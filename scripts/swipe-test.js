/* 滑动翻页专项测试（2026-10-16，小说阅读器式横扫切章/篇）：
 * 四模块横扫切换 + URL 同步 + 边界不动 + 手势判定（慢扫/纵偏不触发）
 * + 与划线选区互斥 + 弹窗守卫 + 淡入反馈类。 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8770;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });

  const base = 'http://127.0.0.1:8765/'.replace('8765', String(PORT));
  const waitSplashGone = () => page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });
  const waitCond = async (fn, want, timeout = 15000) => {
    let v;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      v = await page.evaluate(fn);
      if (want(v)) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    return v;
  };
  // 在 #textCol 上派发横扫触摸序列（与真实触摸同一事件通道）
  const swipe = (dx) => page.evaluate((dxv) => {
    const col = document.getElementById('textCol');
    const target = document.elementFromPoint(195, 420) || col;
    const mk = (type, x, y, touches) => {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      return new TouchEvent(type, { touches, changedTouches: [t], bubbles: true, cancelable: true });
    };
    col.dispatchEvent(mk('touchstart', 195, 420, [new Touch({ identifier: 1, target, clientX: 195, clientY: 420 })]));
    col.dispatchEvent(mk('touchend', 195 + dxv, 420, []));
    return true;
  }, dx);
  // 滑动前等路由就位空闲（真实用户等内容落定再滑；就位中手势会被守卫丢弃）
  const waitRouteIdle = () => page.waitForFunction(() => !_routeApplying && !_routeBusy, { timeout: 30000 });

  // 1. 冷启动进读经 创1
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.click('#homeGrid .home-block[data-entry="bible"]');
  await waitCond(() => ({ hash: location.hash, verses: document.querySelectorAll('#verseContainer .verse .vtext').length }),
    v => v.hash === '#/bible/1/1' && v.verses > 0);

  // 2. 向左滑 = 下一章（URL 同步 + 淡入类）
  await waitRouteIdle();
  await swipe(-120);
  const r2 = await waitCond(() => ({ hash: location.hash, ch: state.currentChapter }), v => v.hash === '#/bible/1/2');
  const fade = await page.evaluate(() => document.getElementById('textCol').classList.contains('swipe-in-l'));
  console.log('2. 左滑下一章:', (r2.hash === '#/bible/1/2' && r2.ch === 2 && fade) ? '✓' : '✗', `| ${r2.hash} 淡入类:${fade}`);

  // 3. 向右滑 = 上一章
  await waitRouteIdle();
  await swipe(120);
  const r3 = await waitCond(() => ({ hash: location.hash, ch: state.currentChapter }), v => v.hash === '#/bible/1/1');
  const fadeR = await page.evaluate(() => document.getElementById('textCol').classList.contains('swipe-in-r'));
  console.log('3. 右滑上一章:', (r3.hash === '#/bible/1/1' && fadeR) ? '✓' : '✗');

  // 4. 边界不动：创1 再右滑
  await waitRouteIdle();
  await swipe(120);
  await new Promise((r) => setTimeout(r, 500));
  const r4 = await page.evaluate(() => ({ hash: location.hash, ch: state.currentChapter }));
  console.log('4. 卷首边界不动:', (r4.hash === '#/bible/1/1' && r4.ch === 1) ? '✓' : '✗');

  // 5. 手势判定：慢扫（dt>600ms）与纵偏（dy≥40）不触发
  await page.evaluate(() => {
    const col = document.getElementById('textCol');
    const target = document.elementFromPoint(195, 420) || col;
    const mk = (type, x, y, touches) => {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      return new TouchEvent(type, { touches, changedTouches: [t], bubbles: true, cancelable: true });
    };
    // 慢扫
    col.dispatchEvent(mk('touchstart', 195, 420, [new Touch({ identifier: 1, target, clientX: 195, clientY: 420 })]));
    setTimeout(() => col.dispatchEvent(mk('touchend', 75, 420, [])), 800);
  });
  await new Promise((r) => setTimeout(r, 1100));
  const r5a = await page.evaluate(() => state.currentChapter);
  // 纵偏
  await page.evaluate(() => {
    const col = document.getElementById('textCol');
    const target = document.elementFromPoint(195, 420) || col;
    const mk = (type, x, y, touches) => {
      const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
      return new TouchEvent(type, { touches, changedTouches: [t], bubbles: true, cancelable: true });
    };
    col.dispatchEvent(mk('touchstart', 195, 420, [new Touch({ identifier: 1, target, clientX: 195, clientY: 420 })]));
    col.dispatchEvent(mk('touchend', 35, 520, []));
  });
  await new Promise((r) => setTimeout(r, 500));
  const r5b = await page.evaluate(() => ({ ch: state.currentChapter, hash: location.hash }));
  console.log('5. 手势判定（慢扫/纵偏不触发）:', (r5a === 1 && r5b.ch === 1) ? '✓' : '✗', `| ch: ${r5a}→${r5b.ch}`);

  // 6. 选区互斥：有选区时横扫不切章，且走标注流程（工具栏出现）
  //    注意：第一个文本节点是节号 vnum（选它不算正文标注），跳过它选真正的经文文本
  await page.evaluate(() => {
    const vtext = document.querySelector('#verseContainer .verse .vtext');
    const walker = document.createTreeWalker(vtext, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && t.textContent.length < 4) t = walker.nextNode();
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, Math.min(4, t.textContent.length));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await waitRouteIdle();
  await swipe(-120);
  const r6 = await waitCond(() => ({ ch: state.currentChapter, toolbar: !document.getElementById('floatTool').hidden }),
    v => v.toolbar);
  await page.evaluate(() => { const sel = getSelection(); sel && sel.removeAllRanges(); });
  console.log('6. 有选区不切章（走标注流程）:', (r6.ch === 1 && r6.toolbar) ? '✓' : '✗', `| ch: ${r6.ch} 工具栏: ${r6.toolbar}`);

  // 7. 弹窗守卫
  await page.evaluate(() => openSettingsModal());
  await waitRouteIdle();
  await swipe(-120);
  await new Promise((r) => setTimeout(r, 500));
  const r7 = await page.evaluate(() => ({ ch: state.currentChapter, popupOpen: !document.getElementById('popup').hidden }));
  await page.evaluate(() => closePopupAll());
  console.log('7. 弹窗开着不切章:', (r7.ch === 1 && r7.popupOpen) ? '✓' : '✗');

  // 8. 生命读经：#/lr/1/2 → 左滑 第3篇
  await page.goto(base + '#/lr/1/2', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'lifereading' && state.lrArticleId === 2, { timeout: 30000 });
  await waitRouteIdle();
  await swipe(-120);
  const r8 = await waitCond(() => ({ hash: location.hash, art: state.lrArticleId }), v => v.hash === '#/lr/1/3');
  console.log('8. 生命读经左滑切篇:', r8.hash === '#/lr/1/3' ? '✓' : '✗', `| ${r8.hash}`);

  // 9. 书报：#/book/slat/1/0/0 → 左滑 第2篇
  await page.goto(base + '#/book/slat/1/0/0', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'books' && state.bookChapter === 0, { timeout: 30000 });
  await waitRouteIdle();
  await swipe(-120);
  const r9 = await waitCond(() => ({ hash: location.hash, ch: state.bookChapter }), v => v.hash === '#/book/slat/1/0/1');
  console.log('9. 书报左滑切章:', r9.hash === '#/book/slat/1/0/1' ? '✓' : '✗');

  // 10. 听抄：#/morning/2026-03/1 → 左滑 第2篇
  await page.goto(base + '#/morning/2026-03/1', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'morning' && state.morningChapterId === 1, { timeout: 30000 });
  await waitRouteIdle();
  await swipe(-120);
  const r10 = await waitCond(() => ({ hash: location.hash, ch: state.morningChapterId }), v => v.hash === '#/morning/2026-03/2');
  console.log('10. 听抄左滑切篇:', r10.hash === '#/morning/2026-03/2' ? '✓' : '✗');

  // 11. notes 模块横扫无效果也不报错
  await page.goto(base + '#/notes', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'notes', { timeout: 30000 });
  await waitRouteIdle();
  await swipe(-120);
  await new Promise((r) => setTimeout(r, 400));
  const r11 = await page.evaluate(() => ({ hash: location.hash, mod: state.activeModule }));
  console.log('11. notes 模块横扫无副作用:', (r11.hash === '#/notes' && r11.mod === 'notes') ? '✓' : '✗');

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
