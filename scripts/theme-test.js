/* 阅读主题专项（2026-10-16）：classic 零回归 + 三主题切换 + 持久化 + 图标双渲染 + 设置入口
   主题机制：:root[data-theme=…] 变量覆盖（style.css 末尾）；early script 防首绘闪变（index.html）
   端口 8765（全量运行器统一端口） */
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
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource')) return;
    errors.push('console: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon') && !r.url().includes('api.github.com')) {
      errors.push('http ' + r.status() + ': ' + r.url().replace('http://127.0.0.1:' + PORT, ''));
    }
  });
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
  const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
  const ok = (msg) => console.log('✓ ' + msg);
  const bg = (sel, prop) => page.evaluate((s, p) => getComputedStyle(document.querySelector(s))[p], sel, prop);

  // 1. classic 默认零回归：关键计算值与 token 化前字面量一致
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#splash.hidden', { timeout: 30000 });
  const c = await page.evaluate(() => ({
    attr: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    topbarImage: getComputedStyle(document.querySelector('.topbar')).backgroundImage,
    topbarSolid: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    barInTopbar: document.querySelector('.topbar').contains(document.querySelector('#readingProgress')),
    barPos: getComputedStyle(document.querySelector('#readingProgress')).position,
    cardShadow: getComputedStyle(document.querySelector('.scripture-card')).boxShadow,
    vtext: getComputedStyle(document.querySelector('.vtext')).fontSize,
    em: getComputedStyle(document.querySelector('.hb-ic-em')).display,
    line: getComputedStyle(document.querySelector('.hb-ic-line')).display,
  }));
  if (c.attr !== 'classic') fail(`1. data-theme 应为 classic，实际 ${c.attr}`);
  else ok('1a. data-theme=classic（early script 显式落值）');
  if (c.bodyBg !== 'rgb(240, 243, 249)') fail(`1b. classic 页面底应 #f0f3f9，实际 ${c.bodyBg}`);
  else ok('1b. classic 页面底 #f0f3f9 不变');
  if (!c.topbarImage.includes('linear-gradient')) fail('1c. classic 顶栏应保留渐变');
  else ok('1c. classic 顶栏渐变不变');
  if (!c.cardShadow.includes('rgba(102, 126, 234, 0.2)')) fail(`1d. classic 卡片主题色阴影应不变，实际 ${c.cardShadow}`);
  else ok('1d. classic 卡片靛蓝阴影不变');
  if (c.vtext !== '18px') fail(`1e. 经文字号应 18px，实际 ${c.vtext}`);
  else ok('1e. 经文基准字号 18px 不变');
  // CR 后新增：弹窗面板底色应保持纯白（--panel，防 surface 蓝味白回归）
  const popupBg = await bg('#popup', 'backgroundColor');
  if (popupBg !== 'rgb(255, 255, 255)') fail(`1g. classic 弹窗面板底应纯白，实际 ${popupBg}`);
  else ok('1g. classic 弹窗面板底纯白（--panel）');
  if (c.em !== 'inline' || c.line !== 'none') fail(`1f. classic 应显 emoji 隐线性图标（em=${c.em}, line=${c.line}）`);
  else ok('1f. classic 图标=emoji');
  // iOS 26 Safari 顶部取色只采样贴视口边缘的 fixed/sticky 元素：
  // 进度条必须在顶栏内且为 absolute，顶栏自身须有可被采样的纯色底
  if (!c.barInTopbar || c.barPos !== 'absolute') fail(`1h. 进度条应在顶栏内且 absolute，实际 in=${c.barInTopbar} pos=${c.barPos}`);
  else ok('1h. 进度条在顶栏内 absolute（不参与 iOS 顶部取色）');
  if (c.topbarSolid !== 'rgb(102, 126, 234)') fail(`1i. classic 顶栏显式底色应 #667EEA，实际 ${c.topbarSolid}`);
  else ok('1i. classic 顶栏显式底色 #667EEA（iOS 取色源）');

  // 2. 进工作区有经文卡片可断言（首页没有 .scripture-card）
  await page.evaluate(() => { enterWork(); });

  // 3. UI 切换：设置 → 阅读主题 → 暖纸
  await page.evaluate(() => openSettingsModal());
  await page.click('#setTheme');
  await page.waitForSelector('.theme-item', { timeout: 5000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll('.theme-item')].map((x) => x.dataset.themeId));
  if (ids.join(',') !== 'classic,indigo,paper,minimal') fail(`3a. 选择器应含 4 主题，实际 ${ids.join(',')}`);
  else ok('3a. 主题选择器 4 项（经典/靛蓝/暖纸/素灰）');
  // 三主题的顶栏采样色都要等于各自 --topbar-solid（iOS 26 顶部取色源）
  await page.click('.theme-item[data-theme-id="indigo"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'indigo', { timeout: 5000 });
  const i1 = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
  if (i1 !== 'rgb(86, 98, 206)') fail(`3h. indigo 顶栏采样色应 #5662CE，实际 ${i1}`);
  else ok('3h. indigo 顶栏采样色 #5662CE');
  await page.click('.theme-item[data-theme-id="paper"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'paper', { timeout: 5000 });
  const p1 = await page.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    topbarBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    topbarFg: getComputedStyle(document.querySelector('.topbar')).color,
    cardBg: getComputedStyle(document.querySelector('.scripture-card')).backgroundColor,
    sep: getComputedStyle(document.querySelector('.scripture-card .verse + .verse')).borderTopWidth,
    em: getComputedStyle(document.querySelector('.hb-ic-em')).display,
    line: getComputedStyle(document.querySelector('.hb-ic-line')).display,
    cur: document.querySelector('.theme-item.cur')?.dataset.themeId,
  }));
  if (p1.bodyBg !== 'rgb(250, 247, 241)') fail(`3b. paper 页面底应 #faf7f1，实际 ${p1.bodyBg}`);
  else ok('3b. paper 页面底 #faf7f1');
  if (p1.topbarBg !== 'rgb(250, 247, 241)' || p1.topbarFg !== 'rgb(51, 48, 42)') fail(`3c. paper 顶栏应纸面+墨字，实际 ${p1.topbarBg}/${p1.topbarFg}`);
  else ok('3c. paper 顶栏融入纸面、墨色字');
  if (p1.cardBg !== 'rgba(0, 0, 0, 0)') fail(`3d. paper 经文应去卡片（透明底），实际 ${p1.cardBg}`);
  else ok('3d. paper 经文去卡片化');
  if (p1.sep !== '1px') fail(`3e. paper 节间应有 1px 分隔，实际 ${p1.sep}`);
  else ok('3e. paper 节间 hairline 分隔');
  if (p1.em !== 'none' || p1.line !== 'block') fail(`3f. paper 应显线性图标隐 emoji（em=${p1.em}, line=${p1.line}）`);
  else ok('3f. paper 图标=线性');
  if (p1.cur !== 'paper') fail(`3g. 选择器选中态应为 paper，实际 ${p1.cur}`);
  else ok('3g. 选择器 ✓ 停在暖纸');

  // 4. 素灰：顶栏融入背景 + 卡片无描边阴影 + 纲目二级转灰
  await page.click('.theme-item[data-theme-id="minimal"]');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'minimal', { timeout: 5000 });
  const m1 = await page.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    topbarBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    cardBorder: getComputedStyle(document.querySelector('.scripture-card')).borderTopWidth,
    cardShadow: getComputedStyle(document.querySelector('.scripture-card')).boxShadow,
    ol2: getComputedStyle(document.querySelector('.outline-item.lv2')).color,
  }));
  if (m1.bodyBg !== 'rgb(246, 246, 248)') fail(`4a. minimal 页面底应 #f6f6f8，实际 ${m1.bodyBg}`);
  else ok('4a. minimal 页面底 #f6f6f8');
  if (m1.topbarBg !== m1.bodyBg) fail(`4d. minimal 顶栏采样色应跟随 --page-bg，实际 ${m1.topbarBg} vs ${m1.bodyBg}`);
  else ok('4d. minimal 顶栏采样色跟随 --page-bg');
  if (m1.cardBorder === '0px' && m1.cardShadow === 'none') ok('4b. minimal 卡片纯色差分层（无描边阴影）');
  else fail(`4b. minimal 卡片应无描边阴影，实际 border=${m1.cardBorder} shadow=${m1.cardShadow}`);
  if (m1.ol2 !== 'rgb(72, 72, 77)') fail(`4c. minimal 纲目二级应转灰 #48484d，实际 ${m1.ol2}`);
  else ok('4c. minimal 纲目二级转灰');

  // 5. 持久化：刷新后主题保持（early script 防闪变）
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#splash.hidden', { timeout: 30000 });
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  if (after !== 'minimal') fail(`5. 刷新后应保持 minimal，实际 ${after}`);
  else ok('5. 刷新后主题保持（early script 恢复）');

  // 6. 非法 localStorage 值回退 classic
  await page.evaluate(() => { localStorage.setItem('bible-study.theme', JSON.stringify('hack')); });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#splash.hidden', { timeout: 30000 });
  const sanitized = await page.evaluate(() => document.documentElement.dataset.theme);
  if (sanitized !== 'classic') fail(`6. 非法主题值应回 classic，实际 ${sanitized}`);
  else ok('6. 非法主题值回退 classic');

  await browser.close();
  server.kill();
  if (errors.length) { console.log('JS 错误: [' + errors.join(' | ') + ']'); process.exit(1); }
  console.log(process.exitCode === 1 ? 'theme-test FAIL' : 'theme-test 全部通过');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
