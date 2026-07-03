// حساب‌داری پخش موتر — Service Worker
// هر بار که تغییری اساسی در فایل‌های اصلی دادید، این نسخه را عوض کنید تا گوشی‌ها نسخهٔ تازه بگیرند
const CACHE_VERSION = 'hesabdari-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
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

  // فایل‌های SDK فایربیس (gstatic.com): کش کن تا آفلاین هم لود شوند
  if (url.hostname === 'www.gstatic.com') {
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
