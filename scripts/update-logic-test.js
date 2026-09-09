/* update.js 下载逻辑本地模拟测试：mock 原生插件（ApkInstaller），
 * 在真实浏览器环境验证新的原生下载链路（fallback 切换、进度事件、listener 清理）。
 * 用法：node scripts/update-logic-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));

  const puppeteer = require('D:/coder/aiWorkSpace/bible-reader/node_modules/puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  console.log('=== update.js 原生下载逻辑模拟（mock ApkInstaller 插件） ===\n');
  await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });   // 跳过启动静默更新检查（省 GitHub API 配额）
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });

  const source = fs.readFileSync(path.join(ROOT, 'update.js'), 'utf8');

  /* 场景 1：首源成功（进度事件在下载过程中触发） */
  let r1 = await page.evaluate(async ({ source }) => {
    const calls = [];
    const listeners = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        ApkInstaller: {
          download: ({ url }) => {
            calls.push('download:' + url.replace('https://', '').split('/')[0]);
            if (url.startsWith('https://github.com')) {
              // 模拟下载过程:先注册的 progress listener 收到进度事件
              listeners.forEach((l) => l.ev === 'progress' && l.cb({ fraction: 0.5 }));
              return new Promise((resolve) => setTimeout(() => {
                listeners.forEach((l) => l.ev === 'progress' && l.cb({ fraction: 1 }));
                resolve({ uri: '/cache/downloads/test.apk' });
              }, 30));
            }
            return Promise.reject({ message: 'timeout' });
          },
          install: ({ filePath }) => { calls.push('install:' + filePath); return Promise.resolve({ message: 'ok' }); },
          addListener: (ev, cb) => { listeners.push({ ev, cb }); return Promise.resolve({ remove() {} }); },
          removeAllListeners: () => { calls.push('removeAllListeners'); },
        },
      },
    };
    eval(source);
    const progress = [];
    const res = await window.BibleStudyUpdate.download(
      { downloadUrl: 'https://github.com/all-the-day/bible-study/releases/download/bible-study-main/bible-study.apk' },
      (f) => progress.push(f)
    );
    await new Promise((r) => setTimeout(r, 50));
    return { res, calls, progress };
  }, { source });
  console.log('场景1 首源成功:', JSON.stringify(r1.res));
  console.log('  调用序列:', r1.calls.join(' → '));
  console.log('  进度事件转发:', r1.progress.join(', '), '(预期 0.5, 1)');

  /* 场景 2：首源失败 → 切镜像成功 */
  let r2 = await page.evaluate(async ({ source }) => {
    const calls = [];
    const listeners = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        ApkInstaller: {
          download: ({ url }) => {
            calls.push(url.replace('https://', '').split('/')[0]);
            if (url.startsWith('https://github.com')) return Promise.reject({ message: 'timeout' }); // 直连失败
            if (url.startsWith('https://gh-proxy.com')) return Promise.reject({ message: 'HTTP 403' }); // 镜像1失败
            return Promise.resolve({ uri: '/cache/downloads/test.apk' }); // 镜像2成功
          },
          install: ({ filePath }) => { calls.push('install:' + filePath); return Promise.resolve({ message: 'ok' }); },
          addListener: (ev, cb) => { listeners.push({ ev, cb }); return Promise.resolve({ remove() {} }); },
          removeAllListeners: () => { calls.push('removeAllListeners'); },
        },
      },
    };
    eval(source);
    const res = await window.BibleStudyUpdate.download({ downloadUrl: 'https://github.com/x/y.apk' });
    await new Promise((r) => setTimeout(r, 50));
    return { res, calls };
  }, { source });
  console.log('\n场景2 直连+镜像1失败→镜像2成功:', JSON.stringify(r2.res));
  console.log('  调用序列:', r2.calls.join(' → '), '(预期 github.com → gh-proxy.com → ghproxy.net → install → removeAllListeners)');

  /* 场景 3：全部失败 */
  let r3 = await page.evaluate(async ({ source }) => {
    const calls = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        ApkInstaller: {
          download: () => { calls.push('download'); return Promise.reject({ message: 'timeout' }); },
          install: () => Promise.resolve({}),
          addListener: () => Promise.resolve({ remove() {} }),
          removeAllListeners: () => { calls.push('removeAllListeners'); },
        },
      },
    };
    eval(source);
    const res = await window.BibleStudyUpdate.download({ downloadUrl: 'https://github.com/x/y.apk' });
    return { res, calls };
  }, { source });
  console.log('\n场景3 全部失败:', JSON.stringify(r3.res));
  console.log('  调用序列:', r3.calls.join(' → '), '(预期 4 次 download + 1 次 removeAllListeners)');
  console.log('  错误文案为超时提示(首个失败源错误):', /下载超时/.test(JSON.stringify(r3.res)));

  /* 场景 4：版本化资产名——镜像候选用同一 URL 换 host，文件名保持一致（防镜像按 URL 缓存串版） */
  let r4 = await page.evaluate(async ({ source }) => {
    const urls = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        ApkInstaller: {
          download: ({ url }) => {
            urls.push(url);
            // 前两源失败，逼出全部候选（最后一个成功）
            if (!url.startsWith('https://ghproxy.net')) return Promise.reject({ message: 'timeout' });
            return Promise.resolve({ uri: '/cache/t.apk' });
          },
          install: () => Promise.resolve({ message: 'ok' }),
          addListener: () => Promise.resolve({ remove() {} }),
          removeAllListeners: () => {},
        },
      },
    };
    eval(source);
    await window.BibleStudyUpdate.download({
      downloadUrl: 'https://github.com/all-the-day/bible-study/releases/download/bible-study-main/bible-study-v1.0.26.apk',
    });
    return urls;
  }, { source });
  console.log('\n场景4 版本化资产名:', JSON.stringify(r4, null, 1));
  const verName = /bible-study-v1\.0\.26\.apk/;
  console.log('  所有候选都带版本化文件名:', r4.every((u) => verName.test(u)), '| 候选数:', r4.length, '(预期 3：直连+两镜像)');

  await browser.close();
  server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
