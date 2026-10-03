/* =====================================================================
   core.js — منطق خالص (بدون صفحه، بدون Firebase) که می‌شود جدا تست کرد.
   هر چیزی که با پول، تاریخ، هزینهٔ تمام‌شده و امنیت PIN سروکار دارد اینجا
   یک منبع واحد دارد؛ app.js فقط از همین توابع استفاده می‌کند.
   ===================================================================== */

/* ---------- گرد کردن ---------- */
export function round2(n){ return Math.round((Number(n)||0)*100)/100; }
export function round4(n){ return Math.round((Number(n)||0)*10000)/10000; }
export function fmtQty(n){
  const r = Math.round((Number(n)||0)*1000)/1000;
  return Number.isInteger(r) ? r.toLocaleString('en-US') : String(r);
}
function num(n){ const x = Number(n); return Number.isFinite(x) ? x : 0; }

/* ---------- منطقهٔ زمانی کسب‌وکار ----------
   قبلاً todayISO() از UTC می‌خواند: در کابل (UTC+4:30) بین ۰۰:۰۰ تا ۰۴:۳۰ صبح
   تاریخ «دیروز» ثبت می‌شد. حالا همه‌چیز بر اساس منطقهٔ زمانی کسب‌وکار است. */
export const DEFAULT_TIMEZONE = 'Asia/Kabul';
let _tz = DEFAULT_TIMEZONE;

export function isValidTimezone(tz){
  try{ new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }catch(e){ return false; }
}
export function setBusinessTimezone(tz){
  _tz = (tz && isValidTimezone(tz)) ? tz : DEFAULT_TIMEZONE;
  return _tz;
}
export function getBusinessTimezone(){ return _tz; }

/* تاریخ «YYYY-MM-DD» یک لحظه در منطقهٔ زمانی کسب‌وکار */
export function isoDateInTz(date, tz){
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || _tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const get = (t)=> parts.find(p=>p.type===t).value;
  return get('year')+'-'+get('month')+'-'+get('day');
}
export function todayISO(now){ return isoDateInTz(now == null ? new Date() : now, _tz); }

/* حساب‌وکتاب تاریخ فقط با UTC انجام می‌شود تا هیچ‌وقت به منطقهٔ زمانی گوشی وابسته نباشد */
function parseISO(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));
  if(!m) return null;
  return { y:+m[1], mo:+m[2], d:+m[3] };
}
export function addDaysISO(iso, n){
  const p = parseISO(iso); if(!p) return iso;
  return new Date(Date.UTC(p.y, p.mo-1, p.d + n)).toISOString().slice(0,10);
}
/* 0=یکشنبه … 6=شنبه */
export function weekdayIndex(iso){
  const p = parseISO(iso); if(!p) return 0;
  return new Date(Date.UTC(p.y, p.mo-1, p.d)).getUTCDay();
}
export function daysBetweenISO(a, b){
  const pa = parseISO(a), pb = parseISO(b);
  if(!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y,pb.mo-1,pb.d) - Date.UTC(pa.y,pa.mo-1,pa.d))/86400000);
}
/* weekStartsOn: 0=یکشنبه (رفتار فعلی برنامه)، 6=شنبه */
export function startOfWeekISO(iso, weekStartsOn){
  const ws = (weekStartsOn===undefined || weekStartsOn===null) ? 0 : weekStartsOn;
  const diff = (weekdayIndex(iso) - ws + 7) % 7;
  return addDaysISO(iso, -diff);
}
export function startOfMonthISO(iso){ return String(iso).slice(0,7)+'-01'; }
const FA_DAYS = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
export function dateLabelFa(iso){ return FA_DAYS[weekdayIndex(iso)]+' '+iso; }

/* ---------- محاسبهٔ فاکتور (منبع واحد) ----------
   items: [{qty, returnedQty, unitPrice}] — همه به واحد پایه
   قانون: subtotal = مجموع اقلام (منهای مرجوعی)
          total     = subtotal − discount
          remaining = total − paid
   اگر paid از total بیشتر باشد: paid به total محدود می‌شود و مقدار اضافه در
   overpaid برمی‌گردد (تا برنامه آن را به‌عنوان اعتبار مشتری ثبت کند، نه اینکه گم شود). */
