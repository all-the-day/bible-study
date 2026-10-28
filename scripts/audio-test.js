/* 听书模块专项测试（2026-10-26，端口 8778）
 *
 * 覆盖：首页块 → 模块（单列播放器）/ 抽屉双栏（合集 | 讲次）/ 分组切换 /
 * 深链 #/audio/{合集}/{讲次} / 切讲次与分段 / 播放与倍速 / 断点恢复 /
 * 首页统一检索 + 抽屉搜索 / 移动端单列不溢出。
 *
 * 音频走阿里云 OSS（跨域），**断言不依赖真实出声**：只检查 <audio> 的 src/时长可读、
 * 播放后 currentTime 推进。启动时先探测 OSS 可达性；不可达时**跳过第 7 项（播放推进）**，
 * 其余项（切讲/切段/落盘/深链/检索/移动端）仍全部断言——本测试已进 pre-push 全量门禁，
 * 不能让 CDN 抖动变成假失败。注意：探活失败时对「真实播放行为」零覆盖，别把它当保障。
 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8778;   // 独立端口：8765 常被用户遗留服务器占用（见 AGENTS.md 端口纪律）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0;
const ok = (cond, label, extra) => {
  console.log(`${label}:`, cond ? '✓' : '✗', extra === undefined ? '' : '| ' + extra);
  if (!cond) fail = 1;
};

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  await sleep(1500);

  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('Failed to load resource')) return;   // OSS 资源由 response 监听接管
    errors.push('console: ' + m.text());
  });
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });

  // 期望时长从数据反算（不硬编码秒数：源侧重导会碎断言）
  const fs = require('fs');
  const path = require('path');
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/audio/niaokan.json'), 'utf8'));
  const lec35 = data.lectures.find(l => l.n === 35);
  const clockOf = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  const exp = { track1: lec35.tracks[0].durationSec, track3: lec35.tracks[2].durationSec };
  // 数据里的 durationSec 是 ffprobe 四舍五入到秒，<audio> 给的 duration 是精确值（floor 后显示），
  // 两者可能差 1 秒——比较用 ±2 秒容差，别硬比字符串
  const clockToSec = (s) => String(s).split(':').reduce((a, b) => a * 60 + (+b || 0), 0);
  const durClose = (shown, expectSec) => shown !== '—:—' && Math.abs(clockToSec(shown) - expectSec) <= 2;

  // 外网可达性探测：音频在 OSS（跨域直连）。不可达时跳过播放断言——
  // 本测试已进 pre-push 全量门禁，不能让 CDN 抖动/离线变成假失败。
  let canPlayRemote = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Range: 'bytes=0-1' } });
      return { ok: r.ok || r.status === 206, status: r.status };
    }, data.baseUrl + lec35.tracks[0].path);
    clearTimeout(timer);
    canPlayRemote = res.ok;
  } catch (e) {
    canPlayRemote = false;
  }
  console.log('   （OSS 可达性:', canPlayRemote ? '可播' : '不可达 → 播放断言将跳过', '）');

  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  // 等 init 收尾再点首页块：并发全量跑时启动数据处理变慢，固定 sleep 后就点击的话
  // init 尾部的 selectBook/initRoute（覆写 crumb、重渲染）会掀掉刚进的模块态（2026-10-27 notes-module 实测踩过）
  await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 30000 });

  // 1. 首页有听书块
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('#homeGrid .home-block')].map(b => b.dataset.entry));
  ok(blocks.includes('audio'), '1. 首页「听书」块', blocks.join(','));

  // 2. 直进模块：单列 + 播放器 + 讲次信息
  await page.evaluate(() => document.querySelector('.home-block[data-entry="audio"]').click());
  await sleep(2500);
  const r2 = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-audio'),
    studyHidden: getComputedStyle(document.querySelector('#studyCol')).display === 'none',
    mainVisible: getComputedStyle(document.querySelector('#audioMain')).display,
    title: document.querySelector('.au-title') && document.querySelector('.au-title').textContent,
    meta: document.querySelector('.au-meta') && document.querySelector('.au-meta').textContent,
    hasPlayer: !!document.querySelector('#auPlay'),
    bookName: document.querySelector('#bookName').textContent,
    actionsHidden: ['#viewModeBtn', '#hideMarksBtn', '#studyFullBtn', '#typographyBtn']
      .every(s => getComputedStyle(document.querySelector(s)).display === 'none'),
  }));
  ok(r2.mod && r2.studyHidden && r2.mainVisible === 'block' && r2.hasPlayer && r2.actionsHidden,
    '2. 直进模块（单列播放器）', `${r2.bookName} | ${r2.title} | ${r2.meta}`);

  // 3. 抽屉双栏：左=合集、右=当前分组的讲次；底部分组条存在
  const r3 = await page.evaluate(() => ({
    cols: document.querySelectorAll('#dwBody .dw-col').length,
    colls: [...document.querySelectorAll('#dwBody .dw-item[data-ac]')].map(x => x.textContent.trim()),
    lects: document.querySelectorAll('#dwBody .dw-item[data-r]').length,
    foot: [...document.querySelectorAll('#dwFoot [data-t]')].map(x => x.textContent + (x.classList.contains('sel') ? '*' : '')),
  }));
  ok(r3.cols === 2 && r3.colls.length === 1 && r3.colls[0] === '鸟瞰圣经' && r3.lects === 23
    && r3.foot.length === 2, '3. 抽屉双栏 + 旧约/新约', JSON.stringify(r3));

  // 4. 切分组 → 右栏换成新约 18 讲
  await page.evaluate(() => document.querySelector('#dwFoot [data-t="nt"]').click());
  await sleep(600);
  const r4 = await page.evaluate(() => ({
    lects: document.querySelectorAll('#dwBody .dw-item[data-r]').length,
    foot: [...document.querySelectorAll('#dwFoot [data-t]')].map(x => x.textContent + (x.classList.contains('sel') ? '*' : '')),
  }));
  ok(r4.lects === 18 && r4.foot[1].endsWith('*'), '4. 分组切换（新约 18 讲）', JSON.stringify(r4));

  // 5. 点右栏第 35 讲 → 主区切换 + URL + 分段列表（5 段）
  await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-r="35"]').click());
  await sleep(1500);
  const r5 = await page.evaluate(() => ({
    title: document.querySelector('.au-title').textContent,
    meta: document.querySelector('.au-meta').textContent,
    tracks: document.querySelectorAll('.au-track').length,
    crumb: document.querySelector('#chapterLabel').textContent,
    hash: location.hash,
    curDrawer: document.querySelector('#dwBody .dw-item.cur[data-r]') &&
      document.querySelector('#dwBody .dw-item.cur[data-r]').dataset.r,
  }));
  ok(r5.title === '腓立比书' && r5.tracks === 5 && r5.hash === '#/audio/niaokan/35' && r5.curDrawer === '35',
    '5. 切第 35 讲（腓立比书 / 5 段）', `${r5.crumb} | ${r5.hash} | ${r5.meta}`);

  // 6. 单段讲次不渲染分段列表（第 25 讲 四福音书）
  await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-r="25"]').click());
  await sleep(1200);
  const r6 = await page.evaluate(() => ({
    title: document.querySelector('.au-title').textContent,
    tracks: document.querySelectorAll('.au-track').length,
    secHead: !!document.querySelector('.au-sec-head'),
  }));
  ok(r6.title === '四福音书' && r6.tracks === 0 && !r6.secHead, '6. 单段讲次无分段列表', r6.title);

  // 7. 回到第 35 讲，播放：时长来自数据、currentTime 推进
  //    期望值从 data/audio/niaokan.json 反算（不硬编码秒数——源侧重导会碎）
  await page.evaluate(() => document.querySelector('#dwBody .dw-item[data-r="35"]').click());
  await sleep(1200);
  await page.evaluate(() => document.querySelector('#auPlay').click());
  await sleep(4000);
  const r7 = await page.evaluate(() => ({
    btn: document.querySelector('#auPlay').textContent,
    cur: document.querySelector('#auCur').textContent,
    total: document.querySelector('#auTotal').textContent,
    fill: document.querySelector('#auFill').style.width,
    saved: JSON.parse(localStorage.getItem('bible-study.audioLast') || 'null'),
  }));
  if (!canPlayRemote) {
    console.log('7. 播放推进（OSS 直连）: — 跳过（外网不可达，音频无法加载）');
  } else {
    const playing = r7.btn === '❚❚' && r7.cur !== '0:00' && durClose(r7.total, exp.track1);
    ok(playing, '7. 播放推进（OSS 直连）', `cur=${r7.cur} total=${r7.total} fill=${r7.fill}`);
  }

  // 8. 倍速循环 1 → 1.25
  const r8 = await page.evaluate(() => {
    document.querySelector('#auSpeed').click();
    return document.querySelector('#auSpeed').textContent;
  });
  ok(r8 === '1.25×', '8. 倍速切换', r8);

  // 9. 点第 3 段 → 切源、当前段高亮、落盘 track=2
  await page.evaluate(() => document.querySelector('.au-track[data-atrack="2"]').click());
  await sleep(1800);
  const r9 = await page.evaluate(() => ({
    curTrack: document.querySelector('.au-track.cur') && document.querySelector('.au-track.cur').dataset.atrack,
    total: document.querySelector('#auTotal').textContent,
    name: document.querySelector('.au-track.cur .name').textContent,
    idx: JSON.parse(localStorage.getItem('bible-study.audioLast') || '{}').track,
  }));
  const trackOk = durClose(r9.total, exp.track3);
  ok(r9.curTrack === '2' && trackOk && r9.idx === 2, '9. 切第 3 段', JSON.stringify(r9));

  // 10. 阅读历史记 audio 模块（在此断言：后续深链/刷新会改写首条）
  const r10h = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('bible-study.history') || '[]');
    const first = list.find(x => x.module === 'audio');
    return { mod: first && first.module, title: first && first.title, loc: first && first.loc };
  });
  ok(r10h.mod === 'audio' && r10h.title && r10h.title.includes('腓立比书'), '10. 阅读历史记录',
    `${r10h.title} ${JSON.stringify(r10h.loc)}`);

  // 11. 深链直达 + 刷新保持
  await page.goto('http://127.0.0.1:' + PORT + '/#/audio/niaokan/41', { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2500);
  const r11a = await page.evaluate(() => ({
    title: document.querySelector('.au-title') && document.querySelector('.au-title').textContent,
    tracks: document.querySelectorAll('.au-track').length,
    foot: [...document.querySelectorAll('#dwFoot [data-t]')].map(x => x.textContent + (x.classList.contains('sel') ? '*' : '')),
  }));
  ok(r11a.title === '启示录' && r11a.tracks === 5 && r11a.foot[1].endsWith('*'),
    '11. 深链 #/audio/niaokan/41', JSON.stringify(r11a));

  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(2500);
  const r11c = await page.evaluate(() => ({
    title: document.querySelector('.au-title') && document.querySelector('.au-title').textContent,
    mod: document.body.classList.contains('body-mod-audio'),
    hash: location.hash,
  }));
  ok(r11c.title === '启示录' && r11c.mod && r11c.hash === '#/audio/niaokan/41',
    '11b. 刷新保持位置', JSON.stringify(r11c));

  // 12. 首页统一检索命中听书 + 点击跳转
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });
  await page.click('#homeSearch');
  await page.type('#homeSearch', '腓立比');
  await sleep(2500);
  const r12 = await page.evaluate(() => {
    const g = document.querySelector('#homeSearchResults .sr-group[data-g="audio"]');
    return {
      has: !!g,
      count: g ? g.querySelectorAll('.home-sr-item[data-k]').length : 0,
      text: g ? g.textContent.replace(/\s+/g, ' ').slice(0, 40) : '',
    };
  });
  ok(r12.has && r12.count >= 1 && r12.text.includes('腓立比书'), '12. 首页检索「腓立比」命中听书',
    r12.text);

  const jumped = await page.evaluate(() => {
    const el = document.querySelector('#homeSearchResults .sr-group[data-g="audio"] .home-sr-item[data-k]');
    if (!el) return null;
    el.click();
    return true;
  });
  await sleep(2000);
  const r12c = await page.evaluate(() => ({
    mod: document.body.classList.contains('body-mod-audio'),
    hash: location.hash,
    title: document.querySelector('.au-title') && document.querySelector('.au-title').textContent,
  }));
  ok(jumped && r12c.mod && r12c.hash === '#/audio/niaokan/35' && r12c.title === '腓立比书',
    '12b. 搜索结果跳转', r12c.hash);

  // 13. 抽屉模块级搜索
  await page.evaluate(() => document.querySelector('#dwSearchInput').focus());
  await page.type('#dwSearchInput', '使徒');
  await sleep(1500);
  const r13 = await page.evaluate(() =>
    [...document.querySelectorAll('#dwSearchResults [data-sr="audio"]')].map(x => x.textContent));
  ok(r13.length === 1 && r13[0].includes('第28讲'), '13. 抽屉搜索「使徒」', r13.join(' / '));

  // 14. 移动端：单列、无 pill、无横向溢出、抽屉双栏不挤爆
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(2500);
  const r14 = await page.evaluate(() => ({
    pill: getComputedStyle(document.querySelector('#modePill')).display,
    study: getComputedStyle(document.querySelector('#studyCol')).display,
    crumbTrunc: (() => {
      const c = document.querySelector('.crumb');
      return c.scrollWidth > c.clientWidth + 1;
    })(),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    playerW: Math.round(document.querySelector('.au-player').getBoundingClientRect().width),
  }));
  ok(r14.pill === 'none' && r14.study === 'none' && !r14.overflow && r14.playerW > 300,
    '14. 移动端单列', JSON.stringify(r14));

  await page.evaluate(() => document.querySelector('#menuBtn').click());
  await sleep(700);
  const r14b = await page.evaluate(() => ({
    open: document.querySelector('#navDrawer').classList.contains('open'),
    cols: document.querySelectorAll('#dwBody .dw-col').length,
    widths: [...document.querySelectorAll('#dwBody .dw-col')].map(x => Math.round(x.getBoundingClientRect().width)),
  }));
  ok(r14b.open && r14b.cols === 2 && r14b.widths.every(w => w > 120),
    '14b. 移动端抽屉双栏', JSON.stringify(r14b.widths));

  // 15. UI 评审回归（2026-10-28）：分段进度说明 / 进度条命中区 / 控制行不重叠
  //     —— 三条都是纯几何与文案，不依赖 OSS，慢网也能稳定断言
  await page.evaluate(() => { if (typeof closeNavDrawer === 'function') closeNavDrawer(); });
  await sleep(400);
  await page.evaluate(() => openAudioLecture('niaokan', 35));
  await sleep(1200);
  const r15 = await page.evaluate(() => {
    const cap = document.getElementById('auSegCap');
    const pg = document.getElementById('auPg').getBoundingClientRect();
    const cx = Math.round(pg.left + pg.width / 2);
    // 纵向扫描可命中「播放进度」的高度（视觉 4px，命中带应 ≥24px）
    let band = 0;
    for (let dy = -20; dy <= 20; dy += 1) {
      const el = document.elementFromPoint(cx, Math.round(pg.top + pg.height / 2 + dy));
      if (el && el.id === 'auPg') band++;
    }
    const fwd = document.querySelector('[data-aseek="15"]').getBoundingClientRect();
    const speed = document.getElementById('auSpeed').getBoundingClientRect();
    let stolen = 0;   // 前进按钮全宽里有多少像素实际落在倍速上
    for (let x = Math.round(fwd.left); x < Math.round(fwd.right); x += 1) {
      const el = document.elementFromPoint(x, Math.round(fwd.top + fwd.height / 2));
      if (el && el.id === 'auSpeed') stolen++;
    }
    return {
      capShown: !cap.hidden, capText: cap.textContent,
      valuetext: document.getElementById('auPg').getAttribute('aria-valuetext'),
      band, stolen, fwdRight: Math.round(fwd.right), speedLeft: Math.round(speed.left),
    };
  });
  ok(r15.capShown && r15.capText.includes('共 5 段') && r15.valuetext.startsWith('第一段'),
    '15. 多段讲次标注「分段进度」', `${r15.capText} | ${r15.valuetext}`);
  ok(r15.band >= 24, '15b. 进度条命中区 ≥24px', `band=${r15.band}px`);
  ok(r15.stolen === 0 && r15.fwdRight <= r15.speedLeft,
    '15c. 「前进 15 秒」与倍速不重叠', `fwd右=${r15.fwdRight} 倍速左=${r15.speedLeft} 被压像素=${r15.stolen}`);

  // 16. 单段讲次不显示分段进度说明（避免与「1 段」重复）
  await page.evaluate(() => openAudioLecture('niaokan', 25));
  await sleep(1200);
  const r16 = await page.evaluate(() => {
    const cap = document.getElementById('auSegCap');
    return { tracks: document.querySelectorAll('.au-track').length, capHidden: cap.hidden, valuetext: document.getElementById('auPg').getAttribute('aria-valuetext') };
  });
  ok(r16.tracks === 0 && r16.capHidden && !r16.valuetext.startsWith('第'),
    '16. 单段讲次隐藏分段说明', JSON.stringify(r16));

  // 17. 数据缺失空态要给出可点的动作（不能是死胡同）
  const r17 = await page.evaluate(() => {
    state.audioData['__empty__'] = { id: '__empty__', name: '空合集', lectures: [], groups: [] };
    const keepColl = state.audioColl, keepLec = state.audioLecture;
    state.audioColl = '__empty__'; state.audioLecture = 1;
    renderAudioMain();
    const text = document.getElementById('audioMain').textContent.replace(/\s+/g, ' ').trim();
    const hasRetry = !!document.querySelector('#audioMain [data-areload]');
    delete state.audioData['__empty__'];
    state.audioColl = keepColl; state.audioLecture = keepLec;
    renderAudioMain();
    return { text, hasRetry };
  });
  ok(r17.hasRetry && r17.text.includes('听书数据缺失'), '17. 空态给出重试动作', JSON.stringify(r17));

  // 18. 触屏纵向滑动不该改播放位置（手指落在进度条行上想滚页时，
  //     浏览器接管滚动发生在 pointerdown 之后，先 seek 会把位置无声跳走）
  await page.evaluate(() => openAudioLecture('niaokan', 35));
  await sleep(1000);
  const r18 = await page.evaluate(() => {
    const pg = document.getElementById('auPg');
    const r = pg.getBoundingClientRect();
    const y = Math.round(r.top + r.height / 2);
    const at = (f) => Math.round(r.left + r.width * f);
    const ev = (type, x, yy) => pg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: yy,
      pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0,
    }));
    const el = ensureAudioEl();
    el.currentTime = 0;
    ev('pointerdown', at(0.2), y);
    ev('pointermove', at(0.2), y + 12);
    ev('pointermove', at(0.2), y + 34);
    ev('pointerup', at(0.2), y + 34);
    const afterSwipe = el.currentTime;
    // 轻点仍应定位到对应位置
    ev('pointerdown', at(0.5), y);
    ev('pointerup', at(0.5), y);
    return { afterSwipe: +afterSwipe.toFixed(1), afterTap: +el.currentTime.toFixed(1), half: Math.round(audioDuration() * 0.5) };
  });
  ok(r18.afterSwipe === 0 && Math.abs(r18.afterTap - r18.half) <= 3,
    '18. 触屏纵滑不改位置 / 轻点定位', JSON.stringify(r18));

  console.log('\nJS 错误:', errors.length ? errors : '无');
  if (errors.length) fail = 1;
  await browser.close();
  server.kill();
  process.exit(fail);
}

main().catch((e) => { console.error(e); process.exit(1); });
