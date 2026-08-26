/* 下载链路本地模拟测试：在真实浏览器（与 Capacitor WebView 同引擎 Chromium）里
 * 复现 update.js 的跨域下载逻辑，定位 APK 下载失败原因。
 * 用法：node scripts/download-sim-test.js
 * 需要：本机 Chrome + bible-reader 的 puppeteer-core（与其他 e2e 测试一致）
 */
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const APK_PATH = '/all-the-day/bible-study/releases/download/bible-study-main/bible-study.apk';
const SOURCES = ['https://github.com' + APK_PATH, 'https://gh-proxy.com' + APK_PATH, 'https://ghproxy.net' + APK_PATH];

async function main() {
  // 启动本地静态服务器（模拟 WebView origin）
  const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));

  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  console.log('=== 模拟 WebView 跨域下载（origin: http://localhost:' + PORT + '） ===\n');
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

  for (const url of SOURCES) {
    const label = url.replace(APK_PATH, '');
    const result = await page.evaluate(async (u) => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(u, { headers: { Accept: 'application/vnd.android.package-archive' }, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return { ok: false, phase: 'http', status: res.status };
        const reader = res.body.getReader();
        const first = await reader.read(); // 读首个 chunk 验证流是否通
        await reader.cancel();
        return { ok: true, phase: 'stream', bytes: first.value ? first.value.length : 0, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        return { ok: false, phase: 'fetch', error: e.name + ': ' + e.message, ms: Math.round(performance.now() - t0) };
      }
    }, url);

    if (result.ok) {
      console.log('  ✓ ' + label + '  → 下载流可读（首 chunk ' + result.bytes + 'B，' + result.ms + 'ms）');
    } else if (result.phase === 'http') {
      console.log('  ✗ ' + label + '  → HTTP ' + result.status);
    } else {
      console.log('  ✗ ' + label + '  → fetch 被拦截：' + result.error);
    }
  }

  console.log('\n=== api.github.com（检查更新走的 API） ===');
  const apiOk = await page.evaluate(async () => {
    try {
      const res = await fetch('https://api.github.com/repos/all-the-day/bible-study/releases/tags/bible-study-main', { headers: { Accept: 'application/json' } });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e.name + ': ' + e.message };
    }
  });
  console.log(apiOk.ok ? '  ✓ API 可访问（HTTP ' + apiOk.status + '）→ 说明「检查更新」能通，失败只在下载环节' : '  ✗ API 也被拦截：' + apiOk.error);

  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
