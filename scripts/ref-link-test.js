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
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）

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
  r = await refsOf('（约壹一1，18。）');
  check('7. 节不存在过滤（约壹1:18 不识别）', r.includes('约壹一1') && !r.includes('约壹1:18'), JSON.stringify(r));

  // 7b. 书卷切分回退（反馈 #6）：数据源里 约一/约二/约三 = 约翰福音第 1/2/3 章，
  //     「约一14」= 约1:14，不能被最长别名 约一→约壹 抢走（约壹只有5章，14 越界）
  r = await refsOf('（约一14。）');
  check('7b. 约一14 识别为引用', r.length === 1 && r[0] === '约一14', JSON.stringify(r));
  let keys = await page.evaluate(() => resolveRefString('约一14'));
  check('7c. 约一14 解析为 约1:14', JSON.stringify(keys) === JSON.stringify(['约1:14']), JSON.stringify(keys));
  r = await refsOf('（约二11，约三16。）');
  check('7d. 约二11/约三16 归约翰福音', r.includes('约二11') && r.includes('约三16'), JSON.stringify(r));
  keys = await page.evaluate(() => resolveRefString('约二11，约三16'));
  check('7e. 约二11/约三16 解析为 约2:11、约3:16',
    JSON.stringify(keys) === JSON.stringify(['约2:11', '约3:16']), JSON.stringify(keys));

  // 7f. 章…节至…节 范围（反馈 #7）：「彼后二章六至九节」
  r = await refsOf('我们若读彼后二章六至九节');
  check('7f. 二章六至九节 识别为引用', r.length === 1 && r[0] === '彼后二章六至九节', JSON.stringify(r));
  keys = await page.evaluate(() => resolveRefString('彼后二章六至九节'));
  check('7g. 展开为 彼后2:6～2:9',
    JSON.stringify(keys) === JSON.stringify(['彼后2:6', '彼后2:7', '彼后2:8', '彼后2:9']), JSON.stringify(keys));
  keys = await page.evaluate(() => resolveRefString('创一章一节至二节'));
  // 创1:2 数据本身分上下半节，范围展开走 pushKey 兜底 → 创1:2上
  check('7h. 「一节至二节」写法', JSON.stringify(keys) === JSON.stringify(['创1:1', '创1:2上']), JSON.stringify(keys));
  keys = await page.evaluate(() => resolveRefString('创一章一节'));
  check('7i. 单节不受影响', JSON.stringify(keys) === JSON.stringify(['创1:1']), JSON.stringify(keys));

  // 7j. 全称简体引用（反馈 #8）：正文「路加十七章二十七节」→ 路加别名缺失时会把「加」
  //     当加拉太书识别成加17:27（越界死链），需整词命中 路17:27
  r = await refsOf('在路加十七章二十七节，当主说到挪亚的日子');
  check('7j. 路加十七章二十七节 识别为引用', r.length === 1 && r[0] === '路加十七章二十七节', JSON.stringify(r));
  keys = await page.evaluate(() => resolveRefString('路加十七章二十七节'));
  check('7k. 解析为 路17:27', JSON.stringify(keys) === JSON.stringify(['路17:27']), JSON.stringify(keys));
  r = await refsOf('马可十六章九节');
  check('7l. 马可十六章九节 识别为引用', r.length === 1 && r[0] === '马可十六章九节', JSON.stringify(r));

  // 7m. 章数越界守卫：别名虽匹配但章号超出书卷章数（如伪造的加拉太17章）→ 不包裹成死链
  r = await refsOf('有人引用加拉太十七章二十七节');
  check('7m. 越界全量引用不包裹', r.length === 0, JSON.stringify(r));

  // 7n. 半节后缀回退（反馈 #12）：听抄正文「太十一29上，十七5下，彼前二21」——
  //     太11:29/太17:5 在数据里是整节（未拆分上下半），带 上/下 后缀引用须回退整节，
  //     否则弹窗「未收录」；相对引用「十七5下」也要带半节解析
  keys = await page.evaluate(() => resolveRefString('太十一29上，十七5下，彼前二21'));
  check('7n. 半节引用回退整节（太11:29/太17:5/彼前2:21）',
    JSON.stringify(keys) === JSON.stringify(['太11:29', '太17:5', '彼前2:21']), JSON.stringify(keys));
  keys = await page.evaluate(() => resolveRefString('太11:29上，太17:5下'));
  check('7o. 规范 key 带半节同样回退', JSON.stringify(keys) === JSON.stringify(['太11:29', '太17:5']), JSON.stringify(keys));
  keys = await page.evaluate(() => resolveRefString('民十一29上'));
  check('7p. 民11:29 半节引用回退', JSON.stringify(keys) === JSON.stringify(['民11:29']), JSON.stringify(keys));
  keys = await page.evaluate(() => resolveRefString('创一2下'));
  check('7q. 真实半节数据不受影响（创1:2下）', JSON.stringify(keys) === JSON.stringify(['创1:2下']), JSON.stringify(keys));

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

  // 12. 串珠「节范围：引用」格式（全角冒号是分隔符，前半的 2～5 不是引用）
  keys = await page.evaluate(() => resolveRefString('2～5：代上一5～7'));
  check('12. 「2～5：代上一5～7」→ 代上1:5～7',
    keys.length === 3 && keys[0] === '代上1:5' && keys[2] === '代上1:7', JSON.stringify(keys));

  // 13. 引导词前缀（串珠常见「参创三五23～26」）
  keys = await page.evaluate(() => resolveRefString('参创三五23～26'));
  check('13a. 参 前缀解析', keys.length === 4 && keys[0] === '创35:23' && keys[3] === '创35:26', JSON.stringify(keys));
  r = await refsOf('（参申三三6～25）');
  check('13b. 正文「参申三三6～25」成链接', r.length === 1 && r[0] === '参申三三6～25', JSON.stringify(r));

  // 13c. 双字引导词（参看）：正文按捕获组取别名与章節尾，不能用 startsWith 反查
  r = await refsOf('（参看申三三6～25）');
  check('13c. 正文「参看申三三6～25」成链接', r.length === 1 && r[0] === '参看申三三6～25', JSON.stringify(r));
  keys = await page.evaluate(() => resolveRefString('参看申三三6～25'));
  check('13d. 参看 前缀解析为 申33:6～25',
    keys.length === 20 && keys[0] === '申33:6' && keys[19] === '申33:25', JSON.stringify(keys));

  // 14. 单章书卷的裸节号（犹16 = 犹1:16）
  keys = await page.evaluate(() => resolveRefString('犹16'));
  check('14. 犹16 → 犹1:16', JSON.stringify(keys) === JSON.stringify(['犹1:16']), JSON.stringify(keys));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('JS 错误:', errors.length ? errors : '无');
  await browser.close();
  server.kill();
  process.exit(fail || errors.length ? 1 : 0);
}

main().catch((e) => { console.error('测试失败:', e.message); process.exit(1); });
