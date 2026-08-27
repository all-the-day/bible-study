/* 听抄阅读器专项测试：直进第一篇、期条切期、篇列表切篇、层级标题渲染、
 * 听抄划线标注、全局笔记听抄分组跳转、回首页再进恢复 */
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

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  // 1. 点晨兴块 → 直进（默认第 1 期第 1 篇，听抄层级标题渲染）
  await page.click('#homeGrid .home-block[data-entry="morning"]');
  await new Promise((r) => setTimeout(r, 3500));
  const r1 = await page.evaluate(() => ({
    modMorning: document.body.classList.contains('body-mod-morning'),
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 20),
    periodBtns: document.querySelectorAll('.morning-period-btn').length,
    artCount: document.querySelectorAll('.morning-nav-art').length,
    heads: document.querySelectorAll('.morning-head').length,
    paras: document.querySelectorAll('.morning-para').length,
    sideTa: !!document.querySelector('#morningSide .lr-note-ta'),
    actionsHidden: getComputedStyle(document.querySelector('#viewModeBtn')).display === 'none',
  }));
  console.log('1. 晨兴直进:', r1.modMorning && r1.periodBtns === 2 && r1.paras >= 10 ? '✓' : '✗',
    '| 篇数:', r1.artCount, '| 层级标题:', r1.heads, '| 段落:', r1.paras, '| crumb:', r1.crumb);

  // 2. 期条切期（国殇节特会，6 篇）
  await page.evaluate(() => { document.querySelectorAll('.morning-period-btn')[1].click(); });
  await new Promise((r) => setTimeout(r, 2500));
  const r2 = await page.evaluate(() => ({
    periodActive: document.querySelector('.morning-period-btn.active')?.textContent,
    artCount: document.querySelectorAll('.morning-nav-art').length,
    title: document.querySelector('.morning-title')?.textContent.slice(0, 14),
  }));
  console.log('2. 切期:', r2.periodActive === '国殇节国际相调特会' && r2.artCount === 6 ? '✓' : '✗', '|', r2.title);

  // 3. 切篇（第2篇）
  await page.evaluate(() => { document.querySelectorAll('.morning-nav-art')[1].click(); });
  await new Promise((r) => setTimeout(r, 1200));
  const r3 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    artActive: document.querySelector('.morning-nav-art.active')?.textContent.slice(0, 10),
  }));
  console.log('3. 切篇:', r3.crumb.includes('第2篇') ? '✓' : '✗', '|', r3.crumb, '| active:', r3.artActive);

  // 4. 篇级笔记持久化
  await page.type('#morningSide .lr-note-ta', '晨兴测试笔记');
  await new Promise((r) => setTimeout(r, 400));
  const r4 = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.morningNotes') || '{}'));
  const noteKey = Object.keys(r4)[0];
  console.log('4. 篇级笔记:', r4[noteKey] === '晨兴测试笔记' ? '✓' : '✗', '| key:', noteKey);

  // 5. 划线标注 → type 'morning' + 高亮
  await page.evaluate(() => {
    const content = document.querySelector('#morningMain .morning-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && (t.parentElement.tagName === 'SUP' || t.parentElement.classList.contains('ref-link'))) t = walker.nextNode();
    const len = Math.min(4, t.textContent.length);
    const range = document.createRange();
    range.setStart(t, 0); range.setEnd(t, len);
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#floatTool .sw.c4');
  await new Promise((r) => setTimeout(r, 500));
  const r5 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const last = anns[anns.length - 1];
    return {
      type: last && last.type, period: last && last.period, chapterId: last && last.chapterId,
      mark: !!document.querySelector('#morningMain mark.c4'),
      sideItems: document.querySelectorAll('#morningSide .hl-item').length,
    };
  });
  console.log('5. 晨兴划线:', r5.type === 'morning' && r5.period === '2026-03' && r5.mark && r5.sideItems >= 1 ? '✓' : '✗',
    '| 主区高亮:', r5.mark, '| 右栏汇总条数:', r5.sideItems);

  // 6. 笔记管理模块：听抄 tab 分组 + 点击条目选中进编辑面板（不再跳回原文）
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await new Promise((r) => setTimeout(r, 1200));
  const r6 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-notes'),
    tabs: [...document.querySelectorAll('.notes-tab')].map(t => t.textContent).join('|'),
    groups: [...document.querySelectorAll('.notes-group')].map(g => g.textContent).join('|'),
  }));
  console.log('6. 笔记模块:', r6.mod && r6.tabs.includes('听抄') ? '✓' : '✗', '| 分组:', r6.groups);
  // 切到听抄 tab 找条目，点击 → 右栏编辑面板出现
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '听抄').click(); });
  await new Promise((r) => setTimeout(r, 500));
  const itemCount = await page.$$eval('.notes-item', els => els.length);
  if (itemCount) {
    // 大段笔记项带 .notes-item-kind 图标，标注项没有——点标注项
    await page.evaluate(() => {
      const ann = [...document.querySelectorAll('.notes-item')].find(el => !el.querySelector('.notes-item-kind'));
      if (ann) ann.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const r6b = await page.evaluate(() => ({
      panelTitle: document.querySelector('.notes-panel-title')?.textContent,
      modMorning: document.body.classList.contains('body-mod-morning'),
      stayNotes: document.body.classList.contains('body-mod-notes'),
    }));
    console.log('   点击选中:', r6b.panelTitle === '听抄标注' && r6b.stayNotes && !r6b.modMorning ? '✓' : '✗', '| 面板:', r6b.panelTitle);
  } else {
    console.log('   点击选中: ✗ 无条目');
  }

  // 7. ⌂ 回首页再进晨兴 → 恢复上次位置
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="morning"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r7 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    periodActive: document.querySelector('.morning-period-btn.active')?.textContent,
  }));
  console.log('7. 回首页再进恢复:', r7.periodActive === '国殇节国际相调特会' && r7.crumb.includes('第2篇') ? '✓' : '✗', '|', r7.crumb);

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
