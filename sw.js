// =============================================================
// Service Worker · 古韵抽卡 v3.2
//
// 缓存策略（按更新频率分层）：
//   - 导航(HTML) + JS 模块 → 网络优先：保证用户永远拿到最新代码，
//     离线时回退缓存。改过 CACHE_NAME 后旧缓存会在 activate 时清掉。
//   - 图标 / manifest / 本地诗词库 → 缓存优先：几乎不变，提速用。
//   - 诗泉 API → 网络优先 + 缓存兜底（离线可读到上一次结果）
//   - 图片 CDN(LoremFlickr/Picsum/Pollinations) → 不缓存（体积大、每次都变）
// =============================================================

const CACHE_NAME = 'poetry-cards-v3.5';  // v3.2.8 → v3.5:统计页加「收藏总数」第三卡
const PRECACHE = [
  // 页面骨架
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  // 应用代码
  './src/main.js',
  './src/images.js',
  './src/cards.js',
  './src/poems.local.json',
  // 请求治理（net 子模块）
  './src/net/api.js',
  './src/net/rate-limit.js',
  './src/net/circuit-breaker.js',
  // 图标
  './assets/icons/favicon.svg',
  './assets/icons/favicon.ico',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    throw new Error('offline');
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})   // 预缓存失败不阻塞安装
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 清掉所有旧版本缓存（改 CACHE_NAME 即自动生效）
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 诗泉 API：网络优先 + 缓存兜底
  if (url.origin === 'https://poetry.palemoky.com') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 图片 CDN：不缓存（体积大且每次不同）
  if (url.hostname.endsWith('loremflickr.com') || url.hostname.endsWith('picsum.photos')
      || url.hostname.endsWith('picsum.photos') || url.hostname.endsWith('fastly.picsum.photos')) {
    return;   // 交给浏览器默认处理
  }

  // 跨域资源：不拦截
  if (url.origin !== self.location.origin) return;

  // 本项目处于快速迭代期，代码/样式几乎每次发布都会变。
  // 因此**所有同源请求统一走网络优先**，离线时才回退缓存——
  // 宁可牺牲一点加载速度，也不能让用户看到上一版的 UI。
  // （等版本稳定后可再把图标/JSON 改回 cacheFirst）
  event.respondWith(networkFirst(request));
});
