/* 人物链接原型专项（2026-10-12）：书报正文人名 → 人物小传弹窗
   范围：原型阶段仅「十二篮」（data/persons.json 的 scope=slat）启用；其余系列/模块不受影响。
   覆盖：启用范围门控 / 正文注入人名链接且不破坏偏移坐标 / 点击弹窗内容 / 跳完整小传 /
         匹配规则（最长优先、复合词保护、与经文引用不冲突）
   SHOT=1 时另存截图到 generated-images/person-link.png */
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
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));

  // 1. 词典加载 + scope 收敛在 slat
  await page.evaluate(() => ensurePersonsData());
  const r1 = await page.evaluate(() => ({
    scope: state.personsData ? state.personsData.scope : null,
    n: state.personsData ? state.personsData.persons.length : 0,
    slat: personScopeOn('slat'), ni: personScopeOn('ni'), bio: personScopeOn('bio'),
  }));
  console.log('1. 词典与范围:', r1.n > 0 && r1.slat && !r1.ni && !r1.bio ? '✓' : '✗',
    '| 人物:', r1.n, '| scope:', JSON.stringify(r1.scope), '| slat/ni/bio:', r1.slat, r1.ni, r1.bio);

  // 2. 匹配规则：最长优先（路德马丁→马丁路德）/ 复合词保护（加尔文主义不链）/ 与经文引用可共存
  const r2 = await page.evaluate(() => {
    const name = (pid) => (state.personsData.persons.find(p => p.id === pid) || {}).name;
    const t1 = detectPersons('这是路德马丁所说的话');
    const t2 = detectPersons('高举加尔文主义的人');
    const t3 = detectPersons('慕迪先生读约三16');
    const line = '卫斯理约翰和戴德生都引用约三16';
    const persons = detectPersons(line);
    const refs = detectRefs(line, null);
    return {
      luther: t1.map(x => name(x.pid)), calvin: t2.length, moody: t3.map(x => name(x.pid)),
      persons: persons.length, refs: refs.length,
      overlap: persons.some(p => refs.some(r => p.start < r.end && r.start < p.end)),
    };
  });
  console.log('2. 匹配规则:', r2.luther[0] === '马丁路德' && r2.calvin === 0 && r2.moody[0] === '慕迪'
    && r2.persons === 2 && r2.refs === 1 && !r2.overlap ? '✓' : '✗', JSON.stringify(r2));

  // 3. 直进十二篮「基督人所当注意的四件事」（该篇含 4 位人物）→ 正文注入 person-link
  await page.evaluate(() => openBookChapter(9, 0, 7, 'slat'));
  await new Promise((r) => setTimeout(r, 2500));
  const r3 = await page.evaluate(() => {
    const links = [...document.querySelectorAll('#bookMain span.person-link')];
    return {
      count: links.length,
      persons: [...new Set(links.map(l => l.dataset.person))],
      texts: [...new Set(links.map(l => l.textContent))],
      refs: document.querySelectorAll('#bookMain span.ref-link').length,
    };
  });
  console.log('3. 十二篮正文人名链接:', r3.count > 0 && r3.persons.length >= 4 ? '✓' : '✗',
    '| 链接:', r3.count, '| 人物:', r3.texts.join('、'), '| 经文引用:', r3.refs);

  // 3b. 注入 span 不改变正文文本与偏移坐标：逐行对比渲染文本与源 content 行
  const r3b = await page.evaluate(() => {
    const ch = state.bookVolumes.slat[9].books[0].chapters[7];
    const bad = [];
    for (const div of document.querySelectorAll('#bookMain .book-content > div')) {
      const base = +div.dataset.base;
      const src = ch.content.slice(base).split('\n')[0];
      if (div.textContent !== src) bad.push({ base, dom: div.textContent.slice(0, 30), src: src.slice(0, 30) });
    }
    return { bad: bad.length, sample: bad[0] || null, lines: document.querySelectorAll('#bookMain .book-content > div').length };
  });
  console.log('3b. 偏移坐标与源文本一致:', r3b.bad === 0 && r3b.lines > 5 ? '✓' : '✗',
    '| 行数:', r3b.lines, '| 不一致:', r3b.bad, JSON.stringify(r3b.sample || ''));

  // 4. 非 slat 系列（倪文集）不注入
  await page.evaluate(() => openBookChapter(1, 0, 0, 'ni'));
  await new Promise((r) => setTimeout(r, 2500));
  const r4 = await page.evaluate(() => ({
    series: state.bookSeries,
    persons: document.querySelectorAll('#bookMain span.person-link').length,
    paras: document.querySelectorAll('#bookMain .bk-para').length,
  }));
  console.log('4. 倪文集不启用:', r4.series === 'ni' && r4.persons === 0 && r4.paras > 0 ? '✓' : '✗',
    '| series:', r4.series, '| person-link:', r4.persons, '| 段落:', r4.paras);

  // 5. 十二篮「一个两面的真理」（慕迪 8 处）点人名 → 弹窗（简介 + 生卒 + 摘录 + 出处 + 跳转按钮）
  await page.evaluate(() => openBookChapter(11, 0, 10, 'slat'));
  await new Promise((r) => setTimeout(r, 2500));
  const r5a = await page.evaluate(() => document.querySelectorAll('#bookMain span.person-link').length);
  console.log('5a. 同篇多人名:', r5a >= 5 ? '✓' : '✗', '| 链接:', r5a);
  if (process.env.SHOT) {
    // 把人名滚到视口内再截（该篇首个人名在正文中部）
    await page.evaluate(() => {
      const el = document.querySelector('#bookMain span.person-link');
      document.querySelector('#textCol').scrollTop = Math.max(0, el.offsetTop - 220);
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: require('path').join(ROOT, 'generated-images', 'person-link-text.png') });
  }
  await page.evaluate(() => {
    [...document.querySelectorAll('#bookMain span.person-link')].find(l => l.dataset.person === 'd-l-moody').click();
  });
  await new Promise((r) => setTimeout(r, 700));
  const r5 = await page.evaluate(() => ({
    open: !document.querySelector('#popup').hidden,
    title: document.querySelector('#popupTitle').textContent,
    desc: document.querySelector('.person-pop-desc')?.textContent,
    meta: document.querySelector('.person-pop-meta')?.textContent,
    excerpt: document.querySelector('.person-pop-excerpt')?.textContent || '',
    loc: document.querySelector('.person-pop-loc')?.textContent,
    go: !!document.querySelector('#personGo'),
  }));
  console.log('5. 人物弹窗:', r5.open && r5.title.includes('慕迪') && r5.desc && r5.meta.includes('Moody')
    && r5.excerpt.length > 40 && r5.loc.includes('传记与文集') && r5.go ? '✓' : '✗',
    '|', r5.title, '|', r5.desc, '|', r5.meta, '| 摘录', r5.excerpt.length, '字 |', (r5.loc || '').slice(0, 32));

  if (process.env.SHOT) {
    const fs = require('fs');
    const dir = require('path').join(ROOT, 'generated-images');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: require('path').join(dir, 'person-link.png') });
    console.log('   （截图 → generated-images/person-link.png）');
  }

  // 6. 跳「查看完整小传」→ 书报·传记与文集对应章
  await page.evaluate(() => document.querySelector('#personGo').click());
  await new Promise((r) => setTimeout(r, 3000));
  const r6 = await page.evaluate(() => ({
    series: state.bookSeries, book: state.bookBook, chapter: state.bookChapter,
    popupClosed: document.querySelector('#popup').hidden,
    title: document.querySelector('#bookMain .bk-title')?.textContent,
  }));
  console.log('6. 跳完整小传:', r6.series === 'bio' && r6.book === 0 && r6.chapter === 41 && r6.popupClosed
    && (r6.title || '').includes('慕迪') ? '✓' : '✗',
    '|', r6.series, `书${r6.book} 章${r6.chapter}`, '| 弹窗已关:', r6.popupClosed, '|', r6.title);

  // 7. 定位不全时不跳转：守住 LS_BOOK_LAST 不被写坏（openBookChapter 收 undefined 会当成「章不同」）
  const r7 = await page.evaluate(async () => {
    state.personsData.persons.push({ id: '__bad', name: '测试人物', aliases: ['测试人物'], loc: { series: 'bio' }, locLabel: '测试' });
    state.personEntries = null;
    showPersonPopup('__bad');
    const before = JSON.parse(localStorage.getItem('bible-study.bookLast') || 'null');
    document.querySelector('#personGo').click();
    await new Promise((r) => setTimeout(r, 500));
    return {
      before, after: JSON.parse(localStorage.getItem('bible-study.bookLast') || 'null'),
      popupOpen: !document.querySelector('#popup').hidden,
      toast: (document.querySelector('#toast') || {}).textContent || '',
      chapter: state.bookChapter,
    };
  });
  const sameLast = JSON.stringify(r7.before) === JSON.stringify(r7.after);
  console.log('7. loc 守卫（不写坏上次位置）:', sameLast && r7.popupOpen && r7.toast.includes('出处') && r7.chapter === 41 ? '✓' : '✗',
    '| last 未变:', sameLast, '| 弹窗保留:', r7.popupOpen, '| toast:', r7.toast, '| chapter:', r7.chapter);
  await page.evaluate(() => { closePopupAll(); state.personsData.persons.pop(); state.personEntries = null; });

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  if (errors.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
