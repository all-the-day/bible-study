/* 笔记管理模块专项测试：直进 / 分类树计数 / 来源 tab / 颜色过滤 / 搜索 / 排序 /
 * 条目选中进右栏 / 编辑笔记 / 改色 / 删除单条（确认框）/ 大段笔记编辑与删除 /
 * 批量删除 / 偏好持久化恢复 */
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
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text());
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });

  // 预置数据：4 条不同类型标注 + 2 条大段笔记（chapterNotes/morningNotes）
  await page.evaluate(() => {
    const now = Date.now();
    const anns = [
      { id: 't1', type: 'verse', book: 1, chapter: 24, verse: 5, half: '', start: 0, end: 4, text: '耶和华啊', prefix: '', suffix: '', colorId: 'c1', underline: false, note: '测试经文笔记', createdAt: now - 5000 },
      { id: 't2', type: 'lr', book: 1, articleId: 60, start: 0, end: 6, text: '圣灵启示', prefix: '', suffix: '', colorId: 'c2', underline: false, note: '', createdAt: now - 4000 },
      { id: 't3', type: 'morning', period: '2026-03', chapterId: 2, start: 0, end: 5, text: '早晨复兴', prefix: '', suffix: '', colorId: 'c4', underline: false, note: '听抄笔记', createdAt: now - 3000 },
      { id: 't4', type: 'book', series: 'ni', volume: 2, book: 0, chapter: 0, start: 0, end: 5, text: '十字架的道', prefix: '', suffix: '', colorId: 'c5', underline: true, note: '', createdAt: now - 2000 },
    ];
    localStorage.setItem('bible-study.annotations', JSON.stringify(anns));
    localStorage.setItem('bible-study.chapterNotes', JSON.stringify({ '1:24': '创世记24章大段笔记' }));
    localStorage.setItem('bible-study.morningNotes', JSON.stringify({ '2026-03:2': '听抄大段笔记' }));
    localStorage.removeItem('bible-study.notesPrefs');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await wait(800);

  // 1. 直进笔记模块
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await wait(1500);
  const r1 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-notes'),
    nav: document.querySelector('#notesNav') && getComputedStyle(document.querySelector('#notesNav')).display !== 'none',
    main: document.querySelector('#notesMain') && getComputedStyle(document.querySelector('#notesMain')).display !== 'none',
    side: document.querySelector('#notesSide') && getComputedStyle(document.querySelector('#notesSide')).display !== 'none',
    crumb: document.querySelector('#bookName').textContent,
    treeNodes: [...document.querySelectorAll('#notesNav .notes-tree-node')].map(n => n.textContent),
  }));
  console.log('1. 直进:', r1.mod && r1.nav && r1.main && r1.side && r1.crumb === '笔记管理' ? '✓' : '✗',
    '| 树节点:', r1.treeNodes.join(','));

  // 2. 全部列表：4 标注 + 2 大段笔记 = 6 条目，分组含「创世记 · 第24章」
  const r2 = await page.evaluate(() => ({
    items: document.querySelectorAll('.notes-item').length,
    groups: [...document.querySelectorAll('.notes-group')].map(g => g.textContent).join('|'),
    tabs: [...document.querySelectorAll('.notes-tab')].map(t => t.textContent).join(','),
  }));
  console.log('2. 全部列表:', r2.items === 6 ? '✓' : '✗', '| 条目:', r2.items, '| 分组:', r2.groups);

  // 3. 来源 tab 过滤：经文 → 1 标注 + 1 大段笔记
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '经文').click(); });
  await wait(400);
  const r3 = await page.evaluate(() => ({
    items: document.querySelectorAll('.notes-item').length,
    group: document.querySelector('.notes-group')?.textContent,
  }));
  console.log('3. 来源过滤:', r3.items === 2 && r3.group.includes('创世记 · 第24章') ? '✓' : '✗', '|', JSON.stringify(r3));

  // 4. 颜色过滤 c1（经文 tab 下）→ 标注只剩 t1，大段笔记不受颜色过滤（仍 1 条）→ 共 2 条
  await page.evaluate(() => { document.querySelectorAll('.notes-color')[1].click(); });
  await wait(400);
  const r4 = await page.evaluate(() => ({
    items: document.querySelectorAll('.notes-item').length,
    hasVerse: [...document.querySelectorAll('.notes-item')].some(el => el.textContent.includes('耶和华啊')),
  }));
  console.log('4. 颜色过滤:', r4.items === 2 && r4.hasVerse ? '✓' : '✗', '| 条目:', r4.items);
  await page.evaluate(() => { document.querySelectorAll('.notes-color')[0].click(); });
  await wait(300);

  // 5. 切回全部 tab 再搜索（连续输入不被重建打断）：听抄 → 1 条标注 + 1 条大段笔记
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '全部').click(); });
  await wait(300);
  const search = await page.$('.notes-search');
  await search.click();
  await page.type('.notes-search', '听抄');
  await wait(400);
  const r5 = await page.evaluate(() => ({
    items: document.querySelectorAll('.notes-item').length,
    val: document.querySelector('.notes-search').value,
  }));
  console.log('5. 搜索:', r5.items === 2 && r5.val === '听抄' ? '✓' : '✗', '| 条目:', r5.items, '| 输入值:', r5.val);

  // 6. 排序切时间倒序 → 无报错且条目不变
  await page.evaluate(() => { [...document.querySelectorAll('.notes-sort')].find(b => b.textContent === '时间倒序').click(); });
  await wait(300);
  const r6 = await page.evaluate(() => ({
    active: document.querySelector('.notes-sort.active')?.textContent,
    items: document.querySelectorAll('.notes-item').length,
  }));
  console.log('6. 排序:', r6.active === '时间倒序' && r6.items === 2 ? '✓' : '✗', '|', JSON.stringify(r6));
  // 恢复默认：清搜索 + 书卷序 + 全部 tab
  await page.evaluate(() => { document.querySelector('.notes-search').value = ''; document.querySelector('.notes-search').dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  await page.evaluate(() => { [...document.querySelectorAll('.notes-sort')].find(b => b.textContent === '书卷序').click(); });
  await wait(300);
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '全部').click(); });
  await wait(400);

  // 7. 点击标注条目（圣灵启示）→ 右栏编辑面板 + 编辑笔记 + 改色
  await page.evaluate(() => { [...document.querySelectorAll('.notes-item')].find(el => el.textContent.includes('圣灵启示')).click(); });
  await wait(400);
  const r7 = await page.evaluate(() => ({
    title: document.querySelector('.notes-panel-title')?.textContent,
    ta: !!document.querySelector('#notesSide .lr-note-ta'),
  }));
  console.log('7. 选中进面板:', r7.title === '生命读经标注' && r7.ta ? '✓' : '✗', '|', r7.title);
  await page.type('#notesSide .lr-note-ta', '面板编辑笔记');
  await wait(300);
  const r7b = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const t2 = anns.find(a => a.id === 't2');
    return t2 && t2.note;
  });
  console.log('   编辑笔记写回:', r7b === '面板编辑笔记' ? '✓' : '✗', '|', r7b);
  await page.evaluate(() => { document.querySelectorAll('#notesSide .notes-color').forEach(b => { if (b.title.includes('蓝')) b.click(); }); });
  await wait(400);
  const r7c = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const t2 = anns.find(a => a.id === 't2');
    return t2 && t2.colorId;
  });
  console.log('   改色写回:', r7c === 'c4' ? '✓' : '✗', '| colorId:', r7c);

  // 8. 删除单条（确认框）
  await page.evaluate(() => { [...document.querySelectorAll('#notesSide .popup-btn')].find(b => b.textContent === '删除').click(); });
  await wait(300);
  const r8a = await page.evaluate(() => ({ popup: !document.querySelector('#popup').hidden, ok: !!document.querySelector('#cfOk') }));
  await page.evaluate(() => { document.querySelector('#cfOk').click(); });
  await wait(500);
  const r8b = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    return !anns.some(a => a.id === 't2');
  });
  console.log('8. 删除单条:', r8a.popup && r8a.ok && r8b ? '✓' : '✗', '| 确认框:', r8a.popup, '| 已删:', r8b);

  // 9. 大段笔记：选中 → 编辑写回 → 删除
  await page.evaluate(() => { [...document.querySelectorAll('.notes-item')].find(el => el.textContent.includes('创世记24章大段笔记')).click(); });
  await wait(400);
  const r9a = await page.evaluate(() => document.querySelector('.notes-panel-title')?.textContent);
  await page.evaluate(() => { const ta = document.querySelector('#notesSide .lr-note-ta'); ta.value = '改过的大段笔记'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  const r9b = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.chapterNotes') || '{}')['1:24']);
  console.log('9. 大段笔记:', r9a === '大段笔记' && r9b === '改过的大段笔记' ? '✓' : '✗', '| 面板:', r9a, '| 写回:', r9b);
  await page.evaluate(() => { [...document.querySelectorAll('#notesSide .popup-btn')].find(b => b.textContent === '删除').click(); });
  await wait(300);
  await page.evaluate(() => { document.querySelector('#cfOk').click(); });
  await wait(500);
  const r9c = await page.evaluate(() => !('1:24' in JSON.parse(localStorage.getItem('bible-study.chapterNotes') || '{}')));
  console.log('   大段笔记删除:', r9c ? '✓' : '✗');

  // 10. 批量删除：多选 → 勾 2 条 → 删除所选
  await page.evaluate(() => { [...document.querySelectorAll('.notes-sort')].find(b => b.textContent === '多选').click(); });
  await wait(400);
  const r10a = await page.evaluate(() => ({
    checks: document.querySelectorAll('.notes-item-check').length,
    bar: !!document.querySelector('.notes-batch-bar'),
  }));
  await page.evaluate(() => {
    const cbs = document.querySelectorAll('.notes-item-check');
    cbs[0].click(); cbs[1].click();
  });
  await wait(300);
  const r10b = await page.evaluate(() => document.querySelector('.notes-batch-bar span')?.textContent);
  await page.evaluate(() => { [...document.querySelectorAll('.notes-batch-bar .popup-btn')].find(b => b.textContent === '删除所选').click(); });
  await wait(300);
  await page.evaluate(() => { document.querySelector('#cfOk').click(); });
  await wait(500);
  const r10c = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.annotations') || '[]').length);
  console.log('10. 批量删除:', r10a.checks === 3 && r10a.bar && r10b === '已选 2 条' && r10c === 1 ? '✓' : '✗',
    '| 复选:', r10a.checks, '| 计数:', r10b, '| 剩余标注:', r10c);

  // 11. 偏好持久化：切听抄 tab → 重载 → 再进模块 tab 仍为听抄
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '听抄').click(); });
  await wait(400);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await wait(800);
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await wait(1500);
  const r11 = await page.evaluate(() => ({
    active: document.querySelector('.notes-tab.active')?.textContent,
    items: document.querySelectorAll('.notes-item').length,
  }));
  console.log('11. 偏好恢复:', r11.active === '听抄' && r11.items >= 1 ? '✓' : '✗', '|', JSON.stringify(r11));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}
main().catch((e) => { console.error(e); process.exit(1); });
