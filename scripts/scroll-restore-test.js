/* 阅读位置记忆专项（2026-11-09）：重开/刷新后回到上次读到的那一行
   覆盖：滚动→刷新→回到原位（读经/生命读经各一次，刷新走 hash 深链，与真实用户路径一致）
        / 翻章仍滚顶 / 翻走再翻回不沿用旧位置 / 两模块记录互不覆盖 / 不进云同步 / 锚点失效滚顶
   端口 8701（不与 8765 等既有测试抢） */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8701;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource')) return;
    errors.push('console: ' + m.text());
  });
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let fails = 0;
  const check = (label, pass, info) => {
    if (!pass) fails++;
    console.log(label, pass ? '✓' : '✗', info === undefined ? '' : '| ' + info);
  };
  // 等 splash 让位（覆盖态下 clickablePoint 会失败）
  const waitSplash = () => page.waitForFunction(() => {
    const s = document.getElementById('splash');
    return s && s.classList.contains('hidden');
  }, { timeout: 60000 });
  // 等读经主区渲染完成（深链刷新后由 initRoute 就位）
  const waitBible = () => page.waitForFunction(
    () => typeof state !== 'undefined' && state.screen === 'work' && document.querySelectorAll('#verseContainer .vtext').length > 2,
    { timeout: 30000 });
  const waitLr = () => page.waitForFunction(
    () => typeof state !== 'undefined' && state.screen === 'work' && document.querySelectorAll('#lrMain [data-base]').length > 2,
    { timeout: 40000 });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 40000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 20000 });
  await waitSplash();
  await sleep(400);

  // ── 1. 读经：滚到中段 → 刷新（深链）→ 回到同一位置
  await page.evaluate(() => localStorage.setItem('bible-study.last', JSON.stringify({ book: 1, chapter: 1 })));
  await page.click('#homeGrid .home-block[data-entry="bible"]');
  await waitBible();
  await sleep(900);
  await page.evaluate(() => {
    const c = document.getElementById('textCol');
    c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.55);
  });
  await sleep(900);   // 等防抖落盘（350ms）
  const before = await page.evaluate(() => ({
    scrollTop: Math.round(document.getElementById('textCol').scrollTop),
    rec: JSON.parse(localStorage.getItem('bible-study.readPos') || '{}').bible || null,
    hash: location.hash,
  }));
  await page.reload({ waitUntil: 'networkidle0' });
  await waitSplash();
  await waitBible();
  await sleep(1400);   // 让 enterModule 的位置恢复落定
  const after = await page.evaluate(() => ({
    scrollTop: Math.round(document.getElementById('textCol').scrollTop),
    unit: readingUnitKey('bible'),
    screen: state.screen,
  }));
  check('1. 读经 滚动 → 刷新 → 回原位',
    !!before.rec && before.scrollTop > 100 && Math.abs(after.scrollTop - before.scrollTop) <= 30,
    `滚前 ${before.scrollTop} → 刷新后 ${after.scrollTop} · 记录 ${JSON.stringify(before.rec)} · 深链 ${before.hash} · 单元 ${after.unit}`);

  // ── 2. 翻章仍滚顶
  await page.evaluate(() => selectChapter(2));
  await sleep(1600);
  const next = await page.evaluate(() => ({ top: Math.round(document.getElementById('textCol').scrollTop), ch: state.currentChapter }));
  check('2. 翻到下一章滚顶', next.ch === 2 && next.top === 0, `章 ${next.ch} · scrollTop ${next.top}`);

  // ── 3. 翻走再翻回来不沿用旧位置（记录已被新章覆盖）
  await page.evaluate(() => selectChapter(1));
  await sleep(1600);
  const backCh = await page.evaluate(() => ({ top: Math.round(document.getElementById('textCol').scrollTop), ch: state.currentChapter }));
  check('3. 翻回上一章不恢复旧位置', backCh.ch === 1 && backCh.top === 0, `章 ${backCh.ch} · scrollTop ${backCh.top}`);

  // ── 4. 生命读经独立记忆：滚动 → 回首页 → 再进 → 回原位
  await page.evaluate(() => localStorage.setItem('bible-study.lrLast', JSON.stringify({ book: 0, articleId: 1 })));
  await page.evaluate(() => enterModule('lifereading'));
  await waitLr();
  await sleep(1200);
  await page.evaluate(() => {
    const c = document.getElementById('textCol');
    c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.4);
  });
  await sleep(900);
  const lrBefore = await page.evaluate(() => ({
    top: Math.round(document.getElementById('textCol').scrollTop),
    recs: JSON.parse(localStorage.getItem('bible-study.readPos') || '{}'),
  }));
  await page.evaluate(() => showHome());
  await sleep(500);
  await page.evaluate(() => enterModule('lifereading'));
  await waitLr();
  await sleep(1500);
  const lrAfter = await page.evaluate(() => ({
    top: Math.round(document.getElementById('textCol').scrollTop),
    unit: readingUnitKey('lifereading'),
  }));
  check('4. 生命读经 回首页再进 → 回原位',
    !!lrBefore.recs.lifereading && lrBefore.top > 50 && Math.abs(lrAfter.top - lrBefore.top) <= 30,
    `滚前 ${lrBefore.top} → 再进 ${lrAfter.top} · 单元 ${lrAfter.unit} · 两模块记录并存 ${lrBefore.recs.bible && lrBefore.recs.lifereading ? '是' : '否'}`);

  // ── 5. 位置记录不进云同步白名单
  // SYNC_KEYS 是脚本作用域的 const（不是 window 属性）：直接引用，typeof 兜底
  const sync = await page.evaluate(() => {
    const ks = (typeof SYNC_KEYS !== 'undefined' && SYNC_KEYS) || [];
    return { n: ks.length, has: ks.includes('bible-study.readPos') };
  });
  check('5. 位置记录不进云同步', !sync.has, `SYNC_KEYS ${sync.n} 项，不含 readPos`);

  // ── 6. 锚点失效 → 滚顶且无异常
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('bible-study.readPos') || '{}');
    all.bible = { u: readingUnitKey('bible'), k: '9999', d: 100, t: Date.now() };
    localStorage.setItem('bible-study.readPos', JSON.stringify(all));
  });
  await page.evaluate(() => enterModule('bible'));
  await waitBible();
  await sleep(1200);
  const ghost = await page.evaluate(() => ({ top: Math.round(document.getElementById('textCol').scrollTop) }));
  check('6. 锚点失效 → 滚顶且无异常', ghost.top === 0, `scrollTop ${ghost.top}`);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  if (errors.length) fails++;
  console.log(fails ? `\n存在失败 ✗（${fails}）` : '\n全部通过');
  await browser.close();
  server.kill();
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
