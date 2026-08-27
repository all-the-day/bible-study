/* 首页补充验证：移动端(375px) + 全局笔记跨书卷跳转 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8765;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });

  // ── A. 移动端 375px ──
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  const m1 = await page.evaluate(() => {
    const cols = getComputedStyle(document.querySelector('#homeGrid')).gridTemplateColumns.split(' ').length;
    return {
      bodyHome: document.body.classList.contains('home'),
      cols, // 375px 宽约 3 列
      menuHidden: getComputedStyle(document.querySelector('#menuBtn')).display === 'none',
      mobileNavHidden: getComputedStyle(document.querySelector('#mobileNav')).display === 'none',
    };
  });
  console.log('A. 移动端首页:', m1.bodyHome ? '✓' : '✗', '| 网格列数:', m1.cols, '| ☰ 隐藏:', m1.menuHidden, '| 底nav隐藏:', m1.mobileNavHidden);
  // 点读经块 → 直接进读经视图（不再弹选章）
  await page.click('#homeGrid .home-block[data-entry="bible"]');
  await new Promise((r) => setTimeout(r, 1500));
  const m2 = await page.evaluate(() => ({
    home: document.body.classList.contains('home'),
    mobileStudy: document.body.classList.contains('mobile-study'),
    popupHidden: document.querySelector('#popup').hidden,
    mobileNav: getComputedStyle(document.querySelector('#mobileNav')).display,
    verseVisible: getComputedStyle(document.querySelector('.verse')).display !== 'none',
  }));
  console.log('   进读经视图: 非首页', !m2.home ? '✓' : '✗', '| 无弹窗', m2.popupHidden ? '✓' : '✗', '| 经文可见', m2.verseVisible ? '✓' : '✗', '| 底nav', m2.mobileNav);
  await page.close();

  // ── B. 笔记管理模块跨书卷聚合 + 首页搜索跨书卷跳转 ──
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 800 });
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push('pageerror: ' + e.message));
  // 预置两条标注：创世记 1:1 + 罗马书 1:1（模拟跨书卷）
  await page2.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page2.evaluate(() => {
    localStorage.setItem('bible-study.annotations', JSON.stringify([
      { id: 'a1', type: 'verse', book: 1, chapter: 1, verse: 1, half: '', start: 0, end: 2, text: '起初', prefix: '', suffix: '', colorId: 'c1', underline: false, note: '创世记的笔记' },
      { id: 'a2', type: 'verse', book: 45, chapter: 1, verse: 1, half: '', start: 0, end: 2, text: '基督', prefix: '', suffix: '', colorId: 'c2', underline: false, note: '罗马书的笔记' },
    ]));
  });
  await page2.reload({ waitUntil: 'networkidle0' });
  await page2.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await page2.click('#homeGrid .home-block[data-entry="notes"]');
  await page2.waitForSelector('.notes-item', { timeout: 5000 });
  const groups = await page2.$$eval('.notes-group', els => els.map(e => e.textContent));
  console.log('B. 笔记模块分组:', groups.join(' | '));
  // 点击条目 → 选中进右栏编辑面板（笔记模块内不跳原文）
  await page2.evaluate(() => { document.querySelectorAll('.notes-item')[0].click(); });
  await new Promise((r) => setTimeout(r, 500));
  const panel = await page2.evaluate(() => ({
    stayNotes: document.body.classList.contains('body-mod-notes'),
    title: document.querySelector('.notes-panel-title')?.textContent,
  }));
  console.log('   点击条目进面板:', panel.stayNotes && panel.title === '经文标注' ? '✓' : '✗', '|', panel.title);

  // 跨书卷跳转改走首页搜索的标注分支：搜「基督」→ 点击结果 → 跳到罗马书
  await page2.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page2.type('#homeSearch', '基督');
  await new Promise((r) => setTimeout(r, 500));
  const srCount = await page2.$$eval('#homeSearchResults .home-sr-item', els => els.length);
  if (srCount) {
    await page2.click('#homeSearchResults .home-sr-item');
    await new Promise((r) => setTimeout(r, 2000));
    const jumped = await page2.evaluate(() => ({
      home: document.body.classList.contains('home'),
      book: document.querySelector('#bookName').textContent,
      ch: document.querySelector('#chapterLabel').textContent,
    }));
    console.log('   搜索跨书卷跳转:', !jumped.home && jumped.book === '罗马书' ? '✓' : '✗', '|', jumped.book, jumped.ch);
  } else {
    console.log('   搜索跨书卷跳转: ✗ 无结果');
  }
  console.log('   JS 错误:', errors2.length ? errors2 : '无');

  await browser.close();
  server.kill();
}
main().catch((e) => { console.error(e); process.exit(1); });
