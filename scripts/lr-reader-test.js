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
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

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

  // 4. 切卷(罗马书) → 统一导航抽屉（书卷列表 + 篇目列表）两级跳转
  await page.evaluate(() => openNavDrawer());
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-l="45"]').click());
  await new Promise((r) => setTimeout(r, 1000));
  const r4a = await page.evaluate(() => ({
    curLeft: document.querySelector('#dwBody .dw-col .dw-item.cur')?.dataset.l,
    artCount: document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').length,
  }));
  await page.evaluate(() => document.querySelector('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').click());
  await new Promise((r) => setTimeout(r, 2000));
  const r4 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    art: document.querySelector('#lrMain .lr-content')?.dataset.article,
    artCount: document.querySelectorAll('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item').length,
  }));
  console.log('4. 抽屉切卷罗马书:', r4a.curLeft === '45' && r4.book === '罗马书' && r4.art === '1' ? '✓' : '✗',
    '| 左栏选中:', r4a.curLeft, '| 停靠篇目:', r4a.artCount, '| 停靠篇目2:', r4.artCount);

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

  // 6. ☰ 收起停靠列 / 再点展开
  await page.click('#menuBtn');
  await new Promise((r) => setTimeout(r, 400));
  const r6 = await page.evaluate(() => ({
    dockedOff: !document.body.classList.contains('drawer-docked'),
    drawerGone: document.querySelector('#navDrawer').getBoundingClientRect().width === 0,
  }));
  console.log('6. ☰ 收起停靠列:', r6.dockedOff && r6.drawerGone ? '✓' : '✗');
  await page.click('#menuBtn');   // 展开还原
  await new Promise((r) => setTimeout(r, 400));

  // 7. ⌂ 回首页 → 再进生命读经 → 恢复上次位置（罗马书第1篇）
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="lifereading"]');
  await new Promise((r) => setTimeout(r, 2000));
  const r7 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 12),
    artActive: document.querySelector('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item.cur')?.textContent.slice(0, 6),
  }));
  console.log('7. 回首页再进恢复:', r7.book === '罗马书' ? '✓' : '✗', '|', r7.crumb, '| 停靠active:', r7.artActive);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
