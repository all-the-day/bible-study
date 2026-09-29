const CACHE = 'bible-study-v8';
const DATA_CACHE = 'bible-study-data-v6';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/sync.js', '/update.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 跨域请求（duoban.xyz KV 同步 / GitHub API）不代理、不缓存：
  // 防标注/笔记数据残留 Cache Storage（共用设备隐私），也防离线时回退陈旧 KV
  if (url.origin !== self.location.origin) return;

  // 数据 JSON：stale-while-revalidate（先给缓存、后台静默更新）
  // 背景：站点部署在 Cloudflare Pages，大陆访问跨境链路慢，每次启动重下约 2.94MB(brotli) 数据要 8 秒左右；
  // 数据只在重跑 export 后才会变，故有缓存时立即返回缓存保证秒开，同时后台拉取最新并写回，下次访问生效。
  if (url.pathname.startsWith('/data/')) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(network);
        return cached;
      }
      return (await network) || Response.error();
    })());
    return;
  }

  // 核心文件：网络优先，失败才回退缓存（保证代码更新即时生效）
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || Response.error()))
  );
});
