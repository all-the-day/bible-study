/* 书报阅读器专项测试：直进第1辑第1本、辑条切辑、书列表切书、右栏章列表/笔记、
 * 书报划线标注、全局笔记书报分组跳转、回首页再进恢复 */
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
  await new Promise((r) => setTimeout(r, 1500));

  // 1. 点书报块 → 直进第1辑第1本第1章
  await page.click('#homeGrid .home-block[data-entry="books"]');
  await new Promise((r) => setTimeout(r, 3500));
  const r1 = await page.evaluate(() => ({
    modBooks: document.body.classList.contains('body-mod-books'),
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 18),
    filter: (() => { const el = document.querySelector('#bookNav input'); return !!el && getComputedStyle(el).display !== 'none'; })(),
    bookCount: document.querySelectorAll('.bk-nav-book').length,
    title: document.querySelector('.bk-title')?.textContent,
    paraCount: document.querySelectorAll('.bk-para').length,
    sideTabs: [...document.querySelectorAll('#bookSide .lr-side-tab')].map(t => t.textContent).join('|'),
    actionsHidden: getComputedStyle(document.querySelector('#viewModeBtn')).display === 'none',
  }));
  console.log('1. 书报直进:', r1.modBooks && r1.filter && r1.bookCount === 20 && r1.crumb.includes('灵修指微') ? '✓' : '✗',
    '| crumb:', r1.crumb, '| 章数:', r1.paraCount > 0 ? '>' + r1.paraCount : '✗', '| tabs:', r1.sideTabs);

  // 2. 右栏章列表 → 切第2章
  await page.evaluate(() => { document.querySelectorAll('.bk-toc-item')[1].click(); });
  await new Promise((r) => setTimeout(r, 1500));
  const r2 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    tocActive: document.querySelector('.bk-toc-item.active')?.textContent.slice(0, 14),
  }));
  console.log('2. 切章:', r2.crumb.includes('第2章') && r2.tocActive ? '✓' : '✗', '|', r2.crumb, '| active:', r2.tocActive);

  // 3. 书列表切书(第2本) → 第1章
  await page.evaluate(() => { document.querySelectorAll('.bk-nav-book')[1].click(); });
  await new Promise((r) => setTimeout(r, 1500));
  const r3 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    bookActive: document.querySelector('.bk-nav-book.active .bkb-title')?.textContent.slice(0, 10),
  }));
  console.log('3. 切书:', r3.crumb.includes('十字架的道') && r3.crumb.includes('第1章') ? '✓' : '✗', '|', r3.crumb);

  // 4. crumb 弹窗（辑 Tab + 书列表）切第2辑 → 第1本第1章
  await page.evaluate(() => openBookPicker());
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => document.querySelectorAll('#bkpVols .chp-book')[1].click());
  await new Promise((r) => setTimeout(r, 600));
  const r4a = await page.evaluate(() => ({
    tabActive: document.querySelector('#bkpVols .chp-book.active')?.textContent,
    pickerBooks: document.querySelectorAll('#bkpBooks .bk-nav-book').length,
  }));
  await page.evaluate(() => document.querySelector('#bkpBooks .bk-nav-book').click());
  await new Promise((r) => setTimeout(r, 2000));
  const r4 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    bookCount: document.querySelectorAll('#bookNav .bk-nav-book').length,
  }));
  console.log('4. 弹窗切辑:', r4a.tabActive === '第二辑' && r4a.pickerBooks === 26 && r4.bookCount === 26 ? '✓' : '✗',
    '| Tab:', r4a.tabActive, '|', r4.crumb, '| 书数:', r4.bookCount);

  // 5. 划线标注 → 保存 + 高亮
  await page.evaluate(() => {
    const content = document.querySelector('#bookMain .book-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && (t.parentElement.tagName === 'SUP' || t.parentElement.classList.contains('ref-link'))) t = walker.nextNode();
    const len = Math.min(4, t.textContent.length);
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, len);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#floatTool .sw.c2');
  await new Promise((r) => setTimeout(r, 500));
  const r5 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const last = anns[anns.length - 1];
    return { type: last && last.type, vol: last && last.volume, mark: !!document.querySelector('#bookMain mark.c2') };
  });
  console.log('5. 书报划线:', r5.type === 'book' && r5.vol === 2 && r5.mark ? '✓' : '✗', JSON.stringify(r5));

  // 6. 回首页 → 笔记管理模块 → 书报 tab 分组 → 点击选中进编辑面板（不再跳回原文）
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await new Promise((r) => setTimeout(r, 1200));
  const r6 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-notes'),
    tabs: [...document.querySelectorAll('.notes-tab')].map(t => t.textContent).join('|'),
    groups: [...document.querySelectorAll('.notes-group')].map(g => g.textContent).join('|'),
  }));
  console.log('6. 笔记模块:', r6.mod && r6.tabs.includes('书报') ? '✓' : '✗', '| 分组:', r6.groups);
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '书报').click(); });
  await new Promise((r) => setTimeout(r, 500));
  const itemCount = await page.$$eval('.notes-item', els => els.length);
  if (itemCount) {
    await page.click('.notes-item');
    await new Promise((r) => setTimeout(r, 500));
    const r6b = await page.evaluate(() => ({
      panelTitle: document.querySelector('.notes-panel-title')?.textContent,
      stayNotes: document.body.classList.contains('body-mod-notes'),
      modBooks: document.body.classList.contains('body-mod-books'),
    }));
    console.log('   点击选中:', r6b.panelTitle === '书报标注' && r6b.stayNotes && !r6b.modBooks ? '✓' : '✗', '| 面板:', r6b.panelTitle);
  } else {
    console.log('   点击选中: ✗ 无条目');
  }

  // 7. ⌂ 回首页再进书报 → 恢复上次位置
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="books"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r7 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    volMeta: (state.bookMeta.volumes[state.bookVolume - 1] || {}).title,
  }));
  console.log('7. 回首页再进恢复:', r7.volMeta === '第二辑' && r7.crumb.includes('复刊基督徒报') && r7.crumb.includes('第1章') ? '✓' : '✗', '|', r7.crumb);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
