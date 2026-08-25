/* ============================================================
 * update.js — App 内检查更新 + APK 下载安装
 * 版本真相源：GitHub Releases（滚动 tag bible-study-main）
 * 本地版本：manifest.json 的 version（CI 构建 APK 时用 package.json 重写）
 * 移植自晨读 app 更新逻辑（反编译分析，见 AGENTS.md「App 内更新」节）
 * ============================================================ */
(function () {
  "use strict";

  const REPO = "all-the-day/bible-study";
  const TAG = "bible-study-main";
  const API_URL = "https://api.github.com/repos/" + REPO + "/releases/tags/" + TAG;
  // APK 相对路径（GitHub 直连 + 各镜像前缀拼接）
  const APK_PATH = "/" + REPO + "/releases/download/" + TAG + "/bible-study.apk";
  // 下载源：直连 GitHub + 公共代理镜像（失败依次切换）
  const SOURCES = ["https://github.com", "https://gh-proxy.com", "https://ghproxy.net"];
  const CHECK_TIMEOUT = 10000;
  const CONNECT_TIMEOUT = 8000;   // 连接/首字节超时：超过则 abort 并切换下一个下载源
  const STALL_TIMEOUT = 15000;    // 读取停滞超时：超过 N 秒无任何数据则 abort 并切换下载源
  const APK_FILE = "bible-study-update.apk";
  const MIME_APK = "application/vnd.android.package-archive";

  function fetchJSON(url, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || CHECK_TIMEOUT);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then((r) => {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  }

  /* 版本号解析/比较：'v1.2.3' → '1.2.3'，逐位数值比较 */
  function parseVersion(str) {
    const m = String(str || "").match(/v?(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  }
  function compareVersion(a, b) {
    if (!a || !b) return null;
    const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  /* 本地版本：manifest.json（CI 在 www/ 里用 package.json 版本重写） */
  let _localVersion = null;
  function localVersion() {
    if (_localVersion) return Promise.resolve(_localVersion);
    return fetchJSON("manifest.json", 5000)
      .then((m) => (_localVersion = parseVersion(m.version) || "1.0.0"))
      .catch(() => (_localVersion = "1.0.0"));
  }

  /* 查最新 release：失败静默返回 null */
  function check() {
    return fetchJSON(API_URL)
      .then((release) => {
        const version = parseVersion(release.name) || parseVersion(release.tag_name);
        if (!version) return null;
        const asset = (release.assets || []).find((a) => /\.apk$/i.test(a.name || ""));
        return {
          version,
          name: release.name,
          body: release.body || "",
          html_url: release.html_url,
          downloadUrl: asset && asset.browser_download_url ? asset.browser_download_url : null,
        };
      })
      .then((latest) => {
        if (!latest) return null;
        return localVersion().then((current) => ({
          latest,
          current,
          hasUpdate: compareVersion(latest.version, current) === 1,
        }));
      })
      .catch(() => null);
  }

  /* 流式下载（fetch + reader），按 content-length 上报进度 fraction 0..1。
     连接与读取停滞均带超时：国内访问 GitHub 直连常「TCP 已连但数据 stalled」，
     无超时会让 fetch 永久挂起、镜像 fallback 永远等不到（曾致进度卡 0%） */
  function fetchBinary(url, onProgress) {
    const ctrl = new AbortController();
    const connTimer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT);
    return fetch(url, { headers: { Accept: MIME_APK }, signal: ctrl.signal }).then((r) => {
      if (!r.ok) throw new Error("http " + r.status);
      clearTimeout(connTimer);
      const total = parseInt(r.headers.get("content-length") || "0", 10) || 0;
      if (!r.body || !r.body.getReader) return r.blob();
      const reader = r.body.getReader();
      const chunks = [];
      let received = 0;
      let stallTimer = null;
      const resetStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ctrl.abort(), STALL_TIMEOUT);
      };
      resetStall();
      function pump() {
        return reader.read().then(({ done, value }) => {
          if (done) {
            clearTimeout(stallTimer);
            const blob = new Blob(chunks, { type: MIME_APK });
            if (onProgress) onProgress(1);
            return blob;
          }
          chunks.push(value);
          received += value.length;
          if (onProgress && total) onProgress(Math.min(received / total, 0.95));
          resetStall();
          return pump();
        });
      }
      return pump();
    });
  }

  /* 超时类错误 → 友好文案（用户可操作提示） */
  function friendlyError(err) {
    if (err && (err.name === "AbortError" || /timeout|timed ?out|超时/i.test(err.message || ""))) {
      return "下载超时，请检查网络后重试";
    }
    return null;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = () => reject(fr.error || new Error("读取文件失败"));
      fr.readAsDataURL(blob);
    });
  }

  /* 依次尝试各下载源，第一个成功即用 */
  function downloadWithFallback(candidates, onProgress) {
    let idx = 0;
    function next() {
      if (idx >= candidates.length) return Promise.reject(new Error("所有下载源均失败"));
      const url = candidates[idx++];
      return fetchBinary(url, onProgress)
        .then((blob) => ({ blob, url }))
        .catch((err) => next().catch(() => Promise.reject(err)));
    }
    return next();
  }

  /* 写入 Filesystem（CACHE → EXTERNAL → DATA 依次尝试），返回 uri */
  function saveApk(blob) {
    const dirs = [
      { directory: "CACHE", path: "downloads/" + APK_FILE },
      { directory: "EXTERNAL", path: "Download/" + APK_FILE },
      { directory: "DATA", path: "downloads/" + APK_FILE },
    ];
    return blobToBase64(blob).then((b64) => {
      function tryWrite(i) {
        if (i >= dirs.length) return Promise.reject(new Error("写入 APK 文件失败"));
        const d = dirs[i];
        return Capacitor.Filesystem.writeFile({ directory: d.directory, path: d.path, data: b64 })
          .then((res) => res.uri || (d.directory + "/" + d.path))
          .catch(() => tryWrite(i + 1));
      }
      return tryWrite(0);
    });
  }

  /* 清理历史 APK（不删当前要装的） */
  function cleanupOldApks() {
    if (!isNative() || !Capacitor.Filesystem) return;
    ["CACHE", "DATA"].forEach((directory) => {
      Capacitor.Filesystem.readdir({ directory, path: "downloads" })
        .then(({ files }) => {
          (files || []).forEach((f) => {
            if (f.name !== APK_FILE && /\.apk$/i.test(f.name || "")) {
              Capacitor.Filesystem.deleteFile({ directory, path: "downloads/" + f.name }).catch(() => {});
            }
          });
        })
        .catch(() => {});
    });
  }

  /* 原生下载 + 安装。onProgress(fraction 0..1)。返回 {ok, msg} */
  function download(latest, onProgress) {
    const candidates = [];
    if (latest && latest.downloadUrl) candidates.push(latest.downloadUrl);
    SOURCES.forEach((s) => candidates.push(s + APK_PATH));
    return downloadWithFallback(candidates, onProgress)
      .then(({ blob }) => saveApk(blob))
      .then((uri) =>
        Capacitor.Plugins.ApkInstaller.install({ filePath: uri }).then(
          (res) => ({ ok: true, msg: (res && res.message) || "安装程序已打开" }),
          (err) => ({ ok: false, msg: (err && err.message) || "打开安装程序失败", filePath: uri })
        )
      )
      .then((r) => {
        if (r.ok) cleanupOldApks();
        return r;
      })
      .catch((err) => ({ ok: false, msg: friendlyError(err) || (err && err.message ? err.message : "下载失败") }));
  }

  window.BibleStudyUpdate = {
    check,
    download,
    cleanupOldApks,
    isNative,
    localVersion,
    compareVersion,
  };
})();
