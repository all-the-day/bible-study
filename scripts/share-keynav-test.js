/* 分享 + 键盘翻页专项（2026-11-18，反馈 #34 / #33）
   分享：长按顶栏标题 → 弹窗（位置名 / 二维码 SVG / 可分享网址）→「复制链接」写入剪贴板；
        长按后随后的 click 必须被吞掉（不能同时开导航抽屉）；无 hash 的位置不弹。
   键盘：PC 端 ←/→ 切上下章（复用 swipeTargetChapter 的模块分派），弹窗/抽屉/输入焦点/听书模块让位。 */
const { spawn } = require('child_process');
const ROOT = require('path').resolve(__dirname, '..');
const PORT = 8779;   // 独占端口（不碰 8765 的遗留服务器）

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  let fail = 0;
  const ok = (cond, label, extra) => {
    console.log(` ${label}:`, cond ? '✓' : '✗', extra === undefined ? '' : '| ' + extra);
    if (!cond) fail = 1;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function lane(page) {
    return async (label, fn) => {
      try {
        const r = await fn();
        ok(r.cond, label, r.extra);
      } catch (e) {
        ok(false, label, 'EXC ' + e.message);
      }
    };
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(() => {
      window.BIBLE_SKIP_UPDATE = true;
      // 剪贴板打桩：headless 下不申请权限，直接记录写入内容
      window.__copied = null;
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
        });
      } catch (e) {}
      // 系统分享打桩（headless Chrome 通常没有 navigator.share，这里强制有以便验证分支）
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: (d) => { window.__shared = d; return Promise.resolve(); },
        });
      } catch (e) {}
    });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => document.getElementById('splash').classList.contains('hidden'), { timeout: 60000 });

    const check = lane(page);

    // 0. vendor 库加载 + 定位到腓立比书 3 章
    await check('0. 二维码库已加载（vendor/qrcode.js）', async () => {
      const r = await page.evaluate(() => ({ qr: typeof qrcode, hash: location.hash }));
      await page.evaluate(() => { location.hash = '#/bible/50/3'; });
      await sleep(1800);
      const pos = await page.evaluate(() => ({ book: state.currentBook && state.currentBook.index, ch: state.currentChapter }));
      return { cond: r.qr === 'function' && pos.book === 50 && pos.ch === 3, extra: `typeof qrcode=${r.qr} | ${pos.book}:${pos.ch}` };
    });

    // 1. 长按标题 → 分享弹窗：标题、二维码 SVG、网址含当前位置、两个按钮
    await check('1. 长按标题弹出分享（二维码 + 网址 + 复制/分享）', async () => {
      await page.evaluate(() => {
        const crumb = document.querySelector('.crumb');
        const r = crumb.getBoundingClientRect();
        const opt = { bubbles: true, clientX: r.left + 30, clientY: r.top + r.height / 2 };
        crumb.dispatchEvent(new MouseEvent('mousedown', opt));
      });
      await sleep(750);
      const r = await page.evaluate(() => ({
        title: document.querySelector('#popupTitle')?.textContent,
        shown: !document.querySelector('#popup').hidden,
        loc: document.querySelector('.share-loc')?.textContent || '',
        svg: !!document.querySelector('.share-qr svg'),
        url: document.querySelector('.share-url')?.textContent || '',
        copyBtn: !!document.getElementById('shareCopy'),
        sysBtn: !!document.getElementById('shareSys'),
        modules: document.querySelector('.share-qr svg path')?.getAttribute('d')?.length || 0,
      }));
      return {
        cond: r.shown && r.title === '分享' && r.loc.includes('腓立比书') && /3章/.test(r.loc) &&
          r.svg && r.url.endsWith('#/bible/50/3') && r.copyBtn && r.sysBtn && r.modules > 200,
        extra: JSON.stringify({ ...r, modules: r.modules }),
      };
    });

    // 2. 复制链接 → 剪贴板内容 = 当前完整网址
    await check('2. 复制链接写入剪贴板', async () => {
      await page.evaluate(() => document.getElementById('shareCopy').click());
      await sleep(400);
      const r = await page.evaluate(() => ({
        copied: window.__copied,
        toast: (document.querySelector('.toast') || {}).textContent || '',
      }));
      return {
        cond: !!r.copied && r.copied.endsWith('#/bible/50/3') && r.copied.startsWith('http'),
        extra: JSON.stringify(r),
      };
    });

    // 3. 系统分享（有 navigator.share 时出现并传入同一网址）
    await check('3. 系统分享传入当前网址', async () => {
      await page.evaluate(() => document.getElementById('shareSys').click());
      await sleep(300);
      const r = await page.evaluate(() => window.__shared);
      return { cond: !!r && String(r.url).endsWith('#/bible/50/3'), extra: JSON.stringify(r) };
    });

    // 4. 长按后那次 click 被吞：不额外打开导航抽屉/收起停靠列
    await check('4. 长按后 click 被吞（不同时开抽屉）', async () => {
      await page.evaluate(() => closePopupAll());
      await sleep(300);
      const before = await page.evaluate(() => ({
        docked: document.body.classList.contains('drawer-docked'),
        open: !!document.querySelector('#navDrawer.open'),
      }));
      await page.evaluate(() => {
        const crumb = document.querySelector('.crumb');
        const r = crumb.getBoundingClientRect();
        const opt = { bubbles: true, clientX: r.left + 30, clientY: r.top + r.height / 2 };
        crumb.dispatchEvent(new MouseEvent('mousedown', opt));
        // 真实设备会在长按后补一个 click，这里同时模拟
        setTimeout(() => crumb.dispatchEvent(new MouseEvent('click', opt)), 700);
      });
      await sleep(1100);
      const after = await page.evaluate(() => ({
        popup: !document.querySelector('#popup').hidden,
        docked: document.body.classList.contains('drawer-docked'),
        open: !!document.querySelector('#navDrawer.open'),
      }));
      await page.evaluate(() => closePopupAll());
      await sleep(200);
      return {
        cond: after.popup && after.docked === before.docked && after.open === before.open,
        extra: JSON.stringify({ before, after }),
      };
    });

    // 5. 键盘右 → 下一章；左 → 回上一章
    await check('5. ←/→ 切上下章', async () => {
      await page.evaluate(() => { location.hash = '#/bible/50/3'; });
      await sleep(1600);
      await page.keyboard.press('ArrowRight');
      await sleep(1400);
      const next = await page.evaluate(() => ({ ch: state.currentChapter, hash: location.hash }));
      await page.keyboard.press('ArrowLeft');
      await sleep(1400);
      const prev = await page.evaluate(() => ({ ch: state.currentChapter, hash: location.hash }));
      return {
        cond: next.ch === 4 && next.hash === '#/bible/50/4' && prev.ch === 3 && prev.hash === '#/bible/50/3',
        extra: JSON.stringify({ next, prev }),
      };
    });

    // 6. 边界不动：腓 4 章（末章）再按右不加章
    await check('6. 末章边界不动', async () => {
      await page.evaluate(() => { location.hash = '#/bible/50/4'; });
      await sleep(1500);
      await page.keyboard.press('ArrowRight');
      await sleep(900);
      const r = await page.evaluate(() => ({ ch: state.currentChapter, hash: location.hash }));
      return { cond: r.ch === 4 && r.hash === '#/bible/50/4', extra: JSON.stringify(r) };
    });

    // 7. 弹窗开着时不切章
    await check('7. 弹窗开着不响应 ←/→', async () => {
      await page.evaluate(() => { location.hash = '#/bible/50/2'; });
      await sleep(1500);
      await page.evaluate(() => openPopup('测试', '内容'));
      await sleep(300);
      await page.keyboard.press('ArrowRight');
      await sleep(900);
      const r = await page.evaluate(() => ({ ch: state.currentChapter }));
      await page.evaluate(() => closePopupAll());
      return { cond: r.ch === 2, extra: JSON.stringify(r) };
    });

    // 8. 抽屉搜索框聚焦时 ←/→ 编辑光标，不切章
    await check('8. 输入焦点内不切章', async () => {
      await page.evaluate(() => { location.hash = '#/bible/50/2'; });
      await sleep(1400);
      await page.evaluate(() => {
        openNavDrawer();
        const si = document.getElementById('dwSearchInput');
        si.value = 'ab'; si.focus();
        si.setSelectionRange(1, 1);
      });
      await sleep(500);
      await page.keyboard.press('ArrowRight');
      await sleep(900);
      const r = await page.evaluate(() => ({ ch: state.currentChapter }));
      await page.evaluate(() => { document.getElementById('dwSearchCancel').click(); closeNavDrawer(); });
      return { cond: r.ch === 2, extra: JSON.stringify(r) };
    });

    // 9. 生命读经模块同样生效（←/→ 切篇）
    await check('9. 生命读经 ←/→ 切篇', async () => {
      await page.evaluate(() => { location.hash = '#/lr/50/17'; });
      await sleep(2500);
      await page.keyboard.press('ArrowRight');
      await sleep(1800);
      const r = await page.evaluate(() => ({ mod: state.activeModule, id: state.lrArticleId, hash: location.hash }));
      return { cond: r.mod === 'lifereading' && r.id === 18 && r.hash === '#/lr/50/18', extra: JSON.stringify(r) };
    });

    // 10. 听书模块不接管（播放器自己用 ←/→ 调 ±5 秒）
    await check('10. 听书模块不切讲次', async () => {
      await page.evaluate(() => { location.hash = '#/audio/niaokan/5'; });
      await sleep(2500);
      const before = await page.evaluate(() => ({ mod: state.activeModule, n: state.audioLecture }));
      await page.keyboard.press('ArrowRight');
      await sleep(1200);
      const after = await page.evaluate(() => ({ mod: state.activeModule, n: state.audioLecture }));
      return { cond: after.mod === 'audio' && after.n === before.n, extra: JSON.stringify({ before, after }) };
    });

    // 11. 移动端：长按同样可用（触摸事件）
    await check('11. 移动端长按（touchstart）', async () => {
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.evaluate(() => { location.hash = '#/bible/50/3'; });
      await sleep(2200);
      await page.evaluate(() => {
        const crumb = document.querySelector('.crumb');
        const r = crumb.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: crumb, clientX: r.left + 40, clientY: r.top + r.height / 2 });
        crumb.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t], changedTouches: [t] }));
      });
      await sleep(800);
      const r = await page.evaluate(() => ({
        shown: !document.querySelector('#popup').hidden,
        title: document.querySelector('#popupTitle')?.textContent,
        url: document.querySelector('.share-url')?.textContent || '',
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        svgW: Math.round((document.querySelector('.share-qr svg') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
      }));
      await page.evaluate(() => closePopupAll());
      return {
        cond: r.shown && r.title === '分享' && r.url.endsWith('#/bible/50/3') && !r.overflow && r.svgW > 100,
        extra: JSON.stringify(r),
      };
    });

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    server.kill();
  }
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
