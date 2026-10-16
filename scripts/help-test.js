/* 使用帮助专项（2026-10-16）：入口 / 正文渲染 / 最近更新来自 CHANGELOG / 更新弹窗「本次更新」联动与回退
   机制：app.js CHANGELOG 单一来源 → 帮助 popup「最近更新」+ 更新弹窗「本次更新」两处消费。端口 8765。 */
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

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#splash.hidden', { timeout: 30000 });
  await page.evaluate(() => { enterWork(); });

  // 1. 入口：设置弹窗「其他」组，使用帮助在检查更新上方
  await page.evaluate(() => openSettingsModal());
  const entry = await page.evaluate(() => {
    const help = document.querySelector('#setHelp');
    const upd = document.querySelector('#setUpdate');
    if (!help || !upd) return null;
    return { label: help.querySelector('.settings-label').textContent, before: help.compareDocumentPosition(upd) & Node.DOCUMENT_POSITION_FOLLOWING };
  });
  if (!entry || entry.label !== '使用帮助' || !entry.before) fail(`1. 设置行缺失或位置不对: ${JSON.stringify(entry)}`);
  else ok('1. 设置「其他」组含「使用帮助」行（检查更新上方）');

  // 2. 打开帮助：标题 + 四个章节 + 五色语义 mark + 最近更新来自 CHANGELOG
  await page.click('#setHelp');
  await page.waitForSelector('#popupBody .help-h', { timeout: 5000 });
  const help = await page.evaluate(() => {
    const t = document.querySelector('#popupTitle').textContent;
    const b = document.querySelector('#popupBody');
    return {
      title: t,
      sections: [...b.querySelectorAll('.help-h .n')].map(n => n.textContent),
      marks: b.querySelectorAll('mark.c1, mark.c2, mark.c3, mark.c4, mark.c5').length,
      vers: [...b.querySelectorAll('.help-ver')].map(v => v.textContent.trim()),
      has54: b.textContent.includes('滑动翻页'),
      hasUpdHead: b.textContent.includes('最近更新'),
      top: String(window.changelogSince('0')[0].v),   // const 不挂 window，借函数声明 changelogSince 取顶部条目
    };
  });
  if (help.title !== '使用帮助') fail(`2a. 标题应为使用帮助，实际 ${help.title}`);
  else ok('2a. 标题「使用帮助」');
  if (help.sections.join(',') !== '1,2,3,4') fail(`2b. 应有 4 个章节，实际 ${help.sections.join(',')}`);
  else ok('2b. 四章节（从开始/阅读/划线/技巧）');
  if (help.marks !== 5) fail(`2c. 五色语义 mark 应 5 个，实际 ${help.marks}`);
  else ok('2c. 五色标注语义色块 5 个');
  if (help.vers.length !== 3 || !help.vers[0].includes(help.top)) fail(`2d. 最近更新应为 3 个版本段且首条=CHANGELOG[0]（${help.top}），实际 ${JSON.stringify(help.vers)}`);
  else ok(`2d. 最近更新 3 段（来自 CHANGELOG），首条 v${help.top}`);
  if (!help.hasUpdHead || !help.has54) fail('2e. 帮助正文缺「最近更新」或 1.0.54 条目文案');   // 1.0.54 条目持续存在（滑动翻页文案锚点）
  else ok('2e. 帮助正文含 1.0.54 条目（阅读主题/滑动翻页）');

  // 3. 关闭帮助；更新弹窗联动：mock check → 发现新版本（1.0.53 → 1.0.54）
  await page.evaluate(() => closePopup());
  await page.evaluate(() => {
    window.BibleStudyUpdate.check = () => Promise.resolve({
      latest: { version: '1.0.54', body: 'RAW-COMMIT-TEXT', html_url: 'https://x', downloadUrl: null },
      current: '1.0.53', hasUpdate: true,
    });
    openUpdateModal();
  });
  await page.waitForFunction(() => document.querySelector('#updateBody').textContent.includes('本次更新'), { timeout: 5000 }).catch(() => {});
  const upd = await page.evaluate(() => ({
    status: document.querySelector('#updateStatus').textContent,
    body: document.querySelector('#updateBody').textContent,
    hasList: !!document.querySelector('#updateBody .upd-ch-item'),
    helpBtn: !document.querySelector('#updateHelp').hidden,
  }));
  if (!/发现新版本 v1\.0\.54/.test(upd.status)) fail(`3a. 状态行应报 1.0.54，实际 ${upd.status}`);
  else ok('3a. 状态行「发现新版本 v1.0.54」');
  if (!upd.body.includes('本次更新') || !upd.body.includes('滑动翻页') || upd.body.includes('RAW-COMMIT-TEXT')) fail(`3b. 应展示 CHANGELOG 用户语言（本次更新/滑动翻页），不得出现原始提交文本，实际含: ${upd.body.slice(0, 120)}`);
  else ok('3b. 「本次更新」= CHANGELOG 用户语言条目，原始提交文本未出现');
  if (!upd.hasList) fail('3c. 应有 .upd-ch-item 列表');
  else ok('3c. 条目列表渲染');
  if (!upd.helpBtn) fail('3d. 查看全部更新按钮应显示');
  else ok('3d. 「查看全部更新」按钮显示');

  // 4. 回退分支：远端版本在 CHANGELOG 之外且本地=记录最新 → 回退原始信息
  await page.evaluate(() => {
    document.querySelector('#updateHelp').click();   // 先验证联动跳转
  });
  await new Promise((r) => setTimeout(r, 300));
  const jump = await page.evaluate(() => ({
    modalHidden: document.querySelector('#updateModal').hidden,
    popupTitle: document.querySelector('#popupTitle').textContent,
    popupOpen: !document.querySelector('#popup').hidden,
  }));
  if (!jump.modalHidden || !jump.popupOpen || jump.popupTitle !== '使用帮助') fail(`4a. 「查看全部更新」应关更新弹窗并开帮助，实际 ${JSON.stringify(jump)}`);
  else ok('4a. 「查看全部更新」→ 关更新弹窗、开帮助');
  await page.evaluate(() => closePopup());

  await page.evaluate(() => {
    window.BibleStudyUpdate.check = () => Promise.resolve({
      latest: { version: '9.9.9', body: 'RAW-COMMIT-TEXT', html_url: 'https://x', downloadUrl: null },
      current: String(window.changelogSince('0')[0].v), hasUpdate: true,   // 本地=记录最新 → 回退
    });
    openUpdateModal();
  });
  await page.waitForFunction(() => document.querySelector('#updateBody').textContent.includes('RAW-COMMIT-TEXT'), { timeout: 5000 }).catch(() => {});
  const fb = await page.evaluate(() => document.querySelector('#updateBody').textContent);
  if (!fb.includes('RAW-COMMIT-TEXT')) fail(`4b. 本地=记录最新时回退原始信息，实际 ${fb.slice(0, 80)}`);
  else ok('4b. 回退分支：CHANGELOG 无对应条目时回退原始信息');
  await page.evaluate(() => closeUpdateModal());

  // 5. 过老版本：全量展示 CHANGELOG（不为空）
  await page.evaluate(() => {
    window.BibleStudyUpdate.check = () => Promise.resolve({
      latest: { version: '1.0.54', body: 'RAW-COMMIT-TEXT', html_url: 'https://x', downloadUrl: null },
      current: '1.0.40', hasUpdate: true,
    });
    openUpdateModal();
  });
  await page.waitForFunction(() => document.querySelector('#updateBody').textContent.includes('本次更新'), { timeout: 5000 }).catch(() => {});
  const old = await page.evaluate(() => document.querySelectorAll('#updateBody .upd-ch-item').length);
  if (old < 6) fail(`5. 过老版本应全量展示 CHANGELOG 条目（≥6），实际 ${old}`);
  else ok(`5. 过老版本全量展示（${old} 条）`);
  await page.evaluate(() => closeUpdateModal());

  await browser.close();
  server.kill();
  if (errors.length) { console.log('JS 错误: [' + errors.join(' | ') + ']'); process.exit(1); }
  console.log(process.exitCode === 1 ? 'help-test FAIL' : 'help-test 全部通过');
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
