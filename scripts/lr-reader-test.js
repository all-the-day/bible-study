/* 生命读经阅读器专项测试：直进第一篇、卷条切卷、篇目切篇、右栏纲目/笔记、☰ 折叠、
 * 模块主区划线、回首页再进恢复上次篇目 */
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

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });

  // 1. 点生命读经块 → 直读创世记第1篇
  await page.click('#homeGrid .home-block[data-entry="lifereading"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r1 = await page.evaluate(() => ({
    modLr: document.body.classList.contains('body-mod-lifereading'),
    art: document.querySelector('#lrMain .lr-content')?.dataset.article,
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 14),
    toc: document.querySelectorAll('.lr-side-body .lr-toc-item').length,
  }));
  console.log('1. 直进第一篇:', r1.modLr && r1.art === '1' && r1.crumb.includes('第1篇') ? '✓' : '✗', '| article:', r1.art, '| 纲目项:', r1.toc);

  // 2. 右栏纲目点击 → 定位到标题
  await page.evaluate(() => { document.querySelector('.lr-side-body .lr-toc-item').click(); });
  await new Promise((r) => setTimeout(r, 600));
  const r2 = await page.evaluate(() => document.querySelector('.lr-side-body .lr-toc-item.active')?.textContent.slice(0, 12));
  console.log('2. 纲目点击定位:', r2 ? '✓' : '✗', '| active:', r2);

  // 3. 右栏笔记 tab：输入 → 持久化
  await page.evaluate(() => { document.querySelectorAll('.lr-side-tab')[1].click(); });
  await new Promise((r) => setTimeout(r, 300));
  await page.type('.lr-note-ta', '阅读器测试笔记');
  await new Promise((r) => setTimeout(r, 400));
  const r3 = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.lrNotes') || '{}'));
  const noteKey = Object.keys(r3)[0];
  console.log('3. 篇级笔记持久化:', r3[noteKey] === '阅读器测试笔记' ? '✓' : '✗', '| key:', noteKey);

  // 4. 切卷(罗马书) → 第一篇 + crumb/卷条 active
  await page.evaluate(() => document.querySelector('.lr-vol-strip-btn[data-b="45"]').click());
  await new Promise((r) => setTimeout(r, 2000));
  const r4 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    art: document.querySelector('#lrMain .lr-content')?.dataset.article,
    volActive: document.querySelector('.lr-vol-strip-btn.active')?.textContent,
    artCount: document.querySelectorAll('.lr-nav-art').length,
  }));
  console.log('4. 切卷罗马书:', r4.book === '罗马书' && r4.art === '1' && r4.volActive === '罗' ? '✓' : '✗', '| 篇目:', r4.artCount);

  // 5. 模块主区划线 → 工具条出现（验证 handleSelection 卷定位）
  await page.evaluate(() => {
    const content = document.querySelector('#lrMain .lr-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && t.parentElement.tagName === 'SUP') t = walker.nextNode();
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, 4);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const r5 = await page.$eval('#floatTool', el => !el.hidden);
  console.log('5. 模块主区划线工具条:', r5 ? '✓' : '✗');

  // 6. ☰ 折叠左栏
  await page.click('#menuBtn');
  await new Promise((r) => setTimeout(r, 300));
  const r6 = await page.evaluate(() => ({
    collapsed: document.querySelector('.layout').classList.contains('nav-collapsed'),
    navHidden: getComputedStyle(document.querySelector('#navCol')).display === 'none',
  }));
  console.log('6. ☰ 折叠:', r6.collapsed && r6.navHidden ? '✓' : '✗');
  await page.click('#menuBtn');   // 展开还原
  await new Promise((r) => setTimeout(r, 200));

  // 7. ⌂ 回首页 → 再进生命读经 → 恢复上次位置（罗马书第1篇）
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="lifereading"]');
  await new Promise((r) => setTimeout(r, 2000));
  const r7 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 12),
    volActive: document.querySelector('.lr-vol-strip-btn.active')?.textContent,
  }));
  console.log('7. 回首页再进恢复:', r7.book === '罗马书' && r7.volActive === '罗' ? '✓' : '✗', '|', r7.crumb);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
