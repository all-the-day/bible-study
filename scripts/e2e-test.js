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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.verse', { timeout: 15000 });
  await page.evaluate(() => enterWork());   // 启动先进首页（body.home 隐藏工作区），测试需先切回工作区

  // 1. 默认创世记第1章，检查首节文本
  const firstVerse = await page.$eval('.verse .vtext', el => el.textContent);
  console.log('首节文本:', firstVerse.slice(0, 40));

  // 2. 检查注脚上标数量（创1:1 有 4 个注脚 + 2 个串珠）
  const fnCount = await page.$$eval('sup.fn-ref', els => els.length);
  console.log('注脚上标数量:', fnCount);

  // 3. 点击第一个注脚，检查弹窗
  await page.click('sup.fn-ref');
  await page.waitForSelector('#popup:not([hidden])', { timeout: 5000 });
  const popupTitle = await page.$eval('#popupTitle', el => el.textContent);
  console.log('弹窗标题:', popupTitle);
  await page.click('#popupClose');

  // 4. 点击串珠 [a]，检查弹窗解析
  await page.click('sup.xref-ref[data-xref="a"]');
  await page.waitForSelector('#popup:not([hidden])', { timeout: 5000 });
  const xrefTitle = await page.$eval('#popupTitle', el => el.textContent);
  const xrefBody = await page.$eval('#popupBody', el => el.textContent.slice(0, 80));
  console.log('串珠弹窗:', xrefTitle, '|', xrefBody);
  await page.click('#popupClose');

  // 5. 切到创世记第24章
  await page.evaluate(() => selectChapter(24));
  await page.waitForFunction(() => document.querySelector('.verse .vtext'), { timeout: 10000 });
  const ch24Text = await page.$eval('.verse .vtext', el => el.textContent);
  console.log('创24 首节:', ch24Text.slice(0, 40));

  // 6. 检查生命读经 tab
  await page.click('.study-tab[data-tab="lifereading"]');
  await new Promise((r) => setTimeout(r, 2000));
  const lrCount = await page.$$eval('.lr-item', els => els.length);
  console.log('创24 相关生命读经篇数:', lrCount);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
