/* update.js 下载与版本检查逻辑本地模拟测试：mock 原生插件和 fetch，
 * 验证原生下载 fallback、进度、listener 清理、APK 清理与 manifest 失败重试。
 * 用法：node scripts/update-logic-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  let failed = 0;
  const check = (name, ok, extra) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`);
    if (!ok) failed++;
  };

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const puppeteer = require('D:/AIWorkSpace/project/bible-reader/node_modules/puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: 'new',
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { window.BIBLE_SKIP_UPDATE = true; });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const source = fs.readFileSync(path.join(ROOT, 'update.js'), 'utf8');

    /* 场景 1：首源成功，进度透传，安装与监听清理完整 */
    const r1 = await page.evaluate(async ({ source }) => {
      const calls = [];
      const listeners = [];
      const fileNames = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          ApkInstaller: {
            download: ({ url, fileName }) => {
              calls.push('download:' + url.replace('https://', '').split('/')[0]);
              fileNames.push(fileName);
              if (url.startsWith('https://github.com')) {
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
            removeAllListeners: () => { calls.push('removeAllListeners'); listeners.length = 0; },
          },
        },
      };
      eval(source);
      const progress = [];
      const res = await window.BibleStudyUpdate.download(
        { downloadUrl: 'https://github.com/all-the-day/bible-study/releases/download/bible-study-main/bible-study.apk' },
        (f) => progress.push(f),
      );
      return { res, calls, progress, fileNames, listenerCount: listeners.length };
    }, { source });
    check('场景1 首源下载与安装成功', r1.res.ok === true
      && r1.calls.includes('install:/cache/downloads/test.apk'));
    check('场景1 进度事件完整透传', same(r1.progress, [0.5, 1]), r1.progress.join(', '));
    check('场景1 监听器已清理', r1.listenerCount === 0
      && r1.calls.filter((x) => x === 'removeAllListeners').length >= 2
      && r1.calls.lastIndexOf('removeAllListeners') < r1.calls.findIndex((x) => x.startsWith('install:')));
    check('场景1 无版本时沿用固定兜底文件名', same(r1.fileNames, ['bible-study-update.apk']));

    /* 场景 2：直连与镜像 1 失败，镜像 2 成功 */
    const r2 = await page.evaluate(async ({ source }) => {
      const calls = [];
      const listeners = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          ApkInstaller: {
            download: ({ url }) => {
              calls.push(url.replace('https://', '').split('/')[0]);
              if (url.startsWith('https://github.com')) return Promise.reject({ message: 'timeout' });
              if (url.startsWith('https://gh-proxy.com')) return Promise.reject({ message: 'HTTP 403' });
              return Promise.resolve({ uri: '/cache/downloads/test.apk' });
            },
            install: ({ filePath }) => { calls.push('install:' + filePath); return Promise.resolve({ message: 'ok' }); },
            addListener: (ev, cb) => { listeners.push({ ev, cb }); return Promise.resolve({ remove() {} }); },
            removeAllListeners: () => { calls.push('removeAllListeners'); listeners.length = 0; },
          },
        },
      };
      eval(source);
      const res = await window.BibleStudyUpdate.download({ downloadUrl: 'https://github.com/x/y.apk' });
      return { res, calls, listenerCount: listeners.length };
    }, { source });
    check('场景2 按直连、镜像1、镜像2顺序切换', same(r2.calls.filter((x) => !x.startsWith('install:') && x !== 'removeAllListeners'), [
      'github.com', 'gh-proxy.com', 'ghproxy.net',
    ]), r2.calls.join(' → '));
    check('场景2 镜像成功后只安装一次', r2.res.ok === true
      && r2.calls.filter((x) => x.startsWith('install:')).length === 1);
    check('场景2 完成后清理监听器', r2.listenerCount === 0
      && r2.calls.filter((x) => x === 'removeAllListeners').length >= 2
      && r2.calls.lastIndexOf('removeAllListeners') < r2.calls.findIndex((x) => x.startsWith('install:')));

    /* 场景 3：三个候选全部失败，保留首个超时错误且不安装 */
    const r3 = await page.evaluate(async ({ source }) => {
      const calls = [];
      const listeners = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          ApkInstaller: {
            download: () => { calls.push('download'); return Promise.reject({ message: 'timeout' }); },
            install: () => { calls.push('install'); return Promise.resolve({}); },
            addListener: (ev, cb) => { listeners.push({ ev, cb }); return Promise.resolve({ remove() {} }); },
            removeAllListeners: () => { calls.push('removeAllListeners'); listeners.length = 0; },
          },
        },
      };
      eval(source);
      const res = await window.BibleStudyUpdate.download({ downloadUrl: 'https://github.com/x/y.apk' });
      return { res, calls, listenerCount: listeners.length };
    }, { source });
    check('场景3 全部失败时恰好尝试三个候选', r3.calls.filter((x) => x === 'download').length === 3);
    check('场景3 全部失败返回超时且不安装', r3.res.ok === false
      && /下载超时/.test(r3.res.msg || '') && !r3.calls.includes('install'));
    check('场景3 失败后清理监听器', r3.listenerCount === 0
      && r3.calls[r3.calls.length - 1] === 'removeAllListeners');

    /* 场景 4：所有镜像候选与原生下载参数都保留版本化文件名 */
    const r4 = await page.evaluate(async ({ source }) => {
      const urls = [];
      const fileNames = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          ApkInstaller: {
            download: ({ url, fileName }) => {
              urls.push(url);
              fileNames.push(fileName);
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
        version: '1.0.26',
        downloadUrl: 'https://github.com/all-the-day/bible-study/releases/download/bible-study-main/bible-study-v1.0.26.apk',
      });
      return { urls, fileNames };
    }, { source });
    check('场景4 直连加两个镜像共三个候选', r4.urls.length === 3);
    check('场景4 所有候选 URL 带版本化文件名', r4.urls.every((u) => /bible-study-v1\.0\.26\.apk/.test(u)), JSON.stringify(r4.urls));
    check('场景4 原生下载参数带版本化文件名', same(r4.fileNames, Array(3).fill('bible-study-v1.0.26.apk')), JSON.stringify(r4.fileNames));

    /* 场景 5：只保留当前包；固定名作为历史包可删，作为当前兜底包时保留 */
    const r5 = await page.evaluate(async ({ source }) => {
      const reads = [];
      const deleted = [];
      const fileNames = [];
      const files = [
        { name: 'bible-study-v2.0.0.apk' },
        { name: 'bible-study-update.apk' },
        { name: 'bible-study-v1.0.0.apk' },
        { name: 'notes.txt' },
      ];
      window.Capacitor = {
        isNativePlatform: () => true,
        Filesystem: {
          readdir: ({ directory, path }) => {
            reads.push(directory + ':' + path);
            return Promise.resolve({ files });
          },
          deleteFile: ({ directory, path }) => {
            deleted.push(directory + ':' + path);
            return Promise.resolve();
          },
        },
        Plugins: {
          ApkInstaller: {
            download: ({ fileName }) => {
              fileNames.push(fileName);
              return Promise.resolve({ uri: '/cache/downloads/current.apk' });
            },
            install: () => Promise.resolve({ message: 'ok' }),
            addListener: () => Promise.resolve({ remove() {} }),
            removeAllListeners: () => {},
          },
        },
      };
      eval(source);
      const latest = {
        version: '2.0.0',
        downloadUrl: 'https://github.com/x/bible-study-v2.0.0.apk',
      };
      const res = await window.BibleStudyUpdate.download(latest);
      await new Promise((r) => setTimeout(r, 30));
      const versionedDeleted = deleted.slice();
      deleted.length = 0;
      await window.BibleStudyUpdate.download({ downloadUrl: 'https://github.com/x/bible-study-update.apk' });
      await new Promise((r) => setTimeout(r, 30));
      return { res, reads, deleted, versionedDeleted, fileNames };
    }, { source });
    check('场景5 CACHE 与 DATA 的 downloads 均检查', same(r5.reads.slice(0, 2), [
      'CACHE:downloads', 'DATA:downloads',
    ]));
    check('场景5 历史固定名与旧版本 APK 均删除', same(r5.versionedDeleted, [
      'CACHE:downloads/bible-study-update.apk',
      'CACHE:downloads/bible-study-v1.0.0.apk',
      'DATA:downloads/bible-study-update.apk',
      'DATA:downloads/bible-study-v1.0.0.apk',
    ]), r5.versionedDeleted.join(', '));
    check('场景5 当前版本包与非 APK 未删除', !r5.versionedDeleted.some((x) => /v2\.0\.0|notes\.txt/.test(x)));
    check('场景5 当前固定兜底包保留，其他 APK 仍清理', r5.deleted.length === 4
      && !r5.deleted.some((x) => x.endsWith('/bible-study-update.apk'))
      && r5.deleted.every((x) => /bible-study-v(?:1\.0\.0|2\.0\.0)\.apk$/.test(x)));

    /* 场景 6：manifest 失败不缓存占位版本，后续检查重试且同版本不误报 */
    const r6 = await page.evaluate(async ({ source }) => {
      let manifestAttempts = 0;
      let apiAttempts = 0;
      window.BIBLE_SKIP_UPDATE = false;
      window.fetch = (url) => {
        if (url === 'manifest.json') {
          manifestAttempts++;
          if (manifestAttempts === 1) return Promise.reject(new Error('temporary failure'));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: '1.0.64' }) });
        }
        if (url.includes('api.github.com')) {
          apiAttempts++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: '读经 v1.0.64 · 云同步版', tag_name: 'bible-study-main',
              body: '', html_url: '', assets: [],
            }),
          });
        }
        return Promise.reject(new Error('unexpected ' + url));
      };
      eval(source);
      const first = await window.BibleStudyUpdate.check();
      const second = await window.BibleStudyUpdate.check();
      const cached = await window.BibleStudyUpdate.localVersion();
      return { first, second, cached, manifestAttempts, apiAttempts };
    }, { source });
    check('场景6 manifest 首次失败时检查失败而非误报更新', r6.first === null);
    check('场景6 第二次重试成功且同版本不提示更新', !!r6.second
      && r6.second.current === '1.0.64' && r6.second.hasUpdate === false);
    check('场景6 有效版本只读取一次并缓存', r6.cached === '1.0.64'
      && r6.manifestAttempts === 2 && r6.apiAttempts === 2);

    console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
