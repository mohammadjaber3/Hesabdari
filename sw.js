// حساب‌داری فروشگاه صانع — Service Worker (نسخهٔ آفلاین‌-اول)
//
// اصل کار:
//  • فایل‌های خود برنامه (index/app/core/...) هنگام نصب «همه‌یا‌هیچ» در یک کشِ نسخه‌دار ذخیره می‌شوند و
//    از همان کش «فوراً» (بدون هیچ انتظاری برای شبکه) سرو می‌شوند. پس باز شدنِ برنامه نه به اینترنت وابسته است نه کند می‌شود.
//  • چون کش نسخه‌دار و اتمی است، هرگز ترکیبِ فایلِ قدیم + جدید (که ماژول‌ها را می‌شکند) پیش نمی‌آید.
//  • نسخهٔ جدید فقط با deploy می‌آید: BUILD_ID را GitHub Actions با شناسهٔ commit پر می‌کند (deploy.yml).
//    سرویس‌ورکر جدید در پس‌زمینه نصب می‌شود و دفعهٔ بعدی که برنامه باز شود فعال است.
//  • کتابخانه‌های بیرونی (Firebase SDK و ماژول‌های داخلی‌اش، Chart.js، XLSX، فونت) هم پیش‌کش می‌شوند؛
//    اگر نصب اول با اینترنت ضعیف ناقص ماند، هر بار که اینترنت وصل شد دوباره کامل می‌شود.
const BUILD_ID = '__BUILD_ID__';
const IS_DEV = BUILD_ID.indexOf('__') === 0;           // روی کامپیوتر خودتان (بدون deploy)
const CACHE_VERSION = 'hesabdari-' + (IS_DEV ? 'dev' : BUILD_ID);

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './core.js',
  './units.js',
  './ledger.js',
  './chart.js',
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

// آدرس کتابخانه‌های بیرونی از داخل خود فایل‌های برنامه خوانده می‌شود (نسخهٔ Firebase فقط در firebase-sdk.js نوشته می‌شود)
const URL_SOURCES = ['./firebase-sdk.js', './app.js', './styles.css'];
const EXTERNAL_URL_RE = /https:\/\/(?:www\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[A-Za-z0-9._\/@~%+-]+/g;
const CACHEABLE_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

/* ---------- نصب: فایل‌های برنامه همه‌یا‌هیچ ---------- */
async function cacheShell(cache) {
  await Promise.all(APP_SHELL.map(async (url) => {
    const res = await fetch(url, { cache: 'reload' });
    if (!res || res.status !== 200) throw new Error('shell fetch failed: ' + url);
    await cache.put(url, res);
  }));
}

/* ---------- کتابخانه‌های بیرونی: تلاشِ بهترین‌ممکن (شکستشان نصب را خراب نمی‌کند) ---------- */
async function discoverExternalUrls() {
  const found = new Set();
  await Promise.all(URL_SOURCES.map(async (src) => {
    try {
      const res = await fetch(src, { cache: 'no-cache' });
      if (!res || res.status !== 200) return;
      const text = await res.text();
      (text.match(EXTERNAL_URL_RE) || []).forEach((u) => found.add(u));
    } catch (e) { /* دفعهٔ بعد */ }
  }));
  return Array.from(found);
}

// اگر قبلاً در این کش یا کشِ نسخهٔ قبلی بود دوباره دانلود نمی‌کند (صرفه‌جویی در اینترنت ضعیف)
async function ensureCached(cache, url) {
  let res = await cache.match(url, { ignoreVary: true });
  if (res) return res;
  res = await caches.match(url, { ignoreVary: true });
  if (res) { await cache.put(url, res.clone()); return res; }
  try {
    const net = await fetch(url);
    if (!net || net.status !== 200) return null;
    await cache.put(url, net.clone());
    return net;
  } catch (e) { return null; }
}

const isJs = (u) => /\.m?js$/.test(u.split('?')[0]);

// ماژول‌های Firebase خودشان ماژول‌های دیگری import می‌کنند؛ همه را (تا عمق ۳) دنبال و کش می‌کنیم،
// وگرنه اگر فقط آدرس‌های firebase-sdk.js کش شود، آفلاین بالا آمدنِ برنامه ممکن است شکست بخورد.
async function precacheExternal(cache) {
  const missing = [];   // ماژول‌های Firebase که کش نشدند (بدون آن‌ها برنامه آفلاین بالا نمی‌آید)
  const seeds = await discoverExternalUrls();
  const seen = new Set(seeds);
  let frontier = seeds.slice();
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next = [];
    await Promise.all(frontier.map(async (url) => {
      const res = await ensureCached(cache, url);
      if (!res && url.indexOf('www.gstatic.com') >= 0) { missing.push(url); return; }
      if (!res || !isJs(url) || url.indexOf('www.gstatic.com') < 0) return;
      let text = '';
      try { text = await res.clone().text(); } catch (e) { return; }
      const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(text))) {
        let abs;
        try { abs = new URL(m[1], url); } catch (e) { continue; }
        if (!CACHEABLE_HOSTS.includes(abs.hostname) || !isJs(abs.href) || seen.has(abs.href)) continue;
        seen.add(abs.href); next.push(abs.href);
      }
    }));
    frontier = next;
  }
  return missing;
}

