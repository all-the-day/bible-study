/* 专题（活力八 · 作业单）专项（2026-10-21 改版）：首页块 → 作业单页（周卡 + 条目链接）→
   条目深链进读经 / 生命读经（含同位置重入的顶栏 crumb）→ 待填条不可点 →
   刷新保持与深链归一（旧分屏 URL → 作业单页）→ 非法专题 id 回首页 → 移动端单列无溢出。 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8772;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  let fail = 0;
  const ok = (cond, label, extra) => {
    console.log(` ${label}:`, cond ? '✓' : '✗', extra === undefined ? '' : '| ' + extra);
    if (!cond) fail = 1;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(() => {
      window.BIBLE_SKIP_UPDATE = true;
      // 作业单页没有正文标注：清掉可能残留的旧版专题标注，避免干扰断言
      if (!sessionStorage.getItem('__topicTestSeeded')) {
        sessionStorage.setItem('__topicTestSeeded', '1');
        localStorage.setItem('bible-study.annotations', '[]');
      }
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await sleep(800);

    // 1. 首页有「活力八」块
    const blocks = await page.evaluate(() => [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry));
    ok(blocks.includes('vitality8'), '1. 首页含活力八块', blocks.join(','));

    // 2. 点块 → 作业单页：8 周、每周五类条目、标题与顶栏
    await page.click('#homeGrid .home-block[data-entry="vitality8"]');
    await page.waitForSelector('#topicMain .topic-week', { timeout: 15000 });
    await sleep(400);
    const home = await page.evaluate(() => ({
      topic: document.body.classList.contains('topic'),
      hash: location.hash,
      hero: document.querySelector('.topic-hero-title')?.textContent || '',
      weeks: document.querySelectorAll('#topicMain .topic-week').length,
      firstWeek: document.querySelector('.topic-week-title')?.textContent || '',
      kinds: [...document.querySelectorAll('.topic-week:first-of-type .topic-kind')].map(e => e.textContent),
      crumb: [document.getElementById('bookName')?.textContent, document.getElementById('chapterLabel')?.textContent],
    }));
    ok(home.topic && home.hero === '活力八' && home.weeks === 8 && home.firstWeek.includes('腓立比书 1 章') &&
      home.kinds.join(',') === '原文,生命读经,生命读经,生命读经,书报,背经,注释' &&
      home.crumb[0] === '活力八' && home.crumb[1] === '作业单',
      '2. 作业单页（8 周 + 五类条目 + 顶栏）', JSON.stringify(home));

    // 3. 第 1 周的条目链接正确（原文 / 三篇生命读经按顺序 / 注释）
    const hrefs = await page.evaluate(() => ({
      bible: document.querySelector('.topic-week a.topic-row')?.getAttribute('href'),
      lr: [...document.querySelectorAll('.topic-week:first-of-type a.topic-row[href^="#/lr/"]')].map(a => a.getAttribute('href')),
      fn: document.querySelector('.topic-week:first-of-type a.topic-row[href^="#/bible/"]:last-of-type')?.getAttribute('href'),
    }));
    ok(hrefs.bible === '#/bible/50/1' && hrefs.lr.join(',') === '#/lr/50/3,#/lr/50/4,#/lr/50/5' && hrefs.fn === '#/bible/50/1',
      '3. 第 1 周链接（原文 + 三篇按顺序）', JSON.stringify(hrefs));

    // 4. 书报 / 背经未填 → 虚化不可点（div 而非 a）
    const pending = await page.evaluate(() => ({
      count: document.querySelectorAll('.topic-row.pending').length,
      anchors: [...document.querySelectorAll('.topic-row.pending')].filter(e => e.tagName === 'A').length,
      texts: [...document.querySelectorAll('.topic-week:first-of-type .topic-row.pending .topic-row-t')].map(e => e.textContent),
    }));
    ok(pending.count === 16 && pending.anchors === 0 &&
      pending.texts.join(',') === '指定书报待填,背经经节待填',
      '4. 待填条虚化不可点', JSON.stringify(pending));

    // 5. 点「原文」→ 读经模块对应章（读经里自己的标注照常），顶栏 crumb 刷新
    //    前置：先把读经模块停在腓 1 章，制造「同模块同位置重入」——旧实现会残留专题标题
    await page.evaluate(() => { state.screen = 'work'; enterModule('bible').then(() => location.hash = '#/bible/50/1'); });
    await sleep(2000);
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1500);
    await page.click('.topic-week a.topic-row');
    await sleep(2200);
    const bibleView = await page.evaluate(() => ({
      mod: state.activeModule,
      screen: state.screen,
      topic: document.body.classList.contains('topic'),
      hash: location.hash,
      book: state.currentBook && state.currentBook.index,
      crumb: [document.getElementById('bookName')?.textContent, document.getElementById('chapterLabel')?.textContent],
      verses: document.querySelectorAll('#textCol .vtext').length,
    }));
    ok(bibleView.mod === 'bible' && bibleView.screen === 'work' && !bibleView.topic &&
      bibleView.hash === '#/bible/50/1' && bibleView.book === 50 && bibleView.verses > 0 &&
      bibleView.crumb[0] === '腓立比书' && /1章/.test(bibleView.crumb[1]),
      '5. 原文跳读经 + crumb 不残留', JSON.stringify(bibleView));

    // 6. 回作业单，点第 1 篇生命读经 → 生命读经模块
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1500);
    await page.click('.topic-week a.topic-row[href^="#/lr/"]');
    await sleep(2600);
    const lrView = await page.evaluate(() => ({
      mod: state.activeModule,
      hash: location.hash,
      crumb: document.getElementById('chapterLabel')?.textContent || '',
      len: (document.getElementById('lrMain')?.textContent || '').length,
    }));
    ok(lrView.mod === 'lifereading' && lrView.hash === '#/lr/50/3' && lrView.len > 2000 && /第3篇/.test(lrView.crumb),
      '6. 生命读经跳转', JSON.stringify(lrView));

    // 7. 刷新保持作业单页（深链就位）
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-week', { timeout: 15000 });
    await sleep(500);
    const reload = await page.evaluate(() => ({
      hash: location.hash,
      topic: document.body.classList.contains('topic'),
      weeks: document.querySelectorAll('#topicMain .topic-week').length,
    }));
    ok(reload.hash === '#/topic/vitality8' && reload.topic && reload.weeks === 8,
      '7. 刷新保持作业单页', JSON.stringify(reload));

    // 8. 旧版分屏深链（#/topic/{id}/{卷}/{屏}）归一到作业单页，URL 也归一
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/vitality8/50/2', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-week', { timeout: 15000 });
    await sleep(800);
    const legacy = await page.evaluate(() => ({ hash: location.hash, weeks: document.querySelectorAll('#topicMain .topic-week').length }));
    ok(legacy.hash === '#/topic/vitality8' && legacy.weeks === 8, '8. 旧分屏深链归一', JSON.stringify(legacy));

    // 9. 非法专题 id → 回首页并净化 URL
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/nope', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await sleep(600);
    const bad = await page.evaluate(() => ({ home: document.body.classList.contains('home'), hash: location.hash }));
    ok(bad.home && bad.hash === '', '9. 非法专题 id 回首页并净化 URL', JSON.stringify(bad));

    // 9b. 返回作业单保留滚动位置（八周清单逐周点开再返回的典型用法）
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1500);
    await page.evaluate(() => { document.getElementById('topicTextCol').scrollTop = 800; });
    await sleep(150);
    await page.evaluate(() => { document.querySelectorAll('.topic-week')[3].querySelector('a.topic-row').click(); });
    await sleep(2200);
    await page.goBack();
    await sleep(2000);
    const backScroll = await page.evaluate(() => ({
      hash: location.hash,
      top: Math.round(document.getElementById('topicTextCol').scrollTop),
    }));
    ok(backScroll.hash === '#/topic/vitality8' && backScroll.top > 300,
      '9b. 返回作业单保留滚动位置', JSON.stringify(backScroll));

    // 10. 纵向可达：作业单 8 周必须能滚到底（曾因 #topicView 改 block 导致整页不可滚，
    //     第 3-8 周看不见也点不到，而只断言 DOM 计数的测试全绿——这条锁死）
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1800);
    const scroll = await page.evaluate(() => new Promise((resolve) => {
      const col = document.getElementById('topicTextCol');
      col.scrollTop = col.scrollHeight;
      setTimeout(() => {
        const last = [...document.querySelectorAll('.topic-week')].pop();
        const r = last.getBoundingClientRect();
        resolve({
          scrollable: col.scrollHeight > col.clientHeight,
          scrollTop: Math.round(col.scrollTop),
          lastTop: Math.round(r.top),
          lastVisible: r.top < window.innerHeight && r.bottom > 0,
        });
      }, 150);
    }));
    ok(scroll.scrollable && scroll.scrollTop > 0 && scroll.lastVisible,
      '10. 纵向可达（滚到底能看到第 8 周）', JSON.stringify(scroll));

    // 11. 移动端（390px）：单列、无横向溢出、读经|研读 pill 隐藏、同样可纵向滚动
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(2000);
    const mobile = await page.evaluate(() => new Promise((resolve) => {
      const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : 'missing'; };
      const col = document.getElementById('topicTextCol');
      col.scrollTop = col.scrollHeight;
      setTimeout(() => {
        const last = [...document.querySelectorAll('.topic-week')].pop();
        const r = last.getBoundingClientRect();
        resolve({
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          pill: cs('#modePill', 'display'),
          weeks: document.querySelectorAll('#topicMain .topic-week').length,
          rowH: Math.round((document.querySelector('.topic-row') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
          scrollable: col.scrollHeight > col.clientHeight,
          lastVisible: r.top < window.innerHeight && r.bottom > 0,
        });
      }, 150);
    }));
    ok(!mobile.overflow && mobile.pill === 'none' && mobile.weeks === 8 && mobile.rowH > 30 &&
      mobile.scrollable && mobile.lastVisible,
      '11. 移动端单列无溢出 + pill 隐藏 + 可滚到底', JSON.stringify(mobile));

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    server.kill();
  }
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
