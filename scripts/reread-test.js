/* 重读专项：「划线汇总」头部「重读」按钮——移除当前阅读单元的无笔记划线，带笔记的标注原样保留
 * 覆盖：读经模块（色划/下划线/带笔记混合）→ 确认框条数 → 无笔记划线删除+墓碑、带笔记完好、
 *       正文 mark 仅剩 has-note、汇总计数刷新、按钮消失、toast；
 *       跨单元隔离（关联生命读经篇目、邻章标注保留）；无标注章按钮不出现；
 *       生命读经模块右栏「笔记」tab 冒烟；移动端 390px 研读视图冒烟
 *       （Chrome 切换 isMobile 设备模拟会触发页面重载 → 重载后重新进工作区再断言） */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8767;   // 与 run-all-tests 的 8765 隔离（同 lr-module-annotation/copy-citation 惯例）

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log(`✓ ${name}`, extra || ''); }
  else { fail++; console.log(`✗ ${name}`, extra || ''); }
};

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
  // 跳过启动静默更新检查（省 GitHub API 配额）；t-boots 计数供移动端切换后等待重载完成
  await page.evaluateOnNewDocument(() => {
    window.BIBLE_SKIP_UPDATE = true;
    sessionStorage.setItem('t-boots', String((+sessionStorage.getItem('t-boots') || 0) + 1));
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await page.waitForSelector('#verseContainer .verse .vtext', { timeout: 15000 });
    await wait(600);

    // 工作区 + 创世记 1 章（selectChapter 顺带加载本卷生命读经，供关联篇目匹配）
    await page.evaluate(async () => { enterWork(); await selectChapter(1); });
    await wait(800);
    await page.click('.study-tab[data-tab="mynotes"]');
    await wait(300);

    // 选区辅助：在容器（或指定节）里选可标注文本节点的前 3 字并触发选区事件。
    // 节号按数字匹配（创1:2 是拆半节 2上/2下，vnum 文本带「上/下」后缀）
    await page.evaluate(() => {
      window.__selectIn = (containerSel, verseNum, skip) => {
        const root = document.querySelector(containerSel);
        let scope = root;
        if (verseNum) {
          const v = [...root.querySelectorAll('.verse')].find(el => ((el.querySelector('.vnum') || {}).textContent || '').replace(/[^\d]/g, '') === String(verseNum));
          scope = v && v.querySelector('.vtext');
        }
        if (!scope) return false;
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const ok = (x) => x && x.textContent.trim().length >= 3 && x.parentElement.tagName !== 'SUP'
          && !x.parentElement.classList.contains('ref-link') && !x.parentElement.classList.contains('person-link');
        let t = walker.nextNode();
        while (t && !ok(t)) t = walker.nextNode();
        for (let n = 0; t && n < (skip || 0); n++) {
          t = walker.nextNode();
          while (t && !ok(t)) t = walker.nextNode();
        }
        if (!t) return false;
        const range = document.createRange();
        range.setStart(t, 0);
        range.setEnd(t, Math.min(3, t.textContent.length));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return t.textContent.slice(0, 3);
      };
    });

    const vMarkCount = () => page.evaluate(() => document.querySelectorAll('#verseContainer mark').length);
    const selectVerse = async (n) => { await page.evaluate((v) => window.__selectIn('#verseContainer', v, 0), n); await wait(250); };
    const pressFloatBtn = (text) => page.evaluate((tx) => {
      const btn = [...document.querySelectorAll('#floatTool .tool-btn')].find(b => b.textContent === tx);
      if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }, text);
    // 工具栏按钮 bindPress 绑 mousedown（click 序列无效），全量负载下偶发瞬态不可点 → 重试兜底
    const addVerseMark = async (verseNum, colorSel) => {
      const before = await vMarkCount();
      for (let i = 0; i < 3; i++) {
        await selectVerse(verseNum);
        try { await page.click(colorSel); } catch (e) { /* 瞬态不可点，重试 */ }
        await wait(350);
        if (await vMarkCount() > before) return true;
      }
      return false;
    };
    const addVerseUnderline = async (verseNum) => {
      const before = await vMarkCount();
      for (let i = 0; i < 3; i++) {
        await selectVerse(verseNum);
        await pressFloatBtn('下划线');
        await wait(350);
        if (await vMarkCount() > before) return true;
      }
      return false;
    };

    // 造 4 条经文划线：v1 c1、v2 c2、v3 下划线、v4 c3（c3 稍后补笔记）
    const okMarks = (await addVerseMark(1, '#floatTool .sw.c1')) && (await addVerseMark(2, '#floatTool .sw.c2'))
      && (await addVerseUnderline(3)) && (await addVerseMark(4, '#floatTool .sw.c3'));
    // 给 c3 那条补笔记（「带笔记」判据 = note 非空白）；写回原文（含墓碑桩）保留其他条目
    const noted = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
      const a = raw.find(x => !x._del && x.colorId === 'c3');
      if (a) a.note = '重读要保留的笔记';
      localStorage.setItem('bible-study.annotations', JSON.stringify(raw));
      state.annotations = raw.filter(x => !x._del);
      renderChapter(); renderStudy();
      return a ? { id: a.id } : null;
    });
    await wait(400);

    // 种两条「不该被清」的标注：本章关联生命读经篇目 1 条 + 邻章（第2章）经文 1 条
    const extra = await page.evaluate(() => {
      const ids = autoMatchLrIds((state.lifereading && state.lifereading.articles) || [], 1);
      const now = Date.now();
      state.annotations.push(
        { id: 'reread-lr-1', type: 'lr', book: state.currentBook.index, articleId: ids[0], start: 0, end: 4, text: '关联篇目片段', prefix: '', suffix: '', colorId: 'c1', underline: false, note: '', createdAt: now + 1 },
        { id: 'reread-nb-1', type: 'verse', book: state.currentBook.index, chapter: 2, verse: 1, half: '', start: 0, end: 2, text: '起初', prefix: '', suffix: '', colorId: 'c2', underline: false, note: '', createdAt: now + 2 });
      save('bible-study.annotations', state.annotations);
      renderChapter(); renderStudy();
      return { lrArticleId: ids[0], matched: ids.length };
    });
    await wait(300);

    // 1. 初始态：4 条划线渲染（含 1 条 has-note）+ 按钮出现 + 汇总含关联生命读经
    const r1 = await page.evaluate(() => {
      const header = document.querySelector('#studyBody .hl-header');
      return {
        marks: document.querySelectorAll('#verseContainer mark').length,
        hasNote: document.querySelectorAll('#verseContainer mark.has-note').length,
        isUl: document.querySelectorAll('#verseContainer mark.ul').length,
        btn: document.querySelectorAll('#studyBody .hl-reread-btn').length,
        headerText: (header && header.textContent) || '',
        stored: JSON.parse(localStorage.getItem('bible-study.annotations') || '[]').length,
      };
    });
    check('1. 初始 4 划线 + 按钮出现 + 汇总 5（含关联生命读经）',
      okMarks && !!noted && extra.matched > 0 && r1.marks === 4 && r1.hasNote === 1 && r1.isUl === 1
      && r1.btn === 1 && r1.stored === 6 && /划线汇总 5 · 笔记 1/.test(r1.headerText),
      `marks=${r1.marks} hasNote=${r1.hasNote} ul=${r1.isUl} btn=${r1.btn} stored=${r1.stored} 匹配篇=${extra.matched} | ${r1.headerText}`);

    // 2. 点击重读 → 确认框条数 → 确认后：无笔记划线删除+墓碑、带笔记完好、按钮消失、toast
    const pureVerseIds = await page.evaluate(() => state.annotations
      .filter(a => a.type === 'verse' && a.chapter === 1 && !(a.note && a.note.trim())).map(a => a.id));
    await page.click('#studyBody .hl-reread-btn');
    await wait(300);
    const dlg = await page.evaluate(() => ({
      hint: (document.querySelector('.popup .fb-hint') || {}).textContent || '',
      ok: !!document.querySelector('#cfOk'),
    }));
    check('2a. 确认框文案（条数/保留数）', dlg.ok && /将移除本章经文的 3 处划线，保留 1 处带笔记的标注/.test(dlg.hint), dlg.hint);
    await page.click('#cfOk');
    await wait(500);
    const r2 = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
      const header = document.querySelector('#studyBody .hl-header');
      const toast = document.querySelector('#toast');
      return {
        liveIds: raw.filter(x => !x._del).map(x => x.id),
        tombIds: raw.filter(x => x._del).map(x => x.id),
        marks: document.querySelectorAll('#verseContainer mark').length,
        hasNote: document.querySelectorAll('#verseContainer mark.has-note').length,
        btn: document.querySelectorAll('#studyBody .hl-reread-btn').length,
        headerText: (header && header.textContent) || '',
        toast: (toast && toast.textContent) || '',
        toastShown: !!(toast && toast.classList.contains('show')),
      };
    });
    check('2b. 无笔记 3 条删除 + 墓碑 3 条 + 带笔记/跨单元 3 条保留',
      r2.liveIds.length === 3 && r2.liveIds.includes('reread-lr-1') && r2.liveIds.includes('reread-nb-1')
      && !!noted && r2.liveIds.includes(noted.id)
      && r2.tombIds.length === 3 && pureVerseIds.length === 3 && pureVerseIds.every(id => r2.tombIds.includes(id)),
      `live=${r2.liveIds.length} tomb=${r2.tombIds.length} liveIds=${r2.liveIds.join(',')}`);
    check('2c. 正文 mark 只剩 has-note + 汇总 2 · 笔记 1 + 按钮消失 + toast',
      r2.marks === 1 && r2.hasNote === 1 && r2.btn === 0 && /划线汇总 2 · 笔记 1/.test(r2.headerText)
      && r2.toastShown && /已重读：移除 3 处划线，保留 1 处笔记/.test(r2.toast),
      `marks=${r2.marks} btn=${r2.btn} | ${r2.headerText} | ${r2.toast}`);

    // 3. 无标注章：按钮不出现
    await page.evaluate(() => selectChapter(3));
    await wait(600);
    const r3 = await page.evaluate(() => ({
      btn: document.querySelectorAll('#studyBody .hl-reread-btn').length,
      marks: document.querySelectorAll('#verseContainer mark').length,
    }));
    check('3. 无标注章无按钮', r3.btn === 0 && r3.marks === 0, JSON.stringify(r3));

    // 4. 生命读经模块冒烟：右栏「笔记」tab 的重读（切到与关联篇不同的另一篇，保证侧栏账目干净）
    await page.evaluate(() => enterModule('lifereading'));
    await wait(2000);
    const lrTarget = await page.evaluate((avoidId) => {
      const vol = state.lrVolumes[state.lrBookIndex];
      const art = (vol && vol.articles.find(a => a.id !== avoidId)) || (vol && vol.articles[0]);
      return art ? { id: art.id } : null;
    }, extra.lrArticleId);
    await page.evaluate((id) => selectLrArticle(id), lrTarget.id);
    await wait(900);
    await page.evaluate(() => { state.lrSideTab = 'notes'; renderLrSide(); });
    await wait(300);
    const lrCount = () => page.evaluate(() => document.querySelectorAll('#lrMain mark').length);
    const addLrMark = async (skip, colorSel) => {
      const before = await lrCount();
      for (let i = 0; i < 3; i++) {
        await page.evaluate((sk) => window.__selectIn('#lrMain .lr-content', null, sk), skip);
        await wait(250);
        try { await page.click(colorSel); } catch (e) { /* 瞬态不可点，重试 */ }
        await wait(400);
        if (await lrCount() > before) return true;
      }
      return false;
    };
    const okLr = (await addLrMark(0, '#floatTool .sw.c1')) && (await addLrMark(1, '#floatTool .sw.c4'));
    // 当前篇内两条 lr 划线：c1=纯划线（将被清）、c4=补笔记（保留）
    const lrIds = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
      const cur = raw.filter(x => !x._del && x.type === 'lr' && x.articleId === state.lrArticleId);
      const pure = cur.find(x => x.colorId === 'c1'), kept = cur.find(x => x.colorId === 'c4');
      if (kept) {
        kept.note = '生命读经保留笔记';
        localStorage.setItem('bible-study.annotations', JSON.stringify(raw));
        state.annotations = raw.filter(x => !x._del);
        rerenderAnn(kept);
      }
      return { pureId: pure && pure.id, keptId: kept && kept.id };
    });
    await wait(800);
    const r4a = await page.evaluate(() => {
      const header = document.querySelector('#lrSide .hl-header');
      return {
        marks: document.querySelectorAll('#lrMain mark').length,
        hasNote: document.querySelectorAll('#lrMain mark.has-note').length,
        btn: document.querySelectorAll('#lrSide .hl-reread-btn').length,
        headerText: (header && header.textContent) || '',
      };
    });
    check('4a. 生命读经右栏：2 划线 + 按钮', okLr && !!lrIds.pureId && !!lrIds.keptId && r4a.marks === 2 && r4a.hasNote === 1 && r4a.btn === 1
      && /划线汇总 2 · 笔记 1/.test(r4a.headerText),
      `marks=${r4a.marks} hasNote=${r4a.hasNote} btn=${r4a.btn} | ${r4a.headerText}`);
    await page.click('#lrSide .hl-reread-btn');
    await wait(300);
    await page.click('#cfOk');
    await wait(500);
    const r4b = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('bible-study.annotations') || '[]');
      const header = document.querySelector('#lrSide .hl-header');
      return {
        marks: document.querySelectorAll('#lrMain mark').length,
        hasNote: document.querySelectorAll('#lrMain mark.has-note').length,
        btn: document.querySelectorAll('#lrSide .hl-reread-btn').length,
        headerText: (header && header.textContent) || '',
        liveIds: raw.filter(x => !x._del).map(x => x.id),
        tombIds: raw.filter(x => x._del).map(x => x.id),
      };
    });
    check('4b. 生命读经模块重读：纯划线删（有墓碑）、笔记标注留、按钮消失',
      r4b.marks === 1 && r4b.hasNote === 1 && r4b.btn === 0 && /划线汇总 1 · 笔记 1/.test(r4b.headerText)
      && r4b.liveIds.length === 4 && r4b.liveIds.includes(lrIds.keptId) && r4b.tombIds.includes(lrIds.pureId),
      `marks=${r4b.marks} btn=${r4b.btn} live=${r4b.liveIds.length} tomb=${r4b.tombIds.length} | ${r4b.headerText}`);

    // 5. 移动端 390px：切视口（会触发 Chrome 重载）→ 重载后重新进工作区 → 研读视图按钮可见且可点
    await page.evaluate(async () => { enterModule('bible'); await selectChapter(1); });
    await wait(800);
    const okMobileMark = await addVerseMark(5, '#floatTool .sw.c2');
    const bootsBefore = await page.evaluate(() => +sessionStorage.getItem('t-boots') || 0);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.waitForFunction((prev) => (+sessionStorage.getItem('t-boots') || 0) > prev, { timeout: 20000 }, bootsBefore).catch(() => {});
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await wait(500);
    await page.evaluate(async () => { enterWork(); await selectChapter(1); });
    await wait(800);
    await page.evaluate(() => {
      state.activeTab = 'mynotes';
      document.querySelectorAll('.study-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mynotes'));
      setMobileView('study');
      renderStudy();
    });
    await wait(400);
    const r5a = await page.evaluate(() => {
      const btn = document.querySelector('#studyBody .hl-reread-btn');
      const rect = btn && btn.getBoundingClientRect();
      return {
        mobile: document.body.classList.contains('mobile-study'),
        btn: !!btn,
        visible: !!rect && rect.width > 0 && rect.height > 0 && getComputedStyle(btn).display !== 'none',
      };
    });
    check('5a. 移动端研读视图按钮可见', okMobileMark && r5a.mobile && r5a.btn && r5a.visible, JSON.stringify(r5a));
    await page.click('#studyBody .hl-reread-btn');
    await wait(300);
    await page.click('#cfOk');
    await wait(500);
    const r5b = await page.evaluate(() => ({
      btn: document.querySelectorAll('#studyBody .hl-reread-btn').length,
      marks: document.querySelectorAll('#verseContainer mark').length,
      hasNote: document.querySelectorAll('#verseContainer mark.has-note').length,
    }));
    check('5b. 移动端重读生效（删纯划线、笔记标注留、按钮消失）', r5b.btn === 0 && r5b.marks === 1 && r5b.hasNote === 1, JSON.stringify(r5b));
  } finally {
    console.log('\nJS 错误:', errors.length ? errors : '无');
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail || errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
