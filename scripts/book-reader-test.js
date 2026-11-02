/* 书报阅读器专项测试：直进第1辑第1本、辑条切辑、书列表切书、抽屉切章、右栏本章笔记
 * （原右栏「章列表」tab 与目录抽屉冗余已删，切章统一走抽屉）、
 * 书报划线标注、全局笔记书报分组跳转、回首页再进恢复 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8765;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  // 等 init 收尾再点首页块：并发全量跑时启动数据处理变慢，固定 sleep 兜不住——
  // init 尾部的 selectBook 会覆写 crumb（本步恰断言 crumb），2026-10-27 notes-module 实测踩过
  await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });

  // 1. 点书报块 → 直进第1辑第1本第1章
  await page.click('#homeGrid .home-block[data-entry="ni"]');
  await new Promise((r) => setTimeout(r, 3500));
  const r1 = await page.evaluate(() => ({
    modBooks: document.body.classList.contains('body-mod-books'),
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 18),
    filter: (() => { const el = document.querySelector('#dwSearchInput'); return !!el && getComputedStyle(el).display !== 'none'; })(),
    bookCount: document.querySelectorAll('#navDrawer .dw-col .dw-item[data-l]').length,
    title: document.querySelector('.bk-title')?.textContent,
    paraCount: document.querySelectorAll('.bk-para').length,
    sideTabs: [...document.querySelectorAll('#bookSide .lr-side-tab')].map(t => t.textContent).join('|'),
    notesTa: !!document.querySelector('#bookSide .lr-note-ta'),
    actionsHidden: getComputedStyle(document.querySelector('#viewModeBtn')).display === 'none',
  }));
  console.log('1. 书报直进:', r1.modBooks && r1.filter && r1.bookCount === 20 && r1.crumb.includes('灵修指微') ? '✓' : '✗',
    '| crumb:', r1.crumb, '| 章数:', r1.paraCount > 0 ? '>' + r1.paraCount : '✗', '| tabs:', r1.sideTabs || '(无)', '| 笔记:', r1.notesTa);

  // 2. 目录抽屉右栏切第2章（原右栏「章列表」tab 已删，切章统一走抽屉）
  await page.evaluate(() => { document.querySelectorAll('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item')[1].click(); });
  await new Promise((r) => setTimeout(r, 1500));
  const r2 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    drawerCur: document.querySelector('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item.cur')?.textContent.slice(0, 14),
  }));
  console.log('2. 抽屉切章:', r2.crumb.includes('第2章') && r2.drawerCur ? '✓' : '✗', '|', r2.crumb, '| cur:', r2.drawerCur);

  // 3. 停靠列切书(第2本)：点左栏书=刷新右栏，点右栏第1章才跳转
  await page.evaluate(() => { document.querySelectorAll('#navDrawer .dw-col .dw-item[data-l]')[1].click(); });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => { document.querySelector('#navDrawer .dw-cols .dw-col:nth-child(2) .dw-item').click(); });
  await new Promise((r) => setTimeout(r, 1500));
  const r3 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    bookCur: document.querySelector('#navDrawer .dw-col .dw-item.cur')?.textContent.slice(0, 12),
  }));
  console.log('3. 切书:', r3.crumb.includes('十字架的道') && r3.crumb.includes('第1章') ? '✓' : '✗', '|', r3.crumb, '| cur:', r3.bookCur);

  // 4. 统一导航抽屉（辑切换 + 书列表）切第2辑 → 第1本第1章
  await page.evaluate(() => openNavDrawer());
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => document.querySelectorAll('#dwFoot [data-vol]')[1].click());
  await new Promise((r) => setTimeout(r, 600));
  const r4a = await page.evaluate(() => ({
    volSel: document.querySelector('#dwFoot [data-vol].sel')?.textContent,
    drawerBooks: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
  }));
  await page.evaluate(() => document.querySelector('#dwBody .dw-col .dw-item[data-l]').click());
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').click());
  await new Promise((r) => setTimeout(r, 2000));
  const r4 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    bookCount: document.querySelectorAll('#navDrawer .dw-col .dw-item[data-l]').length,
  }));
  console.log('4. 抽屉切辑:', r4a.volSel === '第二辑' && r4a.drawerBooks === 26 && r4.bookCount === 26 ? '✓' : '✗',
    '| 辑:', r4a.volSel, '|', r4.crumb, '| 书数:', r4.bookCount);

  // 5. 划线标注 → 保存 + 高亮
  await page.evaluate(() => {
    const content = document.querySelector('#bookMain .book-content');
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let t = walker.nextNode();
    while (t && (t.parentElement.tagName === 'SUP' || t.parentElement.classList.contains('ref-link'))) t = walker.nextNode();
    const len = Math.min(4, t.textContent.length);
    const range = document.createRange();
    range.setStart(t, 0);
    range.setEnd(t, len);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#floatTool .sw.c2');
  await new Promise((r) => setTimeout(r, 500));
  const r5 = await page.evaluate(() => {
    const anns = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
    const last = anns[anns.length - 1];
    // 笔记管理只收纳带 note 的标注——补一条笔记并同步内存态，供第 6 步在模块内选中
    if (last) {
      last.note = '书报测试笔记';
      localStorage.setItem('bible-study.annotations', JSON.stringify(anns));
      state.annotations = anns;
    }
    return { type: last && last.type, vol: last && last.volume, mark: !!document.querySelector('#bookMain mark.c2') };
  });
  console.log('5. 书报划线:', r5.type === 'book' && r5.vol === 2 && r5.mark ? '✓' : '✗', JSON.stringify(r5));

  // 6. 回首页 → 笔记管理模块 → 书报 tab 分组 → 点击选中进编辑面板（不再跳回原文）
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="notes"]');
  await new Promise((r) => setTimeout(r, 1200));
  const r6 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-notes'),
    tabs: [...document.querySelectorAll('.notes-tab')].map(t => t.textContent).join('|'),
    groups: [...document.querySelectorAll('.notes-group')].map(g => g.textContent).join('|'),
  }));
  console.log('6. 笔记模块:', r6.mod && r6.tabs.includes('书报') ? '✓' : '✗', '| 分组:', r6.groups);
  await page.evaluate(() => { [...document.querySelectorAll('.notes-tab')].find(t => t.textContent === '书报').click(); });
  await new Promise((r) => setTimeout(r, 500));
  const itemCount = await page.$$eval('.notes-item', els => els.length);
  if (itemCount) {
    await page.click('.notes-item');
    await new Promise((r) => setTimeout(r, 500));
    const r6b = await page.evaluate(() => ({
      panelTitle: document.querySelector('.notes-panel-title')?.textContent,
      stayNotes: document.body.classList.contains('body-mod-notes'),
      modBooks: document.body.classList.contains('body-mod-books'),
    }));
    console.log('   点击选中:', r6b.panelTitle === '书报标注' && r6b.stayNotes && !r6b.modBooks ? '✓' : '✗', '| 面板:', r6b.panelTitle);
  } else {
    console.log('   点击选中: ✗ 无条目');
  }

  // 7. ⌂ 回首页再进书报 → 恢复上次位置
  await page.click('#homeBtn');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('#homeGrid .home-block[data-entry="ni"]');
  await new Promise((r) => setTimeout(r, 2500));
  const r7 = await page.evaluate(() => ({
    crumb: document.querySelector('#chapterLabel').textContent.slice(0, 22),
    volMeta: (state.bookMeta.volumes[state.bookVolume - 1] || {}).title,
  }));
  console.log('7. 回首页再进恢复:', r7.volMeta === '第二辑' && r7.crumb.includes('复刊基督徒报') && r7.crumb.includes('第1章') ? '✓' : '✗', '|', r7.crumb);

  // 8. ensureBookVolume 在途去重：加载进行中重复调用只发一次请求（慢网重复下载回归，2026-10-10）
  {
    const reqs = [];
    const onReq = (r) => { if (r.url().includes('data/books/ni-2.json')) reqs.push(r.url()); };
    page.on('request', onReq);
    const r8 = await page.evaluate(async () => {
      state.bookSeries = 'ni';
      state.bookVolumes.ni = {};          // 清缓存强制重新加载
      const [a, b] = await Promise.all([ensureBookVolume(2), ensureBookVolume(2)]);
      return { same: a === b, cached: !!state.bookVolumes.ni[2], bookCount: a?.books?.length };
    });
    await new Promise((r) => setTimeout(r, 800));
    page.off('request', onReq);
    console.log('8. 在途去重(并发双调单请求):', r8.same && r8.cached && reqs.length === 1 ? '✓' : '✗',
      '| 请求次数:', reqs.length, '| 同一Promise:', r8.same, '| 缓存写入:', r8.cached, '| 书数:', r8.bookCount);
  }

  // 9. 右栏纲目（2026-11 策展流水线，契约见 docs/book-outline-playbook.md）：
  //    策展章按纲目渲染 + 点击定位；显式空章压制运行时误报；未策展章回退 detectLrHeading
  {
    // data/books/outline/ 是构建产物（不入库）：本地缺失就先构建。
    // 构建失败/产物缺失**判失败**（✗），不许静默跳过——否则整个新功能的 e2e 可以永不执行而门禁全绿（CR 2026-11-02）。
    // 构建脚本原子写入（tmp + os.replace），并发泳道里被读到半个 JSON 的风险已消除。
    const { spawnSync } = require('child_process');
    const built = spawnSync('python', ['scripts/build-book-outlines.py', 'ni', 'gospel'], { cwd: ROOT, encoding: 'utf-8' });
    const hasData = built.status === 0 &&
      require('fs').existsSync(require('path').join(ROOT, 'data', 'books', 'outline', 'ni-1.json'));
    if (!hasData) {
      console.log('9. 纲目: ✗ 数据不可用（build-book-outlines 退出码 ' + built.status + '）：'
        + (built.error ? built.error.message : String(built.stderr || '').slice(0, 200)));
    } else {
      await page.evaluate(() => openBookChapter(1, 0, 1, 'ni'));
      await new Promise((r) => setTimeout(r, 2000));
      const r9a = await page.evaluate(() => ({
        tab: document.querySelector('#bookSide .lr-side-tab.active')?.textContent,
        toc: [...document.querySelectorAll('#bookSide .lr-toc-item')].map(i => i.textContent),
        heads: document.querySelectorAll('#bookMain .bk-head').length,
      }));
      const ok9a = r9a.tab === '纲目' && r9a.heads === 5 && r9a.toc.length === 5 &&
        r9a.toc[0] === '与神和好的地方' &&
        r9a.toc[4] === '祂的子民怎样得胜过魔鬼和他的军兵呢？';   // 12 字上限漏识别、策展补入的那条
      console.log('9a. 纲目(策展章):', ok9a ? '✓' : '✗', '| tab:', r9a.tab, '| 纲目', r9a.toc.length, '条 | 正文标题', r9a.heads, '个');
      const topBefore = await page.evaluate(() => document.getElementById('textCol').scrollTop);
      await page.evaluate(() => document.querySelectorAll('#bookSide .lr-toc-item')[2].click());
      await new Promise((r) => setTimeout(r, 1000));
      const r9b = await page.evaluate(() => ({
        top: document.getElementById('textCol').scrollTop,
        active: document.querySelector('#bookSide .lr-toc-item.active')?.textContent,
      }));
      console.log('9b. 纲目点击定位:', r9b.top > topBefore && r9b.active === '基督的十字架和洗净' ? '✓' : '✗',
        '| scrollTop', topBefore, '→', r9b.top, '| active:', r9b.active);
      await page.evaluate(() => openBookChapter(1, 1, 34, 'ni'));
      await new Promise((r) => setTimeout(r, 2000));
      const r9c0 = await page.evaluate(() => ({
        tab: document.querySelector('#bookSide .lr-side-tab.active')?.textContent,
        noteTa: !!document.querySelector('#bookSide .lr-note-ta'),
      }));
      // 没有纲目的章默认落「笔记」（CR 2026-11-02：未策展系列否则一进来就是空态）
      await page.evaluate(() => { [...document.querySelectorAll('#bookSide .lr-side-tab')].find(t => t.textContent === '纲目').click(); });
      await new Promise((r) => setTimeout(r, 400));
      const r9c = await page.evaluate(() => ({
        toc: document.querySelectorAll('#bookSide .lr-toc-item').length,
        empty: document.querySelector('#bookSide .empty-hint')?.textContent || '',
        heads: document.querySelectorAll('#bookMain .bk-head').length,
      }));
      const ok9c = r9c0.tab === '笔记' && r9c0.noteTa &&
        r9c.toc === 0 && r9c.heads === 0 && r9c.empty === '本章无纲目';
      console.log('9c. 纲目(显式空压制+默认落笔记):', ok9c ? '✓' : '✗',
        '| 默认tab:', r9c0.tab, '| 纲目', r9c.toc, '条 | 正文标题', r9c.heads, '个 |', r9c.empty);
      // 回退路径：全系列已策展后，把本辑缓存置成「已加载但本章无键」→ bookOutlineFor 返回 null
      // → 主区/右栏都走 detectLrHeading 回退（策展文件加载失败、未来新增系列未策展时靠这条路兜底）。
      // CR 2026-11-02 修的正是这条路径的锚点错位：旧实现 TOC 扫全文、正文跳过开头书名/章名行，
      // 回退路径整体偏一位，点击跳错标题。bio 第2本第1章正是「开头有书名+章名两行」的样本。
      // 注意不能 delete 整个系列缓存——renderMain 会 await ensureBookOutline 重新 fetch 回来，
      // 那样仍走策展路径，断言会假绿（CR 2026-11-03 实测：54/54 策展 vs 66/66 回退）。
      await page.evaluate(() => openBookChapter(1, 1, 0, 'bio'));
      await new Promise((r) => setTimeout(r, 2500));
      await page.evaluate(async () => {
        state.bookOutlines.bio = { 1: {} };         // 已加载但本章无键 → 真回退
        await READER_MODULES.books.renderMain();
        READER_MODULES.books.renderSide();
      });
      await new Promise((r) => setTimeout(r, 800));
      const r9d = await page.evaluate(() => {
        const tocEls = [...document.querySelectorAll('#bookSide .lr-toc-item')];
        if (tocEls.length < 2) return { toc: tocEls.length, heads: 0 };
        tocEls[1].click();
        const hit = document.getElementById(tocEls[1].dataset.target);
        return {
          toc: tocEls.length,
          heads: document.querySelectorAll('#bookMain .bk-head').length,
          tocFirst: tocEls[0].textContent,
          tocSecond: tocEls[1].textContent,
          hitText: hit ? hit.textContent : '',
        };
      });
      const ok9d = r9d.toc > 1 && r9d.toc === r9d.heads &&
        r9d.tocFirst !== '世界基督教历史故事' && r9d.tocFirst !== '第一章 初期教会史' &&
        r9d.hitText && r9d.tocSecond.startsWith(r9d.hitText);
      console.log('9d. 纲目(回退路径+锚点对齐):', ok9d ? '✓' : '✗',
        '| 纲目', r9d.toc, '条 | 正文标题', r9d.heads, '个 | 首条:', r9d.tocFirst,
        '| 点第2条「' + r9d.tocSecond + '」→ 命中「' + r9d.hitText + '」');
    }
  }

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
