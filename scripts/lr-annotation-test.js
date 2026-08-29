const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.verse .vtext', { timeout: 15000 });
  await page.evaluate(() => enterWork());   // 启动先进首页（body.home 隐藏工作区），测试需先切回工作区

  // 切到创世记 24 章（有生命读经）
  await page.evaluate(() => selectChapter(24));
  await new Promise((r) => setTimeout(r, 1500));

  // 打开生命读经 tab
  await page.click('.study-tab[data-tab="lifereading"]');
  await page.waitForSelector('.lr-content', { timeout: 10000 });

  // 选中生命读经第一篇正文的前几个字符（跳过 sup 无 sup，直接取第一个文本节点）
  await page.evaluate(() => {
    const content = document.querySelector('.lr-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, Math.min(6, firstText.length));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const toolVisible = await page.$eval('#floatTool', el => !el.hidden);
  console.log('生命读经选区工具栏出现:', toolVisible);

  // 点绿色 c2
  await page.click('#floatTool .sw.c2');
  await new Promise((r) => setTimeout(r, 200));
  const markCount = await page.$$eval('.lr-content mark.c2', els => els.length);
  const markText = await page.$eval('.lr-content mark.c2', el => el.textContent.slice(0, 20));
  console.log('生命读经 c2 标注数:', markCount, '内容:', markText);

  // 检查存储的类型字段
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.annotations') || '[]'));
  const lrAnn = stored.filter(a => a.type === 'lr');
  console.log('lr 类型标注数:', lrAnn.length, '| 首条:', lrAnn[0] && JSON.stringify({ book: lrAnn[0].book, articleId: lrAnn[0].articleId, start: lrAnn[0].start, end: lrAnn[0].end, colorId: lrAnn[0].colorId }));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
