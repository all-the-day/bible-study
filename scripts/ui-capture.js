/* UI 风格梳理：当前界面基线截图（桌面 1280x800 + 移动端 390x844）
   用途：① 风格 Case 对比的「现状」侧；② 后续样式重构的回归对照基线
   输出：generated-images/ui-style/current/*.png
   独立端口 8766 自起服务器，不干扰 8765 测试/用户浏览器 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;
const TAG = process.argv[2] || 'current';   // 输出子目录名：current=基线 / after-classic=token 化后 / paper|indigo|minimal=对应主题
const OUT = path.join(ROOT, 'generated-images', 'ui-style', TAG);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const errors = [];
  // 主题预置（TAG=主题名时切到该主题再截图；current/after-classic 不动）
  if (['paper', 'indigo', 'minimal'].includes(TAG)) {
    const pre = await browser.newPage();
    await pre.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pre.evaluate((t) => { try { localStorage.setItem('bible-study.theme', JSON.stringify(t)); } catch (e) {} }, TAG);
    await pre.close();
  }
  async function newPage(w, h) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()); });
    await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
    return page;
  }
  async function shot(page, name) {
    await new Promise((r) => setTimeout(r, 450));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('✓', name);
  }

  // ── 桌面 1280x800 ──
  const d = await newPage(1280, 800);
  await d.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await d.waitForSelector('#splash.hidden', { timeout: 30000 });
  await shot(d, 'd-home');
  await d.evaluate(() => { enterWork(); });
  await shot(d, 'd-bible');
  await d.evaluate(() => { if (!document.body.classList.contains('drawer-docked')) toggleDrawerDock(); });
  await shot(d, 'd-bible-drawer');
  await d.evaluate(() => toggleDrawerDock());
  await d.evaluate(() => { enterModule('lifereading'); });
  await shot(d, 'd-lifereading');
  await d.evaluate(() => { enterModule('books', { series: 'ni' }); });
  await shot(d, 'd-book-ni');
  await d.evaluate(() => { openBookHub(); });
  await shot(d, 'd-bookhub');
  await d.evaluate(() => { enterModule('morning'); });
  await shot(d, 'd-morning');
  await d.evaluate(() => { enterModule('notes'); });
  await shot(d, 'd-notes');
  await d.evaluate(() => { enterModule('bible'); openSettingsModal(); });
  await shot(d, 'd-settings');

  // ── 移动端 390x844 ──
  const m = await newPage(390, 844);
  await m.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await m.waitForSelector('#splash.hidden', { timeout: 30000 });
  await shot(m, 'm-home');
  await m.evaluate(() => { enterWork(); });
  await shot(m, 'm-bible');
  await m.evaluate(() => { enterModule('lifereading'); });
  await shot(m, 'm-lifereading');

  await browser.close();
  server.kill();
  if (errors.length) { console.log('JS 错误: [' + errors.join(' | ') + ']'); process.exit(1); }
  console.log('完成 →', OUT);
}

main().catch((e) => { console.error('捕获失败:', e.message); process.exit(1); });
