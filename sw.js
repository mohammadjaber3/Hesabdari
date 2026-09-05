// حساب‌داری پخش موتر — Service Worker
// هر بار که تغییری اساسی در فایل‌های اصلی دادید، این نسخه را عوض کنید تا گوشی‌ها نسخهٔ تازه بگیرند
const CACHE_VERSION = 'hesabdari-v3';

// فایل‌های خود سایت (همیشه باید برای بازکردن آفلاین موجود باشند)
const APP_SHELL = [
  './',
  './index.html',
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
];

// کتابخانه‌های بیرونی که برنامه بدون آن‌ها اصلاً باز نمی‌شود یا بعضی بخش‌هایش کار نمی‌کند
// (قبلاً فقط فایل‌های gstatic.com پیش‌کش می‌شدند، ولی chart.js و xlsx.js از cdnjs.cloudflare.com
// هرگز کش نمی‌شدند — یعنی همیشه به اینترنت نیاز داشتند حتی برای همین فایل‌های ثابت)
const EXTERNAL_SHELL = [
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// میزبان‌های بیرونی که اجازه داریم پاسخشان را کش کنیم (فقط کتابخانه‌های ثابت -
// نه Firestore/Auth که ارتباط زنده دارند و خودشان آفلاین/آنلاین را مدیریت می‌کنند)
const CACHEABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com'];

// هر فایل را جدا کش می‌کنیم (نه با cache.addAll که اگر حتی یک فایل خطا بدهد، کل نصب
// سرویس‌ورکر شکست می‌خورد و هیچ‌چیز دیگری هم کش نمی‌شود — یعنی برنامه هرگز آفلاین کار نمی‌کرد)
async function cacheEachSafely(cache, urls) {
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res && res.status === 200) await cache.put(url, res);
    } catch (e) {
      // اگر یکی از فایل‌ها الان قابل دریافت نبود، بقیهٔ نصب را خراب نمی‌کنیم؛
      // دفعهٔ بعد که اینترنت وصل بود دوباره تلاش می‌شود.
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cacheEachSafely(cache, [...APP_SHELL, ...EXTERNAL_SHELL]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => {
      // بعد از فعال شدن نسخهٔ جدید، دوباره تلاش می‌کنیم هر چیزی که دفعهٔ نصب کم آمده بود
      // (مثلاً به‌خاطر قطعی موقت اینترنت) را کامل کنیم.
      return caches.open(CACHE_VERSION).then((cache) => cacheEachSafely(cache, [...APP_SHELL, ...EXTERNAL_SHELL]));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // فایل‌های خود برنامه (همین سایت): کش را فوری نشان بده، در پس‌زمینه تازه‌اش کن
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // کتابخانه‌های ثابت بیرونی (Firebase SDK از gstatic.com، Chart.js و XLSX از cdnjs):
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
  // خود Firebase SDK آفلاین/آنلاین‌بودن را داخلی مدیریت می‌کند و بعد از وصل‌شدن اینترنت خودکار سینک می‌کند
});
