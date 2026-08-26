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

  await page.goto('http://localhost:8765/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.verse .vtext', { timeout: 15000 });
  await page.evaluate(() => enterWork());   // 启动先进首页（body.home 隐藏工作区），测试需先切回工作区

  // 切到创世记 11 章（第八篇「终极的完成」经文范围含 11 章）
  await page.evaluate(() => selectChapter(11));
  await new Promise((r) => setTimeout(r, 1500));

  // 打开生命读经 tab
  await page.click('.study-tab[data-tab="lifereading"]');
  await page.waitForSelector('.lr-item', { timeout: 10000 });

  // 收集正文标题层级
  const headings = await page.$$eval('.lr-item .lr-head', els =>
    els.map(el => ({ cls: el.className.replace('lr-head ', ''), text: el.textContent.trim().slice(0, 18) })));
  console.log('生命读经正文标题层级:');
  headings.forEach(h => console.log('  ', h.cls, '|', h.text));

  // 切换到全屏研读，检查纲目侧边栏层级缩进
  await page.click('#studyFullBtn');
  await new Promise((r) => setTimeout(r, 500));
  const toc = await page.$$eval('.lr-toc-item', els =>
    els.map(el => ({ cls: el.className.replace('lr-toc-item ', ''), text: el.textContent.trim().slice(0, 18) })));
  console.log('\n全屏研读纲目侧边栏:');
  toc.forEach(t => console.log('  ', t.cls, '|', t.text));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
})().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
