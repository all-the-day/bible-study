/* 首页 + 合集块冒烟测试（阅读器直进版）：启动进首页 → 三个块直进阅读器 → ⌂ 回首页 → 搜索 */
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
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource')) return;   // 资源加载错误由 response 监听接管
    errors.push('console: ' + m.text());
  });
  // 资源加载失败（排除 favicon 与 GitHub API 更新检查——测试环境限流属环境噪音）
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('api.github.com')) {
      errors.push('http ' + r.status() + ': ' + r.url().replace('http://127.0.0.1:' + PORT, ''));
    }
  });

  // 1. 启动进首页 + 无副标题
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  const homeOk = await page.evaluate(() => ({
    bodyHome: document.body.classList.contains('home'),
    blocks: [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry),
    subCount: document.querySelectorAll('.home-block-sub').length,
  }));
  console.log('1. 启动进首页:', homeOk.bodyHome ? '✓' : '✗', '| 块:', homeOk.blocks.join(','), '| 副标题数:', homeOk.subCount, homeOk.subCount === 0 ? '✓' : '✗');

  // 2. 读经块 → 直接进上次章节(预置 创24)，无弹窗
  await page.evaluate(() => localStorage.setItem('bible-study.last', JSON.stringify({ book: 1, chapter: 24 })));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await page.click('#homeGrid .home-block[data-entry="bible"]');
  await new Promise((r) => setTimeout(r, 1500));
  const r2 = await page.evaluate(() => ({
    home: document.body.classList.contains('home'),
    popupHidden: document.querySelector('#popup').hidden,
    ch: document.querySelector('#chapterLabel').textContent,
    verseVisible: getComputedStyle(document.querySelector('.verse')).display !== 'none',
  }));
  console.log('2. 读经块直进:', !r2.home && r2.popupHidden && r2.ch.includes('24') && r2.verseVisible ? '✓' : '✗', '|', r2.ch);

  // 3. ⌂ 回首页
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  const backHome = await page.evaluate(() => document.body.classList.contains('home'));
  console.log('3. ⌂ 回首页:', backHome ? '✓' : '✗');

  // 4. 生命读经块 → 直接进阅读器(默认创世记第1篇)
  await page.click('#homeGrid .home-block[data-entry="lifereading"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r4 = await page.evaluate(() => ({
    home: document.body.classList.contains('home'),
    modLr: document.body.classList.contains('body-mod-lifereading'),
    lrVisible: getComputedStyle(document.querySelector('#lrMain')).display === 'block',
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 12),
    artCount: document.querySelectorAll('.lr-nav-art').length,
    volCount: document.querySelectorAll('.lr-vol-strip-btn').length,
    sideTabs: [...document.querySelectorAll('.lr-side-tab')].map(t => t.textContent).join('|'),
    actionsHidden: getComputedStyle(document.querySelector('#viewModeBtn')).display === 'none',
  }));
  console.log('4. 生命读经块直进阅读器:', !r4.home && r4.modLr && r4.lrVisible ? '✓' : '✗',
    '| crumb:', r4.crumb, '| 篇目:', r4.artCount, '| 卷条:', r4.volCount, '| 侧栏tab:', r4.sideTabs, '| 读经按钮隐藏:', r4.actionsHidden);

  // 5. 切卷(罗马书 45) + 切篇(第2篇)
  await page.evaluate(() => document.querySelector('.lr-vol-strip-btn[data-b="45"]').click());
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => { document.querySelectorAll('.lr-nav-art')[1].click(); });
  await new Promise((r) => setTimeout(r, 800));
  const r5 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 14),
    activeArt: document.querySelector('.lr-nav-art.active')?.textContent.slice(0, 10),
  }));
  console.log('5. 切卷切篇:', r5.book === '罗马书' ? '✓' : '✗', '|', r5.crumb, '| active:', r5.activeArt);

  // 6. 右栏纲目 tab 存在 + 切笔记 tab
  await page.evaluate(() => { document.querySelectorAll('.lr-side-tab')[1].click(); });
  await new Promise((r) => setTimeout(r, 300));
  const r6 = await page.evaluate(() => ({
    ta: !!document.querySelector('.lr-note-ta'),
    tabActive: document.querySelector('.lr-side-tab.active').textContent,
  }));
  console.log('6. 右栏笔记 tab:', r6.tabActive === '笔记' && r6.ta ? '✓' : '✗');

  // 7. ⌂ 回首页 → 我的笔记块 → 全局模式
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await page.waitForSelector('.note-scope', { timeout: 5000 });
  const r7 = await page.evaluate(() => ({
    tab: document.querySelector('.study-tab.active')?.dataset.tab,
    scope: [...document.querySelectorAll('.note-scope-btn')].map(b => b.textContent + (b.classList.contains('active') ? '*' : '')).join('/'),
  }));
  console.log('7. 我的笔记块:', r7.tab === 'mynotes' && r7.scope.includes('全部*') ? '✓' : '✗', '|', r7.scope);

  // 8. 搜索「创24」→ 跳转
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.type('#homeSearch', '创24');
  await new Promise((r) => setTimeout(r, 500));
  const srCount = await page.$$eval('#homeSearchResults .home-sr-item', els => els.length);
  if (srCount) {
    await page.click('#homeSearchResults .home-sr-item');
    await new Promise((r) => setTimeout(r, 1500));
    const r8 = await page.evaluate(() => ({ home: document.body.classList.contains('home'), ch: document.querySelector('#chapterLabel').textContent }));
    console.log('8. 搜索跳转:', !r8.home && r8.ch.includes('24') ? '✓' : '✗', '|', r8.ch);
  } else {
    console.log('8. 搜索跳转: ✗ 无结果');
  }

  // 9. 模块往返切换：生命读经 → 首页 → 读经 → 首页 → 生命读经（body-mod 类必须互斥切换）
  const moduleSwitch = async (entry) => {
    await page.click('#homeBtn');
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate((e) => document.querySelector('.home-block[data-entry="' + e + '"]').click(), entry);
    await new Promise((r) => setTimeout(r, 1800));
    return page.evaluate((e) => ({
      mod: document.body.classList.contains('body-mod-' + e),
      otherMod: document.body.classList.contains('body-mod-' + (e === 'bible' ? 'lifereading' : 'bible')),
      lrMain: getComputedStyle(document.querySelector('#lrMain')).display,
      verse: getComputedStyle(document.querySelector('#verseContainer')).display,
    }), entry);
  };
  const sLr = await moduleSwitch('lifereading');
  const sBible = await moduleSwitch('bible');
  const sLr2 = await moduleSwitch('lifereading');
  const swOk = sLr.mod && !sLr.otherMod && sLr.lrMain === 'block' &&
               sBible.mod && !sBible.otherMod && sBible.verse !== 'none' &&
               sLr2.mod && !sLr2.otherMod && sLr2.lrMain === 'block';
  console.log('9. 模块往返切换:', swOk ? '✓' : '✗', '| 生命读经→读经→生命读经 类互斥正确');

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
