/* 书报合集层专项（2026-10-12）：首页 6 块（倪文集/书报拆分）→ 书报二级层 → 合集块直进 → 搜索 */
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
  let fail = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // 1. 首页 6 块且含 倪文集/书报
    const r1 = await page.evaluate(() => [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry));
    const ok1 = r1.length === 6 && r1.includes('ni') && r1.includes('bookhub');
    console.log('1. 首页 6 块:', ok1 ? '✓' : '✗', '|', r1.join(','));
    if (!ok1) fail = 1;

    // 2. 点倪文集 → 直达 ni 阅读器
    await page.click('#homeGrid .home-block[data-entry="ni"]');
    await new Promise((r) => setTimeout(r, 2000));
    const r2 = await page.evaluate(() => ({
      work: state.screen === 'work',
      series: state.bookSeries,
      crumb: document.querySelector('#chapterLabel')?.textContent.slice(0, 14),
    }));
    const ok2 = r2.work && r2.series === 'ni' && r2.crumb;
    console.log('2. 倪文集直达:', ok2 ? '✓' : '✗', '|', r2.series, '|', r2.crumb);
    if (!ok2) fail = 1;

    // 3. ⌂ 回首页 → 点书报 → 合集层（无 ni）
    await page.click('#homeBtn');
    await new Promise((r) => setTimeout(r, 500));
    await page.click('#homeGrid .home-block[data-entry="bookhub"]');
    await new Promise((r) => setTimeout(r, 1500));
    const r3 = await page.evaluate(() => ({
      bookhub: document.body.classList.contains('bookhub'),
      home: document.body.classList.contains('home'),
      blocks: [...document.querySelectorAll('#bookHubGrid .home-block')].map(b => b.dataset.series),
    }));
    const ok3 = r3.bookhub && !r3.home && r3.blocks.includes('slat') && r3.blocks.includes('bio') && !r3.blocks.includes('ni');
    console.log('3. 合集层:', ok3 ? '✓' : '✗', '| bookhub 态:', r3.bookhub, '| 块:', r3.blocks.join(','));
    if (!ok3) fail = 1;

    // 4. 点十二篮块 → slat 阅读器
    await page.click('#bookHubGrid .home-block[data-series="slat"]');
    await new Promise((r) => setTimeout(r, 2000));
    const r4 = await page.evaluate(() => ({
      work: state.screen === 'work',
      series: state.bookSeries,
      crumb: document.querySelector('#chapterLabel')?.textContent.slice(0, 16),
      bookhubGone: !document.body.classList.contains('bookhub'),
    }));
    const ok4 = r4.work && r4.series === 'slat' && r4.bookhubGone;
    console.log('4. 十二篮直进:', ok4 ? '✓' : '✗', '|', r4.series, '|', r4.crumb);
    if (!ok4) fail = 1;

    // 5. 回合集层搜索「两种的认识」→ 跨合集命中：ezoe 篇目与十二篮篇目同列
    //    （series 按 id 排序，ezoe 首条），点击第一条直进 ezoe 该篇
    await page.click('#homeBtn');
    await new Promise((r) => setTimeout(r, 400));
    await page.click('#homeGrid .home-block[data-entry="bookhub"]');
    await new Promise((r) => setTimeout(r, 1200));
    await page.type('#bookHubSearch', '两种的认识');
    await new Promise((r) => setTimeout(r, 600));
    const r5 = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#bookHubSearchResults .home-sr-item')];
      return {
        first: items[0]?.textContent || '',
        hasLoc: !!items[0]?.querySelector('.sr-loc'),
        hasSlat: items.some(x => x.textContent.includes('两种的认识主耶稣') && x.textContent.includes('十二篮')),
        hasEzoe: items.some(x => x.textContent.includes('ezoe书报合辑')),
      };
    });
    const ok5 = r5.first.includes('两种的认识') && r5.hasLoc && r5.hasSlat && r5.hasEzoe;
    console.log('5. 合集层搜索:', ok5 ? '✓' : '✗', '|', r5.first.slice(0, 40));
    if (!ok5) fail = 1;

    // 5b. 点击第一条搜索结果 → 直进 ezoe 该篇（合集层搜索跳转链路）
    await page.click('#bookHubSearchResults .home-sr-item');
    await new Promise((r) => setTimeout(r, 1500));
    const r5b = await page.evaluate(() => ({
      work: state.screen === 'work',
      series: state.bookSeries,
      hubGone: !document.body.classList.contains('bookhub'),
      bkTitle: document.querySelector('.bk-title')?.textContent.slice(0, 20) || '',
    }));
    const ok5b = r5b.work && r5b.series === 'ezoe' && r5b.hubGone;
    console.log('5b. 搜索点击直进:', ok5b ? '✓' : '✗', '|', r5b.series, '|', r5b.bkTitle);
    if (!ok5b) fail = 1;

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(fail);
}
main().catch((e) => { console.error(e); process.exit(1); });
