/* 生命读经模块内划线标注专项测试（回归：rerenderAnn 模块主区重渲染分支）：
 * 直进生命读经阅读器 → 模块正文选区 → 点颜色 → 断言 #lrMain 高亮渲染 + 存储 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8768;

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

  // 1. 直进生命读经模块（创世记第1篇）
  await page.click('#homeGrid .home-block[data-entry="lifereading"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r1 = await page.evaluate(() => ({
    modLr: document.body.classList.contains('body-mod-lifereading'),
    art: document.querySelector('#lrMain .lr-content')?.dataset.article,
  }));
  console.log('1. 直进生命读经模块:', r1.modLr && r1.art === '1' ? '✓' : '✗', '| article:', r1.art);

  // 2. 模块正文选区 → 工具栏出现
  await page.evaluate(() => {
    const content = document.querySelector('#lrMain .lr-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && t.parentElement.tagName === 'SUP') t = walker.nextNode();
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, Math.min(4, t.textContent.length));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const toolVisible = await page.$eval('#floatTool', (el) => !el.hidden);
  console.log('2. 模块内选区工具栏:', toolVisible ? '✓' : '✗');

  // 3. 点黄色 c1 → 高亮必须渲染在 #lrMain（回归点：曾只重渲染研读列导致不生效）
  await page.click('#floatTool .sw.c1');
  await new Promise((r) => setTimeout(r, 400));
  const r3 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    return {
      stored: anns.length,
      last: anns[anns.length - 1] && { type: anns[anns.length - 1].type, colorId: anns[anns.length - 1].colorId },
      markInLrMain: document.querySelectorAll('#lrMain mark.c1').length,
      markStudy: document.querySelectorAll('#studyBody mark.c1').length,
    };
  });
  console.log('3. 点色后 #lrMain 高亮:', r3.markInLrMain > 0 ? '✓' : '✗',
    '| 存储:', r3.stored, JSON.stringify(r3.last), '| lrMain:', r3.markInLrMain, '| 研读列:', r3.markStudy);

  // 4. 切篇再切回 → 高亮回放（自愈锚点定位）
  await page.evaluate(() => { document.querySelectorAll('.lr-nav-art')[1].click(); });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { document.querySelectorAll('.lr-nav-art')[0].click(); });
  await new Promise((r) => setTimeout(r, 800));
  const r4 = await page.evaluate(() => document.querySelectorAll('#lrMain mark.c1').length);
  console.log('4. 切篇切回高亮回放:', r4 > 0 ? '✓' : '✗', '| mark.c1:', r4);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
