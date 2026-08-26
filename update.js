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
  const APK_FILE = "bible-study-update.apk";

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

  /* 流式下载已废弃：WebView fetch 跨域下载 GitHub release 资产被 CORS 拦截
   * （release-assets.githubusercontent.com 无 Access-Control-Allow-Origin），
   * 手机上稳定复现 "Failed to fetch"。改用原生 HttpURLConnection 下载
   * （ApkInstallerPlugin.download，不受 CORS 限制），见下方 download()。 */

  /* 超时类错误 → 友好文案（用户可操作提示） */
  function friendlyError(err) {
    if (err && (err.name === "AbortError" || /timeout|timed ?out|超时/i.test(err.message || ""))) {
      return "下载超时，请检查网络后重试";
    }
    return null;
  }

  /* 依次尝试各下载源：原生下载，第一个成功即用（失败如超时/HTTP 错误 → 切下一个源）。
     每轮尝试前清理历史进度监听，结束时整体移除（不持有 handle，避免 addListener
     异步返回导致监听泄漏） */
  function downloadWithFallback(candidates, plugin) {
    let idx = 0;
    const resetListeners = () => {
      if (plugin.removeAllListeners) plugin.removeAllListeners();
      if (plugin.addListener) {
        plugin.addListener("progress", (e) => {
          if (_progressCb && e && typeof e.fraction === "number") _progressCb(e.fraction);
        });
      }
    };
    const finish = () => {
      if (plugin.removeAllListeners) plugin.removeAllListeners();
    };
    resetListeners();
    function next() {
      if (idx >= candidates.length) {
        finish();
        return Promise.reject(new Error("所有下载源均失败"));
      }
      const url = candidates[idx++];
      return plugin.download({ url }).then(
        (res) => {
          finish();
          return res;
        },
        (err) => next().catch(() => Promise.reject(err))
      );
    }
    return next();
  }

  /* 候选源：API 给的 downloadUrl 优先 + 镜像拼接；downloadUrl 通常就是
     github.com 直连地址，与 SOURCES 首个域名重复，按域名去重避免直连失败时白等两次 */
  function buildCandidates(latest) {
    const byHost = new Map();
    if (latest && latest.downloadUrl) {
      try { byHost.set(new URL(latest.downloadUrl).host, latest.downloadUrl); } catch (e) {}
    }
    SOURCES.forEach((s) => {
      const u = s + APK_PATH;
      try {
        const host = new URL(u).host;
        if (!byHost.has(host)) byHost.set(host, u);
      } catch (e) {}
    });
    return Array.from(byHost.values());
  }

  /* 原生下载 + 安装。onProgress(fraction 0..1)。返回 {ok, msg} */
  let _progressCb = null;
  function download(latest, onProgress) {
    const candidates = buildCandidates(latest);
    const plugin = Capacitor.Plugins.ApkInstaller;
    if (!isNative() || !plugin || !plugin.download) {
      return Promise.reject(new Error("当前环境不支持原生下载"));
    }
    _progressCb = onProgress || null;
    return downloadWithFallback(candidates, plugin)
      .then(({ uri }) => plugin.install({ filePath: uri }).then(
        (res) => ({ ok: true, msg: (res && res.message) || "安装程序已打开" }),
        (err) => ({ ok: false, msg: (err && err.message) || "打开安装程序失败", filePath: uri })
      ))
      .then((r) => {
        if (r.ok) cleanupOldApks();
        return r;
      })
      .finally(() => {
        _progressCb = null;
      })
      .catch((err) => ({ ok: false, msg: friendlyError(err) || (err && err.message ? err.message : "下载失败") }));
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

  window.BibleStudyUpdate = {
    check,
    download,
    cleanupOldApks,
    isNative,
    localVersion,
    compareVersion,
  };
})();
