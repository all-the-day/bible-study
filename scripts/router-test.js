/* 路由专项测试（hash 路由 + Android 返回键逻辑，2026-10-15）：
 * URL 同步（进模块/翻章/换模块）、翻页 replace 不堆历史、浏览器后退/前进跨模块就位、
 * 刷新保持位置、冷启动深链（读经/书报/生命读经/听抄/notes/hub）、非法 hash 净化、
 * 章号越界钳制、原生返回键层级（弹窗→历史后退→exitApp，伪 Capacitor 注入）、
 * 移动端返回键关抽屉、书报合集层 push/back。 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8769;

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
  await page.evaluateOnNewDocument(() => {
    window.BIBLE_SKIP_UPDATE = true;   // 跳过启动静默更新检查（省 GitHub API 配额）
    sessionStorage.setItem('t-boots', String((+sessionStorage.getItem('t-boots') || 0) + 1));   // 供移动端切换后等待重载
  });

  const base = 'http://127.0.0.1:' + PORT + '/';
  const waitHash = (h) => page.waitForFunction((x) => location.hash === x, { timeout: 20000 }, h);
  const waitNoHash = () => page.waitForFunction(() => !location.hash, { timeout: 20000 });
  const waitHome = () => page.waitForFunction(() => document.body.classList.contains('home'), { timeout: 20000 });
  const waitSplashGone = () => page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });
  const waitRouteIdle = () => page.waitForFunction(() => !_routeApplying && !_routeBusy, { timeout: 30000 });   // 上一次就位完成

  // 1. 冷启动首页：无 hash
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  const r1 = await page.evaluate(() => ({ home: document.body.classList.contains('home'), hash: location.hash }));
  console.log('1. 冷启动首页无 hash:', r1.home && !r1.hash ? '✓' : '✗', '| hash:', JSON.stringify(r1.hash));

  // 2. 点合集块进读经 → URL 同步（push 新增历史）
  const len0 = await page.evaluate(() => history.length);
  await page.click('#homeGrid .home-block[data-entry="bible"]');
  await waitHash('#/bible/1/1');
  await waitRouteIdle();
  const len1 = await page.evaluate(() => history.length);
  console.log('2. 进读经 URL 同步:', len1 > len0 ? '✓' : '✗', `| #/bible/1/1 | history ${len0}→${len1}`);

  // 3. 翻章 replace：URL 跟随、历史不增
  await page.evaluate(() => selectChapter(2));
  await waitHash('#/bible/1/2');
  const len2 = await page.evaluate(() => history.length);
  console.log('3. 翻章 replace 不堆历史:', len2 === len1 ? '✓' : '✗', `| history ${len1}→${len2}`);

  // 4. 浏览器后退 → 回首页（replace 语义：一步回根，不逐章回退）
  await page.goBack();
  await waitNoHash();
  await waitHome();
  await waitRouteIdle();
  console.log('4. 后退一步回首页（非逐章）: ✓');

  // 5. 前进 → 回读经 ch2 就位
  await page.goForward();
  await waitHash('#/bible/1/2');
  await waitRouteIdle();
  const r5 = await page.evaluate(() => ({ home: document.body.classList.contains('home'), label: document.getElementById('chapterLabel').textContent }));
  console.log('5. 前进回到 ch2:', (!r5.home && r5.label === '2章') ? '✓' : '✗', '| label:', r5.label);

  // 5b. 刷新保持位置（reload 走深链）
  await page.reload({ waitUntil: 'networkidle0' });
  await waitSplashGone();
  const ok5b = await page.waitForFunction(() => state.screen === 'work' && state.currentChapter === 2 && location.hash === '#/bible/1/2', { timeout: 20000 }).then(() => true).catch(() => false);
  await waitRouteIdle();
  console.log('5b. 刷新保持位置:', ok5b ? '✓' : '✗');

  // 6. 换模块 push（读经 → 生命读经）
  const lenA = await page.evaluate(() => history.length);
  await page.evaluate(() => openLrArticle(1, { id: 2 }));
  await waitHash('#/lr/1/2');
  const r6 = await page.evaluate(() => ({ mod: state.activeModule, len: history.length }));
  console.log('6. 换模块 push:', (r6.mod === 'lifereading' && r6.len > lenA) ? '✓' : '✗', `| ${r6.mod} history ${lenA}→${r6.len}`);

  // 7. 生命读经切篇 replace
  await page.evaluate(() => selectLrArticle(3));
  await waitHash('#/lr/1/3');
  const lenB = await page.evaluate(() => history.length);
  console.log('7. 生命读经切篇 replace:', lenB === r6.len ? '✓' : '✗', `| history ${r6.len}→${lenB}`);

  // 8. 后退/前进跨模块就位
  await page.goBack();
  await waitHash('#/bible/1/2');
  await waitRouteIdle();
  const r8a = await page.evaluate(() => ({ mod: state.activeModule, label: document.getElementById('chapterLabel').textContent }));
  await page.goForward();
  await waitHash('#/lr/1/3');
  await waitRouteIdle();
  const r8b = await page.evaluate(() => state.activeModule);
  console.log('8. 后退/前进跨模块:', (r8a.mod === 'bible' && r8a.label === '2章' && r8b === 'lifereading') ? '✓' : '✗',
    `| back→${r8a.mod} 前进→${r8b}`);

  // 9. 书报深链冷启动：精确就位（含防「续接上次位置」纠偏）
  await page.goto(base + '#/book/ni/1/0/2', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'books' && state.bookChapter === 2, { timeout: 30000 });
  await waitRouteIdle();
  const r9 = await page.evaluate(() => ({ hash: location.hash, series: state.bookSeries, vol: state.bookVolume, book: state.bookBook, ch: state.bookChapter }));
  console.log('9. 书报深链精确就位:', (r9.hash === '#/book/ni/1/0/2' && r9.series === 'ni' && r9.vol === 1 && r9.book === 0 && r9.ch === 2) ? '✓' : '✗', JSON.stringify(r9));

  // 10. 生命读经深链（跨卷：马太福音 40 卷）
  await page.goto(base + '#/lr/40/3', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'lifereading' && state.lrArticleId === 3, { timeout: 30000 });
  await waitRouteIdle();
  const r10 = await page.evaluate(() => ({ hash: location.hash, book: state.lrBookIndex }));
  console.log('10. 生命读经深链:', (r10.hash === '#/lr/40/3' && r10.book === 40) ? '✓' : '✗', JSON.stringify(r10));

  // 11. 听抄深链
  await page.goto(base + '#/morning/2026-03/3', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'morning' && state.morningChapterId === 3, { timeout: 30000 });
  await waitRouteIdle();
  const r11 = await page.evaluate(() => ({ hash: location.hash, period: state.morningPeriod }));
  console.log('11. 听抄深链:', (r11.hash === '#/morning/2026-03/3' && r11.period === '2026-03') ? '✓' : '✗', JSON.stringify(r11));

  // 12. 笔记模块 + 书报合集层深链
  await page.goto(base + '#/notes', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.activeModule === 'notes' && state.screen === 'work', { timeout: 30000 });
  await waitRouteIdle();
  const r12a = await page.evaluate(() => location.hash === '#/notes');
  await page.goto(base + '#/hub', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.screen === 'bookhub', { timeout: 30000 });
  await waitRouteIdle();
  const r12b = await page.evaluate(() => document.body.classList.contains('bookhub'));
  console.log('12. notes / hub 深链:', (r12a && r12b) ? '✓' : '✗');

  // 13. 非法 hash 净化回首页（含小数章号等手输垃圾路由）
  await page.goto(base + '#/bible/999/1', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await waitHome();
  await waitNoHash();
  await waitRouteIdle();
  await page.goto(base + '#/bible/1/2.5', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  const ok13b = await page.waitForFunction(() => document.body.classList.contains('home') && !location.hash, { timeout: 20000 }).then(() => true).catch(() => false);
  console.log('13. 非法 hash → 首页 + URL 净化:', ok13b ? '✓' : '✗');

  // 14. 章越界钳制（创世记 50 章：999 → 50）
  await page.goto(base + '#/bible/1/999', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  const ok14 = await waitHash('#/bible/1/50').then(() => true).catch(() => false);
  await waitRouteIdle();
  const r14 = await page.evaluate(() => state.currentChapter);
  console.log('14. 章越界钳制到 50:', (ok14 && r14 === 50) ? '✓' : '✗', '| ch:', r14);

  // 15. Android 返回键逻辑（伪 Capacitor 注入）
  await page.goto(base + '#/bible/1/1', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await waitRouteIdle();
  const injectFakeCapacitor = () => page.evaluate(() => {
    window.__exited = false;
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { App: {
        addListener: (ev, cb) => { window.__backCb = cb; return Promise.resolve({ remove: () => {} }); },
        exitApp: () => { window.__exited = true; },
      } },
    };
    initNativeBack();
  });
  await injectFakeCapacitor();
  // 15a 弹窗开着 → 返回键只关弹窗、不动 URL
  await page.evaluate(() => openSettingsModal());
  await page.evaluate(() => window.__backCb({ canGoBack: true }));
  const r15a = await page.evaluate(() => ({ hidden: document.getElementById('popup').hidden, hash: location.hash }));
  console.log('15a. 返回键先关弹窗:', (r15a.hidden && r15a.hash === '#/bible/1/1') ? '✓' : '✗', JSON.stringify(r15a));
  // 15b 无浮层 → history.back()（先造一条同文档历史：换模块 push）
  await page.evaluate(() => openLrArticle(1, { id: 2 }));
  await waitHash('#/lr/1/2');
  await waitRouteIdle();
  await page.evaluate(() => window.__backCb({ canGoBack: true }));
  await waitHash('#/bible/1/1');
  await waitRouteIdle();
  const r15b = await page.evaluate(() => ({ mod: state.activeModule, hash: location.hash }));
  console.log('15b. 返回键 → history.back 回上一级:', (r15b.mod === 'bible' && r15b.hash === '#/bible/1/1') ? '✓' : '✗', `| mod: ${r15b.mod}`);
  // 15c 无历史可退 → exitApp
  await page.evaluate(() => window.__backCb({ canGoBack: false }));
  const r15c = await page.evaluate(() => window.__exited);
  console.log('15c. 无历史 → exitApp:', r15c ? '✓' : '✗');

  // 16. 移动端：切视口（触发重载，走深链）→ 返回键先关抽屉
  const bootsBefore = await page.evaluate(() => +sessionStorage.getItem('t-boots') || 0);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction((prev) => (+sessionStorage.getItem('t-boots') || 0) > prev, { timeout: 20000 }, bootsBefore).catch(() => {});
  await waitSplashGone();
  const ok16a = await page.waitForFunction(() => state.screen === 'work' && location.hash === '#/bible/1/1', { timeout: 20000 }).then(() => true).catch(() => false);
  await waitRouteIdle();
  await injectFakeCapacitor();
  await page.evaluate(() => openNavDrawer());
  const drawerOpened = await page.waitForFunction(() => {
    const dw = document.getElementById('navDrawer');
    return dw && !dw.hidden && dw.classList.contains('open');
  }, { timeout: 10000 }).then(() => true).catch(() => false);
  await page.evaluate(() => window.__backCb({ canGoBack: true }));
  const r16 = await page.evaluate(() => ({ open: document.getElementById('navDrawer').classList.contains('open'), hash: location.hash }));
  console.log('16. 移动端深链 + 返回键关抽屉:', (ok16a && drawerOpened && !r16.open && r16.hash === '#/bible/1/1') ? '✓' : '✗',
    `| 深链:${ok16a} 抽屉开:${drawerOpened} 关后:${!r16.open}`);

  // 17. 书报合集层：点系列块 push → 后退回合集层
  await page.evaluate(() => localStorage.removeItem('bible-study.bookLast'));   // 清上次位置，保证进第 1 篇
  await page.goto(base + '#/hub', { waitUntil: 'networkidle0', timeout: 30000 });
  await waitSplashGone();
  await page.waitForFunction(() => state.screen === 'bookhub', { timeout: 30000 });
  await waitRouteIdle();
  await page.waitForSelector('#bookHubGrid .home-block[data-series="slat"]', { timeout: 15000 });
  await page.click('#bookHubGrid .home-block[data-series="slat"]');
  await waitHash('#/book/slat/1/0/0');
  await waitRouteIdle();
  await page.goBack();
  const ok17 = await page.waitForFunction(() => state.screen === 'bookhub' && location.hash === '#/hub', { timeout: 20000 }).then(() => true).catch(() => false);
  console.log('17. 合集层点系列 push + 后退回合集层:', ok17 ? '✓' : '✗');

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
