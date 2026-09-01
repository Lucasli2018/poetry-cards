const CACHE_NAME = 'poetry-cards-v2.2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/main.js',
  './src/api.js',
  './src/rate-limit.js',
  './src/circuit-breaker.js',
  './src/poems.local.json',
  './manifest.webmanifest'
];

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 诗泉 API：网络优先，离线时回缓存（兜底）
  if (url.origin === 'https://poetry.palemoky.com') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 导航请求（HTML）：网络优先，确保更新后用户拿到最新版
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(cacheFirst(request));
});
