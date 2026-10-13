/* ezoe 书报合辑专项（2026-10-13/14）：分类 = 独立系列平级进书报合集层（用户定稿，
   不裹「ezoe书报合辑」大系列切辑）。首批 gospel/reading/writings/periodicals/misc 五类。
   验证：系列清单 → 直进福音类 → 正文 markdown 剥离渲染 → 抽屉双栏（单辑无底部条、
   左=书列表含「书·部」折叠、点左栏刷新右栏）→ 多部书条目直进 → 划线与系列归属 → 恢复位置 */
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

  // 1. 系列清单：ezoe 四分类各为独立系列（各 1 辑），与 bio/ni/slat 平级；
  //    writings 传记、文集类已并入 bio（同类别整合，用户 2026-10-14 定稿）
  const r1 = await page.evaluate(async () => {
    const idx = await ensureBookSeriesIndex();
    const s = (idx.series || []).find(x => x.id === 'gospel');
    return { ids: (idx.series || []).map(x => x.id), vols: s && s.volumes, name: s && s.name };
  });
  const ezoeIds = ['gospel', 'reading', 'periodicals', 'misc'];
  console.log('1. 系列清单:', ezoeIds.every(id => r1.ids.includes(id)) && r1.vols === 1 && !r1.ids.includes('writings') ? '✓' : '✗',
    '|', r1.ids.join(','), '| gospel:', r1.name, r1.vols, '辑');

  // 2. 直进福音类第 1 本第 1 章
  await page.evaluate(() => openBookChapter(1, 0, 0, 'gospel'));
  await new Promise((r) => setTimeout(r, 2500));
  const r2 = await page.evaluate(() => ({
    modBooks: document.body.classList.contains('body-mod-books'),
    series: state.bookSeries,
    bookName: document.querySelector('#bookName')?.textContent,
    crumb: document.querySelector('#chapterLabel')?.textContent,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
  }));
  console.log('2. 直进福音类:', r2.modBooks && r2.series === 'gospel' && r2.bookName === '福音类' && r2.paras > 0 ? '✓' : '✗',
    '|', r2.series, '|', r2.bookName, '|', r2.crumb, '| 段落:', r2.paras);

  // 3. 正文 markdown 剥离：无 #/** 字面残留；书名/篇名二行式不重复渲染
  const r3 = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('#bookMain .bk-para, #bookMain .bk-head')].map(el => el.textContent);
    return {
      hashLeft: lines.filter(t => /^#/.test(t.trim())).length,
      boldLeft: lines.filter(t => t.includes('**')).length,
      metaLeft: lines.filter(t => /^\*\*(来源|URL|获取时间)/.test(t.trim())).length,
      dupTitle: lines.filter(t => t.trim() === '到底有没有神' || t.trim() === '壹　序言').length,
      firstPara: (lines.find(t => t.length > 10) || '').slice(0, 24),
    };
  });
  console.log('3. markdown 剥离:', !r3.hashLeft && !r3.boldLeft && !r3.metaLeft && !r3.dupTitle ? '✓' : '✗',
    '| # 残留:', r3.hashLeft, '| ** 残留:', r3.boldLeft, '| 元数据残留:', r3.metaLeft,
    '| 书名/篇名重复行:', r3.dupTitle, '| 首段:', r3.firstPara);

  // 3b. 标题行识别：第二篇含「一 神的意义」式裸编号小标题
  await page.evaluate(() => openBookChapter(1, 0, 1, 'gospel'));
  await new Promise((r) => setTimeout(r, 2500));
  const r3b = await page.evaluate(() => ({
    heads: document.querySelectorAll('#bookMain .bk-head').length,
    text: [...document.querySelectorAll('#bookMain .bk-head')].map(x => x.textContent.slice(0, 14)).slice(0, 5),
  }));
  console.log('3b. 标题行识别:', r3b.heads > 0 ? '✓' : '✗', '| bk-head:', r3b.heads, '|', JSON.stringify(r3b.text));

  // 4. 抽屉双栏：单辑系列（volume=1）无底部辑切换条；左=书列表（含「书·部」折叠）、右=章
  await page.evaluate(() => openBookChapter(1, 0, 0, 'gospel'));
  await new Promise((r) => setTimeout(r, 2500));
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
      footEmpty: document.querySelector('#dwFoot').innerHTML.trim() === '',
    };
  });
  console.log('4. 抽屉双栏:', r4.leftCount === 70 && r4.rightCount === 14 && r4.folded === 16
    && !r4.hasNum && !r4.hasSub && r4.footEmpty ? '✓' : '✗',
    '| 左栏:', r4.leftCount, '本 | 首本:', r4.leftFirst, '| 书·部条目:', r4.folded,
    '| 右栏章数:', r4.rightCount, '| 无序号:', !r4.hasNum, '| 无副标:', !r4.hasSub,
    '| 单辑无底部条:', r4.footEmpty);

  // 4b. 左栏点多部书的某个「书·部」条目 → 右栏刷新为该部的章（点左栏刷新右栏）
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    [...cols[0].querySelectorAll('.dw-item')].find(e => (e.querySelector('.t')?.textContent || '').includes('人啊，你在那里')).click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const r4b = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    return {
      rightCount: cols[1].querySelectorAll('.dw-item').length,
      rightFirst: cols[1].querySelector('.dw-item .t')?.textContent,
    };
  });
  console.log('4b. 左栏点书刷右栏:', r4b.rightCount >= 4 && r4b.rightFirst ? '✓' : '✗',
    '| 右栏:', r4b.rightCount, '章 | 首章:', r4b.rightFirst);

  // 4c. 左栏点多部书条目「正常的基督徒信仰·基督与神」→ 右栏刷新为该部章；点右栏首章 → 打开
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    [...cols[0].querySelectorAll('.dw-item')].find(e => (e.querySelector('.t')?.textContent || '').includes('正常的基督徒信仰·基督与神')).click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const r4c1 = await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    return { rightCount: cols[1].querySelectorAll('.dw-item').length };
  });
  await page.evaluate(() => {
    const cols = document.querySelectorAll('#dwBody .dw-col');
    cols[1].querySelector('.dw-item').click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  const r4c2 = await page.evaluate(() => ({
    series: state.bookSeries,
    crumb: document.querySelector('#chapterLabel')?.textContent,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
  }));
  console.log('4c. 多部书条目直进:', r4c1.rightCount === 4 && r4c2.series === 'gospel'
    && r4c2.crumb.includes('正常的基督徒信仰·基督与神') && r4c2.paras > 0 ? '✓' : '✗',
    '| 右栏:', r4c1.rightCount, '章 |', r4c2.crumb, '| 段落:', r4c2.paras);

  // 5. 划线标注 → series=gospel + mark 渲染 + 写笔记（笔记管理只收纳带 note 的标注）
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
  console.log('5. 福音类划线:', r5.type === 'book' && r5.series === 'gospel' && r5.mark ? '✓' : '✗', JSON.stringify(r5));

  // 6. 恢复位置：LS_BOOK_LAST 记录 gospel 系列位置，回首页再进书报回到该章
  const r6a = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.bookLast') || 'null'));
  await page.evaluate(() => { showHome(); enterModule('books'); });
  await new Promise((r) => setTimeout(r, 2500));
  const r6b = await page.evaluate(() => ({
    series: state.bookSeries,
    crumb: document.querySelector('#chapterLabel')?.textContent,
  }));
  console.log('6. 恢复位置:', r6a && r6a.series === 'gospel' && r6b.series === 'gospel' ? '✓' : '✗',
    '| last:', JSON.stringify(r6a), '|', r6b.crumb);

  // 7. 笔记管理：树第二级=书名（metaBook.title），无兜底文案；
  //    列表主区分组标签含「系列名 · 辑名 · 书名」（分类系列下系列名=辑名=分类名，同 bio 模式）
  await page.evaluate(() => { enterModule('notes'); });
  await new Promise((r) => setTimeout(r, 2500));
  const r7 = await page.evaluate(() => {
    const tree = document.querySelector('#notesNav') || document.querySelector('#dwBody');
    const list = document.querySelector('#notesMain');
    return {
      bookName: tree && tree.textContent.includes('正常的基督徒信仰·基督与神'),
      noFallback: !(tree && (tree.textContent.includes('gospel 卷') || tree.textContent.includes('卷1书'))),
      fullLabel: !!(list && list.textContent.includes('福音类') && list.textContent.includes('正常的基督徒信仰·基督与神')),
    };
  });
  console.log('7. 笔记树分组:', r7.bookName && r7.noFallback && r7.fullLabel ? '✓' : '✗',
    '| 树含书名:', r7.bookName, '| 无兜底:', r7.noFallback, '| 列表完整label:', r7.fullLabel);

  // 8. bio 合并验证（用户 2026-10-14 定稿：同类别整合）：系列名=传记与文集；
  //    bio 原子集仍在原位（book 0=基督教历史人物小传，旧标注 book/chapter 索引不错位）；
  //    ezoe 传记、文集类书已并入（神圣启示的高峰）；重复书只保留 bio 一份
  const r8 = await page.evaluate(() => {
    const meta = seriesMeta('bio');
    const books = meta ? meta.volumes[0].books : [];
    return {
      name: meta && meta.name,
      count: books.length,
      first: books[0] && books[0].title,
      hasPeak: books.some(b => b.title.indexOf('神圣启示的高峰') === 0),
      dupXianjian: books.filter(b => b.title.indexOf('先见') >= 0).length,
    };
  });
  const ok8 = r8.name === '传记与文集' && r8.count === 41 && r8.first === '《基督教历史人物小传》'
    && r8.hasPeak && r8.dupXianjian === 1;
  console.log('8. bio 合并传记文集:', ok8 ? '✓' : '✗',
    '|', r8.name, '|', r8.count, '本 | book 0:', r8.first, '| 含高峰文集:', r8.hasPeak, '| 先见书:', r8.dupXianjian, '份');

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
