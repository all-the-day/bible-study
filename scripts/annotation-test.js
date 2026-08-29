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

  // 1. 选中首节「起初」二字（前 2 个文本字符）
  await page.evaluate(() => {
    const vtext = document.querySelector('.verse .vtext');
    const walker = document.createTreeWalker(vtext, NodeFilter.SHOW_TEXT);
    let firstText = walker.nextNode();
    // 跳过 <sup> 注脚/串珠标记的文本节点
    while (firstText && firstText.parentElement.tagName === 'SUP') firstText = walker.nextNode();
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, 2);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const toolVisible = await page.$eval('#floatTool', el => !el.hidden);
  console.log('浮动工具栏出现:', toolVisible);

  // 2. 点黄色 c1
  await page.click('#floatTool .sw.c1');
  await new Promise((r) => setTimeout(r, 200));
  const markCount = await page.$$eval('mark.c1', els => els.length);
  const markText = await page.$eval('mark.c1', el => el.textContent);
  console.log('c1 标注数量:', markCount, '内容:', markText);

  // 3. 检查 localStorage 持久化
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.annotations') || '[]'));
  console.log('存储标注数:', stored.length, '| 首条:', stored[0] && JSON.stringify({ book: stored[0].book, chapter: stored[0].chapter, verse: stored[0].verse, start: stored[0].start, end: stored[0].end, colorId: stored[0].colorId }));

  // 4. 刷新后标注是否回放（刷新后回到首页，同样先切回工作区）
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.verse .vtext', { timeout: 15000 });
  await page.evaluate(() => enterWork());
  await new Promise((r) => setTimeout(r, 300));
  const markAfterReload = await page.$$eval('mark.c1', els => els.length);
  console.log('刷新后 c1 标注数量:', markAfterReload);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