export function calcInvoice({ items, discount, paid, settled }){
  const subtotal = round2((items||[]).reduce((a,it)=>{
    const q = num(it.qty) - num(it.returnedQty);
    return a + (q>0 ? q : 0) * Math.max(0, num(it.unitPrice));
  }, 0));
  let disc = Math.max(0, num(discount));
  if(disc > subtotal) disc = subtotal;
  disc = round2(disc);
  const total = round2(subtotal - disc);
  // paid    = پولی که همان لحظهٔ فروش گرفته شد
  // settled = پرداخت‌های بعدیِ مشتری که مشخصاً به همین فاکتور تخصیص داده شده‌اند
  const p0 = Math.max(0, num(paid));
  const s0 = Math.max(0, num(settled));
  const received = p0 + s0;
  const overpaid = received > total ? round2(received - total) : 0;
  // اضافه‌پرداخت اول از «پرداخت لحظهٔ فروش» کم می‌شود، بعد از تخصیص‌ها
  let p = Math.max(0, p0 - overpaid);
  let st = s0 - Math.max(0, overpaid - p0);
  if(st < 0) st = 0;
  p = round2(p); st = round2(st);
  const remaining = round2(Math.max(0, total - p - st));
  let status = 'posted';
  if(total <= 0 || remaining <= 0.001) status = 'paid';
  else if(p + st > 0.001) status = 'partially_paid';
  return { subtotal, discount: disc, total, paid: p, settled: st, remaining, overpaid, status };
}

/* ---------- تغییر مجموع فاکتور بعد از ثبت (مرجوعی، کاستی، لغو) ----------
   پولی که مشتری تا الان داده: E = paid (نقد هنگام فروش) + settled (پرداخت‌های بعدیِ تخصیص‌یافته).
   اگر مجموع جدید از E کمتر شود، «اضافه» ابتدا از paid برمی‌گردد (استرداد نقد، مثل قبل)
   و بقیه از settled آزاد می‌شود و به اعتبار (پرداخت تخصیص‌نیافته) مشتری تبدیل می‌شود.
   customerDelta = تغییری که باید روی مانده مشتری اعمال شود. */
export function rebalanceAfterTotalChange({ total, paid, settled, newTotal }){
  const P = Math.max(0, num(paid)), S = Math.max(0, num(settled));
  const T = num(total), N = Math.max(0, num(newTotal));
  const E = P + S;
  const oldRemaining = Math.max(0, T - E);
  const newRemaining = Math.max(0, N - E);
  const excess = Math.max(0, E - N);
  const fromPaid = Math.min(P, excess);
  const fromSettled = Math.min(S, Math.max(0, excess - fromPaid));
  return {
    paid: round2(P - fromPaid),
    settled: round2(S - fromSettled),
    remaining: round2(newRemaining),
    cashRefund: round2(fromPaid),
    releasedSettled: round2(fromSettled),
    customerDelta: round2((newRemaining - oldRemaining) - fromSettled)
  };
}

/* ---------- هزینهٔ تمام‌شده (میانگین موزون) ----------
   قبلاً: (stock*avg + qty*cost)/newStock — وقتی موجودی منفی بود، عدد غیرواقعی می‌داد.
   مثال: موجودی −10 با میانگین 5، خرید 30 با قیمت 6 → فرمول قدیم 6.5 می‌داد (غلط)،
   ولی جنس واقعاً موجودِ انبار فقط 20 عدد است که همه با قیمت 6 خریده شده. */
export function nextAvgCost({ stockQty, avgCost, purchaseQty, unitCost }){
  const stock = num(stockQty), avg = num(avgCost), q = num(purchaseQty), c = num(unitCost);
  const newStock = stock + q;
  if(q <= 0) return { newStock, avgCost: round4(avg), coveredNegative: 0 };
  if(stock <= 0){
    // موجودی صفر یا منفی: هیچ ارزشی در انبار نیست؛ قیمت از خریدِ جدید شروع می‌شود
    return { newStock, avgCost: round4(c), coveredNegative: Math.min(q, -stock) };
  }
  return { newStock, avgCost: round4((stock*avg + q*c)/newStock), coveredNegative: 0 };
}

/* ---------- نرمال‌سازی نام (جستجو و تطبیق مشتری) ----------
   ی/ي، ک/ك، اعراب، نیم‌فاصله، فاصله‌های اضافه، ارقام فارسی/عربی.
   فقط برای تطبیق است؛ هیچ مشتری خودکار ادغام نمی‌شود. */
export function normalizeName(s){
  return String(s == null ? '' : s)
    .replace(/[\u064A\u0649\u06CC]/g, '\u06CC')
    .replace(/[\u0643\u06A9]/g, '\u06A9')
    .replace(/[\u06C0\u0629]/g, '\u0647')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200C\u200D\u200E\u200F]/g, ' ')
    .replace(/[\u06F0-\u06F9]/g, d=>String(d.charCodeAt(0)-0x06F0))
    .replace(/[\u0660-\u0669]/g, d=>String(d.charCodeAt(0)-0x0660))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* ---------- خطاهای ورود ---------- */
export function describeAuthError(err){
  const code = (err && err.code) || '';
  switch(code){
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { kind:'credentials', message:'ایمیل یا رمز عبور اشتباه است.' };
    case 'auth/invalid-email':
      return { kind:'credentials', message:'شکل ایمیل درست نیست.' };
    case 'auth/network-request-failed':
      return { kind:'network', message:'اینترنت قطع است یا ضعیف است؛ رمز شما اشتباه نیست. دوباره تلاش کنید.' };
    case 'auth/user-disabled':
      return { kind:'disabled', message:'این حساب غیرفعال شده است. با مالک تماس بگیرید.' };
    case 'auth/too-many-requests':
      return { kind:'throttled', message:'تلاش‌های ناموفق زیاد بود؛ چند دقیقه صبر کنید و دوباره امتحان کنید.' };
    case 'permission-denied':
    case 'firestore/permission-denied':
      return { kind:'permission', message:'اجازهٔ دسترسی ندارید.' };
    default:
      return { kind:'unknown', message:'ورود ناکام شد'+(code?(' ('+code+')'):'')+'؛ دوباره تلاش کنید.' };
  }
}

/* ---------- PIN ----------
   PIN فقط «قفل راحتی» است، نه احراز هویت اصلی (آن را Firebase Auth انجام می‌دهد).
   هش جدید: PBKDF2-SHA256 با salt تصادفی. هش قدیمیِ بدون salt (SHA-256 ساده) هنوز
   شناخته می‌شود تا کاربران قفل نشوند، و بعد از اولین ورود درست به هش جدید ارتقا می‌یابد. */
export const PIN_PBKDF2_ITER = 100000;

function toHex(buf){ return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function fromHex(hex){
  const out = new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++) out[i] = parseInt(hex.substr(i*2,2),16);
  return out;
}
export async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return toHex(buf);
}
export function newSaltHex(){
  const b = new Uint8Array(16); crypto.getRandomValues(b); return toHex(b);
}
export async function pbkdf2PinHash(pin, saltHex, iter){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', hash:'SHA-256', salt: fromHex(saltHex), iterations: iter||PIN_PBKDF2_ITER }, key, 256);
  return toHex(bits);
}
/* رکورد PIN جدید برای ذخیره در Firestore */
export async function makePinRecord(pin){
  const salt = newSaltHex();
  return { pinHash: await pbkdf2PinHash(pin, salt, PIN_PBKDF2_ITER), pinSalt: salt, pinAlgo:'pbkdf2-sha256', pinIter: PIN_PBKDF2_ITER };
}
/* بررسی PIN در برابر رکورد ذخیره‌شده. legacy=true یعنی رکورد قدیمی بود (باید ارتقا یابد). */
export async function verifyPin(pin, rec){
  if(!rec || !rec.pinHash) return { ok:false, legacy:false };
  if(rec.pinSalt){
    const h = await pbkdf2PinHash(pin, rec.pinSalt, rec.pinIter||PIN_PBKDF2_ITER);
    return { ok: h === rec.pinHash, legacy:false };
  }
  const h = await sha256Hex(pin);
  return { ok: h === rec.pinHash, legacy:true };
}

/* ---------- محدودیت تلاش PIN (ضد حدس‌زدن) ----------
   ۵ خطا → ۳۰ ثانیه قفل، ۶ → ۱ دقیقه، ۷ → ۵ دقیقه، ۸ → ۱۵ دقیقه، ۹ → ۳۰ دقیقه،
   ۱۰ خطای پیاپی → خروج اجباری از حساب (باید رمز ورود دوباره وارد شود). */
export const PIN_MAX_FAILS = 10;
const PIN_LOCK_STEPS_SEC = { 5:30, 6:60, 7:300, 8:900, 9:1800 };
export function pinLockDurationMs(fails){
  return (PIN_LOCK_STEPS_SEC[fails] || 0) * 1000;
}
export function pinStateAfterFailure(state, now){
  const fails = (state && state.fails || 0) + 1;
  const wait = pinLockDurationMs(fails);
  return { fails, lockedUntil: wait ? now + wait : 0, forceLogout: fails >= PIN_MAX_FAILS };
}
export function pinLockRemainingMs(state, now){
  const r = (state && state.lockedUntil || 0) - now;
  return r > 0 ? r : 0;
}
export function pinStateAfterSuccess(){ return { fails:0, lockedUntil:0 }; }

/* ---------- اعتبارسنجی فایل پشتیبان ---------- */
export const BACKUP_SCHEMA_VERSION = 2;
export const BACKUP_COLLECTIONS = ['products','customers','suppliers','sales','purchases','expenses','payments','openingEntries','returns'];

export function buildBackup({ businessId, state, now, appVersion }){
  const collections = {};
  BACKUP_COLLECTIONS.forEach(n=>{ collections[n] = Array.isArray(state[n]) ? state[n] : []; });
  return {
    version: appVersion || 'hesabdari',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date(now == null ? Date.now() : now).toISOString(),
    businessId: businessId || 'main',
    settings: state.settings || {},
    collections
  };
}

/* خروجی: { ok, errors[], warnings[], counts } — چیزی وارد نمی‌کند، فقط بررسی می‌کند */
export function validateBackup(b){
  const errors = [], warnings = [], counts = {};
  if(!b || typeof b !== 'object'){ return { ok:false, errors:['فایل پشتیبان خالی یا خراب است.'], warnings, counts }; }
  // فایل‌های قدیمی: کالکشن‌ها مستقیم روی خود شیء بودند (بدون schemaVersion)
  const legacy = b.schemaVersion === undefined;
  const cols = legacy ? b : b.collections;
  if(!legacy){
    if(typeof b.schemaVersion !== 'number') errors.push('schemaVersion نامعتبر است.');
    else if(b.schemaVersion > BACKUP_SCHEMA_VERSION) errors.push('این پشتیبان از نسخهٔ جدیدتری از برنامه است (schema '+b.schemaVersion+').');
    if(!b.exportedAt || isNaN(Date.parse(b.exportedAt))) warnings.push('تاریخ ساخت پشتیبان مشخص نیست.');
    if(!b.businessId) warnings.push('businessId در فایل نیست.');
    if(!cols || typeof cols !== 'object') errors.push('بخش collections وجود ندارد.');
  } else {
    warnings.push('پشتیبان قدیمی (بدون schemaVersion) است؛ فقط با بررسی دقیق وارد می‌شود.');
  }
  if(errors.length) return { ok:false, errors, warnings, counts };
  const required = { products:['id','name'], customers:['id','name'], suppliers:['id','name'],
    sales:['id','date','items','total'], purchases:['id','date','items','total'],
    expenses:['id','date','amount'], payments:['id','date','amount','partyId'], openingEntries:['id','partyId','amount'],
    returns:['id','originalSaleId','date','amount'] };
  BACKUP_COLLECTIONS.forEach(name=>{
    const arr = cols[name];
    if(arr === undefined){ counts[name] = 0; return; }
    if(!Array.isArray(arr)){ errors.push('«'+name+'» باید فهرست باشد.'); return; }
    counts[name] = arr.length;
    const seen = new Set();
    arr.forEach((r, i)=>{
      if(!r || typeof r !== 'object'){ errors.push(name+'['+i+'] رکورد نامعتبر است.'); return; }
      (required[name]||[]).forEach(f=>{
        if(r[f] === undefined || r[f] === null || r[f] === '') errors.push(name+'['+i+'] فیلد الزامی «'+f+'» ندارد.');
      });
      if(typeof r.id !== 'string' || !r.id || r.id.indexOf('/') >= 0) errors.push(name+'['+i+'] شناسهٔ نامعتبر.');
      else if(seen.has(r.id)) errors.push(name+' شناسهٔ تکراری: '+r.id);
      else seen.add(r.id);
      ['total','amount','stock','paid','remaining','balance'].forEach(f=>{
        if(r[f] !== undefined && r[f] !== null && !Number.isFinite(Number(r[f]))) errors.push(name+'['+i+'] مقدار عددیِ «'+f+'» نامعتبر است.');
      });
      if((name==='sales'||name==='purchases') && !Array.isArray(r.items)) errors.push(name+'['+i+'] اقلام (items) فهرست نیست.');
    });
  });
  return { ok: errors.length === 0, errors: errors.slice(0,50), warnings, counts };
}
