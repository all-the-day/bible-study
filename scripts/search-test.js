/* 统一检索专项（2026-10-20）
 *
 * 覆盖：首页分组检索（书报跨系列 / 书号 / 经文全文 / 注解全文 / 标注）、
 * 真实总数与「查看全部」、命中高亮、合集层搜索、抽屉书报跨系列与计数、
 * 抽屉「书卷+章」、空态。
 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8788;   // 测试专用端口：不碰用户遗留的 8765（否则会静默跑在旧代码上）

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  let fail = 0;
  const check = (name, ok, extra) => {
    console.log(`${name}: ${ok ? '✓' : '✗'}${extra ? ' | ' + extra : ''}`);
    if (!ok) fail = 1;
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));

    const typeSearch = async (q, wait) => {
      await page.evaluate(() => {
        const el = document.querySelector('#homeSearch');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.type('#homeSearch', q);
      await new Promise((r) => setTimeout(r, wait || 1800));
    };
    const group = (k) => page.evaluate((kind) => {
      const g = document.querySelector(`#homeSearchResults .sr-group[data-g="${kind}"]`);
      if (!g) return null;
      return {
        count: +g.querySelector('.sr-count').textContent,
        items: [...g.querySelectorAll('.home-sr-item[data-k]')].map(x => x.textContent),
        more: !!g.querySelector('[data-more]'),
      };
    }, k);

    // 1. 书报跨系列：搜到的结果来自不同系列（不再是「当前系列」）
    await typeSearch('两种的认识');
    const g1 = await group('books');
    check('1. 书报跨系列', !!g1 && g1.items.length > 0
      && g1.items.some(t => t.includes('十二篮')) && g1.items.some(t => t.includes('其他')),
      g1 ? `首条:${(g1.items[0] || '').slice(0, 34)} 总数:${g1.count}` : '无书报组');

    // 2. 书号：1001 → 到底有没有神，且结果带 #1001
    await typeSearch('1001');
    const g2 = await group('books');
    check('2. 书号精确匹配', !!g2 && g2.items.some(t => t.includes('#1001') && t.includes('到底有没有神')),
      g2 ? `首条:${(g2.items[0] || '').slice(0, 40)}` : '无书报组');

    // 3. 书号点击直进：点 1001 首条 → 书报模块且该书为「到底有没有神」
    //    （1001 同时存在于 gospel 与 fuyintiandi，两者都算对）
    const jumped2 = await page.evaluate(() => {
      const g = document.querySelector('#homeSearchResults .sr-group[data-g="books"] .home-sr-item[data-k]');
      if (!g) return null;
      g.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 2500));
    const r3 = await page.evaluate(() => ({
      work: state.screen === 'work',
      mod: state.activeModule,
      series: state.bookSeries,
      book: state.bookMeta && state.bookMeta.volumes[state.bookVolume - 1]
        && state.bookMeta.volumes[state.bookVolume - 1].books[state.bookBook]
        && state.bookMeta.volumes[state.bookVolume - 1].books[state.bookBook].title,
      crumb: (document.querySelector('#chapterLabel') || {}).textContent || '',
    }));
    check('3. 书号结果跳转', jumped2 && r3.work && r3.mod === 'books'
      && /到底有没有神/.test((r3.book || '') + (r3.crumb || '')),
      `${r3.series} | ${r3.book || r3.crumb}`);

    // 4. 经文全文：起初神创造 → 创 1:1
    await page.click('#homeBtn');
    await new Promise((r) => setTimeout(r, 400));
    await typeSearch('起初神创造');
    const g4 = await group('verse');
    check('4. 经文全文', !!g4 && g4.items.some(t => t.includes('创世记 1:1')),
      g4 ? `首条:${(g4.items[0] || '').slice(0, 40)}` : '无经文组');

    // 4b. 经文结果点击 → 读经模块并定位到该节
    await page.evaluate(() => {
      const el = document.querySelector('#homeSearchResults .sr-group[data-g="verse"] .home-sr-item[data-k]');
      if (el) el.click();
    });
    await new Promise((r) => setTimeout(r, 2500));
    const r4b = await page.evaluate(() => ({
      mod: state.activeModule,
      book: state.currentBook && state.currentBook.index,
      ch: state.currentChapter,
      flash: !!document.querySelector('.verse.flash'),
    }));
    check('4b. 经文跳转定位', r4b.mod === 'bible' && r4b.book === 1 && r4b.ch === 1,
      `书卷:${r4b.book} 章:${r4b.ch} 高亮:${r4b.flash}`);

    // 5. 注解全文：诸天 → 命中的定位带「注N」
    await page.click('#homeBtn');
    await new Promise((r) => setTimeout(r, 400));
    await typeSearch('诸天');
    const g5 = await group('fn');
    check('5. 注解全文', !!g5 && g5.items.some(t => /注\d+/.test(t)),
      g5 ? `首条:${(g5.items[0] || '').slice(0, 40)}` : '无注解组');

    // 6. 真实总数 + 查看全部：高频词的结果总数 > 预览条数，且能开弹窗
    await typeSearch('基督');
    const g6 = await group('books');
    const opened6 = await page.evaluate(() => {
      const more = document.querySelector('#homeSearchResults .sr-group[data-g="books"] [data-more]');
      if (!more) return null;
      more.click();
      return { title: document.querySelector('#popupTitle').textContent, rows: document.querySelectorAll('#popupBody .home-sr-item[data-k]').length };
    });
    await new Promise((r) => setTimeout(r, 300));
    const popup6 = opened6 || await page.evaluate(() => ({
      title: document.querySelector('#popupTitle').textContent,
      rows: document.querySelectorAll('#popupBody .home-sr-item[data-k]').length,
    }));
    check('6. 真实总数与查看全部', !!g6 && g6.count > 5 && g6.more && popup6.rows > 5 && /条/.test(popup6.title),
      g6 ? `总数:${g6.count} 弹窗:${popup6.title} 行:${popup6.rows}` : '无书报组');
    await page.evaluate(() => { if (typeof closePopupAll === 'function') closePopupAll(); });

    // 7. 命中高亮：结果行含 <mark class="sr-hit">
    const r7 = await page.evaluate(() => document.querySelectorAll('#homeSearchResults mark.sr-hit').length);
    check('7. 命中高亮', r7 > 0, `mark 数:${r7}`);

    // 8. 空态（此时已在首页，⌂ 隐藏不可点）
    await typeSearch('zzz不存在的词zzz');
    const r8 = await page.evaluate(() => {
      const el = document.querySelector('#homeSearchResults');
      return { none: !!el.querySelector('.sr-none'), text: (el.textContent || '').slice(0, 20) };
    });
    check('8. 空态', r8.none, r8.text);

    // 9. 抽屉：书报搜索跨系列 + 真实计数（含「显示前 N 条」）
    await page.evaluate(() => { document.querySelector('#homeSearch').value = ''; });
    await page.click('#homeGrid .home-block[data-entry="bookhub"]');
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => { document.querySelector('.home-block[data-series="slat"]')?.click(); });
    await new Promise((r) => setTimeout(r, 2000));
    // 桌面停靠列常驻，搜索条已在 DOM 里，直接触发 input（不必再点 ☰ 收起/展开）
    await page.evaluate(() => {
      const el = document.querySelector('#dwSearchInput');
      el.value = '两种的认识';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1800));
    const r9 = await page.evaluate(() => ({
      head: document.querySelector('#dwSearchResults .dw-sr-head')?.textContent || '',
      items: [...document.querySelectorAll('#dwSearchResults .dw-item[data-sr="books"]')].map(x => x.textContent),
    }));
    check('9. 抽屉书报跨系列', r9.items.length > 0 && r9.items.some(t => t.includes('其他')) && r9.items.some(t => t.includes('十二篮')),
      `${r9.head.slice(0, 30)} | ${(r9.items[0] || '').slice(0, 34)}`);

    // 9b. 抽屉计数：高频词显示真实总数 + 「显示前 50 条」
    await page.evaluate(() => {
      const el = document.querySelector('#dwSearchInput');
      el.value = '基督';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 2000));
    const r9b = await page.evaluate(() => document.querySelector('#dwSearchResults .dw-sr-head')?.textContent || '');
    const m9b = r9b.match(/共 (\d+) 条结果，显示前 (\d+) 条/);
    check('9b. 抽屉真实计数', !!m9b && +m9b[1] > +m9b[2], r9b.slice(0, 40));

    // 10. 抽屉「书卷+章」：切到读经模块后搜「创24」→ 章结果
    await page.evaluate(() => enterModule('bible'));
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => {
      const el = document.querySelector('#dwSearchInput');
      el.value = '创24';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 1200));
    const r10 = await page.evaluate(() => {
      const el = document.querySelector('#dwSearchResults .dw-item[data-sr="bible-ch"]');
      return el ? { text: el.textContent, b: el.dataset.b, c: el.dataset.c } : null;
    });
    check('10. 抽屉书卷+章', !!r10 && r10.b === '1' && r10.c === '24', r10 ? r10.text : '无结果');
    await page.evaluate(() => document.querySelector('#dwSearchResults .dw-item[data-sr="bible-ch"]')?.click());
    await new Promise((r) => setTimeout(r, 1800));
    const r10b = await page.evaluate(() => ({ mod: state.activeModule, ch: state.currentChapter }));
    check('10b. 书卷+章跳转', r10b.mod === 'bible' && r10b.ch === 24, `章:${r10b.ch}`);

    // 11. 标注搜索：从非读经模块回首页点击，等待模块就位后再定位到创 24:5
    await page.evaluate(async () => {
      await enterModule('books', { series: 'slat', volume: 1, book: 0, chapter: 0 });
      const a = {
        id: 'search-ann-race', type: 'verse', book: 1, chapter: 24, verse: 5, half: '',
        start: 0, end: 2, text: '亚伯兰', prefix: '', suffix: '',
        colorId: 'c1', underline: false, note: '稳定性跳转唯一标记',
      };
      const i = state.annotations.findIndex(x => x.id === a.id);
      if (i >= 0) state.annotations[i] = a;
      else state.annotations.push(a);
      localStorage.setItem(LS_ANNOTATIONS, JSON.stringify(state.annotations));
      showHome();
    });
    await new Promise((r) => setTimeout(r, 400));
    await typeSearch('稳定性跳转唯一标记');
    const g11 = await group('ann');
    check('11. 标注搜索结果', !!g11 && g11.items.some(t => t.includes('稳定性跳转唯一标记')),
      g11 ? `总数:${g11.count}` : '无标注组');
    await page.evaluate(() => {
      const el = document.querySelector('#homeSearchResults .sr-group[data-g="ann"] .home-sr-item[data-k]');
      if (el) el.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    const r11 = await page.evaluate(() => ({
      mod: state.activeModule,
      book: state.currentBook && state.currentBook.index,
      ch: state.currentChapter,
      flash: !!document.querySelector('.vtext[data-verse="5"]')?.closest('.verse.flash'),
    }));
    check('11b. 非读经模块搜索标注跳转', r11.mod === 'bible' && r11.book === 1
      && r11.ch === 24 && r11.flash,
      `模块:${r11.mod} 书卷:${r11.book} 章:${r11.ch} 高亮:${r11.flash}`);

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(fail);
}

main().catch((e) => { console.error(e); process.exit(1); });
