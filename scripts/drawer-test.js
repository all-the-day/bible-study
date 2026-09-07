/* 统一导航抽屉专项测试：桌面停靠列（常驻可收起、四模块双栏渲染/高亮同步、旧约新约与辑切换、
 * 右栏跳转、模块级搜索、阅读历史记录/去重/跳转/清空/空态、notes 不停靠）；移动端浮层（☰/遮罩/切章） */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8766;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  return { page, errors };
}

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await wait(1500);
  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  let fail = 0;
  const check = (label, ok, extra) => {
    console.log(label + ':', ok ? '✓' : '✗', extra || '');
    if (!ok) fail++;
  };

  /* ============ 桌面视口（停靠列常驻） ============ */
  {
    const { page, errors } = await newPage(browser, { width: 1280, height: 800 });

    // 1. 读经模块：停靠列常驻（drawer-docked + 可见 + layout margin）；双栏渲染 + 当前书卷/章高亮
    await page.evaluate(() => enterWork());
    await wait(1500);
    const r1 = await page.evaluate(() => ({
      docked: document.body.classList.contains('drawer-docked'),
      visible: document.querySelector('#navDrawer').getBoundingClientRect().width > 300,
      margin: parseFloat(getComputedStyle(document.querySelector('.layout')).marginLeft),
      segs: [...document.querySelectorAll('#dwSeg [data-seg]')].map(b => b.textContent).join('|'),
      leftItems: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
      curL: document.querySelector('#dwBody .dw-col .dw-item.cur')?.dataset.l,
      chaps: document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').length,
      foot: [...document.querySelectorAll('#dwFoot [data-t]')].map(b => b.textContent).join('|'),
      overlayHidden: document.querySelector('#drawerOverlay').hidden,
    }));
    check('1. 读经停靠列常驻', r1.docked && r1.visible && r1.margin === 340 && r1.segs === '书卷|历史' &&
      r1.leftItems === 39 && r1.chaps === 50 && r1.foot === '旧约|新约' && r1.overlayHidden,
      `| 停靠:${r1.docked} margin:${r1.margin} 段:${r1.segs} 左栏:${r1.leftItems} 章:${r1.chaps} 底部:${r1.foot} 选中卷:${r1.curL}`);

    // 1b. ☰ 收起停靠列 / 再点展开
    await page.click('#menuBtn');
    await wait(400);
    const r1b = await page.evaluate(() => ({
      dockedOff: !document.body.classList.contains('drawer-docked'),
      gone: document.querySelector('#navDrawer').getBoundingClientRect().width === 0,
      margin0: parseFloat(getComputedStyle(document.querySelector('.layout')).marginLeft) === 0,
    }));
    await page.click('#menuBtn');
    await wait(400);
    const r1c = await page.evaluate(() => document.body.classList.contains('drawer-docked'));
    check('1b. ☰ 收起/展开停靠列', r1b.dockedOff && r1b.gone && r1b.margin0 && r1c,
      `| 收起:${r1b.dockedOff} 宽:${r1b.gone} margin0:${r1b.margin0} 展开:${r1c}`);

    // 2. 左栏切书（诗篇 19 → 150 章）+ 右栏切章跳转（停靠不关，内容刷新）
    await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-l="19"]').click());
    await wait(400);
    const r2a = await page.evaluate(() => ({
      chaps: document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').length,
      lastCh: [...document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')].pop()?.textContent,
    }));
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[149].click(); });
    await wait(1500);
    const r2 = await page.evaluate(() => ({
      stillDocked: document.body.classList.contains('drawer-docked'),
      book: document.querySelector('#bookName').textContent,
      crumb: document.querySelector('#chapterLabel').textContent,
      hist: JSON.parse(localStorage.getItem('bible-study.history') || '[]')[0],
    }));
    check('2. 切书切章跳转', r2a.chaps === 150 && r2a.lastCh === '第一百五十章' && r2.stillDocked && r2.crumb.includes('150章') && r2.book === '诗篇',
      `| ${r2a.chaps}章 末项:${r2a.lastCh} ${r2.book} ${r2.crumb}`);
    check('2b. 历史记录(读经)', r2.hist && r2.hist.module === 'bible' && r2.hist.loc.book === 19 && r2.hist.loc.chapter === 150,
      `| ${JSON.stringify(r2.hist)}`);

    // 3. 当前位置高亮；新约切换 → 左栏重置马太 → 切章跳转
    await page.evaluate(() => renderDrawer());
    await wait(400);
    const r3a = await page.evaluate(() => ({
      curL: document.querySelector('#dwBody .dw-col .dw-item.cur')?.dataset.l,
      curR: !!document.querySelector('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item.cur'),
    }));
    await page.evaluate(() => { document.querySelector('#dwFoot [data-t="nt"]').click(); });
    await wait(400);
    const r3b = await page.evaluate(() => ({
      leftFirst: document.querySelector('#dwBody .dw-col .dw-item')?.dataset.l,
      leftCount: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
    }));
    await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-l="40"]').click());
    await wait(400);
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[4].click(); });
    await wait(1500);
    const r3 = await page.evaluate(() => document.querySelector('#bookName').textContent);
    check('3. 高亮同步+新约切换', r3a.curL === '19' && r3a.curR && r3b.leftFirst === '40' && r3b.leftCount === 27 && r3 === '马太福音',
      `| 选中卷:${r3a.curL} 首卷:${r3b.leftFirst} NT卷:${r3b.leftCount} ${r3}`);

    // 4. 模块级搜索（停靠列顶部搜索条）：输入 → 结果层 → 点结果跳转 → 搜索词清空
    await page.evaluate(() => { const el = document.querySelector('#dwSearchInput'); el.value = '撒母耳'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(800);
    const r4 = await page.evaluate(() => ({
      shown: !document.querySelector('#dwSearchResults').hidden,
      items: document.querySelectorAll('#dwSearchResults .dw-item[data-sr]').length,
    }));
    await page.evaluate(() => { document.querySelector('#dwSearchResults .dw-item[data-sr="bible"]').click(); });
    await wait(1500);
    const r4b = await page.evaluate(() => ({
      cleared: document.querySelector('#dwSearchInput').value === '',
      resultsHidden: document.querySelector('#dwSearchResults').hidden,
      book: document.querySelector('#bookName').textContent,
    }));
    check('4. 抽屉搜索(读经)', r4.shown && r4.items > 0 && r4b.cleared && r4b.resultsHidden && r4b.book.length > 0,
      `| 结果:${r4.items} 跳转到:${r4b.book}`);

    // 5. 历史段：列表渲染 + 点击跳转
    await page.evaluate(() => { [...document.querySelectorAll('#dwSeg [data-seg]')].find(b => b.textContent === '历史').click(); });
    await wait(400);
    const r5 = await page.evaluate(() => ({
      items: document.querySelectorAll('.dw-hist-item').length,
      firstTitle: document.querySelector('.dw-hist-item .t')?.textContent,
    }));
    await page.evaluate(() => { document.querySelector('.dw-hist-item').click(); });
    await wait(1200);
    const r5b = await page.evaluate(() => document.querySelector('#chapterLabel').textContent);
    check('5. 历史列表+跳转', r5.items >= 1 && r5b.includes('章'), `| ${r5.items}条 ${r5.firstTitle} → ${r5b}`);

    // 6. 生命读经模块：停靠双栏（66 卷 + 篇目懒加载）+ 切篇跳转 + 历史记录
    await page.evaluate(() => enterModule('lifereading'));
    await wait(2500);
    const r6a = await page.evaluate(() => ({
      docked: document.body.classList.contains('drawer-docked'),
      left: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
      curL: document.querySelector('#dwBody .dw-col .dw-item.cur')?.dataset.l,
      arts: document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').length,
    }));
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[1].click(); });
    await wait(1500);
    const r6 = await page.evaluate(() => ({
      crumb: document.querySelector('#chapterLabel').textContent,
      hist0: JSON.parse(localStorage.getItem('bible-study.history') || '[]')[0],
    }));
    check('6. 生命读经停靠列', r6a.docked && r6a.left === 66 && r6a.curL === '1' && r6a.arts > 0 && r6.crumb.includes('第2篇'),
      `| 卷:${r6a.left} 篇:${r6a.arts} ${r6.crumb}`);
    check('6b. 历史记录(生命读经)', r6.hist0 && r6.hist0.module === 'lifereading' && r6.hist0.title.includes('第2篇'),
      `| ${r6.hist0 && r6.hist0.title}`);

    // 7. 历史去重：同位置再跳 → 不新增，置顶
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[0].click(); });
    await wait(1200);
    const h1 = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.history') || '[]'));
    const dupCount = h1.filter(h => h.module === 'lifereading' && h.loc.articleId === 1).length;
    check('7. 历史去重置顶', dupCount === 1 && h1[0].module === 'lifereading' && h1[0].loc.articleId === 1,
      `| 同位条数:${dupCount} 顶部:${h1[0] && h1[0].title}`);

    // 8. 书报模块：停靠辑切换（底部）+ 双栏 + 点章跳转
    await page.evaluate(() => enterModule('books'));
    await wait(2500);
    const r8a = await page.evaluate(() => ({
      docked: document.body.classList.contains('drawer-docked'),
      foot: [...document.querySelectorAll('#dwFoot [data-vol]')].map(b => b.textContent).join('|'),
      books: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
    }));
    await page.evaluate(() => document.querySelectorAll('#dwFoot [data-vol]')[1].click());
    await wait(500);
    const r8b = await page.evaluate(() => ({
      volSel: document.querySelector('#dwFoot [data-vol].sel')?.textContent,
      books2: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
    }));
    await page.evaluate(() => document.querySelector('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').click());
    await wait(1500);
    const r8 = await page.evaluate(() => document.querySelector('#chapterLabel').textContent);
    check('8. 书报停靠列', r8a.docked && r8a.foot === '第一辑|第二辑|第三辑' && r8b.volSel === '第二辑' && r8.includes('第1章'),
      `| 辑:${r8a.foot} 第2辑书:${r8b.books2} ${r8}`);

    // 9. 听抄模块：期列表 + 篇列表双栏 + 切期跳转
    await page.evaluate(() => enterModule('morning'));
    await wait(2500);
    const r9a = await page.evaluate(() => ({
      periods: document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]').length,
      footEmpty: document.querySelector('#dwFoot').innerHTML.trim() === '',
    }));
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-col .dw-item[data-l]')[1].click(); });
    await wait(1200);
    const r9b = await page.evaluate(() => ({
      arts: document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').length,
    }));
    await page.evaluate(() => document.querySelector('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item').click());
    await wait(1500);
    const r9 = await page.evaluate(() => ({
      crumb: document.querySelector('#chapterLabel').textContent,
      hist0: JSON.parse(localStorage.getItem('bible-study.history') || '[]')[0],
    }));
    check('9. 听抄停靠列', r9a.periods === 2 && r9a.footEmpty && r9b.arts === 6 && r9.crumb.includes('第1篇'),
      `| 期:${r9a.periods} 篇:${r9b.arts} ${r9.crumb}`);
    check('9b. 历史记录(听抄)', r9.hist0 && r9.hist0.module === 'morning', `| ${r9.hist0 && r9.hist0.title}`);

    // 10. 清空历史（confirmDialog 确认）→ 空态
    await page.evaluate(() => { [...document.querySelectorAll('#dwSeg [data-seg]')].find(b => b.textContent === '历史').click(); });
    await wait(400);
    await page.evaluate(() => { document.querySelector('#dwBody .dw-hist-head [data-clear]').click(); });
    await wait(400);
    await page.evaluate(() => { const ok = document.querySelector('#cfOk'); if (ok) ok.click(); });
    await wait(400);
    const r10 = await page.evaluate(() => ({
      empty: document.querySelector('#dwBody .dw-empty')?.textContent,
      stored: JSON.parse(localStorage.getItem('bible-study.history') || '[]').length,
    }));
    check('10. 清空历史+空态', r10.empty === '暂无阅读历史' && r10.stored === 0, `| ${r10.empty}`);

    // 11. notes 模块：停靠列隐藏（分类树左栏顶替）
    await page.evaluate(() => enterModule('notes'));
    await wait(1500);
    const r11 = await page.evaluate(() => ({
      dockedOff: !document.body.classList.contains('drawer-docked'),
      navColVisible: getComputedStyle(document.querySelector('#navCol')).display !== 'none',
    }));
    check('11. notes 停靠隐藏+左栏树', r11.dockedOff && r11.navColVisible, `| 停靠关闭:${r11.dockedOff} 左栏显示:${r11.navColVisible}`);

    check('桌面无 JS 错误', errors.length === 0, errors.join('; ').slice(0, 200));
    await page.close();
  }

  /* ============ 移动端视口（375px，浮层模式） ============ */
  {
    const { page, errors } = await newPage(browser, { width: 375, height: 720 });
    // 1. 读经模式 ☰ → 开浮层抽屉
    await page.evaluate(() => enterWork());
    await wait(1500);
    await page.click('#menuBtn');
    await wait(600);
    const m1 = await page.evaluate(() => ({
      open: document.querySelector('#navDrawer').classList.contains('open'),
      overlayOn: document.querySelector('#drawerOverlay').classList.contains('on'),
      width: document.querySelector('#navDrawer').getBoundingClientRect().width,
    }));
    check('M1. 移动端 ☰ 开浮层', m1.open && m1.overlayOn && m1.width > 250, `| 宽:${m1.width}`);
    // 2. 切章跳转 → 浮层关闭
    await page.evaluate(() => { document.querySelectorAll('#dwBody .dw-cols .dw-col:nth-child(2) .dw-item')[2].click(); });
    await wait(1500);
    const m2 = await page.evaluate(() => ({
      crumb: document.querySelector('#chapterLabel').textContent,
      closed: !document.querySelector('#navDrawer').classList.contains('open'),
    }));
    check('M2. 移动端抽屉切章+关浮层', m2.closed && m2.crumb.includes('3章'), `| ${m2.crumb}`);
    // 3. 遮罩点击关闭
    await page.click('#menuBtn');
    await wait(500);
    await page.evaluate(() => document.querySelector('#drawerOverlay').click());
    await wait(500);
    const m3 = await page.evaluate(() => !document.querySelector('#navDrawer').classList.contains('open'));
    check('M3. 遮罩关闭', m3);
    // 4. 移动端搜索（浮层内）
    await page.click('#menuBtn');
    await wait(500);
    await page.evaluate(() => { const el = document.querySelector('#dwSearchInput'); el.value = '马太'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(800);
    const m4 = await page.evaluate(() => ({
      shown: !document.querySelector('#dwSearchResults').hidden,
      items: document.querySelectorAll('#dwSearchResults .dw-item[data-sr="bible"]').length,
    }));
    check('M4. 移动端抽屉搜索', m4.shown && m4.items > 0, `| 结果:${m4.items}`);
    check('移动端无 JS 错误', errors.length === 0, errors.join('; ').slice(0, 200));
    await page.close();
  }

  await browser.close();
  server.kill();
  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