let _precaching = null;
function precacheExternalOnce() {
  if (!_precaching) {
    _precaching = caches.open(CACHE_VERSION).then(precacheExternal).catch(() => {}).finally(() => { _precaching = null; });
  }
  return _precaching;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cacheShell(cache);          // اگر حتی یک فایل برنامه نیاید، نصب رد می‌شود و نسخهٔ قبلی سالم می‌ماند
    // Firebase اجباری است: اگر کامل کش نشود، نصب رد می‌شود (نسخهٔ قبلی سالم می‌ماند و دفعهٔ بعد که اینترنت بود دوباره تلاش می‌شود)
    // وگرنه سرویس‌ورکر «نصب‌شده» ولی برنامه آفلاین بالا نمی‌آمد. Chart.js / xlsx / فونت همچنان «بهترین‌ممکن»اند.
    const missing = await precacheExternal(cache).catch(() => ['precache-error']);
    if (missing && missing.length) throw new Error('firebase modules not cached: ' + missing.join(', '));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// صفحه وقتی اینترنت وصل شد می‌گوید «کتابخانه‌های ناقص را کامل کن»
self.addEventListener('message', (event) => {
  if (event.data === 'precache') event.waitUntil(precacheExternalOnce());
});

/* ---------- سرو کردن ---------- */
async function cacheFirstShell(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const index = await cache.match('./index.html');
    if (index) return index;
  }
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('آفلاین', { status: 503, statusText: 'Offline' });
  }
}

// فقط برای توسعه روی کامپیوتر خودتان: اول شبکه تا تغییرات فوراً دیده شود
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); }
    return res;
  } catch (e) {
    const hit = await caches.match(req, { ignoreSearch: true });
    return hit || (req.mode === 'navigate' ? await caches.match('./index.html') : undefined) ||
      new Response('آفلاین', { status: 503, statusText: 'Offline' });
  }
}

// کتابخانه‌ها و فونت‌ها نسخهٔ ثابت در آدرس دارند، پس هرگز لازم نیست دوباره از شبکه تازه‌سازی شوند
async function cacheFirstExternal(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  const other = await caches.match(req.url, { ignoreVary: true });
  if (other) { cache.put(req.url, other.clone()); return other; }
  const res = await fetch(req);
  if (res && res.status === 200) cache.put(req.url, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(IS_DEV ? networkFirst(req) : cacheFirstShell(req));
    return;
  }
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirstExternal(req));
    return;
  }
  // ارتباط زندهٔ Firestore/Auth: دست نمی‌زنیم (خودشان آفلاین/آنلاین را مدیریت می‌کنند)
});
