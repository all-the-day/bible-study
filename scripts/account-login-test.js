/* 账密登录端到端（2026-10-11）：启用同步弹窗双入口
   1. 错误密码 → 提示且不启用  2. 正确密码 → 启用（uid 写入 localStorage）
   依赖：本地 8745 起 bible-kv 服务器（账号 abu/duoban，启动幂等初始化），8765 站点 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const KV_PORT = 8745;
const SERVER = 'D:/coder/aiWorkSpace/server-ops/files/bible-reader/server.py';

async function main() {
  const kv = spawn('python', [SERVER, '--host', '127.0.0.1', '--port', String(KV_PORT),
    '--db', path.join(require('os').tmpdir(), 'bkv-login-test.db')],
    { env: { ...process.env, FEEDBACK_ADMIN_TOKEN: 'test-admin-token' }, stdio: 'ignore' });
  const site = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  let fail = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#homeGrid .home-block', { timeout: 15000 });

    // FEEDBACK_API 是编译期 const：运行时重定向 login 请求到本地 KV 服务器
    await page.evaluate((kvPort) => {
      const orig = window.fetch.bind(window);
      window.fetch = (url, opts) => {
        if (typeof url === 'string' && url.includes('duoban.xyz/bible-api/api/account/')) {
          return orig(url.replace('https://duoban.xyz/bible-api', 'http://127.0.0.1:' + kvPort), opts);
        }
        return orig(url, opts);
      };
    }, KV_PORT);
    await page.evaluate(() => openSyncModal());
    await page.waitForSelector('#syncLogin', { timeout: 5000 });

    // 1. 错误密码 → 提示且不启用
    await page.evaluate(() => { $('syncUser').value = 'abu'; $('syncPass').value = 'wrongpass'; });
    await page.click('#syncLogin');
    await new Promise((r) => setTimeout(r, 800));
    const r1 = await page.evaluate(() => ({ msg: $('fbMsg')?.textContent, enabled: syncActive() }));
    const ok1 = r1.msg === '账号名或密码不正确' && !r1.enabled;
    console.log('1. 错误密码:', ok1 ? '✓' : '✗', '|', r1.msg);
    if (!ok1) fail = 1;

    // 2. 正确密码 → 启用（uid=u1 落 localStorage）
    await page.evaluate(() => { $('syncPass').value = 'duoban'; });
    await page.click('#syncLogin');
    await new Promise((r) => setTimeout(r, 1500));
    const r2 = await page.evaluate(() => ({
      enabled: syncActive(),
      uid: state.account && state.account.uid,
      stored: !!localStorage.getItem('bible-study.account'),
    }));
    const ok2 = r2.enabled && r2.uid === 'u1' && r2.stored;
    console.log('2. 正确密码:', ok2 ? '✓' : '✗', '| uid:', r2.uid, '| localStorage:', r2.stored);
    if (!ok2) fail = 1;

    console.log('\nJS 错误:', errors.length ? errors : '无');
    if (errors.length) fail = 1;
  } finally {
    await browser.close();
    kv.kill(); site.kill();
  }
  process.exit(fail);
}
main().catch((e) => { console.error(e); process.exit(1); });
