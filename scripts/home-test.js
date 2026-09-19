/* 首页 + 合集块冒烟测试（阅读器直进版）：启动进首页 → 三个块直进阅读器 → ⌂ 回首页 → 搜索
   末尾含「首页最近阅读」（反馈 #16）：最多 5 条 / 位于合集块下方 / 点击跳原文并置顶 / 全部›开抽屉历史段 / 空历史整块隐藏 */
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

  // 1. 启动进首页 + 无副标题 + splash 隐藏后经节非空
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  const homeOk = await page.evaluate(() => ({
    bodyHome: document.body.classList.contains('home'),
    blocks: [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry),
    subCount: document.querySelectorAll('.home-block-sub').length,
    splashHidden: document.querySelector('#splash')?.classList.contains('hidden'),
    verse: document.querySelector('#splashVerse')?.textContent.trim() || '',
  }));
  console.log('1. 启动进首页:', homeOk.bodyHome ? '✓' : '✗', '| 块:', homeOk.blocks.join(','), '| 副标题数:', homeOk.subCount, homeOk.subCount === 0 ? '✓' : '✗',
    '| splash已隐藏:', homeOk.splashHidden ? '✓' : '✗', '| 经节:', homeOk.verse.slice(0, 12));

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
    artCount: document.querySelectorAll('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item').length,
    filter: (() => { const el = document.querySelector('#dwSearchInput'); return !!el && getComputedStyle(el).display !== 'none'; })(),
    docked: document.body.classList.contains('drawer-docked'),
    sideTabs: [...document.querySelectorAll('.lr-side-tab')].map(t => t.textContent).join('|'),
    actionsHidden: getComputedStyle(document.querySelector('#viewModeBtn')).display === 'none',
  }));
  console.log('4. 生命读经块直进阅读器:', !r4.home && r4.modLr && r4.lrVisible && r4.docked ? '✓' : '✗',
    '| crumb:', r4.crumb, '| 篇目:', r4.artCount, '| 搜索框:', r4.filter, '| 停靠:', r4.docked, '| 侧栏tab:', r4.sideTabs, '| 读经按钮隐藏:', r4.actionsHidden);

  // 5. 切卷(罗马书 45，经停靠抽屉) + 切篇(第2篇)
  await page.evaluate(() => openNavDrawer());
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-l="45"]').click());
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[1].click(); });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => { document.querySelectorAll('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item')[1].click(); });
  await new Promise((r) => setTimeout(r, 800));
  const r5 = await page.evaluate(() => ({
    book: document.querySelector('#bookName').textContent,
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 14),
    activeArt: document.querySelector('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item.cur')?.textContent.slice(0, 10),
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

  // 7. ⌂ 回首页 → 我的笔记块 → 笔记管理模块
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await new Promise((r) => setTimeout(r, 1200));
  const r7 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-notes'),
    mainVisible: getComputedStyle(document.querySelector('#notesMain')).display !== 'none',
    nav: !!document.querySelector('#notesNav'),
    side: !!document.querySelector('#notesSide'),
    crumb: document.querySelector('#bookName').textContent,
  }));
  console.log('7. 我的笔记块:', r7.mod && r7.mainVisible && r7.nav && r7.side && r7.crumb === '笔记管理' ? '✓' : '✗', '|', JSON.stringify(r7));

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

  // 10. 首页「最近阅读」（反馈 #16）：最多 5 条、位于合集块下方、带模块/时间
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('bible-study.history', JSON.stringify([
      { module: 'bible',       loc: { book: 1, chapter: 24 },                         title: '创世记 24章',      t: now - 4 * 60e3 },
      { module: 'lifereading', loc: { book: 45, articleId: 2 },                       title: '第2篇 神的福音',    t: now - 55 * 60e3 },
      { module: 'books',       loc: { series: 'ni', volume: 1, book: 2, chapter: 3 }, title: '某书 · 第4章 标题', t: now - 2 * 36e5 },
      { module: 'morning',     loc: { period: '2026-03', chapterId: 1 },              title: '某期 · 第1篇 标题', t: now - 3 * 864e5 },
      { module: 'bible',       loc: { book: 43, chapter: 7 },                         title: '约翰福音 7章',      t: now - 5 * 864e5 },
      { module: 'bible',       loc: { book: 1, chapter: 1 },                          title: '创世记 1章',        t: now - 9 * 864e5 },
    ]));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeHist .home-hist-item', { timeout: 15000 });
  const h10 = await page.evaluate(() => {
    const box = document.querySelector('#homeHist');
    const grid = document.querySelector('#homeGrid');
    return {
      n: box.querySelectorAll('.home-hist-item').length,
      titles: [...box.querySelectorAll('.home-hist-item .t')].map(e => e.textContent),
      subs: [...box.querySelectorAll('.home-hist-item .sub')].map(e => e.textContent),
      allBtn: !!box.querySelector('[data-hist-all]'),
      title: (box.querySelector('.home-hist-title') || {}).textContent,
      belowGrid: !!(grid.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  const h10ok = h10.n === 5 && h10.titles[0] === '创世记 24章' && h10.titles[4] === '约翰福音 7章' &&
    !h10.titles.includes('创世记 1章') && h10.subs[1] === '生命读经 · 55分钟前' &&
    h10.title === '最近阅读' && h10.allBtn && h10.belowGrid;
  console.log('10. 首页最近阅读(最多5条/在合集块下方):', h10ok ? '✓' : '✗',
    '| 条数:', h10.n, '| 首条:', h10.titles[0], h10.subs[0], '| 末条:', h10.titles[4], '| 标题:', h10.title, '| 全部›:', h10.allBtn, '| 在块下方:', h10.belowGrid);

  // 11. 点条目 → 跳原文；⌂ 回首页后该条置顶（pushHistory 去重置顶）
  await page.evaluate(() => document.querySelectorAll('#homeHist .home-hist-item')[4].click());
  await new Promise((r) => setTimeout(r, 2000));
  const r11 = await page.evaluate(() => ({
    home: document.body.classList.contains('home'),
    modBible: document.body.classList.contains('body-mod-bible'),
    book: document.querySelector('#bookName').textContent,
    ch: document.querySelector('#chapterLabel').textContent,
  }));
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  const h11 = await page.evaluate(() => [...document.querySelectorAll('#homeHist .home-hist-item .t')].map(e => e.textContent));
  const h11ok = !r11.home && r11.modBible && r11.book === '约翰福音' && r11.ch === '7章' &&
    h11[0] === '约翰福音 7章' && h11.length === 5;
  console.log('11. 最近阅读点击跳转+置顶:', h11ok ? '✓' : '✗', '|', r11.book, r11.ch, '| 置顶:', h11[0], '| 条数:', h11.length);

  // 12. 「全部 ›」→ 抽屉历史段（全量 6 条 + 清空按钮）；历史清空后首页整块隐藏（不留空态）
  await page.click('#homeHist [data-hist-all]');
  await new Promise((r) => setTimeout(r, 600));
  const r12 = await page.evaluate(() => ({
    home: document.body.classList.contains('home'),
    segSel: (document.querySelector('#dwSeg [data-seg="history"]') || {}).className,
    rows: document.querySelectorAll('#navDrawer .dw-hist-item').length,
    clearBtn: !!document.querySelector('#navDrawer .dw-clear-btn'),
  }));
  await page.evaluate(() => localStorage.setItem('bible-study.history', '[]'));
  await page.evaluate(() => showHome());
  await new Promise((r) => setTimeout(r, 300));
  const r12b = await page.evaluate(() => ({
    html: document.querySelector('#homeHist').innerHTML,
    blocks: document.querySelectorAll('#homeGrid .home-block').length,
  }));
  const r12ok = !r12.home && r12.segSel === 'sel' && r12.rows === 6 && r12.clearBtn &&
    r12b.html === '' && r12b.blocks === 5;
  console.log('12. 全部›开抽屉历史段+空历史隐藏:', r12ok ? '✓' : '✗',
    '| 抽屉历史行:', r12.rows, '| 段选中:', r12.segSel, '| 清空按钮:', r12.clearBtn, '| 清空后首页块:', r12b.blocks, 'HTML空:', r12b.html === '');

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
