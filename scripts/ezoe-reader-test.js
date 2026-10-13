/* ezoe 书报合辑专项（2026-10-13）：首批五分类接入
   验证：直进 → 正文 markdown 剥离渲染（无 #/** 字面残留、标题行识别）→
   抽屉双栏（左=分类、右=书条目含「书·部」折叠、底部辑切换条）→ 划线与系列归属 → 恢复位置 */
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

  // 1. 系列清单含 ezoe（5 辑）
  const r1 = await page.evaluate(async () => {
    const idx = await ensureBookSeriesIndex();
    const s = (idx.series || []).find(x => x.id === 'ezoe');
    return { ids: (idx.series || []).map(x => x.id), vols: s && s.volumes, name: s && s.name };
  });
  console.log('1. 系列清单:', r1.ids.includes('ezoe') && r1.vols === 5 ? '✓' : '✗',
    '|', r1.ids.join(','), '| ezoe:', r1.name, r1.vols, '辑');

  // 2. 直进 ezoe 福音类第 1 本第 1 章
  await page.evaluate(() => openBookChapter(1, 0, 0, 'ezoe'));
  await new Promise((r) => setTimeout(r, 2500));
  const r2 = await page.evaluate(() => ({
    modBooks: document.body.classList.contains('body-mod-books'),
    series: state.bookSeries,
    bookName: document.querySelector('#bookName')?.textContent,
    crumb: document.querySelector('#chapterLabel')?.textContent,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
    heads: document.querySelectorAll('#bookMain .bk-head').length,
  }));
  console.log('2. 直进 ezoe:', r2.modBooks && r2.series === 'ezoe' && r2.paras > 0 ? '✓' : '✗',
    '|', r2.series, '|', r2.bookName, '|', r2.crumb, '| 段落:', r2.paras, '| 标题行:', r2.heads);

  // 3. 正文 markdown 剥离：无 #/** 字面残留；首篇「序言」正文首段即源文
  const r3 = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('#bookMain .bk-para, #bookMain .bk-head')].map(el => el.textContent);
    return {
      hashLeft: lines.filter(t => /^#/.test(t.trim())).length,
      boldLeft: lines.filter(t => t.includes('**')).length,
      metaLeft: lines.filter(t => /^\*\*(来源|URL|获取时间)/.test(t.trim())).length,
      firstPara: (lines.find(t => t.length > 10) || '').slice(0, 24),
      dupTitle: lines.filter(t => t.trim() === '到底有没有神' || t.trim() === '壹　序言').length,
    };
  });
  console.log('3. markdown 剥离:', !r3.hashLeft && !r3.boldLeft && !r3.metaLeft && !r3.dupTitle ? '✓' : '✗',
    '| # 残留:', r3.hashLeft, '| ** 残留:', r3.boldLeft, '| 元数据残留:', r3.metaLeft,
    '| 书名/篇名重复行:', r3.dupTitle, '| 首段:', r3.firstPara);

  // 3b. 标题行识别：切到含「一 神的意义」式裸编号小标题的篇（第二篇），bk-head 层级类存在
  await page.evaluate(() => openBookChapter(1, 0, 1, 'ezoe'));
  await new Promise((r) => setTimeout(r, 2500));
  const r3b = await page.evaluate(() => ({
    heads: document.querySelectorAll('#bookMain .bk-head').length,
    lv1: document.querySelectorAll('#bookMain .bk-head.lr-h1').length,
    text: [...document.querySelectorAll('#bookMain .bk-head')].map(x => x.textContent.slice(0, 14)).slice(0, 5),
  }));
  console.log('3b. 标题行识别:', r3b.heads > 0 ? '✓' : '✗', '| bk-head:', r3b.heads, '| lr-h1:', r3b.lv1, '|', JSON.stringify(r3b.text));

  // 4. 抽屉双栏（books 非扁平系列）：左=当前分类的书列表（含多部书「书·部」折叠条目）、
  //    右=选中书的章列表，底部=5 分类切换条
  await page.evaluate(() => { openNavDrawer(); });
  await new Promise((r) => setTimeout(r, 800));
  const r4 = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    const left = [...cols[0].querySelectorAll('.dw-item .t')].map(x => x.title || x.textContent.trim());
    const right = [...cols[1].querySelectorAll('.dw-item .t')].map(x => x.title || x.textContent.trim());
    return {
      leftCount: left.length, leftFirst: left[0],
      folded: left.filter(t => t.includes('·')).length,
      rightCount: right.length, rightFirst: right[0],
      hasNum: !!cols[0].querySelector('.num'),
      hasSub: !!cols[0].querySelector('.sub'),
      footCount: document.querySelectorAll('#dwFoot [data-vol]').length,
      footFirst: document.querySelector('#dwFoot [data-vol]')?.textContent,
    };
  });
  console.log('4. 抽屉双栏:', r4.leftCount === 70 && r4.rightCount === 14 && r4.folded === 16
    && !r4.hasNum && !r4.hasSub && r4.footCount === 5 ? '✓' : '✗',
    '| 左栏:', r4.leftCount, '本 | 首本:', r4.leftFirst, '| 书·部条目:', r4.folded,
    '| 右栏章数:', r4.rightCount, '| 无序号:', !r4.hasNum, '| 无副标:', !r4.hasSub,
    '| 底部条:', r4.footCount, '项 |', r4.footFirst);

  // 4b. 底部条切「读经类」→ 左栏刷新为该分类书列表（dwState.vol=2）
  await page.evaluate(() => {
    document.querySelector('#dwFoot [data-vol="2"]').click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const r4b = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    return {
      dwVol: dwState.vol,
      leftCount: cols[0].querySelectorAll('.dw-item').length,
      leftFirst: cols[0].querySelector('.dw-item .t')?.textContent,
      footSel: document.querySelector('#dwFoot [data-vol].sel')?.textContent,
    };
  });
  console.log('4b. 底部条切分类:', r4b.dwVol === 2 && r4b.leftCount === 28 && r4b.footSel === '读经类' ? '✓' : '✗',
    '| vol:', r4b.dwVol, '| 高亮:', r4b.footSel, '| 左栏:', r4b.leftCount, '本 | 首本:', r4b.leftFirst);

  // 4c. 左栏点多部书条目「正常的基督徒信仰·基督与神」→ 右栏刷新为该部章；点右栏首章 → 打开
  await page.evaluate(() => { document.querySelector('#dwFoot [data-vol="1"]').click(); });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    [...cols[0].querySelectorAll('.dw-item')].find(e => (e.querySelector('.t')?.textContent || '').includes('正常的基督徒信仰·基督与神')).click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const r4c1 = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    return {
      rightCount: cols[1].querySelectorAll('.dw-item').length,
      rightFirst: cols[1].querySelector('.dw-item .t')?.textContent,
    };
  });
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    cols[1].querySelector('.dw-item').click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  const r4c2 = await page.evaluate(() => ({
    series: state.bookSeries,
    bookName: document.querySelector('#bookName')?.textContent,
    crumb: document.querySelector('#chapterLabel')?.textContent,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
  }));
  console.log('4c. 多部书条目直进:', r4c1.rightCount === 4 && r4c2.series === 'ezoe'
    && r4c2.crumb.includes('正常的基督徒信仰·基督与神') && r4c2.paras > 0 ? '✓' : '✗',
    '| 右栏:', r4c1.rightCount, '章 |', r4c2.crumb, '| 段落:', r4c2.paras);

  // 5. 划线标注 → series=ezoe + mark 渲染
  await page.evaluate(() => {
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
  const r5 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const last = anns[anns.length - 1];
    if (last) { last.note = 'ezoe测试笔记'; localStorage.setItem('bible-study.annotations', JSON.stringify(anns)); state.annotations = anns; }
    return { type: last && last.type, series: last && last.series, mark: !!document.querySelector('#bookMain mark.c1') };
  });
  console.log('5. ezoe 划线:', r5.type === 'book' && r5.series === 'ezoe' && r5.mark ? '✓' : '✗', JSON.stringify(r5));

  // 6. 恢复位置：LS_BOOK_LAST 记录 ezoe 系列位置，回首页再进书报回到该章
  const r6a = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.bookLast') || 'null'));
  await page.evaluate(() => { showHome(); enterModule('books'); });
  await new Promise((r) => setTimeout(r, 2500));
  const r6b = await page.evaluate(() => ({
    series: state.bookSeries,
    crumb: document.querySelector('#chapterLabel')?.textContent,
  }));
  console.log('6. 恢复位置:', r6a && r6a.series === 'ezoe' && r6b.series === 'ezoe' ? '✓' : '✗',
    '| last:', JSON.stringify(r6a), '|', r6b.crumb);

  // 7. 笔记管理：树第二级=书名（metaBook.title，同 ni「灵修指微」），无兜底文案；
  //    列表主区分组标签含完整层级「系列名 · 分类名 · 书名」（annGroupLabel）
  await page.evaluate(() => { enterModule('notes'); });
  await new Promise((r) => setTimeout(r, 2500));
  const r7 = await page.evaluate(() => {
    const tree = document.querySelector('#notesNav') || document.querySelector('#dwBody');
    const list = document.querySelector('#notesMain');
    return {
      bookName: tree && tree.textContent.includes('正常的基督徒信仰·基督与神'),
      noFallback: !(tree && (tree.textContent.includes('ezoe 卷') || tree.textContent.includes('卷1书'))),
      fullLabel: !!(list && list.textContent.includes('ezoe书报合辑') && list.textContent.includes('福音类')),
    };
  });
  console.log('7. 笔记树分组:', r7.bookName && r7.noFallback && r7.fullLabel ? '✓' : '✗',
    '| 树含书名:', r7.bookName, '| 无兜底:', r7.noFallback, '| 列表完整label:', r7.fullLabel);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
