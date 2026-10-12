/* 十二篮系列专项（2026-10-11）：系列切换 → 阅读 → 抽屉双栏（辑=书级条目）→ 划线标注 → 笔记树分组
   验证多系列通用化：seriesMeta 按标注 series 取元数据（ni 硬编码已移除） */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8765;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1000));

  // 1. 系列清单含 slat
  const r1 = await page.evaluate(async () => {
    const idx = await ensureBookSeriesIndex();
    return (idx.series || []).map(s => s.id);
  });
  console.log('1. 系列清单:', r1.includes('ni') && r1.includes('slat') ? '✓' : '✗', '|', r1.join(','));

  // 2. 直进十二篮：openBookChapter(series=slat, volume=1, book=0, chapter=0)
  await page.evaluate(() => openBookChapter(1, 0, 0, 'slat'));
  await new Promise((r) => setTimeout(r, 2000));
  const r2 = await page.evaluate(() => ({
    modBooks: document.body.classList.contains('body-mod-books'),
    series: state.bookSeries,
    bookName: document.querySelector('#bookName')?.textContent,
    crumb: document.querySelector('#chapterLabel')?.textContent,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
  }));
  console.log('2. 直进十二篮:', r2.modBooks && r2.series === 'slat' && r2.bookName === '十二篮' && r2.paras > 0 ? '✓' : '✗',
    '|', r2.bookName, '|', r2.crumb, '| 段落:', r2.paras);

  // 3. 抽屉双栏：左=辑（12 个，title=第N辑）、右=篇列表；
  //    扁平系列无底部辑切换条、辑项无「N篇」副标、篇标题剥掉与正文重复的「第N篇」前缀
  await page.evaluate(() => { openNavDrawer(); });
  await new Promise((r) => setTimeout(r, 800));
  const r3 = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    const left = [...cols[0].querySelectorAll('.dw-item .t')].map(x => x.title || x.textContent.trim());
    const right = [...cols[1].querySelectorAll('.dw-item')].length;
    return {
      leftCount: left.length, firstLeft: left[0], right,
      rightFirst: cols[1].querySelector('.dw-item .t')?.textContent,
      footEmpty: document.querySelector('#dwFoot').innerHTML.trim() === '',
      hasSub: !!cols[0].querySelector('.sub'),
      hasNum: !!cols[0].querySelector('.num'),
    };
  });
  console.log('3. 抽屉双栏:', r3.leftCount === 12 && r3.right === 12 && r3.footEmpty && !r3.hasSub && !r3.hasNum ? '✓' : '✗',
    '| 左栏:', r3.leftCount, '辑 | 首项:', r3.firstLeft, '| 右栏篇数:', r3.right,
    '| 底部条空:', r3.footEmpty, '| 无N篇副标:', !r3.hasSub, '| 无序号:', !r3.hasNum, '| 右栏首篇:', r3.rightFirst);
  console.log('3c. 篇标题剥编号:', r3.rightFirst === '两种的认识主耶稣' ? '✓' : '✗', '| 右栏首篇:', r3.rightFirst);

  // 3d. 标题剥序号覆盖三种写法（第N篇 / 一·壹 / （一）），纯序号标题与含数字词标题保留
  const r3d = await page.evaluate(() => [
    dwChapterLabel('第一篇、两种的认识主耶稣'), dwChapterLabel('一 雅各'), dwChapterLabel('壹 亚当与儿子的名分'),
    dwChapterLabel('（一）引语'), dwChapterLabel('第一篇'), dwChapterLabel('一个见证人的故事'), dwChapterLabel('序'),
  ]);
  console.log('3d. 标题剥序号:', r3d[0] === '两种的认识主耶稣' && r3d[1] === '雅各' && r3d[2] === '亚当与儿子的名分'
    && r3d[3] === '引语' && r3d[4] === '第一篇' && r3d[5] === '一个见证人的故事' && r3d[6] === '序' ? '✓' : '✗',
    '|', JSON.stringify(r3d));

  // 3b. 左栏点「第二辑」→ 抽屉切到第二辑（不反弹回当前阅读辑），右栏随之刷新
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    [...cols[0].querySelectorAll('.dw-item')].find(e => e.dataset.vol === '2').click();
  });
  await new Promise((r) => setTimeout(r, 700));
  const r3b = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    return {
      dwVol: dwState.vol,
      curLeft: cols[0].querySelector('.dw-item.cur')?.dataset.vol,
      rightFirst: cols[1].querySelector('.dw-item .t')?.textContent,
    };
  });
  console.log('3b. 抽屉内切辑:', r3b.dwVol === 2 && r3b.curLeft === '2' && r3b.rightFirst !== r3.rightFirst ? '✓' : '✗',
    '| vol:', r3b.dwVol, '| 高亮:', r3b.curLeft, '| 右栏首篇:', r3b.rightFirst);

  // 4. 划线标注 → 笔记树分组显示「十二篮 第N辑」（seriesMeta 通用化验证点）
  await page.evaluate(() => { closeNavDrawer ? closeNavDrawer() : null; });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    // 取首个正文段落（首节点为文本且够长）——首段「读经：」仅 3 字，setEnd(4) 会越界
    const p = [...document.querySelectorAll('#bookMain .bk-para')]
      .find(el => el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.textContent.length >= 4);
    const range = document.createRange();
    range.setStart(p.firstChild, 0);
    range.setEnd(p.firstChild, 4);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { applyColor('c1'); });
  await new Promise((r) => setTimeout(r, 600));
  const r4 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const last = anns[anns.length - 1];
    if (last) { last.note = '十二篮测试笔记'; localStorage.setItem('bible-study.annotations', JSON.stringify(anns)); state.annotations = anns; }
    return { type: last && last.type, series: last && last.series, mark: !!document.querySelector('#bookMain mark.c1') };
  });
  console.log('4. 十二篮划线+笔记:', r4.type === 'book' && r4.series === 'slat' && r4.mark ? '✓' : '✗', JSON.stringify(r4));

  // 5. 笔记管理树里 slat 分组名是「十二篮 第1辑」（非兜底「slat 卷1书1」）
  await page.evaluate(() => { enterModule('notes'); });
  await new Promise((r) => setTimeout(r, 2500));
  const r5 = await page.evaluate(() => {
    const tree = document.querySelector('#notesNav') || document.querySelector('#dwBody');
    return {
      volName: tree && tree.textContent.includes('第一辑'),        // seriesMeta 生效：辑名真名
      noFallback: !(tree && (tree.textContent.includes('slat') || tree.textContent.includes('卷1'))),  // 无兜底文案
      text: tree ? tree.textContent.slice(0, 120) : '(tree 不存在)',
    };
  });
  console.log('5. 笔记树层级:', r5.volName && r5.noFallback ? '✓' : '✗',
    '| 辑名真名:', r5.volName, '| 无兜底:', r5.noFallback, '|', r5.text.replace(/\s+/g, ' ').slice(0, 100));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
