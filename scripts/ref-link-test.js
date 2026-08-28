/* 经文引用识别回归测试：相对引用（无书卷前缀，如「创二四62，二五11」里的 二五11）识别、
 * 书卷上下文（defaultAcronym / 前文全书引用）、纯数字相对引用边界防护、章越界/节不存在过滤。
 * 覆盖 2026-08 修复：生命读经正文 ref-link 后续相对引用未识别。 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8766;

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

  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log(`✓ ${name}`); }
    else { fail++; console.log(`✗ ${name} ${extra || ''}`); }
  };

  // 进读经模块加载 bibleText（节存在校验需要）
  await page.evaluate(() => selectBook(1, 26));
  await page.waitForFunction(() => !!state.bibleText, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));

  // detectRefs 返回 {start,end,refText}，refText 为 data-refs（相对引用是规范键如 创25:11）
  const refsOf = (text, defaultAcr) => page.evaluate(([t, a]) =>
    detectRefs(t, a).map(r => r.refText), [text, defaultAcr || null]);

  // 1. 用户报告：生命读经正文「创二四62，二五11」→ 二五11 识别为 创25:11
  let r = await refsOf('（创二四62，二五11。）', '创');
  check('1. 相对引用二五11 → 创25:11（defaultAcronym 提供上下文）', r.includes('创25:11'), JSON.stringify(r));
  r = await refsOf('（创二四62，二五11。）');
  check('2. 相对引用二五11 → 创25:11（前文全书引用提供上下文）', r.includes('创25:11'), JSON.stringify(r));

  // 3. 链式相对引用 + 范围
  r = await refsOf('（二五11，二六15～22，）', '创');
  check('3. 链式相对引用与范围', r.includes('创25:11') && r.includes('创26:15～22'), JSON.stringify(r));

  // 4. 注解相对引用（纯数字，defaultAcronym=注解所在书卷）
  r = await refsOf('（二一25，33。）见申十二5注1与17注1。', '创');
  check('4. 纯数字相对引用 33 → 创21:33', r.includes('创21:33'), JSON.stringify(r));

  // 5. em dash 前导的相对引用（真实注解数据）
  r = await refsOf('（由井所表征—二五11，二六15～22，）', '创');
  check('5. —后相对引用', r.includes('创25:11') && r.includes('创26:15～22'), JSON.stringify(r));

  // 6. 章越界过滤：弗只有6章，三二28 不识别（书卷推断错误）
  r = await refsOf('（弗一10，三2，三二28。）', '创');
  check('6. 章越界过滤（三二28 不识别）', r.includes('弗一10') && r.includes('弗3:2') && !r.includes('弗32:28'), JSON.stringify(r));

  // 7. 节不存在过滤：约壹1:18 不存在（约壹1仅10节），18 不识别
  r = await refsOf('（约一1，18，启十九13。）');
  check('7. 节不存在过滤（18 不识别）', r.includes('约一1') && !r.includes('18') && r.includes('启十九13'), JSON.stringify(r));

  // 8. 纯数字误判防护：25章 / 25:11 / 1920年 不识别
  r = await refsOf('（创二四62，25章）');
  check('8a. 25章 不识别', r.length === 1 && r[0] === '创二四62', JSON.stringify(r));
  r = await refsOf('（创二四62，25:11）');
  check('8b. 25:11 不拆出 11', r.length === 1 && r[0] === '创二四62', JSON.stringify(r));
  r = await refsOf('（创二四62，1920年）');
  check('8c. 1920年 不识别', r.length === 1 && r[0] === '创二四62', JSON.stringify(r));

  // 9. 无上下文时相对引用不识别
  r = await refsOf('二五11');
  check('9. 无上下文不识别', r.length === 0, JSON.stringify(r));

  // 10. DOM 级：生命读经 创 篇63 正文渲染出 二五11 ref-link（data-refs=创25:11）
  await page.evaluate(() => enterModule('lifereading'));
  await page.waitForSelector('#lrMain .lr-content', { timeout: 15000 });
  await page.evaluate(() => openLrArticle(1, state.lrVolumes[1].articles[63]));
  await new Promise((r) => setTimeout(r, 1200));
  const dom = await page.evaluate(() => {
    const span = [...document.querySelectorAll('#lrMain span.ref-link')]
      .find(s => s.textContent === '二五11');
    return span ? { refs: span.dataset.refs, text: span.textContent } : null;
  });
  check('10. 篇63 DOM 渲染：二五11 ref-link → 创25:11',
    !!dom && dom.refs === '创25:11' && dom.text === '二五11', JSON.stringify(dom));

  // 11. renderLrArticle 默认书卷接线：bookIndex=1（创）时裸相对引用落到 创
  r = await page.evaluate(() => {
    const div = document.createElement('div');
    div.appendChild(renderLrArticle({ id: 9999, title: '测试', verses: [], content: '（二五11。）' }, 1));
    const span = div.querySelector('span.ref-link');
    return span ? span.dataset.refs : null;
  });
  check('11. renderLrArticle 默认书卷接线（bookIndex=1 → 创25:11）', r === '创25:11', JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('JS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  process.exit(fail || errors.length ? 1 : 0);
}

main().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
