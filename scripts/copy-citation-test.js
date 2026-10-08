/* 反馈 #21「复制带出处」专项：
 * 1) selectionCitation 跨模块出处文案（读经 / 生命读经 / 书报 / 听抄 各自正确，
 *    不再把非 verse 一律标成「生命读经 第N篇」——原 selectedCitation 的 bug）
 * 2) 「复制」端到端：payload = 正文 + 换行 + 「—— 出处」（尾注式）
 * 3) 「引用到笔记」沿用同一出处（括号式）
 * 自起 :8768 静态服务器（与 run-all-tests 的 8765 隔离），结束即 kill。 */
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
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${extra || ''}`); }
  };

  // 直接装载各模块数据（出处文案只依赖 state，无需真跑模块导航，降低 flake）
  await page.evaluate(async () => {
    state.bookMeta = await fetchJSON('data/books/ni.json');
    state.morningIndex = await fetchJSON('data/morning/index.json');
    state.morningData['2026-04'] = await fetchJSON('data/morning/2026-04.json');
    state.lrVolumes[1] = await fetchJSON('data/lifereading/创.json');
  });

  // 1. 读经：出处 = 书卷全名 + 章:节 + 模块
  await page.evaluate(() => selectBook(1, 1));
  await page.waitForSelector('.verse .vtext', { timeout: 15000 });
  await page.waitForFunction(() => !!state.bibleText, { timeout: 15000 });
  let cit = await page.evaluate(() => selectionCitation({ type: 'verse', verse: 1, half: '' }));
  check('1. 读经出处 =「创世记 1:1 · 读经」', cit === '创世记 1:1 · 读经', JSON.stringify(cit));
  cit = await page.evaluate(() => selectionCitation({ type: 'verse', verse: 26, half: '下' }));
  check('1b. 半节后缀保留 =「创世记 1:26下 · 读经」', cit === '创世记 1:26下 · 读经', JSON.stringify(cit));

  // 2. 生命读经：书卷·生命读经 + 篇目（去源标题序号前缀）+ 模块
  cit = await page.evaluate(() => selectionCitation({ type: 'lr', articleId: 60, book: 1 }));
  check('2. 生命读经出处「创世记·生命读经 第..篇 .. · 生命读经」且无源序号前缀',
    cit.startsWith('创世记·生命读经 第') && cit.endsWith(' · 生命读经') && /以撒的婚姻/.test(cit) && !/0\d/.test(cit),
    JSON.stringify(cit));

  // 3. 书报：文集·辑·书名 + 章名 + 模块（原 bug：会标成「生命读经 第N篇」）
  // 书报章目首项是「序」，故 index 1 = 「第一篇 回到十字架罢(亚察尔)」
  cit = await page.evaluate(() => selectionCitation({ type: 'book', series: 'ni', volume: 1, book: 0, chapter: 1 }));
  check('3. 书报出处 =「倪柝声文集·第一辑·灵修指微 第一篇 回到十字架罢(亚察尔) · 书报」',
    cit === '倪柝声文集·第一辑·灵修指微 第一篇 回到十字架罢(亚察尔) · 书报', JSON.stringify(cit));
  cit = await page.evaluate(() => selectionCitation({ type: 'book', series: 'ni', volume: 1, book: 0, chapter: 0 }));
  check('3b. 书报「序」章出处', cit === '倪柝声文集·第一辑·灵修指微 序 · 书报', JSON.stringify(cit));

  // 4. 听抄：期标题 + 第N篇 + 篇名 + 模块
  cit = await page.evaluate(() => selectionCitation({ type: 'morning', period: '2026-04', chapterId: 2 }));
  check('4. 听抄出处 =「六月半年度训练 第2篇 永远的生命.. · 听抄」',
    cit.startsWith('六月半年度训练 第2篇 永远的生命') && cit.endsWith(' · 听抄'), JSON.stringify(cit));

  // 选中「起初」二字（前 2 个文本字符，跳过 <sup> 标记）
  const selectFirst2 = () => page.evaluate(() => {
    const vtext = document.querySelector('.verse .vtext');
    const walker = document.createTreeWalker(vtext, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && t.parentElement.tagName === 'SUP') t = walker.nextNode();
    const range = document.createRange();
    range.setStart(t, 0); range.setEnd(t, 2);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  // 5. 端到端：点「复制」→ payload = 正文 + 换行 + 「—— 出处」
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
    });
  });
  await selectFirst2();
  await new Promise((r) => setTimeout(r, 300));
  const toolBtn = await page.evaluate(() =>
    [...document.querySelectorAll('#floatTool .tool-btn')].some((b) => b.textContent === '复制'));
  check('5a. 浮动工具栏含「复制」按钮', toolBtn);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#floatTool .tool-btn')].find((b) => b.textContent === '复制');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const payload = await page.evaluate(() => window.__copied[0] || '');
  check('5b. 复制 payload =「起初\\n—— 创世记 1:1 · 读经」', payload === '起初\n—— 创世记 1:1 · 读经', JSON.stringify(payload));

  // 5c. 复制后工具栏自动隐藏 + toast 提示
  //     真实点击序列：mousedown（bindPress 触发复制并隐藏）→ mouseup 冒泡到 document，
  //     handleSelection 会因选区仍在而重建工具栏——须确认已拦截
  await selectFirst2();
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#floatTool .tool-btn')].find((b) => b.textContent === '复制');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => ({
    hidden: document.querySelector('#floatTool').hidden,
    toast: (document.querySelector('#toast') || {}).textContent || '',
    toastShown: !!(document.querySelector('#toast') && document.querySelector('#toast').classList.contains('show')),
  }));
  check('5c. 复制后工具栏隐藏（mouseup 不复弹）', after.hidden, JSON.stringify(after));
  check('5d. 复制后 toast「已复制，含出处」', after.toastShown && after.toast === '已复制，含出处', JSON.stringify(after));

  // 6. 引用到笔记沿用同一出处（括号式）——复制后 pendingRange 已清，重新选
  await selectFirst2();
  await new Promise((r) => setTimeout(r, 300));
  const noteLine = await page.evaluate(() => {
    const key = `${state.currentBook.index}:${state.currentChapter}`;
    const before = state.chapterNotes[key] || '';
    quoteToNotes();
    return (state.chapterNotes[key] || '').slice(before.length).trim();
  });
  check('6. 引用到笔记 =「「起初」（创世记 1:1）」（本模块内免模块标签）',
    noteLine === '「起初」（创世记 1:1）', JSON.stringify(noteLine));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('JS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  process.exit(fail || errors.length ? 1 : 0);
}
main().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
