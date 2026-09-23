/* 排版面板（Aa）专项测试：字号倍率 / 行距
 * 覆盖：默认 1.0x 与改造前一致（零视觉回归）/ Aa 开面板 / 滑杆即时生效 /
 *       步进按钮 / 上下限钳制 / 正文内部层级跟随 / UI 不跟随 / 研读列跟随 /
 *       跨模块基准（经文18·生命读经17·书报15）/ 刷新持久化 / 恢复默认 /
 *       2.0x 无横向溢出 / 标注数据不受排版影响 / 移动端底部 sheet / 遮罩与 Esc 关闭 */
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const LS_TYPO = 'bible-study.typography';

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });

  const go = async () => {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  };
  const toWork = async (ms = 1600) => {
    await page.evaluate(() => enterWork());
    await new Promise((r) => setTimeout(r, ms));
  };
  const setRange = (id, v) => page.evaluate((i, val) => {
    const r = document.getElementById(i);
    r.value = val;
    r.dispatchEvent(new Event('input', { bubbles: true }));
  }, id, v);

  await go();
  // 清掉历史排版偏好（CDP 直清 local_storage：removeItem 后 goto 同 URL 存在「未真正重载」的时序坑）
  const cdp = await page.createCDPSession();
  await cdp.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:' + PORT, storageTypes: 'local_storage' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  // 播一条标注：用于验证排版改动不影响既有标注数据与渲染
  await page.waitForSelector('#verseContainer .verse .vtext', { timeout: 15000 });
  await page.evaluate(() => {
    const t = document.querySelector('#verseContainer .verse .vtext').textContent;
    localStorage.setItem('bible-study.annotations', JSON.stringify([{
      id: 'typo-ann-1', type: 'verse', book: 1, chapter: 1, verse: 1, half: '',
      start: 0, end: 2, text: t.slice(0, 2), prefix: '', suffix: t.slice(2, 27),
      colorId: 'c1', underline: false, note: '',
    }]));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await toWork();

  // 1. 默认 1.0x：各正文字号与改造前完全一致（零视觉回归），外部 UI 不参与缩放
  const r1 = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
    return {
      lsRaw: localStorage.getItem('bible-study.typography'),
      scale: cs.getPropertyValue('--reading-scale').trim(),
      lh: cs.getPropertyValue('--reading-lh').trim(),
      vtext: g('.verse .vtext'), vnum: g('.verse .vnum'), fnref: g('sup.fn-ref'),
      theme: g('.chapter-theme'), lrContentSide: g('#studyBody .lr-content'),
      crumb: g('.crumb'), tab: g('.study-tab'), topBtn: g('#hideMarksBtn'),
    };
  });
  console.log('1. 1.0x 默认与改造前一致:',
    r1.scale === '1' && r1.lh === '2' && r1.vtext === '18px' && r1.vnum === '13px'
      && r1.fnref === '11px' && r1.theme === '15px' && r1.lrContentSide === '17px' ? '✓' : '✗',
    JSON.stringify(r1));

  // 2. 点 Aa 开面板（桌面：居中弹层，无 grab 把手）
  await page.click('#typographyBtn');
  await new Promise((r) => setTimeout(r, 300));
  const r2 = await page.evaluate(() => ({
    open: !document.getElementById('typoModal').hidden,
    active: document.getElementById('typographyBtn').classList.contains('active'),
    fsVal: document.getElementById('fsVal').textContent,
    lhVal: document.getElementById('lhVal').textContent,
    grab: getComputedStyle(document.querySelector('.typo-grab')).display,
    cardTop: Math.round(document.querySelector('.typo-card').getBoundingClientRect().top),
  }));
  console.log('2. Aa 开面板(桌面居中):',
    r2.open && r2.active && /^18px · 1\.00×$/.test(r2.fsVal) && r2.lhVal === '2.00'
      && r2.grab === 'none' && r2.cardTop > 60 ? '✓' : '✗', JSON.stringify(r2));

  // 3. 字号滑杆 → 1.50x：正文 27px、节号 19.5px、注号 16.5px 跟随；顶栏/按钮不动
  await setRange('fsRange', 150);
  await new Promise((r) => setTimeout(r, 250));
  const r3 = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
    return {
      vtext: g('.verse .vtext'), vnum: g('.verse .vnum'), fnref: g('sup.fn-ref'),
      theme: g('.chapter-theme'), ln: g('.chapter-theme'),
      crumb: g('.crumb'), topBtn: g('#hideMarksBtn'),
      stored: JSON.parse(localStorage.getItem('bible-study.typography')),
    };
  });
  console.log('3. 字号 1.50x 正文跟随 / UI 不动:',
    r3.vtext === '27px' && r3.vnum === '19.5px' && r3.fnref === '16.5px' && r3.theme === '22.5px'
      && r3.crumb === '17px' && r3.topBtn === '13px' && r3.stored.scale === 1.5 ? '✓' : '✗', JSON.stringify(r3));

  // 4. 行距滑杆 → 2.40：line-height = 27 × 2.4 = 64.8px（行距按字号联动）
  await setRange('lhRange', 240);
  await new Promise((r) => setTimeout(r, 250));
  const r4 = await page.evaluate(() => ({
    lh: getComputedStyle(document.querySelector('.verse .vtext')).lineHeight,
    val: document.getElementById('lhVal').textContent,
    stored: JSON.parse(localStorage.getItem('bible-study.typography')).lh,
  }));
  console.log('4. 行距 2.40 联动字号:',
    Math.abs(parseFloat(r4.lh) - 64.8) < 0.5 && r4.val === '2.40' && r4.stored === 2.4 ? '✓' : '✗', JSON.stringify(r4));

  // 5. 步进按钮 A+ / A−（步长 0.05，收浮点）
  await page.click('#fsPlus');
  const s5a = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).scale);
  await page.click('#fsMinus');
  await page.click('#fsMinus');
  const s5b = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).scale);
  console.log('5. 步进 A+/A−:', s5a === 1.55 && s5b === 1.45 ? '✓' : '✗', '|', s5a, '→', s5b);

  // 6. 上下限钳制（0.85 ~ 2.00）
  await setRange('fsRange', 200);
  await page.click('#fsPlus');
  const s6a = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).scale);
  await setRange('fsRange', 85);
  await page.click('#fsMinus');
  const s6b = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).scale);
  // 行距下限 1.5 / 上限 2.4
  await setRange('lhRange', 150);
  await page.click('#lhMinus');
  const s6c = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).lh);
  await setRange('lhRange', 240);
  await page.click('#lhPlus');
  const s6d = await page.evaluate(() => JSON.parse(localStorage.getItem('bible-study.typography')).lh);
  console.log('6. 上下限钳制:', s6a === 2 && s6b === 0.85 && s6c === 1.5 && s6d === 2.4 ? '✓' : '✗',
    '| 字号', s6a, s6b, '| 行距', s6c, s6d);

  // 6b. 手改 localStorage 脏数据：越界钳制到边界（防正文尺寸失控），非数字回退默认
  await page.evaluate(() => localStorage.setItem('bible-study.typography', JSON.stringify({ scale: 9, lh: 0.2 })));
  const s6e = await page.evaluate(() => {
    state.typography = normalizeTypo(load('bible-study.typography', null));
    applyTypography();
    return { ...state.typography };
  });
  console.log('6b. 脏数据钳制到边界:', s6e.scale === 2 && s6e.lh === 1.5 ? '✓' : '✗', JSON.stringify(s6e));

  // 7. 研读列跟随（注解正文 17px×1.5=25.5px），研读列 tab/元信息不跟随
  await setRange('fsRange', 150);
  await setRange('lhRange', 200);
  await new Promise((r) => setTimeout(r, 250));
  const r7 = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
    return {
      side: g('#studyBody .lr-content'), fnLabel: g('#studyBody .fn-label'),
      tab: g('.study-tab'), hlText: g('#studyBody .hl-text'),
    };
  });
  console.log('7. 研读列跟随 / 元信息不跟随:',
    r7.side === '25.5px' && r7.fnLabel === '13px' && r7.tab === '14px' ? '✓' : '✗', JSON.stringify(r7));

  // 8. 跨模块基准：生命读经 17px→25.5px、书报 15px→22.5px（同一倍率，基准各异）
  await page.evaluate(() => enterModule('lifereading'));
  await page.waitForFunction(() => document.querySelector('#lrMain .lr-content'), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));
  const r8a = await page.evaluate(() => ({
    fs: getComputedStyle(document.querySelector('#lrMain .lr-content')).fontSize,
    val: document.getElementById('fsVal').textContent,
  }));
  await page.evaluate(() => enterModule('books'));
  await page.waitForFunction(() => document.querySelector('#bookMain .bk-para'), { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 400));
  const r8b = await page.evaluate(() => ({
    fs: getComputedStyle(document.querySelector('#bookMain .bk-para')).fontSize,
    val: document.getElementById('fsVal').textContent,
  }));
  console.log('8. 跨模块基准(生命读经/书报):',
    r8a.fs === '25.5px' && /^26px/.test(r8a.val) && r8b.fs === '22.5px' && /^23px/.test(r8b.val) ? '✓' : '✗',
    '| 生命读经', r8a.fs, r8a.val, '| 书报', r8b.fs, r8b.val);

  // 9. 刷新持久化（回到经文模块，1.5x / 2.00 保持）
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await toWork();
  const r9 = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      scale: cs.getPropertyValue('--reading-scale').trim(),
      lh: cs.getPropertyValue('--reading-lh').trim(),
      fs: getComputedStyle(document.querySelector('.verse .vtext')).fontSize,
    };
  });
  console.log('9. 刷新后持久化:',
    r9.scale === '1.5' && r9.lh === '2' && r9.fs === '27px' ? '✓' : '✗', JSON.stringify(r9));

  // 10. 标注数据不受排版影响：改字号前后 localStorage 原样
  await page.click('#typographyBtn');
  await new Promise((r) => setTimeout(r, 250));
  const annBefore = await page.evaluate(() => localStorage.getItem('bible-study.annotations'));
  const markBefore = await page.evaluate(() => {
    const m = document.querySelector('.verse mark.c1');
    return m ? m.textContent : null;
  });
  await setRange('fsRange', 200);
  await new Promise((r) => setTimeout(r, 300));
  const r10 = await page.evaluate(() => {
    const m = document.querySelector('.verse mark.c1');
    return { ann: localStorage.getItem('bible-study.annotations'), mark: m ? m.textContent : null };
  });
  console.log('10. 标注数据/渲染不受排版影响:',
    markBefore !== null && r10.ann === annBefore && r10.mark === markBefore ? '✓' : '✗',
    '| mark:', markBefore, '→', r10.mark);

  // 11. 2.0x（WCAG 上限）无横向溢出，正文 36px
  await page.evaluate(() => closeTypoModal());
  await new Promise((r) => setTimeout(r, 300));
  const r11 = await page.evaluate(() => {
    const tc = document.getElementById('textCol');
    return {
      overflow: tc.scrollWidth > tc.clientWidth + 1,
      fs: getComputedStyle(document.querySelector('.verse .vtext')).fontSize,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log('11. 2.0x 无横向溢出:',
    !r11.overflow && !r11.docOverflow && r11.fs === '36px' ? '✓' : '✗', JSON.stringify(r11));

  // 12. 恢复默认 → 1.0x / 2.00，正文回 18px
  await page.click('#typographyBtn');
  await new Promise((r) => setTimeout(r, 250));
  await page.click('#typoReset');
  await new Promise((r) => setTimeout(r, 250));
  const r12 = await page.evaluate(() => ({
    fs: getComputedStyle(document.querySelector('.verse .vtext')).fontSize,
    stored: JSON.parse(localStorage.getItem('bible-study.typography')),
    fsVal: document.getElementById('fsVal').textContent,
  }));
  console.log('12. 恢复默认:',
    r12.fs === '18px' && r12.stored.scale === 1 && r12.stored.lh === 2 && /^18px · 1\.00×$/.test(r12.fsVal) ? '✓' : '✗',
    JSON.stringify(r12));

  // 13. 关闭方式：遮罩点击 / Esc（并解除滚动锁）
  const r13a = await page.evaluate(() => {
    document.getElementById('typoModal').click();
    return !document.getElementById('typoModal').hidden;
  });
  await page.click('#typographyBtn');
  await new Promise((r) => setTimeout(r, 250));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 250));
  const r13 = await page.evaluate(() => ({
    open: !document.getElementById('typoModal').hidden,
    locked: document.body.classList.contains('scroll-locked'),
    active: document.getElementById('typographyBtn').classList.contains('active'),
  }));
  console.log('13. 遮罩/Esc 关闭 + 解锁滚动:', !r13a && !r13.open && !r13.locked && !r13.active ? '✓' : '✗', JSON.stringify(r13));

  // 14. 移动端：底部 sheet + 把手显示 + 滑杆可用
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 400));
  await page.click('#typographyBtn');
  await new Promise((r) => setTimeout(r, 400));
  const r14 = await page.evaluate(() => {
    const card = document.querySelector('.typo-card').getBoundingClientRect();
    const crumb = document.querySelector('.crumb').getBoundingClientRect();
    const pill = document.getElementById('modePill').getBoundingClientRect();
    return {
      bottomFlush: Math.abs(card.bottom - window.innerHeight) < 2,
      fullWidth: Math.abs(card.width - window.innerWidth) < 2,
      grab: getComputedStyle(document.querySelector('.typo-grab')).display,
      btnVisible: document.getElementById('typographyBtn').getBoundingClientRect().width > 0,
      barWrapped: document.querySelector('.topbar').getBoundingClientRect().height > 60,
      // 加了 Aa 后右侧更挤：crumb 不得压进 pill 区域（标题被遮）
      overlapPill: crumb.right > pill.left,
      crumbW: Math.round(crumb.width),
    };
  });
  console.log('14. 移动端底部 sheet:',
    r14.bottomFlush && r14.fullWidth && r14.grab !== 'none' && r14.btnVisible && !r14.barWrapped
      && !r14.overlapPill && r14.crumbW > 80 ? '✓' : '✗',
    JSON.stringify(r14));

  // 15. 移动端滑杆生效 + 顶栏 Aa 不挤压（顶栏单行）
  await setRange('fsRange', 130);
  await setRange('lhRange', 160);
  await new Promise((r) => setTimeout(r, 250));
  const r15 = await page.evaluate(() => ({
    fs: getComputedStyle(document.querySelector('.verse .vtext')).fontSize,
    lh: getComputedStyle(document.querySelector('.verse .vtext')).lineHeight,
    barH: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
    vw: window.innerWidth,
  }));
  console.log('15. 移动端滑杆生效:',
    r15.fs === '23.4px' && Math.abs(parseFloat(r15.lh) - 37.44) < 0.5 && r15.barH < 60 ? '✓' : '✗', JSON.stringify(r15));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
