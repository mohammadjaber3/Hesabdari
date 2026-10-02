// حساب‌داری فروشگاه صانع — Service Worker
//
// نسخه‌بندی (یک جای واحد):
//   BUILD_ID هنگام deploy توسط GitHub Actions به‌صورت خودکار با شناسهٔ commit
//   جایگزین می‌شود (فایل .github/workflows/deploy.yml). یعنی هر deploy جدید =
//   کش جدید، و کش قدیمی خودکار پاک می‌شود. دیگر لازم نیست عدد v10 یا CACHE_VERSION
//   را دستی عوض کنید. روی کامپیوتر خودتان (بدون deploy) نام کش «dev» می‌ماند.
const BUILD_ID = '__BUILD_ID__';
const CACHE_VERSION = 'hesabdari-' + (BUILD_ID.indexOf('__') === 0 ? 'dev' : BUILD_ID);

// فایل‌های خود سایت (همیشه باید برای بازکردن آفلاین موجود باشند)
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './core.js',
  './units.js',
  './ledger.js',
  './firebase-sdk.js',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// آدرس کتابخانه‌های بیرونی (Firebase، Chart.js، XLSX، فونت) دیگر اینجا دوباره نوشته نمی‌شوند؛
// موقع نصب از داخل همین فایل‌های برنامه خوانده می‌شوند، پس نسخهٔ Firebase فقط یک جا
// (firebase-sdk.js) نوشته می‌شود و همیشه با پیش‌کش یکی است.
const URL_SOURCES = ['./firebase-sdk.js', './app.js', './styles.css'];
const EXTERNAL_URL_RE = /https:\/\/(?:www\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[A-Za-z0-9._\/@~%+-]+/g;

// میزبان‌های بیرونی که اجازه داریم پاسخشان را کش کنیم (فقط کتابخانه‌های ثابت -
// نه Firestore/Auth که ارتباط زنده دارند و خودشان آفلاین/آنلاین را مدیریت می‌کنند)
const CACHEABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

// اگر شبکه بیشتر از این طول بکشد، برای فایل‌های خود برنامه از کش استفاده می‌کنیم (اینترنت ضعیف)
const NETWORK_TIMEOUT_MS = 4000;

async function discoverExternalUrls() {
  const found = new Set();
  await Promise.all(URL_SOURCES.map(async (src) => {
    try {
      const res = await fetch(src, { cache: 'no-cache' });
      if (!res || res.status !== 200) return;
      const text = await res.text();
      (text.match(EXTERNAL_URL_RE) || []).forEach((u) => found.add(u));
    } catch (e) { /* بعداً دوباره تلاش می‌شود */ }
  }));
  return Array.from(found);
}

// هر فایل را جدا کش می‌کنیم (نه با cache.addAll که اگر حتی یک فایل خطا بدهد، کل نصب
// سرویس‌ورکر شکست می‌خورد و هیچ‌چیز دیگری هم کش نمی‌شود)
async function cacheEachSafely(cache, urls) {
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res && res.status === 200) await cache.put(url, res);
    } catch (e) {
      // دفعهٔ بعد که اینترنت وصل بود دوباره تلاش می‌شود.
    }
  }));
}

async function precacheAll() {
  const cache = await caches.open(CACHE_VERSION);
  const external = await discoverExternalUrls();
  await cacheEachSafely(cache, [...APP_SHELL, ...external]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAll());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // هر کشی که مال این نسخه نیست پاک می‌شود (invalidate کش قدیمی بعد از deploy)
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => precacheAll())
  );
  self.clients.claim();
});

// فایل‌های خود برنامه: اول شبکه (تا بعد از deploy همیشه نسخهٔ تازه بیاید)،
// اگر اینترنت قطع یا خیلی کند بود، از کش (آفلاین کار می‌کند).
function networkFirst(req) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () => caches.match(req).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
    const timer = setTimeout(() => {
      fromCache().then((c) => { if (c && !settled) { settled = true; resolve(c); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then((c) => {
        if (!settled) { settled = true; resolve(c || new Response('آفلاین', { status: 503, statusText: 'Offline' })); }
      });
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // کتابخانه‌های ثابت بیرونی (Firebase SDK، Chart.js، XLSX، فونت):
  // کش کن تا آفلاین هم لود شوند، در پس‌زمینه هم تازه‌اش کن
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(req).then((cached) => {
          const networkFetch = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // بقیه (ارتباط زنده با Firestore/Auth گوگل): دست نمی‌زنیم
});
