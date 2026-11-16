/* 专题（活力八 · 记录块）专项（2026-11-16 改版）：首页块 → 记录页（按块过滤阅读历史）→
   空态 / 块只含本范围记录（无关书卷不串味）/ 点记录回到对应位置 / 刷新保持 /
   旧分屏深链归一 / 非法 id 回首页 / 返回保留滚动 / 纵向可达 / 移动端单列无溢出。 */
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
      // 记录页没有正文标注：清掉可能残留的旧版专题标注；历史从「零记录」起步，先验空态
      if (!sessionStorage.getItem('__topicTestSeeded')) {
        sessionStorage.setItem('__topicTestSeeded', '1');
        localStorage.setItem('bible-study.annotations', '[]');
        localStorage.setItem('bible-study.history', '[]');
        localStorage.setItem('bible-study.last', JSON.stringify({ book: 1, chapter: 1 }));
      }
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    // 等 init 收尾再点首页块：并发全量跑时启动数据处理变慢，固定 sleep 后就点击的话
    // init 尾部的 selectBook/initRoute（重渲染/路由就位）会掀掉刚进入的屏幕态（2026-10-27 notes-module 实测踩过）
    await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });

    // 1. 首页有「活力八」块
    const blocks = await page.evaluate(() => [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry));
    ok(blocks.includes('vitality8'), '1. 首页含活力八块', blocks.join(','));

    // 2. 点块 → 记录页：5 个块（腓原文/腓生命读经/西原文/西生命读经/书报）、顶栏 crumb
    await page.click('#homeGrid .home-block[data-entry="vitality8"]');
    await page.waitForSelector('#topicMain .topic-block', { timeout: 15000 });
    await sleep(400);
    const home = await page.evaluate(() => ({
      topic: document.body.classList.contains('topic'),
      hash: location.hash,
      hero: document.querySelectorAll('.topic-hero, .topic-home-foot').length,   // 标题区/页脚已去掉（2026-11-16 用户定稿）
      titles: [...document.querySelectorAll('#topicMain .topic-block-title')].map(e => e.textContent),
      crumb: [document.getElementById('bookName')?.textContent, document.getElementById('chapterLabel')?.textContent],
      rows: document.querySelectorAll('#topicMain .topic-row').length,
      empties: document.querySelectorAll('#topicMain .topic-empty').length,
    }));
    ok(home.topic && home.hero === 0 && home.hash === '#/topic/vitality8' &&
      home.titles.join(',') === '腓立比书,腓立比书 · 生命读经,歌罗西书,歌罗西书 · 生命读经,福音的托付' &&
      home.crumb[0] === '活力八' && home.crumb[1] === '记录',
      '2. 记录页（5 个块，无标题区 + 顶栏）', JSON.stringify(home));

    // 3. 零记录：每块都是「还没有阅读记录」，且没有任何可点行
    ok(home.rows === 0 && home.empties === 5, '3. 空态（无记录时只显示提示）',
      `rows=${home.rows} empties=${home.empties}`);

    // 4. 播种阅读历史后重开：每块只收本范围的记录（创世记等无关书卷不串味）
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem('bible-study.history', JSON.stringify([
        { module: 'bible',       loc: { book: 50, chapter: 3 },                          title: '腓立比书 3章',              t: now - 60e3 },
        { module: 'lifereading', loc: { book: 50, articleId: 12 },                       title: '第12篇 基督是我们的生命',   t: now - 120e3 },
        { module: 'bible',       loc: { book: 51, chapter: 2 },                          title: '歌罗西书 2章',              t: now - 180e3 },
        { module: 'books',       loc: { series: 'sg', volume: 2, book: 20, chapter: 1 }, title: '福音的托付 · 第2章 福音的托付', t: now - 240e3 },
        { module: 'bible',       loc: { book: 1, chapter: 24 },                          title: '创世记 24章',               t: now - 300e3 },   // 无关书卷
        { module: 'lifereading', loc: { book: 1, articleId: 60 },                        title: '第60篇 创世记里的生命',     t: now - 360e3 },   // 无关书卷
        { module: 'books',       loc: { series: 'ni', volume: 1, book: 2, chapter: 0 },  title: '灵修指微 · 第1章 序',       t: now - 420e3 },   // 无关书报
      ]));
      localStorage.setItem('bible-study.last', JSON.stringify({ book: 1, chapter: 1 }));
    });
    // 不带 hash 重新加载：留在 #/topic 的话会直接就位到记录页，首页块是隐藏的
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });
    await page.click('#homeGrid .home-block[data-entry="vitality8"]');
    await page.waitForSelector('#topicMain .topic-block', { timeout: 15000 });
    await sleep(400);
    const seeded = await page.evaluate(() => [...document.querySelectorAll('#topicMain .topic-block')].map(b => ({
      title: b.querySelector('.topic-block-title').textContent,
      meta: b.querySelector('.topic-block-meta')?.textContent || '',
      rows: [...b.querySelectorAll('.topic-row')].map(a => ({
        t: a.querySelector('.topic-row-t').textContent,
        time: a.querySelector('.topic-row-time')?.textContent || '',
        href: a.getAttribute('href'),
      })),
    })));
    const byTitle = (t) => seeded.find(b => b.title === t) || { rows: [] };
    const got = seeded.map(b => `${b.title}:${b.rows.map(r => r.t).join('/')}`);
    const flat = JSON.stringify(seeded);
    const ok4 = seeded.length === 5 &&
      byTitle('腓立比书').rows.length === 1 && byTitle('腓立比书').rows[0].href === '#/bible/50/3' &&
      byTitle('腓立比书 · 生命读经').rows.length === 1 && byTitle('腓立比书 · 生命读经').rows[0].href === '#/lr/50/12' &&
      byTitle('歌罗西书').rows.length === 1 && byTitle('歌罗西书').rows[0].href === '#/bible/51/2' &&
      byTitle('歌罗西书 · 生命读经').rows.length === 0 &&
      byTitle('福音的托付').rows.length === 1 && byTitle('福音的托付').rows[0].href === '#/book/sg/2/20/1' &&
      byTitle('腓立比书').meta.includes('1') &&
      byTitle('腓立比书').rows[0].time.length > 0 &&
      !flat.includes('创世记') && !flat.includes('灵修指微');
    ok(ok4, '4. 各块只收本范围记录（无关书卷/书报不串味）', got.join(' | '));

    // 5. 点腓立比书块的记录 → 读经模块该章；顶栏 crumb 刷新（不残留专题标题）
    await page.evaluate(() => {
      [...document.querySelectorAll('#topicMain .topic-block')]
        .find(b => b.querySelector('.topic-block-title').textContent === '腓立比书')
        .querySelector('a.topic-row').click();
    });
    await sleep(2200);
    const bibleView = await page.evaluate(() => ({
      mod: state.activeModule, screen: state.screen,
      topic: document.body.classList.contains('topic'),
      hash: location.hash, book: state.currentBook && state.currentBook.index, ch: state.currentChapter,
      crumb: [document.getElementById('bookName')?.textContent, document.getElementById('chapterLabel')?.textContent],
      verses: document.querySelectorAll('#textCol .vtext').length,
    }));
    ok(bibleView.mod === 'bible' && bibleView.screen === 'work' && !bibleView.topic &&
      bibleView.hash === '#/bible/50/3' && bibleView.book === 50 && bibleView.ch === 3 && bibleView.verses > 0 &&
      bibleView.crumb[0] === '腓立比书' && /3章/.test(bibleView.crumb[1]),
      '5. 点原文记录 → 读经该章 + crumb 不残留', JSON.stringify(bibleView));

    // 6. 回记录页，点生命读经记录 → 生命读经模块该篇
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1500);
    await page.evaluate(() => {
      [...document.querySelectorAll('#topicMain .topic-block')]
        .find(b => b.querySelector('.topic-block-title').textContent === '腓立比书 · 生命读经')
        .querySelector('a.topic-row').click();
    });
    await sleep(2600);
    const lrView = await page.evaluate(() => ({
      mod: state.activeModule, hash: location.hash,
      crumb: document.getElementById('chapterLabel')?.textContent || '',
      len: (document.getElementById('lrMain')?.textContent || '').length,
    }));
    ok(lrView.mod === 'lifereading' && lrView.hash === '#/lr/50/12' && lrView.len > 2000 && /第12篇/.test(lrView.crumb),
      '6. 点生命读经记录跳转', JSON.stringify(lrView));

    // 7. 刷新保持记录页（深链就位）
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-block', { timeout: 15000 });
    await sleep(500);
    const reload = await page.evaluate(() => ({
      hash: location.hash,
      topic: document.body.classList.contains('topic'),
      blocks: document.querySelectorAll('#topicMain .topic-block').length,
    }));
    ok(reload.hash === '#/topic/vitality8' && reload.topic && reload.blocks === 5,
      '7. 刷新保持记录页', JSON.stringify(reload));

    // 8. 旧版分屏深链（#/topic/{id}/{卷}/{屏}）归一到记录页，URL 也归一
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/vitality8/50/2', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-block', { timeout: 15000 });
    await sleep(800);
    const legacy = await page.evaluate(() => ({ hash: location.hash, blocks: document.querySelectorAll('#topicMain .topic-block').length }));
    ok(legacy.hash === '#/topic/vitality8' && legacy.blocks === 5, '8. 旧分屏深链归一', JSON.stringify(legacy));

    // 9. 非法专题 id → 回首页并净化 URL
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/nope', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await sleep(600);
    const bad = await page.evaluate(() => ({ home: document.body.classList.contains('home'), hash: location.hash }));
    ok(bad.home && bad.hash === '', '9. 非法专题 id 回首页并净化 URL', JSON.stringify(bad));

    // 9b 前置：播种较长的历史（腓/西各 4 章 + 各 4 篇生命读经 + 书报 7 章 = 23 行），
    //       记录页才有足够高度验证滚动/纵向可达（5 条历史时 900px 一屏放得下，滚不动是正常的）
    await page.evaluate(() => {
      const now = Date.now();
      const list = [];
      let t = now;
      for (let ch = 1; ch <= 4; ch++) list.push({ module: 'bible', loc: { book: 50, chapter: ch }, title: `腓立比书 ${ch}章`, t: t -= 60e3 });
      for (const id of [3, 9, 17, 26]) list.push({ module: 'lifereading', loc: { book: 50, articleId: id }, title: `第${id}篇 腓立比书信息`, t: t -= 60e3 });
      for (let ch = 1; ch <= 4; ch++) list.push({ module: 'bible', loc: { book: 51, chapter: ch }, title: `歌罗西书 ${ch}章`, t: t -= 60e3 });
      for (const id of [2, 18, 27, 31]) list.push({ module: 'lifereading', loc: { book: 51, articleId: id }, title: `第${id}篇 歌罗西书信息`, t: t -= 60e3 });
      for (let ch = 0; ch < 7; ch++) list.push({ module: 'books', loc: { series: 'sg', volume: 2, book: 20, chapter: ch }, title: `福音的托付 · 第${ch + 1}章`, t: t -= 60e3 });
      localStorage.setItem('bible-study.history', JSON.stringify(list));
    });
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/vitality8', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-block', { timeout: 15000 });
    await sleep(600);

    // 9b. 返回记录页保留滚动位置（逐块点开再返回的典型用法）
    await page.evaluate(() => { document.getElementById('topicTextCol').scrollTop = 200; });
    await sleep(150);
    await page.evaluate(() => { document.querySelectorAll('#topicMain .topic-row')[0].click(); });
    await sleep(2200);
    await page.goBack();
    await sleep(2000);
    const backScroll = await page.evaluate(() => ({
      hash: location.hash,
      top: Math.round(document.getElementById('topicTextCol').scrollTop),
    }));
    ok(backScroll.hash === '#/topic/vitality8' && backScroll.top > 80,
      '9b. 返回记录页保留滚动位置', JSON.stringify(backScroll));

    // 10. 纵向可达：滚到底必须能看到最后一个块（曾因 #topicView 改 block 导致整页不可滚，
    //     后面的块看不见也点不到，而只断言 DOM 计数的测试全绿——这条锁死）
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(1800);
    const scroll = await page.evaluate(() => new Promise((resolve) => {
      const col = document.getElementById('topicTextCol');
      col.scrollTop = col.scrollHeight;
      setTimeout(() => {
        const last = [...document.querySelectorAll('#topicMain .topic-block')].pop();
        const r = last.getBoundingClientRect();
        resolve({
          rows: document.querySelectorAll('#topicMain .topic-row').length,
          scrollable: col.scrollHeight > col.clientHeight,
          scrollTop: Math.round(col.scrollTop),
          lastVisible: r.top < window.innerHeight && r.bottom > 0,
        });
      }, 150);
    }));
    ok(scroll.rows === 23 && scroll.scrollable && scroll.scrollTop > 0 && scroll.lastVisible,
      '10. 纵向可达（滚到底能看到最后一个块）', JSON.stringify(scroll));

    // 11. 移动端（390px）：单列、无横向溢出、读经|研读 pill 隐藏、同样可纵向滚动
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => { location.hash = '#/topic/vitality8'; });
    await sleep(2000);
    const mobile = await page.evaluate(() => new Promise((resolve) => {
      const cs = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : 'missing'; };
      const col = document.getElementById('topicTextCol');
      col.scrollTop = col.scrollHeight;
      setTimeout(() => {
        const last = [...document.querySelectorAll('#topicMain .topic-block')].pop();
        const r = last.getBoundingClientRect();
        resolve({
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          pill: cs('#modePill', 'display'),
          blocks: document.querySelectorAll('#topicMain .topic-block').length,
          rowH: Math.round((document.querySelector('.topic-row') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
          rowW: Math.round((document.querySelector('.topic-row-t') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
          scrollable: col.scrollHeight > col.clientHeight,
          lastVisible: r.top < window.innerHeight && r.bottom > 0,
        });
      }, 150);
    }));
    ok(!mobile.overflow && mobile.pill === 'none' && mobile.blocks === 5 && mobile.rowH > 30 && mobile.rowW > 100 &&
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
