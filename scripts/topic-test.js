/* 专题（活力八）专项（2026-10-21）：首页块 → 专题主页 → 屏正文/读经单 →
   专题内划线与刷新保持 → 跳回读经看到的是读经自己的标注（两边不串）→
   专题屏级笔记 → 笔记管理归集（来源「专题」）→ 深链与越界钳制。 */
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
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    // 首次会话播种（evaluateOnNewDocument 每次导航都会跑，故用 sessionStorage 记「已播种」）
    await page.evaluate(() => {
      if (sessionStorage.getItem('__topicTestSeeded')) return;
      sessionStorage.setItem('__topicTestSeeded', '1');
      localStorage.setItem('bible-study.annotations', '[]');
      localStorage.setItem('bible-study.topicNotes', '{}');
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await sleep(800);

    // 1. 首页有「活力八」块
    const blocks = await page.evaluate(() => [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry));
    ok(blocks.includes('vitality8'), '1. 首页含活力八块', blocks.join(','));

    // 2. 点块 → 专题主页（两卷章卡）
    await page.click('#homeGrid .home-block[data-entry="vitality8"]');
    await page.waitForSelector('#topicMain .topic-book-card', { timeout: 15000 });
    await sleep(400);
    const home = await page.evaluate(() => ({
      topic: document.body.classList.contains('topic'),
      hash: location.hash,
      hero: document.querySelector('.topic-hero-title')?.textContent || '',
      cards: [...document.querySelectorAll('.topic-book-title')].map(e => e.textContent),
      rows: document.querySelectorAll('.topic-ch-row').length,
    }));
    ok(home.topic && home.hero === '活力八' && home.cards.length === 2 && home.rows > 0,
      '2. 专题主页', JSON.stringify(home));

    // 3. 点第 1 章行 → 阅读屏（篇名 + 正文 + 读经单）
    await page.click('.topic-ch-row');
    await page.waitForSelector('#topicMain .topic-read', { timeout: 15000 });
    await sleep(400);
    const scr = await page.evaluate(() => ({
      hash: location.hash,
      book: document.querySelector('.topic-page-book')?.textContent || '',
      title: document.querySelector('.topic-page-title')?.textContent || '',
      reads: document.querySelectorAll('#topicMain .topic-read').length,
      len: (document.querySelector('#topicMain .topic-page')?.textContent || '').length,
      refs: [...document.querySelectorAll('.topic-ref .t')].map(e => e.textContent),
      navCur: document.querySelector('.topic-nav-item.cur')?.textContent.trim() || '',
    }));
    ok(scr.hash === '#/topic/vitality8/50/1' && scr.book === '腓立比书' && scr.reads >= 2 && scr.len > 500 &&
      scr.refs.some(t => t.includes('读原文')) && scr.navCur.includes('1'),
      '3. 阅读屏', JSON.stringify(scr));

    // 4. 专题内划线（程序化选第一段前 12 字 + 点色）
    const made = await page.evaluate(() => {
      const page = document.querySelector('#topicMain .topic-page');
      const div = [...page.children].find(d => d.className === 'lr-para' && d.textContent.length > 30);
      if (!div) return null;
      const range = document.createRange();
      const node = div.firstChild;
      range.setStart(node, 0);
      range.setEnd(node, Math.min(12, node.nodeValue.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { text: sel.toString(), page: page.dataset.topicPage };
    });
    await sleep(300);
    const toolShown = await page.evaluate(() => !document.querySelector('#floatTool').hidden);
    if (toolShown) await page.click('#floatTool .sw.c1');
    await sleep(400);
    const ann = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
      const a = list.find(x => x.type === 'topic');
      return a ? { type: a.type, topic: a.topic, page: a.page, book: a.book, text: a.text, colorId: a.colorId } : null;
    });
    ok(toolShown && ann && ann.type === 'topic' && ann.colorId === 'c1' && ann.book === 50 &&
      /^vitality8:50#1#\d+$/.test(ann.page || ''),
      '4. 专题内划线存为 type=topic', JSON.stringify({ made, ann }));
    const marked = await page.evaluate(() => document.querySelectorAll('#topicMain .topic-page mark[data-ann-id]').length);
    ok(marked === 1, '5. 正文高亮渲染', String(marked));

    // 6. 刷新 → 深链保持位置且高亮还在（坐标系稳定）
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-read', { timeout: 15000 });
    await sleep(600);
    const afterReload = await page.evaluate(() => ({
      hash: location.hash,
      marks: document.querySelectorAll('#topicMain .topic-page mark[data-ann-id]').length,
      hl: document.querySelectorAll('#topicSide .hl-item').length,
    }));
    ok(afterReload.hash === scr.hash && afterReload.marks === 1 && afterReload.hl === 1,
      '6. 刷新保持位置+高亮+右栏汇总', JSON.stringify(afterReload));

    // 7. 读经单「读原文」→ 读经模块，读经自己的标注为空（专题与读经互不串）
    await page.evaluate(() => [...document.querySelectorAll('.topic-ref')].find(e => e.dataset.topicBible).click());
    await sleep(1800);
    const bibleView = await page.evaluate(() => ({
      mod: state.activeModule,
      screen: state.screen,
      topic: document.body.classList.contains('topic'),
      hash: location.hash,
      book: state.currentBook && state.currentBook.index,
      marks: document.querySelectorAll('#textCol mark[data-ann-id]').length,
    }));
    ok(bibleView.mod === 'bible' && bibleView.screen === 'work' && !bibleView.topic &&
      bibleView.hash === '#/bible/50/1' && bibleView.book === 50 && bibleView.marks === 0,
      '7. 读经单跳原文（标注互不串）', JSON.stringify(bibleView));

    // 8. 回专题（历史里的专题条目），写屏级笔记 → 笔记管理归集
    await page.evaluate(() => openTopicScreen('vitality8', 50, 1));
    await page.waitForSelector('#topicSide textarea', { timeout: 15000 });
    await page.evaluate(() => {
      const ta = document.querySelector('#topicSide textarea');
      ta.value = '本屏领受：基督是我们的生命。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    const noteSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.topicNotes') || '{}'));
    ok(Object.values(noteSaved).some(t => String(t).includes('本屏领受')), '8. 屏级笔记落盘', JSON.stringify(noteSaved));
    // 给该条划线补一句笔记，才进得了「我的笔记」（纯划线不进笔记管理）
    await page.evaluate(() => { const a = state.annotations.find(x => x.type === 'topic'); if (a) { a.note = '专题笔记测试'; save('bible-study.annotations', state.annotations); } });
    await page.evaluate(() => enterModule('notes'));
    await sleep(1200);
    const notesMod = await page.evaluate(() => {
      const src = [...document.querySelectorAll('#notesMain .notes-tab, #notesMain .notes-sort')].find(b => /专题/.test(b.textContent));
      if (src) src.click();   // 切到「专题」来源，看分类树与列表
      const nav = document.querySelector('#notesNav');
      const list = document.querySelector('#notesMain .notes-list');
      return {
        hasSourceTab: !!src,
        tree: (nav ? nav.textContent : '').replace(/\s+/g, ' ').slice(0, 120),
        list: (list ? list.textContent : '').replace(/\s+/g, ' ').slice(0, 120),
        count: state.annotations.filter(a => a.type === 'topic').length,
      };
    });
    ok(notesMod.hasSourceTab && /专题/.test(notesMod.tree) && /腓立比书/.test(notesMod.tree) && /专题笔记测试/.test(notesMod.list),
      '9. 笔记管理「专题」来源/分类树/列表', JSON.stringify(notesMod));

    // 10. 深链：不存在的屏号（歌罗西书只有 1/3 章两屏）钳制到该书第一屏，URL 归一化
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/vitality8/51/99', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-read', { timeout: 15000 });
    await sleep(600);
    const clamp = await page.evaluate(() => ({ hash: location.hash, screen: state.topicScreen, book: state.topicBook }));
    ok(clamp.book === 51 && clamp.screen === 1 && clamp.hash === '#/topic/vitality8/51/1',
      '10. 深链屏号钳制+URL 归一化', JSON.stringify(clamp));
    // 10b. 合法的第二屏（歌罗西书第 3 章）直进
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/vitality8/51/3', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#topicMain .topic-read', { timeout: 15000 });
    await sleep(600);
    const s3 = await page.evaluate(() => ({ hash: location.hash, screen: state.topicScreen, reads: document.querySelectorAll('#topicMain .topic-read').length }));
    ok(s3.hash === '#/topic/vitality8/51/3' && s3.screen === 3 && s3.reads >= 1, '10b. 合法屏直进', JSON.stringify(s3));

    // 11. 非法专题 id → 回首页
    await page.goto('http://127.0.0.1:' + PORT + '/#/topic/nope/50/1', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await sleep(500);
    const bad = await page.evaluate(() => ({ home: document.body.classList.contains('home'), hash: location.hash }));
    ok(bad.home && bad.hash === '', '11. 非法专题 id 回首页并净化 URL', JSON.stringify(bad));

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    server.kill();
  }
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });