/* ---------- Firebase ----------
   نسخهٔ پایدار برای مرورگر: از import استاتیک استفاده می‌کنیم تا
   parser مرورگر مجبور به پردازش dynamic import + top-level await نباشد.
   Firebase مستندات رسمی استفاده از browser ESM را با gstatic ارائه می‌کند.
*/
import {
  initializeApp,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocFromCache, getDocs, setDoc as _setDoc, updateDoc as _updateDoc, deleteDoc as _deleteDoc, onSnapshot,
  collection, writeBatch as _writeBatch, increment as _increment, runTransaction
} from "./firebase-sdk.js";
import {
  round2, round4, fmtQty, todayISO, addDaysISO, daysBetweenISO, startOfWeekISO, startOfMonthISO, dateLabelFa,
  setBusinessTimezone, calcInvoice, rebalanceAfterTotalChange, calculateReturnRefund, nextAvgCost, describeAuthError,
  makePinRecord, verifyPin, pinStateAfterFailure, pinStateAfterSuccess, pinLockRemainingMs,
  buildBackup, validateBackup, normalizeName, costPerBase, previousRange, changePercent
} from "./core.js";
import {
  normalizeProductUnitsRecord, productUnits as _productUnits, saleUnits as _saleUnits,
  transactionUnits as _transactionUnits, unitByName as _unitByName, unitSellPrice as _unitSellPrice,
  qtyBreakdown as _qtyBreakdown, isBaseTradable as _isBaseTradable, baseLabel as _baseLabel,
  buildPackaging as _buildPackaging
} from "./units.js";
import {
  buildMovement, isNonCashExpense, cashExpensesTotal, buildPaymentReversal, allocatePayment,
  reconcileCustomers, reconcileSuppliers, reconcileStock, reconcileInvoices, negativeStockProducts,
  buildAuditEntry, summarizeDoc, WASTE_CATEGORY, WITHDRAWAL_CATEGORY, DEFAULT_WAREHOUSE,
  buildReturnEvent, salesSummary, reconcileReturns, saleReturnedAmount,
  productProfitSummary, debtAging, AGING_BUCKETS, trendBuckets
} from "./ledger.js";
import { buildTrendChart } from "./chart.js";
import { XLSX_JS_URL, compressImageForStorage, dateLabel, escapeHtml, fmt, fmt2, getDeviceId, getDeviceLabel, ic, immutableInvoiceNo, loadExternalScript, sanitizeDoc, setDeviceLabel, sum, uid } from './helpers.js';
import { viewMethods, bindViews } from './views.js';

/* ---------- سیاست دسترسی نقش «شریک» (راننده) ----------
   دیوارِ اصلی firestore.rules است؛ این‌جا همان قانون‌ها یک بار هم در خود برنامه چک می‌شود
   تا کاربر به‌جای خطای انگلیسیِ نامفهومِ سرور، پیام فارسیِ روشن ببیند.
   شریک «همه‌چیز را می‌بیند» و کارهای روزانه را ثبت می‌کند، ولی:
     • محصول/موجودی: دیدن؛ تغییر فقط از مسیر فروش و ثبت بل خرید (ویرایش دستی و قیمت‌ها بسته است)
     • پرداخت/دریافت: فقط «ثبت جدید»؛ ویرایش یا حذف ندارد (فقط یک بار می‌تواند عکس رسید اضافه کند)
     • مصارف: فقط ثبت جدید؛ حذف/ویرایش ندارد
     • هیچ حذفی، هیچ مرجوعی/ابطال/ویرایش فاکتور، هیچ خرید جدید و هیچ تنظیماتی ندارد
   اگر سیاست عوض شد، فقط همین جدول و بخش partner در firestore.rules را عوض کنید. */
const PARTNER_CAN_CREATE = ['sales','customers','payments','expenses','suppliers','purchases','products','stockLedger','auditLog'];
const PARTNER_CAN_UPDATE = {
  sales:['settled','remaining'],            // تسویهٔ فاکتور هنگام دریافت پول
  customers:['balance','phone','address'],  // مانده و اطلاعات تماس
  suppliers:['balance','balanceUSD'],       // مانده هنگام پرداخت به عمده‌فروش
  purchases:['paid','remaining'],           // تسویهٔ بل هنگام پرداخت
  products:['stock','avgCost','sellPrice'], // موجودی (فروش/خرید)، میانگین بهای خرید، و قیمت فروشِ «اولیه» فقط وقتی هنوز خالی است
  payments:['receiptImage'],                // فقط افزودن عکس رسید (نه عوض‌کردنش)
};
const _PARTNER_META_KEYS = ['lastEditedByEmail','lastEditedByDevice','lastEditedTs','createdByEmail','createdByDevice'];
const PARTNER_DENIED_MSG = 'حساب شما «شریک» است: این کار (تغییر مهم یا حذف) برای شما مجاز نیست.';
function _partnerCheck(op, ref, data){
  let role=null;
  try{ role = App && App.role; }catch(e){ role=null; }
  if(role!=='partner') return null;
  const col = (ref && ref.parent && ref.parent.id) || '';
  if(op==='delete') return PARTNER_DENIED_MSG;
  if(op==='create'){
    if(PARTNER_CAN_CREATE.indexOf(col)<0) return PARTNER_DENIED_MSG;
    if(col==='payments' && !(Number(data&&data.amount)>0 && !(data&&data.reversalOf))) return PARTNER_DENIED_MSG;
    if(col==='expenses' && !(Number(data&&data.amount)>0)) return PARTNER_DENIED_MSG;
    return null;
  }
  // update
  const allowed = PARTNER_CAN_UPDATE[col];
  if(!allowed) return PARTNER_DENIED_MSG;
  const keys = Object.keys(data||{}).filter(k=>_PARTNER_META_KEYS.indexOf(k)<0);
  if(keys.some(k=>allowed.indexOf(k)<0)) return PARTNER_DENIED_MSG;
  if(col==='products' && keys.indexOf('sellPrice')>=0){
    const op=((App.state&&App.state.products)||[]).find(x=>x.id===ref.id);
    if(op && Number(op.sellPrice)>0) return PARTNER_DENIED_MSG;   // قیمت فروشِ تعیین‌شده را شریک عوض نمی‌کند
  }
  if(col==='payments'){
    const old=((App.state&&App.state.payments)||[]).find(x=>x.id===ref.id);
    if(!old || old.receiptImage) return PARTNER_DENIED_MSG;   // عوض‌کردن رسید یعنی ویرایش پرداخت
  }
  return null;
}
function _assertCanWrite(op, ref, data){
  const m=_partnerCheck(op, ref, data);
  if(m) throw new Error(m);
}
/* increment() که مقدارش را هم روی خودش نگه می‌دارد تا لایهٔ Stock Ledger بتواند
   «چقدر کم/زیاد شد» را بخواند (SDK خودش این عدد را نمایش نمی‌دهد). */
function increment(n){ const v=_increment(n); try{ v.__delta=n; }catch(e){} return v; }
/* نوشتنِ «اول محلی»: promiseِ setDoc/updateDoc/deleteDoc در Firestore فقط بعد از تأیید «سرور» تمام می‌شود و
   آفلاین هرگز تمام نمی‌شود. تغییر همان لحظه در حافظهٔ گوشی (IndexedDB) اعمال و در صف ارسال می‌ماند، پس برای
   کاربر منتظر سرور نمی‌مانیم (وگرنه فرم باز می‌ماند، پیام «ذخیره شد» نمی‌آید و کاربر دوباره می‌زند و رکورد تکراری می‌شود).
   اگر سرور بعداً رد کرد، همان‌جا خطا نشان داده می‌شود. */
function _localFirst(p){
  Promise.resolve(p).then(()=>{ try{ App._recomputeSyncState(); }catch(e){} }, (err)=>{
    console.error('write rejected by server', err);
    try{
      App._markWriteResult(false, err);
      App.toastError('سرور این تغییر را قبول نکرد و برگشت داده شد: '+((err&&err.message)||''));
    }catch(e){}
  });
  return Promise.resolve();
}
const setDocRaw = (...a)=> _localFirst(_setDoc(...a));
function setDoc(...a){ _assertCanWrite('create', a[0], a[1]); return _localFirst(_setDoc(...a)); }
function updateDoc(...a){ _assertCanWrite('update', a[0], a[1]); return _localFirst(_updateDoc(...a)); }
function deleteDoc(...a){ _assertCanWrite('delete', a[0]); return _localFirst(_deleteDoc(...a)); }
/* خواندنِ سریع: اول از حافظهٔ گوشی (فوری، بدون شبکه)؛ فقط اگر آنجا نبود از سرور.
   getDoc معمولی در اینترنتِ ضعیف تا ~۱۰ ثانیه منتظر سرور می‌ماند. */
async function getDocQuick(ref){
  try{ const c = await getDocFromCache(ref); if(c.exists()) return c; }catch(e){}
  return getDoc(ref);
}

// navigator.onLine فقط اتصال Wi-Fi/LAN را می‌سنجد، نه دسترسی واقعی به اینترنت.
// در خطاهای شبکه، اجازه می‌دهیم Firestore یک batch را در IndexedDB صف کند.
function isConnectivityError(err){
  const code=String((err&&err.code)||'').toLowerCase();
  const msg=String((err&&err.message)||'').toLowerCase();
  return ['unavailable','deadline-exceeded','network-request-failed','webchannel-errored','cancelled'].some(x=>code.includes(x)||msg.includes(x))
    || /offline|network|internet|timed out|timeout|fetch failed|webchannel/.test(msg);
}
/* هر batch که موجودی کالا را عوض کند، در همان batch (اتمی) یک رویداد Stock Ledger هم می‌نویسد.
   نوع حرکت (SALE/PURCHASE/...) را کد عملیات قبل از ساخت batch با App._mv(...) مشخص می‌کند. */
function writeBatch(d, opts){
  const b=_writeBatch(d);
  const commit=b.commit.bind(b), _set=b.set.bind(b), _update=b.update.bind(b), _delete=b.delete.bind(b);
  let denied=null;   // اولین نقضِ سیاست دسترسی؛ هنگام commit رد می‌شود (نه وسط ساختن batch)
  const noLedger = !!(opts && opts.noLedger);
  let ctx=null;
  try{ if(App){ ctx=App._mvCtx||null; App._mvCtx=null; } }catch(e){ ctx=null; }
  const pending=[]; let refType='', refId='';
  const noteRef=(ref)=>{
    const m=/\/(sales|purchases)\/([^\/]+)$/.exec((ref&&ref.path)||'');
    if(m && !refId){ refType = m[1]==='sales' ? 'sale' : 'purchase'; refId = m[2]; }
  };
  const prodId=(ref)=>{ const m=/\/products\/([^\/]+)$/.exec((ref&&ref.path)||''); return m?m[1]:null; };
  b.delete=function(ref,...rest){
    denied = denied || _partnerCheck('delete', ref);
    return _delete(ref,...rest);
  };
  b.update=function(ref,data,...rest){
    denied = denied || _partnerCheck('update', ref, data);
    noteRef(ref);
    const pid=prodId(ref);
    if(!noLedger && pid && data && data.stock && typeof data.stock.__delta==='number' && data.stock.__delta!==0){
      pending.push({ pid, delta:data.stock.__delta, cost: (typeof data.avgCost==='number') ? data.avgCost : undefined });
    }
    return _update(ref,data,...rest);
  };
  b.set=function(ref,data,...rest){
    denied = denied || _partnerCheck('create', ref, data);
    noteRef(ref);
    const pid=prodId(ref);
    if(!noLedger && pid && data && typeof data.stock==='number' && data.stock!==0){
      pending.push({ pid, delta:data.stock, cost:data.avgCost, created:true });
    }
    return _set(ref,data,...rest);
  };
  b.commit=function(){
    if(denied) return Promise.reject(new Error(denied));
    try{
      const running={};
      pending.forEach(mv=>{
        const p=(App.state.products||[]).find(x=>x.id===mv.pid);
        const before = (mv.pid in running) ? running[mv.pid] : (mv.created ? 0 : (p ? (Number(p.stock)||0) : 0));
        running[mv.pid] = before + mv.delta;
        const type = (ctx && ctx.type) || (mv.created ? 'OPENING' : 'ADJUSTMENT');
        const id = uid();
        const cost = (typeof mv.cost==='number') ? mv.cost : (p ? (Number(p.avgCost)||0) : 0);
        const m = buildMovement({ id, ts:Date.now(), date:todayISO(), productId:mv.pid, warehouseId:DEFAULT_WAREHOUSE,
          type, quantityBase:mv.delta, unit:'عدد', unitCost:cost, userId:(App.user&&App.user.email)||'',
          referenceType:(ctx&&ctx.refType)||refType||'manual', referenceId:(ctx&&ctx.refId)||refId||'',
          reason:(ctx&&ctx.reason)||'', stockBefore:before });
        _set(doc(cols.stockLedger, id), m);
      });
    }catch(e){ console.warn('stock ledger build failed', e); }
    /* Firestore: promiseِ commit() فقط بعد از تأیید «سرور» تمام می‌شود؛ آفلاین هرگز تمام نمی‌شود.
       تغییر همان لحظه روی گوشی (IndexedDB) اعمال می‌شود و در صف ارسال می‌ماند. پس برای کاربر
       منتظر تأیید سرور نمی‌مانیم؛ اگر بعداً سرور آن را رد کرد، خطا نشان داده می‌شود. */
    if(noLedger) return commit(); // عملیات سنگین مدیریتی (بازیابی/پاک‌سازی) همان رفتار قبلی
    let real;
    try{ real = commit(); }catch(e){ return Promise.reject(e); }
    Promise.resolve(real).then(()=>{
      try{ App._recomputeSyncState(); }catch(e){}
    }, (err)=>{
      console.error('batch rejected by server', err);
      try{
        App._markWriteResult(false, err);
        App.toastError('سرور این تغییر را قبول نکرد و برگشت داده شد: '+((err&&err.message)||''));
      }catch(e){}
    });
    return Promise.resolve();
  };
  return b;
}

const firebaseConfig = {
  apiKey: "AIzaSyC1ro1e1rwR7dB9gHGWQkwq2G2r1ZolLGs",
  authDomain: "motar-pakhsh.firebaseapp.com",
  projectId: "motar-pakhsh",
  storageBucket: "motar-pakhsh.firebasestorage.app",
  messagingSenderId: "220111355867",
  appId: "1:220111355867:web:22fe8b83980f82f2cb71fe"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try{
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}catch(e){
  console.warn('Persistent Firestore cache unavailable; using normal Firestore:', e);
  db = getFirestore(fbApp);
}
setPersistence(auth, browserLocalPersistence).catch(()=>{});

const BIZ_ID = 'main';
/* هر نوع رکورد حالا کالکشن جدای خودش را دارد — دیگر یک سند مشترک بزرگ نیست.
   یعنی ویرایش یک فاکتور، رکورد فاکتور دیگری را از دست نمی‌برد. */
const COLLECTIONS = ['products','customers','suppliers','sales','purchases','expenses','payments','openingEntries','returns'];
const cols = {};
COLLECTIONS.forEach(name => { cols[name] = collection(db, 'businesses', BIZ_ID, name); });
/* کالکشن‌های «فقط‌افزودنی» — با listener زنده بارگذاری نمی‌شوند (حجمشان زیاد می‌شود)،
   فقط هنگام نیاز (گزارش/تطبیق) با query خوانده می‌شوند. */
const LEDGER_COLLECTIONS = ['stockLedger','auditLog'];
LEDGER_COLLECTIONS.forEach(name => { cols[name] = collection(db, 'businesses', BIZ_ID, name); });
const settingsDocRef   = doc(db, 'businesses', BIZ_ID, 'meta', 'settings');
const migratedFlagRef  = doc(db, 'businesses', BIZ_ID, 'meta', 'migratedV2');
const oldStateDocRef   = doc(db, 'businesses', BIZ_ID, 'data', 'state'); // ساختار قدیمی (فقط برای مهاجرت یک‌باره)
const teamDocRef       = (uid_) => doc(db, 'businesses', BIZ_ID, 'team', uid_);
/* PIN شخصی هر کاربر: سند نقش (team) از سمت کلاینت قابل نوشتن نیست (و نباید باشد)،
   پس هَشِ PIN در کالکشن جدا ذخیره می‌شود که هر کس فقط سند خودش را می‌نویسد.
   قبلاً PIN داخل همان سند team ذخیره می‌شد و همیشه بی‌صدا ناکام می‌ماند. */
const pinDocRef = (uid_) => doc(db, 'businesses', BIZ_ID, 'pins', uid_);

/* ---------- Helpers ---------- */



/* ---------- شناسهٔ دستگاه (گوشی) ----------
   هر گوشی/مرورگر یک شناسهٔ ثابت محلی می‌گیرد که در تمام رکوردهای ثبت‌شده از همان گوشی ذخیره می‌شود.
   کاربر می‌تواند یک نام دلخواه (مثلاً «گوشی احمد») هم برای این دستگاه در تنظیمات بگذارد. */




// برای مبالغ دالری/سنتی و نرخ دالر — هیچ‌وقت گرد نمی‌شود، همیشه با اعشار (سنت) نشان داده می‌شود.

/* ---------- واحدهای تو در تو (کارتن ← قوطی/بسته ← عدد داخلی) ----------
   مدل داده (سازگار با نسخهٔ قبلی، هیچ مهاجرتی لازم نیست):
     unit        = واحد پایه. معمولاً «عدد» (داخلی، فقط برای محاسبات)؛ ولی اگر baseTradable=true باشد
                   خودِ آن (مثلاً «کارتن» یا «قوطی») واحد خرید/فروش است و عدد داخلی وجود ندارد
     baseTradable= true یعنی محصول عدد داخلی ندارد (تک‌واحدی، یا کارتن←قوطی بدون عدد)
     stock       = موجودی، همیشه به واحد پایه
     avgCost     = قیمت تمام‌شدهٔ یک واحد پایه
     sellPrice   = قیمت فروش یک واحد پایه
     midUnit/midPer   = واحد میانی (قوطی/بسته) و اینکه هر کدام چند واحد پایه دارد
     packUnit/packSize= واحد بزرگ (کارتن) و اینکه هر کارتن جمعاً چند واحد پایه دارد
     sellPriceMid / sellPricePack = قیمت فروش دستیِ آن واحد (خالی = خودکار از قیمت پایه)
     defaultSaleUnit  = واحدی که در فرم فروش پیش‌فرض انتخاب می‌شود
   اقلام فاکتور (sales/purchases items) هم فقط دو فیلد نمایشی اضافه گرفته‌اند:
     txUnit  = نام واحدی که واقعاً با آن معامله شد
     txFactor= چند واحد پایه در آن واحد است
   مقدار qty و unitPrice/unitCost همیشه به واحد پایه ذخیره می‌شوند تا همهٔ
   محاسبات قبلی (سود، مرجوعی، کنسل، موجودی) بدون تغییر و درست بمانند. */
/* قیمت تمام‌شدهٔ واحد پایه هرگز نباید گرد شود: یک کارتن ۱۶۰۰ افغانی با ۱۴۴ عدد
   می‌شود ۱۱.۱۱۱۱ — اگر ۱۱.۱۱ ذخیره شود، ارزش انبار و سود به‌مرور جابه‌جا می‌شود. */

/* دفاع لایهٔ دوم در برابر XSS ذخیره‌شده: هر سندی که از Firestore می‌رسد قبل از ورود به state پاک‌سازی می‌شود.
   شناسه‌ها فقط نویسه‌های امن، تاریخ‌ها فقط ارقام و جداکننده، و عکس‌ها فقط data:image معتبر می‌مانند؛
   پس حتی اگر سندِ مخرب در دیتابیس باشد، هیچ‌وقت داخل onclick/src/قالب‌ها اجرا نمی‌شود. */




/* ---------- فشرده‌سازی عکس (بل شرکت / رسید پرداخت) ----------
   عکس‌ها به‌صورت JPEG فشرده و base64 مستقیم داخل سند Firestore ذخیره می‌شوند
   (نه Firebase Storage) تا کاملاً با ذخیره‌سازی آفلاین فایراستور سازگار بمانند
   و بدون اتصال اینترنت هم ثبت و بعداً خودکار سینک شوند. سقف سند فایراستور ۱ مگابایت
   است، پس عکس تا حد امن (~700 کیلوبایت base64) فشرده می‌شود. */




 // هفتهٔ کاری افغانستان از شنبه شروع می‌شود


function defaultSettings(){
  return { businessName:'فروشگاه صانع', currency:'افغانی', openingCash:0,
    invoiceCounter:0, businessPhone:'', businessAddress:'', logoEmoji:'🏪', openingNote:'', usdRate:0, lowStockThreshold:1, timezone:'Asia/Kabul' };
}
function migrateSettings(s){
  s = s || {};
  if(s.invoiceCounter===undefined) s.invoiceCounter=0;
  if(s.businessName===undefined) s.businessName='فروشگاه صانع';
  if(s.currency===undefined) s.currency='افغانی';
  if(s.openingCash===undefined) s.openingCash=0;
  if(s.businessPhone===undefined) s.businessPhone='';
  if(s.businessAddress===undefined) s.businessAddress='';
  if(s.logoEmoji===undefined) s.logoEmoji='🏪';
  if(s.openingNote===undefined) s.openingNote='';
  if(s.usdRate===undefined) s.usdRate=0;
  if(s.lowStockThreshold===undefined) s.lowStockThreshold=1;
  if(s.timezone===undefined) s.timezone='Asia/Kabul';
  return s;
}
function migrateRecordArrays(sales, purchases){
  (sales||[]).forEach(s=>{
    if(!s.status) s.status='active';
    if(!s.returns) s.returns=[];
    if(s.originalTotal===undefined) s.originalTotal=s.total;
    (s.items||[]).forEach(it=>{ if(it.returnedQty===undefined) it.returnedQty=0; });
  });
  (purchases||[]).forEach(p=>{
    if(!p.status) p.status='active';
    if(!p.returns) p.returns=[];
    if(p.originalTotal===undefined) p.originalTotal=p.total;
    if(!p.currency) p.currency='AFN';
    if(p.rateAtPurchase===undefined) p.rateAtPurchase=0;
    (p.items||[]).forEach(it=>{ if(it.returnedQty===undefined) it.returnedQty=0; });
  });
}

/* ---------- Migration: انتقال یک‌بارهٔ دیتای قدیمی (یک سند مشترک) به کالکشن‌های جدید ---------- */
async function migrateOldDataIfNeeded(){
  try{
    const flagSnap = await getDoc(migratedFlagRef);
    if(flagSnap.exists() && flagSnap.data().done) return; // قبلاً انجام شده

    const oldSnap = await getDoc(oldStateDocRef);
    if(!oldSnap.exists()){
      await setDoc(migratedFlagRef, {done:true, ts:Date.now(), note:'دیتای قدیمی وجود نداشت'});
      return;
    }
    const old = oldSnap.data();
    migrateSettings(old.settings);
    migrateRecordArrays(old.sales, old.purchases);

    const allRecords = [];
    (old.products||[]).forEach(r=>allRecords.push(['products',r]));
    (old.customers||[]).forEach(r=>allRecords.push(['customers',r]));
    (old.suppliers||[]).forEach(r=>allRecords.push(['suppliers',r]));
    (old.sales||[]).forEach(r=>allRecords.push(['sales',r]));
    (old.purchases||[]).forEach(r=>allRecords.push(['purchases',r]));
    (old.expenses||[]).forEach(r=>allRecords.push(['expenses',r]));
    (old.payments||[]).forEach(r=>allRecords.push(['payments',r]));
    (old.openingEntries||[]).forEach(r=>allRecords.push(['openingEntries',r]));

    // نوشتن دسته‌ای (هر batch حداکثر ۴۰۰ عملیات، برای اطمینان زیر سقف ۵۰۰ فایراستور)
    for(let i=0;i<allRecords.length;i+=400){
      const chunk = allRecords.slice(i,i+400);
      const batch = writeBatch(db);
      chunk.forEach(([colName,rec])=>{
        if(!rec.id) rec.id=uid();
        batch.set(doc(cols[colName], rec.id), rec);
      });
      await batch.commit();
    }
    await setDoc(settingsDocRef, migrateSettings(old.settings));
    await setDoc(migratedFlagRef, {done:true, ts:Date.now(), migratedCount:allRecords.length});
    console.log('مهاجرت دیتای قدیمی به ساختار جدید با موفقیت انجام شد. سند قدیمی به‌عنوان نسخهٔ پشتیبان دست‌نخورده باقی ماند.');
  }catch(e){
    console.error('خطا در مهاجرت دیتای قدیمی:', e);
  }
}

/* =========================================================
   ست آیکون خطی (سبک Lucide/Feather) — SVG درون‌خطی
   stroke نه fill، بدون هیچ درخواست شبکه‌ای.
   جایگزین همهٔ ایموجی‌های خام در تب پایین، منوها، دکمه‌ها و نشان‌ها.
   استثنا (طبق خواست کاربر): متن ارسالی به واتساپ، و ایموجی انتخابی
   خود کاربر در تنظیمات (logoEmoji) که در سربرگ فاکتور نمایش می‌شود.
   ========================================================= */

/* ---------- بارگذاری تنبلِ کتابخانهٔ بیرونیِ سنگین (xlsx؛ نمودار دیگر کتابخانهٔ بیرونی ندارد) ----------
   قبلاً این دو با <script defer> در <head> بودند، یعنی هر بار که اپ باز می‌شد
   (حتی فقط برای ثبت یک فروش ساده)، خودِ باز شدنِ صفحه به رسیدن به cdnjs.cloudflare.com
   گره خورده بود. در اتصال ضعیف/آفلاین، مرورگر تا رسیدن به timeout شبکه صبر می‌کرد و رویداد
   load (که ثبتِ سرویس‌ورکر هم به آن گره خورده) خیلی دیر یا هیچ‌وقت اجرا نمی‌شد.
   حالا این کتابخانه‌ها فقط وقتی واقعاً لازم می‌شوند (صفحهٔ گزارش، خروجی اکسل) بارگذاری
   می‌شوند — بازشدنِ اصلِ اپ دیگر به این دو وابسته نیست. */






/* ---------- App ---------- */

const App = {
  state: { settings: defaultSettings(), products:[], customers:[], suppliers:[], sales:[], purchases:[], expenses:[], payments:[], openingEntries:[], returns:[] },
  tab:'dashboard', sub:null,
  saleDraft:null, purchaseDraft:null, editingInvoiceId:null,
  reportPeriod:'today', reportStart:null, reportEnd:null,
  user:null, role:null, authReady:false, dataReady:false, imageViewerSrc:null, payFormOpen:false,
  _loadedParts:null, _unsubs:null,
  modal:null, actionMenu:null, searchOpen:false, searchQuery:'',
  pinLocked:false, pinEntry:'', pinStage:'enter',
  syncState:'offline', _pendingParts:null,

  init(){
    this.resetSaleDraft();
    this.resetPurchaseDraft();
    this.renderLoading();
    this._initHistory();
    onAuthStateChanged(auth, (u)=>{
      this.user = u;
      if(u){ this.afterLogin(u); }
      else { this.role=null; this.dataReady=false; this._teardown(); this.renderLogin(); }
    });
  },

  
  /* نقش کاربر: بعد از هر ورود موفق آنلاین، محلی (روی همین گوشی) ذخیره می‌شود.
     اگر بعداً برای اولین‌بار روی این گوشی آفلاین وارد شود، از همان نقش ذخیره‌شده استفاده می‌شود
     نه اینکه خودکار staff در نظر گرفته شود. */
  _roleCacheKey(uid_){ return 'hesabdari_role_'+uid_; },
  async afterLogin(u){
    // اشتراکِ دادهٔ اصلی (فروش/خرید/محصولات و...) را بلافاصله شروع می‌کنیم و منتظر بررسی
    // نقش کاربر یا مهاجرت دیتای قدیمی نمی‌مانیم — چون هر دوی این‌ها یک درخواست شبکه‌ای‌اند
    // و اگر در حالت آفلاین (بدون کش) گیر کنند یا دیر جواب بدهند، کل برنامه باز نمی‌شد.
    this._subscribeAll();
    this._maybeAskDeviceLabel();

    const cacheKey = this._roleCacheKey(u.uid);
    let cachedRole=null;
    try{ cachedRole = localStorage.getItem(cacheKey); }catch(e){}
    const roleFrom = (snap)=>{
      let r = snap.exists() ? (snap.data().role||'staff') : 'staff';
      if(r==='salesman') r='seller'; // firestore.rules از «salesman» استفاده می‌کند، برنامه از «seller»
      return r;
    };
    if(cachedRole){
      // نقش قبلاً روی همین گوشی ذخیره شده: بدون هیچ انتظاری باز شو، نقش واقعی را در پس‌زمینه تازه کن
      this.role = cachedRole;
      Promise.race([getDocQuick(teamDocRef(u.uid)), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),15000))])
        .then(snap=>{
          const r = roleFrom(snap);
          try{ localStorage.setItem(cacheKey, r); }catch(e){}
          if(r!==this.role){ this.role=r; if(this._subscribedRole!==r) this._subscribeAll(); this.renderNav(); this.render(); }
        }).catch(()=>{});
    } else {
      try{
        const teamSnap = await Promise.race([getDocQuick(teamDocRef(u.uid)), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),2500))]);
        this.role = roleFrom(teamSnap);
        try{ localStorage.setItem(cacheKey, this.role); }catch(e){}
      }catch(e){
        this.role = 'staff';
      }
    }
    // اگر نقش واقعی با نقشی که با آن اشتراک گرفتیم یکی نبود (اولین ورود روی این گوشی،
    // یا تغییر نقش از کنسول)، اشتراک را با دسترسی درست از نو می‌گیریم.
    if(this._subscribedRole !== this.role) this._subscribeAll();
    this.renderNav(); this.render(); // نقش ممکن است روی نمایش برخی دکمه‌ها اثر بگذارد

    migrateOldDataIfNeeded().catch(()=>{});

    // اگر قبلاً برای این کاربر PIN تعیین شده، صفحه را قفل کن.
    // نکته امنیتی: اگر بررسی به‌هر دلیل (مثلاً قطعی موقت اینترنت) ناکام بماند، به‌جای فرض
    // «PIN ندارد»، چند بار دوباره تلاش می‌کنیم — چون فرض اشتباه یعنی دور زدن قفل امنیتی.
    this._checkPinAtLogin(3);
  },
  async _checkPinAtLogin(retriesLeft){
    try{
      const savedHash = await this.getMyPinHash();
      this.myPinHash = savedHash;
      if(savedHash){ this.pinLocked=true; this.renderPinRoot(); }
    }catch(e){
      if(retriesLeft>0){ setTimeout(()=>this._checkPinAtLogin(retriesLeft-1), 1500); }
      // اگر همهٔ تلاش‌ها ناکام بماند (مثلاً واقعاً آفلاین و هیچ‌وقت این دستگاه وارد نشده)،
      // برنامه طبق رفتار پیش‌فرض (بدون قفل اضافه) باز می‌شود — چون بدون هیچ داده‌ای حتی
      // ورود Firebase هم ممکن نبوده، این حالت در عمل رخ نمی‌دهد.
    }
  },

  /* ---------- ثبت‌کنندهٔ رکورد (کاربر + گوشی) ---------- */
  /* نوع حرکت انبار را برای batchِ بعدی مشخص می‌کند (قبل از writeBatch صدا زده می‌شود) */
  _mv(type, reason, extra){ this._mvCtx = { type, reason:reason||'', ...(extra||{}) }; },
  /* رویداد Audit داخل همان batch/transaction */
  audit(target, { action, entityType, entityId, before, after }){
    const id = uid();
    const entry = buildAuditEntry({ id, ts:Date.now(), action, entityType, entityId,
      userId:(this.user&&this.user.email)||'', userRole:this.role||'', before:summarizeDoc(before), after:summarizeDoc(after) });
    target.set(doc(cols.auditLog, id), entry);
  },
  /* وقتی بخشی از پرداختِ تخصیص‌یافته به یک فاکتور آزاد می‌شود (مرجوعی/لغو/کم‌شدن مجموع)،
     مقدار تخصیص روی همان پرداخت‌ها (تازه‌ترین اول) کم می‌شود تا مانده‌ها همیشه با تاریخچه بخوانند. */
  _releaseAllocations(target, saleId, amount){
    let left=round2(amount);
    const cands=(this.state.payments||[]).filter(p=>p.saleId===saleId && !p.voided && !p.reversalOf && (Number(p.allocatedAmount)||0)>0.001)
      .sort((a,b)=>(b.ts||0)-(a.ts||0));
    for(const p of cands){
      if(left<=0.001) break;
      const take=Math.min(left, Number(p.allocatedAmount)||0);
      target.update(doc(cols.payments,p.id), { allocatedAmount: increment(-take) });
      left=round2(left-take);
    }
    return round2(amount-left);
  },
  recordMeta(){
    return {
      createdByEmail: (this.user && this.user.email) || '',
      createdByDevice: getDeviceLabel() || ('دستگاه '+getDeviceId().slice(-5)),
    };
  },
  editMeta(){
    return {
      lastEditedByEmail: (this.user && this.user.email) || '',
      lastEditedByDevice: getDeviceLabel() || ('دستگاه '+getDeviceId().slice(-5)),
      lastEditedTs: Date.now(),
    };
  },
  whoLabel(rec){
    if(!rec) return '';
    const who=[rec.createdByEmail, rec.createdByDevice].filter(Boolean).join(' · ');
    return who ? 'ثبت‌شده توسط: '+who : '';
  },
  /* قبلاً prompt() خام مرورگر بود — حالا همان مودال داخلی خود اپ.
     اگر صفحه قفل PIN است، صبر می‌کنیم تا باز شود و بعد می‌پرسیم. */
  _maybeAskDeviceLabel(tries){
    if(getDeviceLabel()) return;
    const t = tries||0;
    setTimeout(()=>{
      if(getDeviceLabel()) return;
      if(this.pinLocked || this.modal){
        if(t<20) this._maybeAskDeviceLabel(t+1);
        return;
      }
      this.openFormModal({
        title:'نام این گوشی/دستگاه',
        sub:'برای اینکه بعداً بدانید هر معامله از کدام گوشی ثبت شده. بعداً هم از تنظیمات قابل تغییر است.',
        fields:[{key:'label', label:'نام دستگاه', placeholder:'مثلاً گوشی احمد یا دفتر مرکزی'}],
        submitLabel:'ذخیره',
        onSubmit:(v)=>{
          const val=(v.label||'').trim();
          if(val) setDeviceLabel(val);
          this.render();
        }
      });
    }, t===0 ? 700 : 1500);
  },

  _teardown(){
    if(this._unsubs){ this._unsubs.forEach(fn=>{ try{ fn(); }catch(e){} }); }
    this._unsubs=[];
    if(this._readyTimeout){ clearTimeout(this._readyTimeout); this._readyTimeout=null; }
  },

  _subscribeAll(){
    this._teardown();
    this._loadedParts = new Set();
    this._pendingParts = new Set();
    this._subscribedRole = this._cachedRole();
    const hidden = this._hiddenCollections();
    const activeCollections = COLLECTIONS.filter(n=> hidden.indexOf(n)<0);
    hidden.forEach(n=>{ this.state[n]=[]; });
    const totalParts = activeCollections.length + 1; // + settings

    const checkReady = ()=>{
      if(!this.dataReady && this._loadedParts.size>=totalParts){
        this.dataReady = true;
      }
      document.getElementById('biz-name').textContent = this.state.settings.businessName || 'فروشگاه صانع';
      {const _bd=document.getElementById('biz-date'); if(_bd) _bd.textContent = dateLabel(todayISO());}
      this.renderNav();
      this._syncRender();
    };
    // اگر تا این مدت همهٔ ۹ بخش داده هنوز خبری از خودشان نداده باشند (مثلاً چون یکی از
    // کالکشن‌ها -مثل یک نوع سند که کمتر استفاده شده- هنگام آفلاین‌بودن هرگز از کش هم پاسخ
    // نمی‌دهد)، به‌جای گیر ماندنِ همیشگی روی «در حال بارگذاری...»، با همان داده‌هایی که تا
    // الان رسیده باز می‌شویم؛ بقیهٔ بخش‌ها هم به‌محض رسیدن (چه از کش، چه بعد از وصل شدن به
    // اینترنت) خودشان صفحه را به‌روزرسانی می‌کنند.
    this._readyTimeout = setTimeout(()=>{
      if(!this.dataReady){ this.dataReady = true; checkReady(); }
    }, 3000);

    // وضعیت واقعی سینک باید از روی همهٔ داده‌ها (فروش، خرید، محصولات و ...) سنجیده شود،
    // نه فقط سند تنظیمات — وگرنه وقتی مثلاً یک فاکتور هنوز به سرور نرسیده، نشانگر ممکن است
    // اشتباهاً «آنلاین/ذخیره‌شده» نشان بدهد.
    const markPart = (name, hasPendingWrites)=>{
      if(hasPendingWrites) this._pendingParts.add(name); else this._pendingParts.delete(name);
      this._recomputeSyncState();
    };

    activeCollections.forEach(name=>{
      const unsub = onSnapshot(cols[name], {includeMetadataChanges:true}, (snap)=>{
        // تغییر فقط در «متادیتا» (مثلاً رسیدن تأیید سرور برای نوشتهٔ محلی): داده عوض نشده، پس نه بازسازی نه رندر.
        // قبلاً هر تأییدِ سرور کل صفحه را دوباره می‌ساخت و فرم نیمه‌پرشده پاک می‌شد.
        if(this._loadedParts.has(name) && snap.docChanges().length===0){ markPart(name, snap.metadata.hasPendingWrites); return; }
        const arr = [];
        snap.forEach(d=>arr.push(sanitizeDoc(d.data())));
        if(name==='products'){
          const normalized=arr.map(normalizeProductUnitsRecord);
          this.state[name]=normalized;
          // مهاجرت فقط برای مدیر نوشته می‌شود؛ کاربر شریک فقط نسخهٔ محاسباتیِ سازگار را می‌بیند.
          if(this.isOwner()){
            normalized.filter(p=>p._unitSchemaMigrated).forEach(p=>{
              const { _unitSchemaMigrated, ...persisted }=p;
              updateDoc(doc(cols.products,p.id), persisted).catch(e=>console.warn('product unit migration failed',e));
            });
          }
        } else this.state[name] = arr;
        if(name==='sales' || name==='purchases') {
          migrateRecordArrays(this.state.sales, this.state.purchases);
          if(name==='sales' || name==='purchases') this._migrateImmutableInvoiceNumbers(name).catch(e=>console.warn('invoice number migration failed',e));
        }
        this._loadedParts.add(name);
        markPart(name, snap.metadata.hasPendingWrites);
        checkReady();
      }, (err)=>this._onSyncError(name, err, ()=>{ this._loadedParts.add(name); checkReady(); }));
      this._unsubs.push(unsub);
    });

    const unsubSettings = onSnapshot(settingsDocRef, {includeMetadataChanges:true}, async (snap)=>{
      { const raw = JSON.stringify(snap.exists() ? snap.data() : null);
        if(this._loadedParts.has('settings') && raw===this._settingsRaw){ markPart('settings', snap.metadata.hasPendingWrites); return; }
        this._settingsRaw = raw; }
      if(snap.exists()){
        this.state.settings = migrateSettings(snap.data());
        setBusinessTimezone(this.state.settings.timezone);
      } else {
        this.state.settings = defaultSettings();
        try{ await setDoc(settingsDocRef, this.state.settings); }catch(e){}
      }
      this._loadedParts.add('settings');
      markPart('settings', snap.metadata.hasPendingWrites);
      checkReady();
    }, (err)=>this._onSyncError('settings', err, ()=>{ this._loadedParts.add('settings'); checkReady(); }));
    this._unsubs.push(unsubSettings);

    if(!this._netListenersAdded){
      this._netListenersAdded = true;
      window.addEventListener('online', ()=> this._recomputeSyncState());
      window.addEventListener('offline', ()=> this._recomputeSyncState());
    }
    this._recomputeSyncState();
  },
  /* خطای گوش‌دادن به یک کالکشن (مثلاً رد شدن توسط قوانین Firestore): قبلاً فقط در console می‌ماند و برنامه
     همیشه روی «در حال بارگذاری» می‌ماند. حالا آن بخش «بارگذاری‌شده (خالی)» حساب می‌شود، برنامه باز می‌شود
     و کاربر پیام روشن می‌بیند. */
  _onSyncError(name, err, markLoaded){
    console.error('sync error ('+name+')', err);
    try{ markLoaded(); }catch(e){}
    const denied = err && err.code==='permission-denied';
    this._syncErrors = this._syncErrors || {};
    if(!this._syncErrors[name]){
      this._syncErrors[name] = true;
      this.toastError(denied ? 'اجازهٔ دیدن بخش «'+name+'» برای حساب شما نیست (قوانین سرور).' : 'خطا در همگام‌سازی بخش «'+name+'».');
    }
    if(denied) this._lastWriteError = 'permission-denied: '+name;
  },
  /* رندر ناشی از همگام‌سازی: چند رویداد پشت‌سرهم یک رندر می‌شود، و اگر کاربر وسط پر کردن فرم است
     (فاکتور فروش/خرید، پرداخت و...) صفحه را بازسازی نمی‌کنیم تا چیزی که نوشته پاک نشود. */
  _formIsDirty(){
    const root=document.getElementById('screen'); if(!root) return false;
    for(const el of root.querySelectorAll('input,textarea,select')){
      const t=(el.type||'').toLowerCase();
      if(t==='hidden'||t==='button'||t==='submit') continue;
      if(t==='file'){ if(el.files && el.files.length) return true; continue; }
      if(t==='checkbox'||t==='radio'){ if(el.checked!==el.defaultChecked) return true; continue; }
      if(el.tagName==='SELECT'){ if(el.selectedIndex>0 && el.options[el.selectedIndex] && !el.options[el.selectedIndex].defaultSelected) return true; continue; }
      if(el.value!==el.defaultValue) return true;
    }
    return false;
  },
  _syncRender(){
    if(this._syncRenderTimer) return;
    this._syncRenderTimer = setTimeout(()=>{
      this._syncRenderTimer = null;
      if(this.dataReady && this._formIsDirty()){ this._renderDeferred = true; setTimeout(()=>{ if(this._renderDeferred) this._syncRender(); }, 2000); return; } // تا فرم تمام نشده عقب می‌افتد و بعد خودش تازه می‌شود
      this.render();
    }, 60);
  },
  // یک نقطهٔ واحد برای تصمیم‌گیری دربارهٔ وضعیت نمایشی: آفلاین (اصلاً وصل نیست)،
  // در حال همگام‌سازی (وصل است ولی هنوز چیزی در صفِ ارسال به سرور مانده)، یا آنلاین (همه‌چیز رسیده).
  _recomputeSyncState(){
    if(!navigator.onLine){ this.setSyncState('offline'); return; }
    this.setSyncState(this._pendingParts && this._pendingParts.size>0 ? 'pending' : 'ok');
  },
  _markWriteResult(ok, err){
    if(ok){ this._lastWriteError=''; this._recomputeSyncState(); return; }
    this._lastWriteError=(err&&err.message)||'خطای ناشناخته';
    this.setSyncState('error');
  },
  invoiceNoForNew(id,prefix){ return immutableInvoiceNo(id,prefix||'S'); },
  invoiceNoValue(rec,prefix){ return rec && rec.invoiceNo ? String(rec.invoiceNo) : immutableInvoiceNo(rec&&rec.id,prefix||'S'); },
  async _migrateImmutableInvoiceNumbers(name){
    if(!this.isOwner()) return;
    const arr=this.state[name]||[];
    const prefix=name==='sales'?'S':'B';
    const missing=arr.filter(x=>x && !x.invoiceNo);
    if(!missing.length) return;
    let batch=writeBatch(db,{noLedger:true}), n=0;
    for(const rec of missing){
      batch.update(doc(cols[name],rec.id),{invoiceNo:this.invoiceNoForNew(rec.id,prefix)});
      if(++n>=400){ await batch.commit(); batch=writeBatch(db,{noLedger:true}); n=0; }
    }
    if(n) await batch.commit();
  },

  // فقط کسی «مالک» حساب می‌شود که هم نقش «owner» در Firestore داشته باشد و هم دقیقاً
  // با همین ایمیل وارد شده باشد — یعنی حتی اگر یک نقش owner به‌اشتباه به کاربر دیگری
  // داده شود، تا وقتی ایمیلش manager@motar.com نباشد، دسترسی مدیریتی نمی‌گیرد.
  OWNER_EMAIL: 'manager@motar.com',
  // مالک عملیاتی: هر کس در Firebase نقش owner داشته باشد (محصول، موجودی، فروش، خرید، پرداخت، گزارش)
  isOwner(){ return this.role==='owner' && !!this.user && String(this.user.email||'').toLowerCase()===this.OWNER_EMAIL; },
  // مدیر فنی: فقط manager@motar.com — تنظیمات، پشتیبان‌گیری/بازیابی، ابزار تطبیق، پاک‌کردن همه
  isAdmin(){ return this.role==='owner' && !!this.user && String(this.user.email||'').toLowerCase()===this.OWNER_EMAIL; },
  /* --- نقش‌ها ---
     owner   : مالک — همه‌کار
     partner : شریک — همه‌چیز را می‌بیند، هیچ چیز را تغییر نمی‌دهد و پاک نمی‌کند
     seller  : فروشنده — فقط فروش/مشتری/رسید؛ خرید، مصارف، شرکت‌ها و سود را نمی‌بیند
     staff   : نقش قدیمی — نوشتن کامل، بدون حذف و بدون تنظیمات */
  isPartner(){ return this.role==='partner'; },
  isSeller(){ return this.role==='seller'; },
  canWrite(){ return !this.isPartner(); },              // شریک همه‌جا فقط خواندنی است
  canSeeBooks(){ return !this.isSeller(); },            // خرید/مصارف/شرکت‌ها/سود
  canSeeReports(){ return this.isOwner() || this.isPartner(); },
  roleLabel(){
    return this.role==='owner' ? 'مالک' : this.role==='partner' ? 'شریک'
         : this.role==='seller' ? 'فروشنده' : 'کارمند';
  },
  guardWrite(){
    if(!this.canWrite()){ this.toastError(PARTNER_DENIED_MSG); return false; }
    return true;
  },
  guardBooks(){
    if(!this.canSeeBooks()){ this.toastError('این بخش برای حساب فروشنده باز نیست.'); return false; }
    return true;
  },
    _cachedRole(){
    if(this.role) return this.role;
    try{ return this.user ? (localStorage.getItem(this._roleCacheKey(this.user.uid))||'') : ''; }catch(e){ return ''; }
  },
  // فروشنده اجازهٔ خواندن این کالکشن‌ها را ندارد؛ پس بی‌جهت به آن‌ها گوش نمی‌دهیم
  _hiddenCollections(){
    return this._cachedRole()==='seller' ? ['purchases','expenses','suppliers','openingEntries'] : [];
  },

  logout(){
    this.openConfirmModal({ title:'خروج از حساب', msg:'از حساب خارج شوید؟', confirmLabel:'خروج', danger:true, onConfirm:()=> signOut(auth) });
  },

    async doLogin(){
    const email=(document.getElementById('login-email').value||'').trim();
    const pass=document.getElementById('login-pass').value||'';
    const errBox=document.getElementById('login-err');
    errBox.textContent='';
    if(!email||!pass){ errBox.textContent='ایمیل و رمز عبور را بنویسید'; return; }
    try{
      await signInWithEmailAndPassword(auth, email, pass);
    }catch(e){
      console.warn('login failed', e && e.code);
      errBox.textContent = describeAuthError(e).message;
    }
  },
  resetSaleDraft(){ this.saleDraft = { items:[], txId:uid() }; }, // txId = کلید یکتا؛ ثبت دوباره همین فاکتور را نمی‌سازد
  onSaleCustomerNameChange(){
    const name=(document.getElementById('sale-customer-name').value||'').trim();
    const c=this.state.customers.find(x=>x.name===name);
    const phoneEl=document.getElementById('sale-customer-phone');
    const addrEl=document.getElementById('sale-customer-address');
    if(c){ phoneEl.value=c.phone||''; addrEl.value=c.address||''; }
  },
  resetPurchaseDraft(){ this.purchaseDraft = { items:[], currency:'AFN', txId:uid() }; },

  /* ---------- دکمهٔ «بازگشت» گوشی ----------
     هر تب/صفحه یک مرحلهٔ تاریخچه است؛ هر پنجرهٔ باز (فرم، تأیید، منو، جستجو، تصویر) هم یک مرحلهٔ جداست.
     دکمهٔ بازگشت اول پنجرهٔ باز را می‌بندد، بعد به صفحهٔ قبلی برمی‌گردد. فقط در صفحهٔ اصلی از اپ خارج می‌شود.
     پنجره‌هایی که با دکمهٔ خودشان بسته شده‌اند، مرحلهٔ «مرده» می‌مانند و popstate آن‌ها را بی‌صدا رد می‌کند. */
  _pushState(extra){
    try{ history.pushState(Object.assign({tab:this.tab, sub:this.sub}, extra||{}), ''); }catch(e){}
  },
  _pushLayer(){ this._pushState({layer:true}); },
  _hasLayerTop(){ return !!(history.state && history.state.layer); },
  /* بستن پنجره از داخل برنامه (دکمهٔ انصراف/ضربدر): اگر مرحلهٔ پنجره بالای تاریخچه است، یک مرحله برمی‌گردیم
     تا مرحلهٔ «مرده» نماند (وگرنه یک بار زدن بازگشت هیچ‌چیز را عوض نمی‌کرد). */
  _closeOverlay(clear){
    clear();
    if(this._fromPop) return;
    if(this._hasLayerTop()){
      this._pendingPops = (this._pendingPops||0) + 1;
      const tok = this._popTok = (this._popTok||0) + 1;
      // اگر popstate به هر دلیلی نیامد، قفل ناوبری باز نماند
      setTimeout(()=>{ if(this._popTok===tok && this._pendingPops>0){ this._pendingPops=0; this._flushDeferred(); } }, 500);
      try{ history.back(); }catch(e){ this._pendingPops=0; }
    }
  },
  /* اگر یک بازگشتِ ناشی از بستن پنجره هنوز در راه است، کار جدید (باز کردن پنجره/تغییر صفحه) را تا بعد از آن نگه می‌داریم */
  _defer(fn){
    if((this._pendingPops||0) > 0){ (this._afterPops = this._afterPops||[]).push(fn); return true; }
    return false;
  },
  _flushDeferred(){
    const q = this._afterPops || []; this._afterPops = [];
    q.forEach(f=>{ try{ f(); }catch(e){ console.error(e); } });
  },
  _applyNav(tab,sub){
    if(tab!==this.tab || (sub||null)!==(this.sub||null)) this.listUI = {};   // جستجو/فیلتر هر صفحه با ورود به صفحهٔ دیگر پاک می‌شود
    this.tab=tab; this.sub=sub||null; this.renderNav(); this.render(); window.scrollTo(0,0);
  },
  navigate(tab,sub){
    if(this._defer(()=>this.navigate(tab,sub))) return;
    const same = tab===this.tab && (sub||null)===(this.sub||null);
    if(!same) this._pushState({tab, sub:sub||null});
    this._applyNav(tab,sub);
  },
  _initHistory(){
    try{ history.replaceState({tab:this.tab, sub:this.sub}, ''); }catch(e){}
    window.addEventListener('popstate', (e)=>{
      // بازگشتی که خودمان برای بستن پنجره فرستاده بودیم: فقط صف کارهای منتظر را اجرا کن
      if((this._pendingPops||0) > 0){
        this._pendingPops--;
        if(this._pendingPops === 0){ this._popTok = (this._popTok||0)+1; this._flushDeferred(); }
        return;
      }
      const st = e.state || {};
      this._fromPop = true;
      try{
        if(this.imageViewerSrc){ this.closeImageViewer(); return; }
        if(this.searchOpen){ this.closeSearch(); return; }
        if(this.actionMenu){ this.closeActionMenu(); return; }
        if(this.modal){ this.closeModal(); return; }
        if(st.layer){ history.back(); return; }             // پنجرهٔ قبلاً بسته‌شده: ردش کن
        if(st.tab && this.dataReady && !this.pinLocked && this.user){
          if(st.tab!==this.tab || (st.sub||null)!==(this.sub||null)) this._applyNav(st.tab, st.sub);
        }
      } finally { this._fromPop = false; }
    });
  },
  /* تب ناوبری فعال: صفحه‌های جزئیات زیر همان تب شمرده می‌شوند */
  _navTab(){
    if(this.tab==='invoice') return 'sale';
    if(this.tab==='purchase-view') return 'purchase';
    return this.tab;
  },

  /* ---- نسخهٔ ۲: تم روشن/تاریک، دکمهٔ شناور، برچسب جدول‌ها برای نمای کارتی موبایل ---- */
  toggleTheme(){
    const root=document.documentElement;
    const next = root.getAttribute('data-theme')==='dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try{ localStorage.setItem('hesabdari_theme', next); }catch(e){}
    const m=document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute('content', next==='dark' ? '#0E1319' : '#1B2430');
  },
  _syncFab(show){
    const fab=document.getElementById('fab'); if(!fab) return;
    fab.hidden = !(show && this.dataReady && this.canWrite());
  },
  _labelTables(root){
    (root||document).querySelectorAll('table.inv-table').forEach(t=>{
      const heads=[...t.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach(tr=>{
        [...tr.children].forEach((td,i)=>{ if(td.tagName==='TD' && heads[i]!==undefined) td.setAttribute('data-label', heads[i]); });
      });
    });
  },

  
      viewImage(src){ if(!src) return; if(this._defer(()=>this.viewImage(src))) return; this._pushLayer(); this.imageViewerSrc=src; this.render(); },
  closeImageViewer(){ this._closeOverlay(()=>{ this.imageViewerSrc=null; this.render(); }); },

  /* =========================================================
     سیستم مودال/فرم داخل‌اپ — جایگزین prompt()/confirm() مرورگر
     ========================================================= */
  openFormModal({title, sub, fields, submitLabel, danger, onSubmit}){
    if(this._defer(()=>this.openFormModal({title, sub, fields, submitLabel, danger, onSubmit}))) return;
    this._pushLayer();
    this.modal = {kind:'form', title, sub, fields, submitLabel:submitLabel||'ذخیره', danger:!!danger, onSubmit};
    this.renderModalRoot();
  },
  // مودال با بدنهٔ دلخواه (برای فرم‌هایی که فیلدهایشان به هم وابسته‌اند،
  // مثلاً انتخاب محصول ← واحد ← قیمت خودکار)
  openCustomModal({title, sub, bodyHtml, submitLabel, danger, onSubmit, onOpen}){
    if(this._defer(()=>this.openCustomModal({title, sub, bodyHtml, submitLabel, danger, onSubmit, onOpen}))) return;
    this._pushLayer();
    this.modal = {kind:'custom', title, sub, bodyHtml, submitLabel:submitLabel||'ذخیره', danger:!!danger, onSubmit};
    this.renderModalRoot();
    if(onOpen) setTimeout(onOpen,0);
  },
  openConfirmModal({title, msg, danger, confirmLabel, onConfirm}){
    if(this._defer(()=>this.openConfirmModal({title, msg, danger, confirmLabel, onConfirm}))) return;
    this._pushLayer();
    this.modal = {kind:'confirm', title, msg, danger:!!danger, confirmLabel:confirmLabel||'تأیید', onConfirm};
    this.renderModalRoot();
  },
  closeModal(){ this._closeOverlay(()=>{ this.modal=null; this.renderModalRoot(); }); },
  /* خطای انگلیسیِ Firestore را به پیام فارسیِ قابل‌فهم تبدیل می‌کند */
  friendlyError(err){
    const code=(err&&err.code)||'', msg=(err&&err.message)||'';
    if(code==='permission-denied' || code==='firestore/permission-denied' || /missing or insufficient permissions/i.test(msg))
      return 'سرور اجازهٔ ثبت نداد (Firestore Rules). نقش این حساب یا قوانین منتشرشده در Firebase را بررسی کنید.';
    return msg || 'خطا؛ دوباره تلاش کنید.';
  },
  async submitFormModal(){
    if(!this.modal || this.modal.kind!=='form') return;
    const vals={};
    for(const f of this.modal.fields){
      const el = document.getElementById('mf-'+f.key);
      if(!el) continue;
      vals[f.key] = f.type==='number' ? (el.value===''?null:parseFloat(el.value)) : el.value;
    }
    const errEl = document.getElementById('modal-err');
    try{
      const res = await this.modal.onSubmit(vals);
      if(res===false) return;
      this.closeModal();
    }catch(err){
      if(errEl) errEl.textContent = App.friendlyError(err);
    }
  },
  async submitCustomModal(){
    if(!this.modal || this.modal.kind!=='custom') return;
    const errEl=document.getElementById('modal-err');
    try{
      const res=await this.modal.onSubmit();
      if(res===false) return;
      this.closeModal();
    }catch(err){
      if(errEl) errEl.textContent = App.friendlyError(err);
    }
  },
  confirmModalYes(){
    if(!this.modal || this.modal.kind!=='confirm') return;
    const fn=this.modal.onConfirm;
    this.closeModal();
    if(fn) fn();
  },
  
  openActionMenu(items){ if(this._defer(()=>this.openActionMenu(items))) return; this._pushLayer(); this.actionMenu = items; this.renderActionMenuRoot(); },
  closeActionMenu(){ this._closeOverlay(()=>{ this.actionMenu=null; this.renderActionMenuRoot(); }); },
  runActionMenuItem(idx){
    const items=this.actionMenu; this.closeActionMenu();
    if(items && items[idx] && items[idx].onClick) items[idx].onClick();
  },
  
  openSearch(){ if(this._defer(()=>this.openSearch())) return; this._pushLayer(); this.searchOpen=true; this.searchQuery=''; this.renderSearchRoot(); setTimeout(()=>{ const el=document.getElementById('global-search-input'); if(el) el.focus(); },50); },
  closeSearch(){ this._closeOverlay(()=>{ this.searchOpen=false; this.renderSearchRoot(); }); },
  onSearchInput(v){ this.searchQuery=v; this.renderSearchResultsOnly(); },
  runGlobalSearch(q){
    q=(q||'').trim();
    if(!q) return {products:[],customers:[],suppliers:[],sales:[],purchases:[]};
    const norm = s=>String(s||'').toLowerCase();
    const nq = norm(q);
    const products = this.state.products.filter(p=>norm(p.name).includes(nq)).slice(0,8);
    const customers = this.state.customers.filter(c=>norm(c.name).includes(nq)||norm(c.phone).includes(nq)).slice(0,8);
    const suppliers = this.state.suppliers.filter(c=>norm(c.name).includes(nq)||norm(c.phone).includes(nq)).slice(0,8);
    const invNo = nq.replace(/^#/,'').replace(/^0+/,'');
    const sales = this.state.sales.filter(s=> norm(s.customerName).includes(nq) || (invNo && String(this.saleSeqNo(s.id)).includes(invNo)) ).slice(0,8);
    const purchases = this.state.purchases.filter(s=>
      norm(s.supplierName).includes(nq)
      || norm(s.supplierInvoiceNo).includes(nq)
      || norm(s.note).includes(nq)
      || (invNo && String(this.purchaseSeqNo(s.id)).includes(invNo))
    ).slice(0,8);
    return {products,customers,suppliers,sales,purchases};
  },
  // فقط بخش نتایج را بازسازی می‌کند و به فیلد ورودی دست نمی‌زند، تا در حین تایپ
  // فوکوس آن از بین نرود (قبلاً کل کادر جستجو -از جمله خودِ input- با هر حرف
  // دوباره ساخته می‌شد که باعث می‌شد بعد از هر حرف فوکوس قطع شود).
  buildSearchResultsBody(q){
    const r = this.runGlobalSearch(q);
    const hasAny = r.products.length||r.customers.length||r.suppliers.length||r.sales.length||r.purchases.length;
    const group = (title, arr, renderRow) => arr.length ? `<div class="search-group-title">${title}</div>` + arr.map(renderRow).join('') : '';
    return !q.trim() ? `<div class="empty"><span class="ic">${ic('search',26)}</span><b>جست‌وجوی سراسری</b>نام محصول، مشتری، عمده‌فروش، یا شمارهٔ فاکتور فروش/بل خرید را بنویسید</div>` :
      (!hasAny ? `<div class="empty"><span class="ic">${ic('frown',26)}</span>چیزی با «${escapeHtml(q)}» پیدا نشد</div>` :
      group(ic('archive',13)+' محصولات', r.products, p=>`<div class="row-item clickable" onclick="App.closeSearch(); App.navigate('more','products');"><div class="r-left"><b>${escapeHtml(p.name)}</b><span class="sub">موجودی: ${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</span></div><div class="r-right num">${fmt(p.sellPrice)}</div></div>`)
      + group(ic('users',13)+' مشتریان', r.customers, c=>`<div class="row-item clickable" onclick="App.closeSearch(); App.navigate('customers'); App.openParty('customers','${c.id}');"><div class="r-left"><b>${escapeHtml(c.name)}</b><span class="sub">${escapeHtml(c.phone||'')}</span></div><div class="r-right num" style="color:${c.balance>0.5?'var(--red)':'var(--green)'}">${fmt(c.balance||0)}</div></div>`)
      + group(ic('factory',13)+' عمده‌فروشان', r.suppliers, c=>`<div class="row-item clickable" onclick="App.closeSearch(); App.navigate('customers'); App.openParty('suppliers','${c.id}');"><div class="r-left"><b>${escapeHtml(c.name)}</b><span class="sub">${escapeHtml(c.phone||'')}</span></div><div class="r-right num" style="color:${c.balance>0.5?'var(--red)':'var(--green)'}">${fmt(c.balance||0)}</div></div>`)
      + group(ic('receipt',13)+' فروش‌ها', r.sales, s=>`<div class="row-item clickable" onclick="App.closeSearch(); App.viewInvoice('${s.id}');"><div class="r-left"><b>فروش ${this.invoiceNoLabel(s.id)} — ${escapeHtml(s.customerName)}</b><span class="sub">${s.date}</span></div><div class="r-right num">${fmt(s.total)}</div></div>`)
      + group(ic('package',13)+' خریدها', r.purchases, s=>`<div class="row-item clickable" onclick="App.closeSearch(); App.viewPurchase('${s.id}');"><div class="r-left"><b>خرید ${this.purchaseBillLabel(s)} — ${escapeHtml(s.supplierName||'—')}</b><span class="sub">${s.date}</span></div><div class="r-right num">${fmt(s.total)}</div></div>`));
  },
      // نکته: تابع openParty(type,id) از قبل در بخش مشتریان/فروشندگان تعریف شده
  // (پایین‌تر در همین فایل) و همان‌جا استفاده می‌شود — اینجا دوباره تعریف نشد.

  setSyncState(st){
    this.syncState = st;
    const el=document.getElementById('sync-badge'); const txt=document.getElementById('sync-text');
    if(!el||!txt) return;
    el.className = 'sync-badge '+st;
    txt.textContent = st==='ok' ? 'همگام شده' : st==='pending' ? 'در حال همگام‌سازی...' : st==='error' ? 'خطا در همگام‌سازی' : 'آفلاین';
  },

  pinDigit(d){
    if(this.pinEntry.length>=4) return;
    this.pinEntry += d;
    this.renderPinRoot();
    if(this.pinEntry.length===4) setTimeout(()=>this.checkPin(),120);
  },
  pinBackspace(){ this.pinEntry=this.pinEntry.slice(0,-1); this.renderPinRoot(); },
  _pinFailKey(){ return 'hesabdari_pinfail_'+(this.user?this.user.uid:'x'); },
  _readPinFail(){
    try{ return JSON.parse(localStorage.getItem(this._pinFailKey())||'null') || {fails:0,lockedUntil:0}; }
    catch(e){ return {fails:0,lockedUntil:0}; }
  },
  _writePinFail(st){ try{ localStorage.setItem(this._pinFailKey(), JSON.stringify(st)); }catch(e){} },
  async checkPin(){
    // قفل موقت بعد از چند تلاش ناموفق (ضد حدس‌زدن)
    const failState = this._readPinFail();
    const waitMs = pinLockRemainingMs(failState, Date.now());
    if(waitMs>0){
      this.pinEntry='';
      const sec=Math.ceil(waitMs/1000);
      this.pinLockMsg='تلاش‌های ناموفق زیاد بود؛ '+(sec>=60?Math.ceil(sec/60)+' دقیقه':sec+' ثانیه')+' صبر کنید';
      this.renderPinRoot();
      setTimeout(()=>{ this.pinLockMsg=''; this.renderPinRoot(); }, Math.min(waitMs,5000));
      return;
    }
    let rec;
    try{
      rec = (this.myPinHash!==undefined) ? this.myPinHash : await this.getMyPinHash();
      this.myPinHash = rec;
    }catch(e){
      // نتوانستیم مطمئن شویم PIN قبلی چه بوده (مثلاً قطعی اینترنت) — به‌هیچ‌وجه نباید این را
      // به‌معنی «هنوز PIN نداریم» بگیریم، وگرنه هرکسی می‌تواند صفحه را با هر عددی باز/بازتنظیم کند.
      this.pinEntry=''; this.pinCheckError=true; this.renderPinRoot();
      setTimeout(()=>{ this.pinCheckError=false; this.renderPinRoot(); }, 1800);
      return;
    }
    if(!rec){
      const saved = await this.setMyPinHash(this.pinEntry);
      if(saved) this.myPinHash = saved;
      this.pinLocked=false; this.pinEntry=''; this.renderPinRoot();
      if(saved) this.toast('قفل PIN تنظیم شد');
      return;
    }
    const res = await verifyPin(this.pinEntry, rec);
    if(res.ok){
      this._writePinFail(pinStateAfterSuccess());
      if(res.legacy){
        // ارتقای بی‌صدای هش قدیمیِ بدون salt به هش جدید
        try{
          const upgraded = await makePinRecord(this.pinEntry);
          await setDocRaw(pinDocRef(this.user.uid), {...upgraded, uid:this.user.uid, ts:Date.now()}, {merge:true});
          this.myPinHash = upgraded;
        }catch(e){ console.warn('PIN upgrade failed (will retry next time)', e); }
      }
      this.pinLocked=false; this.pinEntry=''; this.renderPinRoot();
      return;
    }
    const next = pinStateAfterFailure(failState, Date.now());
    this._writePinFail(next);
    this.pinEntry='';
    if(next.forceLogout){
      this._writePinFail(pinStateAfterSuccess());
      this.pinLocked=false; this.renderPinRoot();
      this.toastError('بیش از حد PIN اشتباه وارد شد؛ برای امنیت از حساب خارج شدید. با ایمیل و رمز عبور دوباره وارد شوید.');
      signOut(auth);
      return;
    }
    this.pinShake=true; this.renderPinRoot(); setTimeout(()=>{this.pinShake=false;},400);
  },
  async getMyPinHash(){
    if(!this.user) return null;
    const snap = await getDocQuick(pinDocRef(this.user.uid)); // اگر خطا بدهد، عمداً throw می‌کند (fail-safe نه fail-open)
    if(snap.exists() && snap.data().pinHash){
      this._refreshPinInBackground();
      return snap.data();
    }
    // سازگاری با نسخهٔ قبلی که (بی‌اثر) در سند team ذخیره می‌کرد
    try{
      const old = await getDocQuick(teamDocRef(this.user.uid));
      return (old.exists() && old.data().pinHash) ? { pinHash: old.data().pinHash } : null;
    }catch(e){ return null; }
  },
  /* اگر PIN از دستگاه دیگری عوض شده باشد، نسخهٔ سرور را (وقتی اینترنت بود) بی‌صدا جایگزین می‌کند */
  _refreshPinInBackground(){
    if(this._pinRefreshing || !this.user) return;
    this._pinRefreshing = true;
    const ref = pinDocRef(this.user.uid);
    Promise.race([getDoc(ref), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),15000))])
      .then(snap=>{ if(snap.exists() && snap.data().pinHash) this.myPinHash = snap.data(); })
      .catch(()=>{})
      .finally(()=>{ this._pinRefreshing=false; });
  },
  async setMyPinHash(pin){
    if(!this.user) return null;
    const rec = await makePinRecord(pin);
    try{ await setDocRaw(pinDocRef(this.user.uid), {...rec, uid:this.user.uid, ts:Date.now()}, {merge:true}); return rec; }
    catch(e){ this.toastError('PIN ذخیره نشد؛ دوباره تلاش کنید.'); return null; }
  },
  async resetPin(){
    if(!this.user) return;
    try{ await setDocRaw(pinDocRef(this.user.uid), {pinHash:null,pinSalt:null,pinAlgo:null,pinIter:null}, {merge:true}); this.myPinHash=null; this._writePinFail(pinStateAfterSuccess()); this.toast('قفل PIN حذف شد — دفعهٔ بعد یک PIN جدید تعیین کنید'); }
    catch(e){ this.toast('خطا در حذف PIN؛ دوباره تلاش کنید'); }
  },
  lockNow(){ if(!this.user) return; this.pinLocked=true; this.pinEntry=''; this.renderPinRoot(); },
  
  /* توست داخلی — جایگزین alert() مرورگر. kind: ok | error | info */
  toast(msg, kind){
    const root=document.getElementById('toast-root'); if(!root) return;
    const id='t'+Date.now()+Math.random().toString(36).slice(2,5);
    const k = kind || 'ok';
    const icon = k==='error' ? 'alert-triangle' : (k==='info' ? 'info' : 'check-circle');
    root.insertAdjacentHTML('beforeend',
      `<div id="${id}" class="toast ${k}">${ic(icon,16)}<span>${escapeHtml(msg)}</span></div>`);
    setTimeout(()=>{ const el=document.getElementById(id); if(el) el.remove(); }, k==='error'?3400:2200);
  },
  /* خطاها هم داخل خود اپ نشان داده می‌شوند، نه با alert() مرورگر */
  toastError(msg){ this.toast(msg,'error'); },

  /* ---------- Computations (بدون تغییر) ---------- */
  cashBalance(){
    const s=this.state;
    let cash = Number(s.settings.openingCash)||0;
    cash += sum(s.sales,'paid');
    cash += sum(s.payments.filter(p=>p.type==='receive'),'amount');
    s.purchases.forEach(p=>{
      const paidAFN = p.currency==='USD' ? (Number(p.paid)||0)*((Number(p.rateAtPurchase)||this.usdRate())||0) : (Number(p.paid)||0);
      cash -= paidAFN;
    });
    s.payments.filter(p=>p.type==='pay').forEach(p=>{
      const raw = (Number(p.amount)||0) - (p.purchaseId ? (Number(p.allocatedAmount)||0) : 0); // بخش تخصیص‌یافته به بل قبلاً در purchase.paid است
      const amtAFN = p.currency==='USD' ? raw*((Number(p.rate)||this.usdRate())||0) : raw;
      cash -= amtAFN;
    });
    cash -= cashExpensesTotal(s.expenses); // ضایعات پول نقد را کم نمی‌کند
    return cash;
  },
  inventoryValue(){
    return this.state.products.reduce((a,p)=>a+(p.stock*p.avgCost),0);
  },
  inventoryReportRows(){
    const threshold = this.state.settings.lowStockThreshold!==undefined ? Number(this.state.settings.lowStockThreshold) : 1;
    return this.state.products.map(p=>{
      const stock = Number(p.stock)||0;
      const avgCost = Number(p.avgCost)||0;
      const unit = this.unitByName(p, p.defaultSaleUnit);
      let status = 'موجود';
      if(p.archived) status = 'بایگانی‌شده';
      else if(stock < 0) status = 'موجودی منفی';
      else if(stock === 0) status = 'تمام‌شده';
      else if(this.isLowStock(p, threshold)) status = 'کم‌موجود';
      return {
        'شناسه محصول':p.id||'', 'نام محصول':p.name||'', 'واحد پایه':p.unit||'',
        'موجودی (نمایش)':this.qtyBreakdown(p, stock), 'موجودی پایه':stock,
        'واحد هشدار':unit&&unit.name||p.unit||'', 'حد هشدار':threshold,
        'میانگین بهای خرید هر واحد پایه (افغانی)':avgCost,
        'ارزش موجودی (افغانی)':round2(stock*avgCost),
        'قیمت فروش ثبت‌شده':Number(p.sellPrice)||0, 'وضعیت':status
      };
    }).sort((a,b)=>String(a['نام محصول']).localeCompare(String(b['نام محصول']), 'fa'));
  },
  inventorySummaryRows(rows){
    const products = rows || this.inventoryReportRows();
    const active = products.filter(r=>r['وضعیت']!=='بایگانی‌شده');
    return [
      {'شرح':'تعداد کل محصولات','مقدار':products.length},
      {'شرح':'محصولات فعال','مقدار':active.length},
      {'شرح':'محصولات کم‌موجود','مقدار':active.filter(r=>r['وضعیت']==='کم‌موجود').length},
      {'شرح':'محصولات تمام‌شده','مقدار':active.filter(r=>r['وضعیت']==='تمام‌شده').length},
      {'شرح':'محصولات با موجودی منفی','مقدار':active.filter(r=>r['وضعیت']==='موجودی منفی').length},
      {'شرح':'ارزش کل موجودی (افغانی، شامل موجودی منفی)','مقدار':round2(products.reduce((sum,r)=>sum+(Number(r['ارزش موجودی (افغانی)'])||0),0))},
    ];
  },
  totalReceivable(){ return this.state.customers.reduce((a,c)=>a+Math.max(0,c.balance||0),0); },
  totalPayable(){ return this.state.suppliers.reduce((a,c)=>a+Math.max(0,c.balance||0),0); },
  totalPayableUSD(){ return this.state.suppliers.reduce((a,c)=>a+Math.max(0,c.balanceUSD||0),0); },
  usdRate(){ return Number(this.state.settings.usdRate)||0; },
  totalPayableUSDInAFN(){ return this.totalPayableUSD() * this.usdRate(); },
  totalPayableCombinedAFN(){ return this.totalPayable() + this.totalPayableUSDInAFN(); },
  curLabel(code){ return code==='USD' ? 'دالر' : this.state.settings.currency; },
  quickSetUsdRate(){
    const cur = this.state.settings.usdRate || '';
    this.openFormModal({
      title:'نرخ دالر',
      sub:'۱ دالر معادل چند افغانی است؟',
      fields:[{key:'rate', label:'نرخ دالر (افغانی)', type:'number', step:'0.01', value:cur||''}],
      submitLabel:'ذخیره',
      onSubmit: (v)=>{
        if(!v.rate || v.rate<=0) throw new Error('نرخ نامعتبر است.');
        return updateDoc(settingsDocRef, {usdRate:v.rate}).then(()=>{ this.toast('نرخ دالر ذخیره شد'); });
      }
    });
  },
  salesInRange(start,end){
    return this.state.sales.filter(x=>x.date>=start && x.date<=end);
  },
  expensesInRange(start,end){
    return this.state.expenses.filter(x=>x.date>=start && x.date<=end);
  },
  purchasesInRange(start,end){
    return this.state.purchases.filter(x=>x.date>=start && x.date<=end);
  },

  /* ---------- Dashboard ---------- */
  
  /* =========================================================
     واحدهای فروش: ساختار جدید
     - unit: واحد پایهٔ داخلی/محاسباتی (همیشه «عدد»؛ در فروش عادی نمایش داده نمی‌شود)
     - unitQty: سازگاری با داده‌های قدیمی
     - packUnit: واحد بزرگ (اختیاری)
     - packPer: چند واحد پایه = یک واحد بزرگ
     - stock: موجودی = به واحد پایه
   ========================================================= */
  productUnits(p){ return _productUnits(p); },
  saleUnits(p){ return _saleUnits(p); },
  // خرید/فروش معمولی فقط در واحدهای بسته‌بندی‌شده؛ «عدد» واحد داخلی است.
  transactionUnits(p){ return _transactionUnits(p); },
  // محصولی که «عدد داخلی» ندارد (مثلاً فقط کارتن، یا کارتن+قوطی): خودِ واحد پایه قابل معامله است
  isBaseTradable(p){ return _isBaseTradable(p); },
  baseLabel(p){ return _baseLabel(p); },
  canSellFractional(p){ return !!(p && p.allowFractionalSale); },
  unitByName(p, name){ return _unitByName(p, name); },
  unitSellPrice(p, u){ return _unitSellPrice(p, u); },
  isUnitPriceManual(p,u){
    if(!p||!u) return false;
    return (u.key==='pack' && Number(p.sellPricePack)>0);
  },
  unitCost(p, u){ return round4((Number(p&&p.avgCost)||0)*(u?u.factor:1)); },
  
  qtyBreakdown(p, baseQty){ return _qtyBreakdown(p, baseQty); },
  
  unitLadderLabel(p){
    const ladder=this.productUnits(p);
    const parts=[];
    for(let i=0;i<ladder.length-1;i++){
      const bigger=ladder[i], smaller=ladder[i+1];
      const ratio=bigger.factor/smaller.factor;
      if(ratio>1) parts.push('۱ '+bigger.name+' = '+fmtQty(ratio)+' '+smaller.name);
    }
    return parts.join(' · ');
  },

  /* --- نمایش اقلام فاکتور --- */
  itemFactor(it){ const f=Number(it&&it.txFactor)||0; return f>0?f:1; },
  itemUnitName(it){ return (it&&it.txUnit) || (it&&it.unit) || 'عدد'; },
  itemUnits(it){
    const p=this.state.products.find(x=>x.id===it.productId);
    if(p) return this.productUnits(p);
    const f=this.itemFactor(it);
    const base={key:'base', name:(it.unit||'عدد'), factor:1};
    return f>1 ? [{key:'tx', name:this.itemUnitName(it), factor:f}, base] : [base];
  },
  itemQtyLabel(it, baseQtyOverride){
    const f=this.itemFactor(it);
    const q = baseQtyOverride!==undefined ? (Number(baseQtyOverride)||0) : (Number(it.qty)||0);
    if(f===1) return fmtQty(q)+' '+this.itemUnitName(it);
    const inUnit=q/f;
    if(Math.abs(inUnit-Math.round(inUnit))<1e-9) return fmtQty(Math.round(inUnit))+' '+this.itemUnitName(it);
    const p=this.state.products.find(x=>x.id===it.productId);
    return p ? this.qtyBreakdown(p,q) : fmtQty(round2(inUnit))+' '+this.itemUnitName(it);
  },
  itemBaseNote(it){
    const f=this.itemFactor(it);
    if(f<=1) return '';
    return '= '+fmtQty(it.qty)+' '+(it.unit||'عدد');
  },
  itemQtyLabelForInvoice(it, baseQtyOverride){
    const f=this.itemFactor(it);
    const q = baseQtyOverride!==undefined ? (Number(baseQtyOverride)||0) : (Number(it.qty)||0);
    const baseName = it.unit || 'عدد';
    if(f===1) return fmtQty(q)+' '+this.itemUnitName(it);
    const adj = Number(it.adjBase)||0;
    if(baseQtyOverride===undefined && adj>0){
      const whole=(q+adj)/f;
      const wholeTxt = Math.abs(whole-Math.round(whole))<1e-9 ? fmtQty(Math.round(whole)) : fmtQty(round2(whole));
      return wholeTxt+' '+this.itemUnitName(it)+' (منهای '+fmtQty(adj)+' '+baseName+')';
    }
    const inUnit=q/f;
    if(Math.abs(inUnit-Math.round(inUnit))<1e-9) return fmtQty(Math.round(inUnit))+' '+this.itemUnitName(it);
    const p=this.state.products.find(x=>x.id===it.productId);
    if(!p) return fmtQty(round2(inUnit))+' '+this.itemUnitName(it);
    return this.qtyBreakdown(p, q);
  },

  itemPricePerTxUnit(it){ return round2((Number(it.unitPrice)||0)*this.itemFactor(it)); },
  itemCostPerTxUnit(it){ return round2((Number(it.unitCost)||0)*this.itemFactor(it)); },

  stockInUnit(p, unit){ if(!p) return 0; return round2((Number(p.stock)||0)/(unit?unit.factor:1)); },


    stockInUnit(p, unit){ if(!p) return 0; return round2((Number(p.stock)||0)/(unit?unit.factor:1)); },

  /* --- فرم‌های خرید/فروش: خواندن محصول و واحد انتخاب‌شده از روی صفحه --- */
  formProduct(prefix){
    const sel=document.getElementById(prefix+'-product'); if(!sel) return null;
    if(sel.value==='__new__') return this.draftNewProduct(prefix);
    return this.state.products.find(p=>p.id===sel.value)||null;
  },
  draftNewProduct(prefix){
    const gs=id=>{ const el=document.getElementById(id); return el?String(el.value||'').trim():''; };
    const gn=id=>{ const el=document.getElementById(id); return el?(parseFloat(el.value)||0):0; };
    const pk=_buildPackaging({
      packName:gs(prefix+'-newpackunit'), packPer:gn(prefix+'-newpackper'),
      midName:gs(prefix+'-newmidunit'),   midPer:gn(prefix+'-newmidper')
    });
    const name=gs(prefix+'-newname');
    if(!pk.ok){
      // هنوز واحدی کامل تعریف نشده؛ همان رفتار قبلی (بدون واحد معامله)
      return { name, unit:'عدد', unitQty:1, baseTradable:false, stock:0, avgCost:0, sellPrice:0,
        midUnit:'', midPer:0, packUnit:'', packPer:0, defaultSaleUnit:'', saleUnits:[], allowFractionalSale:false, _packagingError: pk.error };
    }
    const tradeNames=[pk.packUnit, pk.midUnit, pk.baseTradable?pk.unit:''].filter(Boolean);
    const uniq=[...new Set(tradeNames)];
    return {
      name, unit: pk.unit, unitQty:1, baseTradable: pk.baseTradable, stock:0, avgCost:0, sellPrice:0,
      midUnit: pk.midUnit, midPer: pk.midPer,
      packUnit: pk.packUnit, packPer: pk.packPer,
      defaultSaleUnit: uniq[0]||'',
      saleUnits: uniq,
      allowFractionalSale: false
    };
  },
  formUnit(prefix){
    const p=this.formProduct(prefix); if(!p) return null;
    const sel=document.getElementById(prefix+'-unit');
    return this.unitByName(p, sel?sel.value:null);
  },
  // پر کردن لیست واحدها بر اساس محصول انتخاب‌شده (یا محصول جدیدی که کاربر تایپ می‌کند)
  fillUnitSelect(prefix, keepPrice){
    const sel=document.getElementById(prefix+'-unit'); if(!sel) return;
    const p=this.formProduct(prefix);
    const ladder = p ? this.transactionUnits(p) : [];
    const prev=sel.value;
    const baseName = p ? (p.unit||'عدد') : 'عدد';
    sel.innerHTML = ladder.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' — '+fmtQty(u.factor)+' '+escapeHtml(baseName):''}</option>`).join('');
    let def=prev;
    if(!ladder.some(u=>u.name===prev)){
      if(prefix==='pp') def = ladder.length?ladder[0].name:'';
      else def = (p&&p.defaultSaleUnit && ladder.some(u=>u.name===p.defaultSaleUnit)) ? p.defaultSaleUnit : (ladder.length?ladder[0].name:'');
    }
    sel.value=def;
    if(!keepPrice) this.autofillUnitPrice(prefix);
    this.updateUnitHint(prefix);
  },
  autofillUnitPrice(prefix){
    const p=this.formProduct(prefix), u=this.formUnit(prefix);
    if(!p||!u) return;
    if(prefix==='sp'){
      const el=document.getElementById('sp-price'); if(!el) return;
      const v=this.unitSellPrice(p,u); el.value = v>0 ? v : '';
    } else {
      const el=document.getElementById('pp-cost'); if(!el) return;
      const v=this.unitCost(p,u); el.value = v>0 ? v : '';
    }
  },
  // راهنمای زیر فیلدها: معادل واحد پایه، موجودی به تفکیک واحدها، و قیمت خردشدهٔ واحدهای کوچک‌تر
  updateUnitHint(prefix){
    const p=this.formProduct(prefix), u=this.formUnit(prefix);
    const base = p ? (p.unit||'عدد') : 'عدد';
    const noteEl=document.getElementById(prefix+'-unit-note');
    const qtyHint=document.getElementById(prefix+'-qty-hint');
    const priceHint=document.getElementById(prefix+'-price-hint');
    const priceLabel=document.getElementById(prefix+'-price-label');
    const qtyEl=document.getElementById(prefix+'-qty');
    const priceEl=document.getElementById(prefix==='sp'?'sp-price':'pp-cost');
    const qty=qtyEl?(parseFloat(qtyEl.value)||0):0;
    const price=priceEl?parseFloat(priceEl.value):NaN;
    if(noteEl) noteEl.textContent = (u&&u.factor>1) ? ('۱ '+u.name+' = '+fmtQty(u.factor)+' '+base) : '';
    if(qtyHint){
      const bits=[];
      if(u&&u.factor>1&&qty>0) bits.push('= '+fmtQty(round2(qty*u.factor))+' '+(p?this.baseLabel(p):'عدد داخلی'));
      if(prefix==='sp'&&p&&p.id) bits.push('موجودی: '+this.qtyBreakdown(p,p.stock||0));
      qtyHint.textContent=bits.join(' · ');
    }
    if(priceLabel&&u){
      priceLabel.textContent = prefix==='sp'
        ? ('قیمت فروش هر '+u.name)
        : ('قیمت خرید هر '+u.name+' ('+this.curLabel((this.purchaseDraft&&this.purchaseDraft.currency)||'AFN')+')');
    }
    if(priceHint){
      if(p&&u&&!isNaN(price)&&price>0&&u.factor>1){
        const per=price/u.factor;
        const smaller=this.productUnits(p).filter(x=>x.factor<u.factor);
        priceHint.textContent = smaller.length
          ? (prefix==='sp'?'یعنی هر ':'قیمت تمام‌شده: هر ')+smaller.filter(x=>x.key!=='base').map(x=>x.name+' = '+fmt2(round2(per*x.factor))).join(' · هر ')
          : '';
      } else priceHint.textContent='';
    }
  },

  /* ---------- Sale ---------- */
  addSaleItem(){
    const sel=document.getElementById('sp-product');
    let pid=sel.value;
    if(!pid){ this.toast('یک محصول انتخاب کنید'); return; }
    let product;
    if(pid==='__new__'){
      const d=this.draftNewProduct('sp');
      if(!d.name){ this.toast('نام محصول جدید را بنویسید'); return; }
      // نکته: این محصول هنوز در دیتابیس ذخیره نمی‌شود؛ فقط وقتی فاکتور نهایی ثبت شود ذخیره خواهد شد
      // (تا اگر فاکتور رها شود، محصول یتیم با موجودی صفر در فهرست باقی نماند)
      product = Object.assign({}, d, { id: uid(), _draftOnly:true });
      if(d._packagingError){ this.toast(d._packagingError); return; }
    } else {
      product = this.state.products.find(p=>p.id===pid);
    }
    if(!product){ this.toast('محصول پیدا نشد.'); return; }
    if(!this.transactionUnits(product).length){ this.toast('برای این محصول هنوز واحد فروش مثل کارتن، قوطی یا بسته تعریف نشده است.'); return; }
    const u = this.unitByName(product, (document.getElementById('sp-unit')||{}).value);
    const qtyIn = parseFloat(document.getElementById('sp-qty').value);
    const priceIn = parseFloat(document.getElementById('sp-price').value);
    if(!qtyIn||qtyIn<=0){ this.toast('تعداد را درست بنویسید'); return; }
    if(!u || (u.key==='base' && !this.isBaseTradable(product))){ this.toast('واحد پایه فقط برای محاسبه است و در فروش عادی قابل انتخاب نیست.'); return; }
    if(!this.canSellFractional(product) && Math.abs(qtyIn-Math.round(qtyIn))>1e-9){ this.toast('برای این محصول فروش کسری فعال نیست؛ تعداد را به واحد کامل بنویسید.'); return; }
    if(isNaN(priceIn)||priceIn<0){ this.toast('قیمت فروش را بنویسید'); return; }
    // همه‌چیز به واحد پایه تبدیل و ذخیره می‌شود؛ واحد انتخابی فقط برای نمایش نگه داشته می‌شود
    const qty = round2(qtyIn*u.factor);
    const price = priceIn/u.factor;
    if(product._draftOnly){
      // محصول جدید در فروش: قیمت خرید اجباری است (وگرنه بهای تمام‌شده صفر و کل فروش «سود» حساب می‌شد)
      const costIn = parseFloat((document.getElementById('sp-newcost')||{}).value);
      const costBase = costPerBase(costIn, u.factor);
      if(costBase===null){ this.toast('قیمت خرید محصول جدید را بنویسید (باید بزرگ‌تر از صفر باشد).'); return; }
      product.avgCost = costBase;
    }
    /* قلم فقط بعد از تأیید نهایی اضافه می‌شود — هشدار کم‌موجودی حالا مودال داخلی است، نه confirm() مرورگر */
    const finish = ()=>{
      if(product._draftOnly){
        this.saleDraft._draftProducts = this.saleDraft._draftProducts || [];
        if(!this.saleDraft._draftProducts.some(p=>p.id===product.id)) this.saleDraft._draftProducts.push(product);
      }
      this.saleDraft.items.push({productId:product.id,name:product.name,unit:product.unit,qty,unitPrice:price,cost:product.avgCost,txUnit:u.name,txFactor:u.factor});
      this.render();
    };
    if(qty>product.stock){
      this.openConfirmModal({
        title:'موجودی کافی نیست',
        msg:'از «'+product.name+'» فقط '+this.qtyBreakdown(product, product.stock||0)+' در انبار مانده، ولی '+fmtQty(qtyIn)+' '+u.name+' ('+fmtQty(qty)+' '+(product.unit||'عدد')+') فروخته می‌شود. باز هم اضافه شود؟ (موجودی منفی می‌شود)',
        danger:true, confirmLabel:'باز هم اضافه کن',
        onConfirm: finish
      });
      return;
    }
    finish();
  },
  removeSaleItem(idx){ this.saleDraft.items.splice(idx,1); this.render(); },

  async submitSale(){
    if(this._saleBusy) return; // جلوگیری از ثبت دوباره با دوبار لمس
    if(this.saleDraft.items.length===0){ this.toast('حداقل یک محصول اضافه کنید'); return; }
    this._saleBusy=true;
    try{
      const txSaleId = this.saleDraft.txId || uid();
      if(this.state.sales.some(s=>s.id===txSaleId)){ this.toast('این فاکتور قبلاً ثبت شده است.'); return; }
      const total = round2(this.saleDraft.items.reduce((a,i)=>a+i.qty*i.unitPrice,0));
      let paid = parseFloat(document.getElementById('sale-paid').value);
      if(isNaN(paid)) paid=0;
      if(paid>total) paid=total;
      if(paid<0) paid=0;
      const custName = (document.getElementById('sale-customer-name').value||'').trim();
      const custPhone = (document.getElementById('sale-customer-phone').value||'').trim();
      const custAddress = (document.getElementById('sale-customer-address').value||'').trim();
      const date = document.getElementById('sale-date').value || todayISO();
      const note = (document.getElementById('sale-note').value||'').trim();
      const remaining = round2(total-paid);
      const draftProducts = this.saleDraft._draftProducts || [];
      const saleId = txSaleId;

      const commitOfflineBatch = async()=>{
        App._mv('SALE','فروش'); const batch = writeBatch(db);
        let customerId=null, customerNameFinal='مشتری نقدی';
        if(custName){
          const customer=this.state.customers.find(c=>normalizeName(c.name)===normalizeName(custName));
          if(!customer){
            customerId=uid(); customerNameFinal=custName;
            batch.set(doc(cols.customers,customerId), {id:customerId,name:custName,phone:custPhone,address:custAddress,balance:remaining, ...this.recordMeta()});
          } else {
            customerId=customer.id; customerNameFinal=customer.name;
            const fields={ balance: increment(remaining) };
            if(custPhone && !customer.phone) fields.phone=custPhone;
            if(custAddress && !customer.address) fields.address=custAddress;
            batch.update(doc(cols.customers,customer.id), fields);
          }
        } else if(remaining>0.001){
          throw new Error('برای فروش قرضی (نسیه) باید نام مشتری را بنویسید');
        }
        let totalCost=0;
        this.saleDraft.items.forEach(it=>{
          const draftP=draftProducts.find(dp=>dp.id===it.productId);
          if(draftP){
            const draftCost = Number(draftP.avgCost)||Number(it.cost)||0;
            totalCost += it.qty*draftCost;
            batch.set(doc(cols.products,draftP.id), {id:draftP.id,name:draftP.name,unit:draftP.unit,stock:-it.qty,avgCost:draftCost,sellPrice:it.unitPrice,
              baseTradable:!!draftP.baseTradable,midUnit:draftP.midUnit||'',midPer:draftP.midPer||0,packUnit:draftP.packUnit||'',packPer:draftP.packPer||0,
              defaultSaleUnit:draftP.defaultSaleUnit||draftP.packUnit||draftP.midUnit||'',
              saleUnits:draftP.saleUnits||[draftP.packUnit||draftP.midUnit||''].filter(Boolean),allowFractionalSale:!!draftP.allowFractionalSale,
              sellPriceMid:0,sellPricePack:0});
          } else {
            const p=this.state.products.find(pp=>pp.id===it.productId);
            const cost=Number(p&&p.avgCost)||Number(it.cost)||0;
            totalCost += it.qty*cost;
            batch.update(doc(cols.products,it.productId), { stock: increment(-it.qty) });
          }
        });
        totalCost=round2(totalCost);
        const newSale={id:saleId,invoiceNo:this.invoiceNoForNew(saleId,'S'),ts:Date.now(),date,customerId,customerName:customerNameFinal,
          customerPhone:custPhone,customerAddress:custAddress,
          items:this.saleDraft.items.map(it=>({...it,cost:Number((this.state.products.find(p=>p.id===it.productId)||{}).avgCost)||Number(it.cost)||0,returnedQty:0})),
          total,totalCost,profit:round2(total-totalCost),paid,remaining,note,status:'active',returns:[],originalTotal:total,discount:0,returnedAmount:0,returnedCost:0,...this.recordMeta()};
        batch.set(doc(cols.sales,saleId),newSale);
        this.audit(batch,{action:'create',entityType:'sale',entityId:saleId,before:null,after:newSale});
        await batch.commit();
      };



      // همیشه «اول محلی»: بدون هیچ انتظاری برای اینترنت ثبت می‌شود و خودکار همگام می‌شود.
      // (transaction نیاز به سرور دارد و با اینترنت ضعیف/قطع گیر می‌کرد.)
      try{ await commitOfflineBatch(); }
      catch(e){
        this._markWriteResult(false,e);
        App.toastError('ذخیرهٔ فاکتور فروش انجام نشد. '+(e.message||''));
        return;
      }
      this._markWriteResult(true);
      this.resetSaleDraft();
      this.viewInvoiceId=saleId;
      this.navigate('invoice');
    }catch(e){
      console.error('submitSale error',e);
      this._markWriteResult(false,e);
      App.toastError('خطا در ذخیرهٔ فاکتور؛ فاکتور ثبت نشد. '+(e.message||''));
    }finally{
      this._saleBusy=false;
    }
  },

  /* ---------- Invoice view / print / whatsapp ---------- */
  viewInvoice(id){ this.viewInvoiceId=id; this.navigate('invoice'); },
  printInvoice(){ window.print(); },
  // شمارهٔ فاکتور جدید از خود ID یکتا ساخته و داخل رکورد ذخیره می‌شود؛
  // بنابراین با حذف/مرتب‌سازی/همگام‌سازی دوباره تغییر نمی‌کند و دو دستگاه آفلاین
  // نیز شمارهٔ یکسان تولید نمی‌کنند. رکوردهای قدیمی تا زمان مهاجرت، شمارهٔ قبلی خود را دارند.
  saleSeqNo(saleId){
    const s=this.state.sales.find(x=>x.id===saleId);
    if(s && s.invoiceNo) return s.invoiceNo;
    const idx=this.state.sales.findIndex(x=>x.id===saleId);
    return idx>=0 ? String(idx+1).padStart(5,'0') : '00000';
  },
  invoiceNoLabel(saleId){ const s=this.state.sales.find(x=>x.id===saleId); return '#'+this.invoiceNoValue(s,'S'); },
  purchaseSeqNo(purchaseId){
    const p=this.state.purchases.find(x=>x.id===purchaseId);
    if(p && p.invoiceNo) return p.invoiceNo;
    const idx=this.state.purchases.findIndex(x=>x.id===purchaseId);
    return idx>=0 ? String(idx+1).padStart(5,'0') : '00000';
  },
  purchaseNoLabel(purchaseId){ const p=this.state.purchases.find(x=>x.id===purchaseId); return '#'+this.invoiceNoValue(p,'B'); },
  purchaseBillLabel(pur){ return pur.supplierInvoiceNo ? ('بل #'+pur.supplierInvoiceNo) : this.purchaseNoLabel(pur.id); },
  editPurchaseInvoiceNo(purchaseId){
    if(!this.guardWrite()) return;
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    this.openFormModal({
      title:'شمارهٔ بل عمده‌فروش',
      sub:'همان شماره‌ای که روی رسید کاغذی خرید نوشته شده — اختیاری',
      fields:[{key:'no', label:'شمارهٔ بل/فاکتور', value:pur.supplierInvoiceNo||''}],
      submitLabel:'ذخیره',
      onSubmit: async (v)=>{
        await updateDoc(doc(cols.purchases, purchaseId), { supplierInvoiceNo:(v.no||'').trim(), ...this.editMeta() });
        this.toast('ذخیره شد');
      }
    });
  },
  waPhoneDigits(phone){
    let d=(phone||'').replace(/[^0-9]/g,'');
    if(!d) return '';
    if(d.startsWith('0093')) d='93'+d.slice(4);      // پیشوند بین‌المللی 00 + کد کشور (احتیاطی)
    else if(d.startsWith('00')) d=d.slice(2);        // پیشوند بین‌المللی 00 خام
    else if(d.startsWith('0')) d='93'+d.slice(1);    // شماره محلی با صفر → +93
    else if(!d.startsWith('93') && d.length<=10) d='93'+d; // بدون کد کشور و بدون صفر
    return d;
  },
  buildInvoiceText(sale){
    const s=this.state.settings;
    let lines=[];
    lines.push(`${s.logoEmoji||''} ${s.businessName}`.trim());
    if(s.businessPhone) lines.push('تماس: '+s.businessPhone);
    lines.push('———————————————');
    if(sale.status==='cancelled') lines.push('⚠️ این فاکتور باطل شده است');
    lines.push('فاکتور فروش '+this.invoiceNoLabel(sale.id));
    lines.push('تاریخ: '+sale.date);
    lines.push('مشتری: '+sale.customerName);
    if(sale.customerPhone) lines.push('تماس مشتری: '+sale.customerPhone);
    if(sale.customerAddress) lines.push('آدرس: '+sale.customerAddress);
    lines.push('———————————————');
    sale.items.forEach((it,idx)=>{
      const ret = it.returnedQty ? ` (مرجوعی: ${this.itemQtyLabel(it, it.returnedQty)})` : '';
      const base = this.itemFactor(it)>1 ? ` [${fmtQty(it.qty)} ${it.unit}]` : '';
      lines.push(`${idx+1}. ${it.name} — ${this.itemQtyLabelForInvoice(it)}${base} × ${fmt(this.itemPricePerTxUnit(it))} = ${fmt(it.qty*it.unitPrice)}${ret}`);
    });
    lines.push('———————————————');
    if(sale.originalTotal!==undefined && Math.abs(sale.originalTotal-sale.total)>0.5) lines.push('مجموع اولیهٔ فاکتور: '+fmt(sale.originalTotal)+' '+s.currency);
    if(sale.discount>0.5) lines.push('🏷 تخفیف داده‌شده: '+fmt(sale.discount)+' '+s.currency);
    lines.push('مجموع فاکتور: '+fmt(sale.total)+' '+s.currency);
    lines.push('پرداخت‌شده: '+fmt(sale.paid)+' '+s.currency);
    if((Number(sale.settled)||0)>0.5) lines.push('پرداخت‌های بعدی: '+fmt(sale.settled)+' '+s.currency);
    if(sale.status==='cancelled') lines.push('وضعیت: باطل شده ❌');
    else if(sale.remaining>0.5) lines.push('باقیمانده (قرض): '+fmt(sale.remaining)+' '+s.currency);
    else lines.push('وضعیت: تسویه‌شده ✅');
    if(sale.note) lines.push('یادداشت: '+sale.note);
    if(sale.returns && sale.returns.length){
      lines.push('———————————————');
      lines.push('↩️ کالاهای مرجوعی:');
      sale.returns.forEach(r=> lines.push(`- ${r.name} — ${r.qtyLabel||(r.qty+' عدد')} — ${fmt(r.amount)} ${s.currency}`));
    }
    lines.push('———————————————');
    lines.push('با تشکر از خرید شما 🙏');
    return lines.join('\n');
  },
  sendInvoiceWhatsApp(id){
    const sale=this.state.sales.find(x=>x.id===id);
    if(!sale) return;
    const text=encodeURIComponent(this.buildInvoiceText(sale));
    const digits=this.waPhoneDigits(sale.customerPhone);
    const url = digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url,'_blank');
  },
  
  /* ---------- Invoice full edit (items price/qty + customer info) ----------
     برخلاف افزودن/مرجوعی که فقط یک تغییر کوچک را ثبت می‌کنند، این حالت به کاربر
     اجازه می‌دهد قیمت و تعداد هر قلم و نیز اطلاعات مشتری (نام/شماره/آدرس) را
     یک‌جا ویرایش کند. بعد از ذخیره، مجموع فاکتور، بدهی مشتری (قدیم/جدید) و
     موجودی انبار همگی بر اساس مقدار جدید دوباره محاسبه و اصلاح می‌شوند. */
  
  startEditInvoice(saleId){
    if(!this.isAdmin()){ this.toast('ویرایش کامل فاکتور فقط برای مدیر manager@motar.com فعال است.'); return; }
    if(!this.guardWrite()) return;
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است و قابل ویرایش نیست.'); return; }
    this.editingInvoiceId=saleId;
    this._editBaseTs = sale.lastEditedTs||0; // نسخهٔ فاکتور در لحظهٔ باز شدن فرم
    this.render();
  },
  cancelEditInvoice(){
    this.editingInvoiceId=null; this._editBaseTs=undefined;
    this.render();
  },
  saveEditInvoice(saleId, confirmedNegative){
    if(!this.isAdmin()){ this.toast('ویرایش کامل فاکتور فقط برای مدیر manager@motar.com مجاز است.'); return; }
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    // تشخیص تداخل: اگر بعد از باز شدن فرم، دستگاه دیگری همین فاکتور را عوض کرده باشد، رونویسی نمی‌کنیم
    if(this._editBaseTs!==undefined && (sale.lastEditedTs||0)!==this._editBaseTs){
      App.toastError('تداخل (Conflict): این فاکتور بعد از باز شدن فرم توسط کاربر/دستگاه دیگری تغییر کرده است. چیزی ذخیره نشد؛ فرم را ببندید و دوباره باز کنید.');
      return;
    }

    const newItems = sale.items.map((it,idx)=>{
      const f=this.itemFactor(it);
      const qtyEl=document.getElementById('edit-item-qty-'+idx);
      const priceEl=document.getElementById('edit-item-price-'+idx);
      // ورودی‌ها به واحد معامله‌شده‌اند و اینجا به واحد پایه برمی‌گردند
      const qty=round2(parseFloat(qtyEl ? qtyEl.value : NaN)*f);
      const unitPrice=parseFloat(priceEl ? priceEl.value : NaN)/f;
      return {...it, qty, unitPrice};
    });
    for(const it of newItems){
      if(isNaN(it.qty)||it.qty<0){ App.toastError('تعداد نامعتبر برای «'+it.name+'»'); return; }
      if(isNaN(it.unitPrice)||it.unitPrice<0){ App.toastError('قیمت نامعتبر برای «'+it.name+'»'); return; }
      if(it.qty < (it.returnedQty||0)-1e-9){ App.toastError('تعداد «'+it.name+'» نمی‌تواند کمتر از مقدار مرجوعی‌شدهٔ آن ('+App.itemQtyLabel(it,it.returnedQty||0)+') باشد.'); return; }
    }

    const correctedItems = newItems.filter(it=>it.qty>0 || (it.returnedQty||0)>0);
    if(!correctedItems.length){ this.toast('فاکتور نمی‌تواند بدون قلم بماند؛ برای لغو کامل از «کنسل کامل فاکتور» استفاده کنید.'); return; }
    const custName=(document.getElementById('edit-customer-name').value||'').trim();
    const custPhone=(document.getElementById('edit-customer-phone').value||'').trim();
    const custAddress=(document.getElementById('edit-customer-address').value||'').trim();
    const date=document.getElementById('edit-sale-date').value || sale.date;
    const note=(document.getElementById('edit-sale-note').value||'').trim();
    const correctionReason=(document.getElementById('edit-sale-reason').value||'').trim();
    if(!correctionReason){ this.toast('برای اصلاح فاکتور، دلیل اصلاح را بنویسید.'); return; }

    const finalItems = correctedItems;
    const newTotalCost = round2(finalItems.reduce((a,i)=>a+(i.qty-(i.returnedQty||0))*(i.cost||0),0));

    // مجموع، تخفیف، پرداختی و باقیمانده فقط از calcInvoice می‌آیند.
    // تخفیفی که قبلاً روی فاکتور ثبت شده (sale.discount) با ویرایش از بین نمی‌رود.
    let paidInput=parseFloat(document.getElementById('edit-sale-paid').value);
    if(isNaN(paidInput)||paidInput<0) paidInput=0;
    const calc = calcInvoice({ items:finalItems, discount:sale.discount, paid:paidInput, settled:sale.settled||0 });
    const newTotal=calc.total, paid=calc.paid, newRemaining=calc.remaining, overpaid=calc.overpaid;
    // اضافه‌پرداخت (مشتری بیشتر از مجموع جدید داده) گم نمی‌شود: به‌عنوان اعتبار در حساب مشتری ثبت می‌شود
    if(overpaid>0.001 && !custName){ this.toast('مبلغ دریافتی از مجموع فاکتور بیشتر است ('+fmt(overpaid)+'). برای ثبت اعتبار، نام مشتری را بنویسید یا مبلغ را کم کنید.'); return; }

    if(!custName && newRemaining>0.001){ this.toast('برای فروش قرضی (نسیه) باید نام مشتری مشخص باشد.'); return; }

    // موجودی انبار: فقط تفاوت تعداد نسبت به مقدار قبلیِ همان قلم اعمال می‌شود
    const stockDeltas={};
    const oldByPid={}; const newByPid={};
    sale.items.forEach(it=>{ oldByPid[it.productId]=(oldByPid[it.productId]||0)+Number(it.qty||0); });
    correctedItems.forEach(it=>{ newByPid[it.productId]=(newByPid[it.productId]||0)+Number(it.qty||0); });
    const pids=new Set([...Object.keys(oldByPid),...Object.keys(newByPid)]);
    pids.forEach(pid=>{ const deltaQty=(newByPid[pid]||0)-(oldByPid[pid]||0); if(Math.abs(deltaQty)>1e-9) stockDeltas[pid]=(stockDeltas[pid]||0)-deltaQty; });

    let willGoNegative=false;
    Object.keys(stockDeltas).forEach(pid=>{
      const p=this.state.products.find(x=>x.id===pid);
      if(p && (p.stock+stockDeltas[pid])<0) willGoNegative=true;
    });
    /* مودال داخلی به‌جای confirm() مرورگر؛ فرم ویرایش دست‌نخورده باقی می‌ماند و بعد از تأیید همین تابع دوباره اجرا می‌شود */
    if(willGoNegative && !confirmedNegative){
      this.openConfirmModal({
        title:'موجودی منفی می‌شود',
        msg:'با این ویرایش، موجودی بعضی کالاها در انبار منفی می‌شود. باز هم ذخیره شود؟',
        danger:true, confirmLabel:'بله، ذخیره کن',
        onConfirm: ()=> this.saveEditInvoice(saleId, true)
      });
      return;
    }

    App._mv('SALE','ویرایش فاکتور فروش'); const batch=writeBatch(db);
    const oldCustomerId=sale.customerId;
    const oldRemaining=sale.remaining||0;
    let newCustomerId=null, newCustomerNameFinal='مشتری نقدی';

    if(custName){
      const existing=this.state.customers.find(c=>normalizeName(c.name)===normalizeName(custName));
      if(existing){ newCustomerId=existing.id; newCustomerNameFinal=existing.name; }
      else { newCustomerId=uid(); newCustomerNameFinal=custName; }
    }
    if((Number(sale.settled)||0)>0.001 && newCustomerId!==oldCustomerId){
      this.toast('این فاکتور پرداختِ بعدیِ تخصیص‌یافته دارد؛ برای تغییر مشتری، اول پرداخت‌های تخصیص‌یافته را با «ابطال/برگشت» اصلاح کنید.');
      return;
    }

    // اصلاح بدهی مشتری قدیم/جدید (delta-based، تا با ویرایش هم‌زمان تداخل نکند)
    if(oldCustomerId && newCustomerId && oldCustomerId===newCustomerId){
      const existing=this.state.customers.find(c=>c.id===oldCustomerId);
      const fields={ balance: increment(newRemaining-oldRemaining-overpaid) };
      if(custPhone && custPhone!==(existing&&existing.phone)) fields.phone=custPhone;
      if(custAddress && custAddress!==(existing&&existing.address)) fields.address=custAddress;
      batch.update(doc(cols.customers,oldCustomerId), fields);
    } else {
      if(oldCustomerId && Math.abs(oldRemaining)>0.0001){
        batch.update(doc(cols.customers,oldCustomerId), { balance: increment(-oldRemaining) });
      }
      if(newCustomerId){
        const existing=this.state.customers.find(c=>c.id===newCustomerId);
        if(existing){
          const fields={};
          if(Math.abs(newRemaining-overpaid)>0.0001) fields.balance=increment(newRemaining-overpaid);
          if(custPhone && custPhone!==existing.phone) fields.phone=custPhone;
          if(custAddress && custAddress!==existing.address) fields.address=custAddress;
          if(Object.keys(fields).length) batch.update(doc(cols.customers,newCustomerId), fields);
        } else {
          batch.set(doc(cols.customers,newCustomerId), {id:newCustomerId,name:custName,phone:custPhone,address:custAddress,balance:newRemaining-overpaid, ...this.recordMeta()});
        }
      }
    }

    Object.keys(stockDeltas).forEach(pid=>{
      if(stockDeltas[pid]!==0) batch.update(doc(cols.products,pid), { stock: increment(stockDeltas[pid]) });
    });

    batch.update(doc(cols.sales, sale.id), {
      items:finalItems, customerId:newCustomerId, customerName:newCustomerNameFinal,
      customerPhone:custPhone, customerAddress:custAddress, date, note,
      total:newTotal, discount:calc.discount, totalCost:newTotalCost, profit:round2(newTotal-newTotalCost),
      paid, settled:calc.settled, remaining:newRemaining, lastEditReason:correctionReason, ...this.editMeta()
    });

    { const rel=round2((Number(sale.settled)||0)-calc.settled); if(rel>0.001) this._releaseAllocations(batch, sale.id, rel); }
    this.audit(batch, { action:'edit', entityType:'sale', entityId:sale.id, before:sale, after:{ ...sale, total:newTotal, discount:calc.discount, paid, remaining:newRemaining, items:finalItems } });
    batch.commit().then(()=>{
      this._markWriteResult(true);
      this.editingInvoiceId=null; this._editBaseTs=undefined;
      if(overpaid>0.001) this.toast('اضافه‌پرداخت '+fmt(overpaid)+' به‌عنوان اعتبار در حساب مشتری ثبت شد');
      this.render();
    }).catch(e=>{ console.error('saveEditInvoice error',e); this._markWriteResult(false,e); this.toast('خطا در ذخیرهٔ اصلاح؛ فاکتور تغییری نکرد.'); });
  },

    onSaleProductChange(){
    const v=document.getElementById('sp-product').value;
    document.getElementById('sp-new-fields').style.display = v==='__new__' ? 'block':'none';
    this.fillUnitSelect('sp');
  },
  onSaleUnitChange(){
    this.autofillUnitPrice('sp');
    this.updateUnitHint('sp');
  },
  onPurchaseProductChange(){
    const v=document.getElementById('pp-product').value;
    document.getElementById('pp-new-fields').style.display = v==='__new__' ? 'block':'none';
    this.fillUnitSelect('pp');
  },
  onPurchaseUnitChange(){
    this.autofillUnitPrice('pp');
    this.updateUnitHint('pp');
  },
  productOptions(){
    const sorted=this.state.products.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'fa'));
    return '<option value="">— انتخاب محصول از فهرست —</option>' +
      sorted.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.archived?' — بایگانی‌شده':''} — موجودی: ${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</option>`).join('') +
      '<option value="__new__">+ محصول جدید</option>';
  },

  /* ---------- Purchase ---------- */
  addPurchaseItem(){
    const sel=document.getElementById('pp-product');
    let pid=sel.value;
    if(!pid){ this.toast('یک محصول انتخاب کنید'); return; }
    let product;
    if(pid==='__new__'){
      const d=this.draftNewProduct('pp');
      if(!d.name){ this.toast('نام محصول جدید را بنویسید'); return; }
      product = Object.assign({}, d, { id: uid(), _draftOnly:true });
      this.purchaseDraft._draftProducts = this.purchaseDraft._draftProducts || [];
      this.purchaseDraft._draftProducts.push(product);
    } else {
      product = this.state.products.find(p=>p.id===pid);
    }
    if(!product){ this.toast('محصول پیدا نشد.'); return; }
    if(!this.transactionUnits(product).length){ this.toast('برای این محصول هنوز واحد خرید مثل کارتن، قوطی یا بسته تعریف نشده است.'); return; }
    const u = this.unitByName(product, (document.getElementById('pp-unit')||{}).value);
    const qtyIn = parseFloat(document.getElementById('pp-qty').value);
    const costIn = parseFloat(document.getElementById('pp-cost').value);
    if(!qtyIn||qtyIn<=0){ this.toast('تعداد را درست بنویسید'); return; }
    if(isNaN(costIn)||costIn<0){ this.toast('قیمت خرید را بنویسید'); return; }
    // قیمت واحدِ بزرگ به قیمت تمام‌شدهٔ واحد پایه شکسته می‌شود؛ از همین‌جا قیمت
    // تمام‌شدهٔ قوطی/بسته/عدد خودکار به دست می‌آید.
    const qty = round2(qtyIn*u.factor);
    const cost = costIn/u.factor;
    this.purchaseDraft.items.push({productId:product.id,name:product.name,unit:product.unit,qty,unitCost:cost,txUnit:u.name,txFactor:u.factor});
    this.render();
  },
  removePurchaseItem(idx){ this.purchaseDraft.items.splice(idx,1); this.render(); },

  async submitPurchase(){
    if(this._purchaseBusy) return; // جلوگیری از ثبت دوبارهٔ بل خرید
    this._purchaseBusy=true;
    try{ await this._submitPurchaseInner(); } finally { this._purchaseBusy=false; }
  },
  async _submitPurchaseInner(){
    if(this.purchaseDraft.items.length===0){ this.toast('حداقل یک محصول اضافه کنید'); return; }
    const txPurchaseId = this.purchaseDraft.txId || uid();
    if(this.state.purchases.some(x=>x.id===txPurchaseId)){ this.toast('این بل خرید قبلاً ثبت شده است.'); return; }
    const total = round2(this.purchaseDraft.items.reduce((a,i)=>a+i.qty*i.unitCost,0));
    let paid = parseFloat(document.getElementById('purchase-paid').value);
    if(isNaN(paid)) paid=0;
    if(paid>total) paid=total;
    if(paid<0) paid=0;
    const currency = (document.getElementById('purchase-currency') && document.getElementById('purchase-currency').value==='USD') ? 'USD' : 'AFN';
    let rateAtPurchase = 1;
    if(currency==='USD'){
      rateAtPurchase = this.usdRate();
      if(rateAtPurchase<=0){ this.toast('لطفاً ابتدا نرخ فعلی دالر را وارد کنید (دکمهٔ «نرخ دالر» بالای همین فرم).'); return; }
    }
    const balField = currency==='USD' ? 'balanceUSD' : 'balance';
    const supName = (document.getElementById('purchase-supplier-name').value||'').trim();
    const date = document.getElementById('purchase-date').value || todayISO();
    const note = (document.getElementById('purchase-note').value||'').trim();
    const supplierInvoiceNo = (document.getElementById('purchase-supplier-invoice-no').value||'').trim();
    const remaining = round2(total-paid);
    const draftProducts = this.purchaseDraft._draftProducts || [];

    const photoInput = document.getElementById('purchase-bill-photo');
    const photoFile = photoInput && photoInput.files[0];
    let billImage = null;
    if(photoFile){
      try{ billImage = await compressImageForStorage(photoFile); }
      catch(err){ App.toastError(err.message||'خطا در پردازش عکس بل'); return; }
    }

    let supplierId=null, supplierNameFinal=supName||'—';
    if(supName){
      const supplier=this.state.suppliers.find(c=>normalizeName(c.name)===normalizeName(supName));
      if(supplier){ supplierId=supplier.id; supplierNameFinal=supplier.name; }
      else supplierId=uid();
    } else if(remaining>0.001){
      this.toast('برای خرید نسیه باید نام عمده‌فروش/شرکت را بنویسید'); return;
    }

    const purchaseId = txPurchaseId;
    const newPurchase = {
      id:purchaseId, invoiceNo:this.invoiceNoForNew(purchaseId,'B'), ts:Date.now(), date, supplierId, supplierName:supplierNameFinal, currency, rateAtPurchase,
      items:this.purchaseDraft.items.map(it=>({...it,returnedQty:0})), total, paid, remaining, note, supplierInvoiceNo,
      status:'active', returns:[], originalTotal: total,
      ...this.recordMeta()
    };
    if(billImage) newPurchase.billImage = billImage;

    /* خرید و میانگین قیمت در یک batch نوشته می‌شوند تا خود فاکتور، تغییر موجودی
       و ثبت دفتر انبار با هم پذیرفته یا رد شوند. توجه: این batch برای avgCost
       قفل هم‌زمانی ایجاد نمی‌کند؛ دو خرید هم‌زمان از دو دستگاه هنوز به راهکار
       مبتنی بر دفتر حرکات/تطبیق پس از همگام‌سازی نیاز دارند. در حالت آفلاین باید
       همین مسیر سریع و محلی حفظ شود، بنابراین این قسمت را transaction نکردیم. */
    const commitOfflineBatch = async()=>{
      App._mv('PURCHASE','خرید'); const batch = writeBatch(db);
      if(supName){
        const supplier=this.state.suppliers.find(c=>c.id===supplierId);
        if(supplier) batch.update(doc(cols.suppliers,supplierId), { [balField]: increment(remaining) });
        else batch.set(doc(cols.suppliers,supplierId), {id:supplierId,name:supName,phone:'',address:'',balance:currency==='AFN'?remaining:0,balanceUSD:currency==='USD'?remaining:0, ...this.recordMeta()});
      }
      const _run = {};
      this.purchaseDraft.items.forEach(it=>{
        const unitCostAFN = currency==='USD' ? it.unitCost*rateAtPurchase : it.unitCost;
        const draftP = draftProducts.find(dp=>dp.id===it.productId);
        if(draftP){
          batch.set(doc(cols.products, draftP.id), {id:draftP.id, name:draftP.name, unit:draftP.unit, unitQty:draftP.unitQty||1, stock:it.qty, avgCost:unitCostAFN, sellPrice:round2(unitCostAFN*1.15),
            baseTradable:!!draftP.baseTradable, midUnit:draftP.midUnit||'', midPer:draftP.midPer||0, packUnit:draftP.packUnit||'', packPer:draftP.packPer||0,
            defaultSaleUnit:draftP.defaultSaleUnit||draftP.packUnit||draftP.midUnit||draftP.unit,
            saleUnits:draftP.saleUnits||[draftP.packUnit||draftP.midUnit||draftP.unit].filter(Boolean), allowFractionalSale:!!draftP.allowFractionalSale,
            sellPriceMid:0, sellPricePack:0, ...this.recordMeta()});
        } else {
          const p=this.state.products.find(pp=>pp.id===it.productId);
          if(p){
            const unitCost=unitCostAFN;
            const prior=_run[it.productId]||{stock:p.stock,avgCost:p.avgCost};
            const calc=nextAvgCost({stockQty:prior.stock,avgCost:prior.avgCost,purchaseQty:it.qty,unitCost});
            _run[it.productId]={stock:calc.newStock,avgCost:calc.avgCost};
            const newAvgCost=calc.avgCost;
            const fields={stock:increment(it.qty),avgCost:newAvgCost};
            if(!p.sellPrice) fields.sellPrice=round2(unitCost*1.15);
            batch.update(doc(cols.products,it.productId),fields);
          }
        }
      });
      batch.set(doc(cols.purchases,purchaseId),newPurchase);
      this.audit(batch,{action:'create',entityType:'purchase',entityId:purchaseId,before:null,after:newPurchase});
      await batch.commit();
    };

    try{
      await commitOfflineBatch();
      this._markWriteResult(true);
    }catch(e){
      console.error('submitPurchase error',e);
      this._markWriteResult(false,e);
      this.toastError('ذخیرهٔ بل خرید انجام نشد یا وضعیت اتصال نامعلوم است؛ دوباره ثبت نکنید تا وضعیت همگام‌سازی مشخص شود. '+(e.message||''));
      return;
    }

    this.resetPurchaseDraft();
    this.viewPurchaseId=purchaseId;
    this.navigate('purchase-view');
  },

  
  viewPurchase(id){ this.viewPurchaseId=id; this.navigate('purchase-view'); },

  /* اصلاح محدود و حساب‌شدهٔ بل خرید؛ فقط مدیر می‌تواند مبلغ پرداختی/تاریخ/یادداشت را اصلاح کند. */
  editPurchaseInvoice(purchaseId){
    if(!this.isAdmin()){ this.toast('ویرایش بل خرید فقط برای مدیر manager@motar.com فعال است.'); return; }
    const pur=this.state.purchases.find(x=>x.id===purchaseId);
    if(!pur || pur.status==='cancelled'){ this.toast('بل خرید پیدا نشد یا باطل شده است.'); return; }
    const allocated=(this.state.payments||[]).filter(p=>p.purchaseId===purchaseId && !p.voided && !p.reversalOf).reduce((a,p)=>a+(Number(p.allocatedAmount)||0),0);
    if(allocated>0.001){ this.toast('این بل پرداخت تخصیص‌یافته دارد؛ برای جلوگیری از دو بار شمردن پول، ابتدا پرداخت تخصیص‌یافته را اصلاح کنید.'); return; }
    this.openFormModal({
      title:'ویرایش بل خرید '+this.purchaseBillLabel(pur),
      sub:'فقط مدیر مجاز است. تغییر مبلغ پرداختی، ماندهٔ فروشنده و موجودی نقدی را اصلاح می‌کند.',
      fields:[
        {key:'paid',label:'مبلغ واقعاً پرداخت‌شده ('+(pur.currency==='USD'?'دالر':'افغانی')+')',type:'number',value:Number(pur.paid)||0,hint:'مجموع بل: '+fmt(pur.total)+'؛ ماندهٔ فعلی: '+fmt(pur.remaining)},
        {key:'date',label:'تاریخ بل',type:'text',value:pur.date||todayISO()},
        {key:'supplierInvoiceNo',label:'شمارهٔ بل شرکت (اختیاری)',type:'text',value:pur.supplierInvoiceNo||''},
        {key:'note',label:'یادداشت',type:'text',value:pur.note||''},
        {key:'reason',label:'دلیل اصلاح (اجباری)',type:'text',value:''}
      ],
      submitLabel:'ذخیرهٔ اصلاح',
      onSubmit:async(v)=>{
        if(!this.isAdmin()) throw new Error('فقط مدیر مجاز به ویرایش بل خرید است.');
        const paid=round2(Number(v.paid));
        if(!Number.isFinite(paid)||paid<0||paid>(Number(pur.total)||0)+0.001) throw new Error('مبلغ پرداختی باید بین صفر و مجموع بل باشد.');
        const reason=String(v.reason||'').trim(); if(!reason) throw new Error('دلیل اصلاح را بنویسید.');
        if((pur.lastEditedTs||0)!==(this.state.purchases.find(x=>x.id===purchaseId)?.lastEditedTs||0)) throw new Error('بل تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید.');
        const remaining=round2(Math.max(0,(Number(pur.total)||0)-paid));
        const delta=round2(remaining-(Number(pur.remaining)||0));
        const batch=writeBatch(db);
        const balField=(pur.currency||'AFN')==='USD'?'balanceUSD':'balance';
        if(pur.supplierId && Math.abs(delta)>0.001) batch.update(doc(cols.suppliers,pur.supplierId),{[balField]:increment(delta)});
        const after={...pur,paid,remaining,date:String(v.date||pur.date||todayISO()),supplierInvoiceNo:String(v.supplierInvoiceNo||'').trim(),note:String(v.note||'').trim(),lastEditReason:reason,...this.editMeta()};
        batch.update(doc(cols.purchases,purchaseId),{paid,remaining,date:after.date,supplierInvoiceNo:after.supplierInvoiceNo,note:after.note,lastEditReason:reason,...this.editMeta()});
        this.audit(batch,{action:'edit',entityType:'purchase',entityId:purchaseId,before:pur,after});
        await batch.commit(); this._markWriteResult(true); this.toast('بل خرید اصلاح شد؛ ماندهٔ فروشنده و حساب نقدی به‌روزرسانی شد.'); this.render();
      }
    });
  },
  
  /* ---------- Invoice adjustments: cancel / return / edit items (sales) ----------
     نکته: این عملیات‌ها به‌جای «بازخوانی و بازنویسی کل رکورد»، فقط تغییرات (delta) را
     با increment() می‌فرستند — یعنی حتی اگر دو نفر هم‌زمان کار کنند، هیچ نوشته‌ای گم نمی‌شود. */
  saleReturnItem(saleId, idx){
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    const it=sale.items[idx]; if(!it) return;
    const sellable = it.qty-(it.returnedQty||0);
    if(sellable<=0){ this.toast('این قلم قبلاً بطور کامل مرجوعی خورده است.'); return; }
    const ladder=this.itemUnits(it);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(it.unit||'عدد')+')'):'')}));
    const defUnit=this.itemUnitName(it);
    const defFactor=this.itemFactor(it);
    this.openFormModal({
      title:'مرجوعی «'+it.name+'»',
      sub:'حداکثر قابل مرجوعی: '+this.itemQtyLabel(it, sellable),
      fields:[
        {key:'unit', label:'واحد مرجوعی', type:'select', options:unitOptions, value:defUnit, hint:'مشتری ممکن است کارتن گرفته باشد ولی فقط چند قوطی یا چند عدد را واپس بدهد.'},
        {key:'qty', label:'تعداد مرجوعی', type:'number', step:'0.01', value:round2(sellable/defFactor)},
        {key:'reason', label:'دلیل مرجوعی (اختیاری)', type:'text', value:''}
      ],
      submitLabel:'ثبت مرجوعی',
      onSubmit: (v)=>{
        const u=ladder.find(x=>x.name===v.unit)||ladder[ladder.length-1];
        const baseQty=round2((Number(v.qty)||0)*u.factor);
        if(!baseQty || baseQty<=0 || baseQty>sellable+1e-9) throw new Error('تعداد نامعتبر است — حداکثر '+this.itemQtyLabel(it,sellable)+'.');
        return this._applySaleReturn(sale, idx, baseQty, fmtQty(v.qty)+' '+u.name, (v.reason||'').trim()).then(()=>this.toast('مرجوعی ثبت شد'));
      }
    });
  },
  async _applySaleReturn(sale, idx, qty, qtyLabel, reason){
    const it=sale.items[idx];
    // تخفیف کلی فاکتور باید متناسب با ارزش اقلام مرجوع‌شده برگردد.
    // اختلاف تخصیص تخفیف قبل/بعد از این مرجوعی باعث می‌شود مرجوعی چندمرحله‌ای هم جمعاً درست بماند.
    const refund = calculateReturnRefund({ items:sale.items, itemIndex:idx, qty, discount:sale.discount||0 });
    const refundCost = round2(qty*(it.cost||0));
    const rb = rebalanceAfterTotalChange({ total:sale.total, paid:sale.paid, settled:sale.settled||0, newTotal:Math.max(0,round2(sale.total-refund)) });

    const newItems = sale.items.map((x,i)=> i===idx ? {...x, returnedQty:(x.returnedQty||0)+qty} : x);
    const newReturns = [...(sale.returns||[]), {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty, qtyLabel: qtyLabel||this.itemQtyLabel(it,qty), unitPrice:it.unitPrice, amount:refund}];

    const newTotal = Math.max(0, round2(sale.total-refund)), newPaid = rb.paid;
    const dropped = round2(sale.total-newTotal); // مقداری که واقعاً از مجموع فاکتور کم شد
    // رویدادِ جدا برای این مرجوعی (فاکتور اصلی تاریخ خودش را حفظ می‌کند)
    const evId=uid();
    const ev=buildReturnEvent({ id:evId, ts:Date.now(), date:todayISO(), sale, kind:'return',
      items:[{ productId:it.productId, name:it.name, qty, unit:it.unit||'عدد', qtyLabel:qtyLabel||this.itemQtyLabel(it,qty), unitPrice:it.unitPrice, cost:it.cost||0, amount:refund }],
      amount:dropped, cost:refundCost, reason:reason||'', userId:(this.user&&this.user.email)||'',
      cashRefund:rb.cashRefund, debtReduction:Math.max(0, round2((Number(sale.remaining)||0)-rb.remaining)), releasedSettled:rb.releasedSettled });
    App._mv('RETURN','مرجوعی فروش'+(reason?(' — '+reason):''), { refType:'return', refId:evId }); const batch = writeBatch(db);
    batch.set(doc(cols.returns, evId), ev);
    batch.update(doc(cols.sales, sale.id), {
      items: newItems, returns: newReturns,
      total: newTotal, totalCost: sale.totalCost-refundCost, profit: newTotal-(sale.totalCost-refundCost),
      paid: newPaid, settled: rb.settled, remaining: rb.remaining,
      returnedAmount: increment(dropped), returnedCost: increment(refundCost), ...this.editMeta()
    });
    if(sale.customerId && Math.abs(rb.customerDelta)>0.0001){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(rb.customerDelta) });
    }
    if(rb.releasedSettled>0.001) this._releaseAllocations(batch, sale.id, rb.releasedSettled);
    batch.update(doc(cols.products, it.productId), { stock: increment(qty) });
    this.audit(batch, { action:'return', entityType:'sale', entityId:sale.id, before:sale, after:{ ...sale, total:newTotal, paid:newPaid, settled:rb.settled, remaining:rb.remaining } });
    try{ await batch.commit(); this._markWriteResult(true); }
    catch(e){ console.error(e); this._markWriteResult(false,e); throw new Error('خطا در ثبت مرجوعی؛ فاکتور تغییری نکرد. '+(e.message||'')); }
  },
  cancelSale(saleId){
    if(!this.guardWrite()) return;
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور قبلاً باطل شده است.'); return; }
    this.openConfirmModal({
      title:'کنسل کامل فاکتور',
      msg:'کل این فاکتور باطل شود؟ موجودی کالاها به انبار برمی‌گردد و بدهی مشتری اصلاح می‌شود.',
      danger:true, confirmLabel:'بله، باطل شود',
      onConfirm: ()=> this._doCancelSale(saleId)
    });
  },
  _doCancelSale(saleId){
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    let runningTotal=sale.total, runningPaid=sale.paid, runningCost=sale.totalCost;
    const newItems=[...sale.items];
    const newReturns=[...(sale.returns||[])];
    const priorReturnsCount=newReturns.length;
    const stockDeltas={}; const evItems=[]; let refundCostSum=0;
    sale.items.forEach((it,idx)=>{
      const sellable=it.qty-(it.returnedQty||0);
      if(sellable<=0) return;
      const refund=sellable*it.unitPrice, refundCost=sellable*(it.cost||0);
      newItems[idx]={...it, returnedQty:(it.returnedQty||0)+sellable};
      newReturns.push({id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty:sellable, qtyLabel:this.itemQtyLabel(it,sellable), unitPrice:it.unitPrice, amount:refund});
      runningTotal-=refund; runningCost-=refundCost; refundCostSum+=refundCost;
      evItems.push({ productId:it.productId, name:it.name, qty:sellable, unit:it.unit||'عدد', qtyLabel:this.itemQtyLabel(it,sellable), unitPrice:it.unitPrice, cost:it.cost||0, amount:refund });
      stockDeltas[it.productId]=(stockDeltas[it.productId]||0)+sellable;
    });

    // ابطال کامل باید ماندهٔ خالص فعلی فاکتور را به صفر برساند؛ قیمت خام اقلام شامل تخفیف کلی نیست.
    // مبلغ رویداد هر قلم به نسبت ارزش ناخالص اقلام باقی‌مانده تقسیم می‌شود تا جمع دقیقاً با ماندهٔ خالص فاکتور برابر باشد.
    const totalRemainingGross = evItems.reduce((sum,x)=>sum+Math.max(0,Number(x.qty)||0)*Math.max(0,Number(x.unitPrice)||0),0);
    let amountLeft = Math.max(0,round2(Number(sale.total)||0));
    evItems.forEach((x,i)=>{
      const gross = Math.max(0,Number(x.qty)||0)*Math.max(0,Number(x.unitPrice)||0);
      const amount = i===evItems.length-1 ? amountLeft : (totalRemainingGross>0 ? Math.min(amountLeft,round2((Number(sale.total)||0)*gross/totalRemainingGross)) : 0);
      x.amount=round2(amount); amountLeft=round2(amountLeft-x.amount);
      if(newReturns[priorReturnsCount+i]) newReturns[priorReturnsCount+i].amount=x.amount;
    });
    runningTotal = 0;
    const rb = rebalanceAfterTotalChange({ total:sale.total, paid:sale.paid, settled:sale.settled||0, newTotal:0 });
    runningPaid = rb.paid;
    const evId=uid(); const dropped=round2(Number(sale.total)||0);
    const ev=buildReturnEvent({ id:evId, ts:Date.now(), date:todayISO(), sale, kind:'cancel', items:evItems,
      amount:dropped, cost:refundCostSum, reason:'ابطال کامل فاکتور', userId:(this.user&&this.user.email)||'',
      cashRefund:rb.cashRefund, debtReduction:Math.max(0, round2((Number(sale.remaining)||0)-rb.remaining)), releasedSettled:rb.releasedSettled });
    App._mv('RETURN','ابطال فاکتور فروش', { refType:'return', refId:evId }); const batch=writeBatch(db);
    batch.set(doc(cols.returns, evId), ev);
    batch.update(doc(cols.sales, sale.id), {
      items:newItems, returns:newReturns, status:'cancelled', cancelledTs:Date.now(), cancelledDate:todayISO(), cancelledBy:(this.user&&this.user.email)||'',
      returnedAmount: increment(dropped), returnedCost: increment(round2(refundCostSum)),
      total:runningTotal, totalCost:runningCost, profit:runningTotal-runningCost,
      paid:runningPaid, settled:rb.settled, remaining:rb.remaining, ...this.editMeta()
    });
    if(sale.customerId && Math.abs(rb.customerDelta)>0.0001){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(rb.customerDelta) });
    }
    if(rb.releasedSettled>0.001) this._releaseAllocations(batch, sale.id, rb.releasedSettled);
    Object.keys(stockDeltas).forEach(pid=>{
      batch.update(doc(cols.products, pid), { stock: increment(stockDeltas[pid]) });
    });
    this.audit(batch, { action:'cancel', entityType:'sale', entityId:sale.id, before:sale, after:{ ...sale, status:'cancelled', total:runningTotal, settled:rb.settled, remaining:rb.remaining } });
    batch.commit().then(()=>{ this._markWriteResult(true); this.toast('فاکتور باطل شد'); }).catch(e=>{ console.error(e); this._markWriteResult(false,e); App.toastError('خطا در باطل کردن فاکتور؛ فاکتور تغییری نکرد.'); });
  },
  saleIncreaseItemQty(saleId, idx){
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    const it=sale.items[idx]; if(!it) return;
    const p=this.state.products.find(pp=>pp.id===it.productId);
    const ladder=this.itemUnits(it);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(it.unit||'عدد')+')'):'')}));
    const defUnit=this.itemUnitName(it);
    this.openFormModal({
      title:'افزودن تعداد «'+it.name+'»',
      sub: p ? ('موجودی فعلی انبار: '+this.qtyBreakdown(p, p.stock||0)) : '',
      fields:[
        {key:'unit', label:'واحد', type:'select', options:unitOptions, value:defUnit},
        {key:'qty', label:'چند تا دیگر اضافه شود؟', type:'number', step:'0.01', value:1},
        {key:'paid', label:'مبلغ پرداختی نقدی برای همین اضافه', type:'number', step:'1', value:'', hint:'اگر نسیه است، صفر بگذارید.'}
      ],
      submitLabel:'افزودن',
      onSubmit: (v)=>{
        if(!v.qty || v.qty<=0) throw new Error('تعداد نامعتبر است.');
        const u=ladder.find(x=>x.name===v.unit)||ladder[ladder.length-1];
        const qty=round2((Number(v.qty)||0)*u.factor);
        const addAmount=round2(qty*it.unitPrice);
        let addPaid = v.paid===null ? addAmount : v.paid;
        if(isNaN(addPaid)||addPaid<0) addPaid=0; if(addPaid>addAmount) addPaid=addAmount;
        if(addPaid<addAmount && !sale.customerId) throw new Error('برای نسیه باید فاکتور برای یک مشتری مشخص باشد.');

        const newItems = sale.items.map((x,i)=> i===idx ? {...x, qty:x.qty+qty} : x);
        const addCost = qty*(it.cost||0);
        const newTotal=sale.total+addAmount, newPaid=sale.paid+addPaid, newTotalCost=sale.totalCost+addCost;

        App._mv('SALE','افزایش تعداد قلم فاکتور'); const batch=writeBatch(db);
        batch.update(doc(cols.sales, sale.id), {
          items:newItems, total:newTotal, originalTotal: increment(addAmount),
          totalCost:newTotalCost, profit:newTotal-newTotalCost, paid:newPaid, remaining:round2(newTotal-newPaid-(Number(sale.settled)||0)), ...this.editMeta()
        });
        if(p) batch.update(doc(cols.products, it.productId), { stock: increment(-qty) });
        if(sale.customerId && addAmount-addPaid>0){
          batch.update(doc(cols.customers, sale.customerId), { balance: increment(addAmount-addPaid) });
        }
        return batch.commit().then(()=>this.toast('اضافه شد'));
      }
    });
  },
  /* =========================================================
     «حالت استثنایی»: کم کردن چند واحد پایه از یک قلمِ ثبت‌شده
     مثال: یک قوطی ۲۴ عددی که فقط ۲۲ عدد داشت.
     نیازی نیست محصول برای همیشه «عددی» تعریف شود — فقط همین قلم اصلاح می‌شود.
     دو حالت که تفاوتشان فقط سرِ انبار و قیمت تمام‌شده است:
       gone : قوطی از اول کم داشت یا خودم مصرف کرده بودم → پول کم می‌شود، جنس برنمی‌گردد،
              پس ضرر آن مستقیم از سود همین فاکتور کم می‌شود (که همان واقعیت است)
       back : مشتری همین مقدار را کمتر گرفت → پول کم می‌شود و جنس هم به انبار برمی‌گردد
     ========================================================= */
  saleShrinkItem(saleId, idx){
    if(!this.guardWrite()) return;
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    const it=sale.items[idx]; if(!it) return;
    const baseName = it.unit || 'عدد';
    const remaining = round2((Number(it.qty)||0)-(Number(it.returnedQty)||0));
    if(remaining<=0){ this.toast('از این قلم چیزی نمانده است.'); return; }
    const perBase = Number(it.unitPrice)||0;
    this.openFormModal({
      title:'کم کردن چند '+baseName+' از «'+it.name+'»',
      sub:'این قلم الان: '+this.itemQtyLabel(it, remaining)+' · قیمت هر '+baseName+': '+fmt2(round2(perBase)),
      fields:[
        {key:'qty', label:'چند '+baseName+' کم شود؟', type:'number', step:'0.01', value:1,
         hint:'مثلاً قوطیِ ۲۴ عددی که ۲ عدد آن نبود: عدد ۲ را بنویسید. مبلغ خودش کم می‌شود.'},
        {key:'mode', label:'این کمبود چه بود؟', type:'select', value:'gone', options:[
          {value:'gone', label:'قوطی/بسته کم داشت یا خودم مصرف کرده بودم — جنس برنمی‌گردد'},
          {value:'back', label:'مشتری این مقدار را کمتر گرفت — جنس در انبار می‌ماند'}
        ]},
        {key:'note', label:'یادداشت (اختیاری)', placeholder:'مثلاً مصرف شخصی'}
      ],
      submitLabel:'کم کن و مبلغ را اصلاح کن',
      onSubmit:(v)=>{
        const qty=round2(Number(v.qty)||0);
        if(!qty || qty<=0) throw new Error('عدد نامعتبر است.');
        if(qty>remaining-1e-9) throw new Error('حداکثر '+fmtQty(remaining)+' '+baseName+' قابل کم کردن است؛ برای کل قلم از «مرجوعی این قلم» استفاده کنید.');
        this._applySaleShrink(sale, idx, qty, v.mode==='back'?'back':'gone', (v.note||'').trim());
        this.toast(fmtQty(qty)+' '+baseName+' کم شد');
      }
    });
  },
  _applySaleShrink(sale, idx, qty, mode, note){
    const it=sale.items[idx];
    const amount   = round2(qty*(Number(it.unitPrice)||0));                 // پولی که از فاکتور کم می‌شود
    const costBack = mode==='back' ? round2(qty*(Number(it.cost)||0)) : 0;  // قیمت تمام‌شده فقط وقتی جنس برگشته
    const rb = rebalanceAfterTotalChange({ total:Number(sale.total)||0, paid:Number(sale.paid)||0, settled:sale.settled||0, newTotal:round2((Number(sale.total)||0)-amount) });

    const newItems = sale.items.map((x,i)=> i===idx
      ? {...x, qty: round2((Number(x.qty)||0)-qty), adjBase: round2((Number(x.adjBase)||0)+qty), adjNote: note||x.adjNote||''}
      : x);
    const newTotal = Math.max(0, round2((Number(sale.total)||0)-amount));
    const dropped  = round2((Number(sale.total)||0)-newTotal); // مقدار واقعیِ کم‌شده از مجموع
    const newCost  = round2((Number(sale.totalCost)||0)-costBack);
    const newPaid  = rb.paid;
    const log = [...(sale.adjustments||[]), {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx,
      name:it.name, qty, unit:(it.unit||'عدد'), mode, note:note||'', amount}];

    const evId=uid();
    const ev=buildReturnEvent({ id:evId, ts:Date.now(), date:todayISO(), sale, kind:'shortage',
      items:[{ productId:it.productId, name:it.name, qty, unit:(it.unit||'عدد'), qtyLabel:this.itemQtyLabel(it,qty), unitPrice:it.unitPrice, cost:(mode==='back'?(it.cost||0):0), amount }],
      amount:dropped, cost:costBack, reason:(note||'')+(mode==='back'?' (کالا به انبار برگشت)':' (کالا برنگشت)'), userId:(this.user&&this.user.email)||'',
      cashRefund:rb.cashRefund, debtReduction:Math.max(0, round2((Number(sale.remaining)||0)-rb.remaining)), releasedSettled:rb.releasedSettled });
    ev.mode=mode;
    App._mv('RETURN','کاستی/کم‌شدن قلم فاکتور فروش', { refType:'return', refId:evId }); const batch=writeBatch(db);
    batch.set(doc(cols.returns, evId), ev);
    batch.update(doc(cols.sales, sale.id), {
      items:newItems, adjustments:log,
      total:newTotal, totalCost:newCost, profit:round2(newTotal-newCost),
      paid:newPaid, settled:rb.settled, remaining:rb.remaining,
      returnedAmount: increment(dropped), returnedCost: increment(costBack), ...this.editMeta()
    });
    if(sale.customerId && Math.abs(rb.customerDelta)>0.0001){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(rb.customerDelta) });
    }
    if(rb.releasedSettled>0.001) this._releaseAllocations(batch, sale.id, rb.releasedSettled);
    if(mode==='back' && it.productId){
      batch.update(doc(cols.products, it.productId), { stock: increment(qty) });
    }
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا در اصلاح این قلم؛ دوباره تلاش کنید.'); });
  },
  // تبدیل بخشی یا کل «باقی‌مانده» یک فاکتور به «تخفیف» به‌جای بدهی مشتری.
  // مثال: مجموع ۱۳۰۵ شده ولی فقط ۱۳۰۰ از مشتری می‌گیرید — ۵ افغانی باقی‌مانده
  // را با این دکمه به‌عنوان تخفیف می‌بخشید تا در «طلب از مشتریان» باقی نماند.
  
  applySaleDiscount(saleId){
    if(!this.guardWrite()) return;
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    const remaining=sale.remaining||0;
    if(remaining<=0.001){ this.toast('این فاکتور باقیمانده‌ای ندارد که به تخفیف تبدیل شود.'); return; }
    const cur=this.state.settings.currency;
    this.openFormModal({
      title:'تخفیف به‌جای بدهی',
      sub:'باقیماندهٔ فعلی: '+fmt(remaining)+' '+cur,
      fields:[{key:'amt', label:'چقدر تخفیف داده شود؟', type:'number', value:remaining, hint:'بقیهٔ مبلغ، در صورت وجود، همچنان به‌عنوان بدهی مشتری می‌ماند.'}],
      submitLabel:'ثبت تخفیف',
      onSubmit: (v)=>{
        const amt=v.amt;
        if(!amt || amt<=0) throw new Error('عدد نامعتبر است.');
        if(amt>remaining+0.001) throw new Error('این مبلغ از باقیماندهٔ فعلی ('+fmt(remaining)+' '+cur+') بیشتر است.');
        const newTotal=sale.total-amt, newProfit=(sale.total-amt)-sale.totalCost, newRemaining=sale.remaining-amt;
        const batch=writeBatch(db);
        batch.update(doc(cols.sales, sale.id), {
          total:newTotal, profit:newProfit, remaining:newRemaining,
          discount:(sale.discount||0)+amt, ...this.editMeta()
        });
        if(sale.customerId){
          batch.update(doc(cols.customers, sale.customerId), { balance: increment(-amt) });
        }
        return batch.commit().then(()=>this.toast('تخفیف ثبت شد'));
      }
    });
  },
  /* =========================================================
     افزودن قلم جدید به یک فاکتور/بل ثبت‌شده — با انتخاب از فهرست محصولات
     (نه تایپ دستی نام) و انتخاب واحد و قیمت خودکار همان واحد
     ========================================================= */
  productOptionsNoNew(){
    const sorted=this.state.products.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'fa'));
    return '<option value="">— انتخاب از فهرست محصولات —</option>' +
      sorted.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.archived?' — بایگانی‌شده':''} — موجودی: ${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</option>`).join('');
  },
  _aiBody(mode, curLbl){
    return `
    <label>محصول</label>
    <select id="ai-product" onchange="App.onAddItemProductChange()">${this.productOptionsNoNew()}</select>
    <div class="field-note">فقط از فهرست محصولات ثبت‌شده انتخاب کنید؛ قیمت و واحدها خودکار می‌آیند. محصول تازه را از صفحهٔ «محصولات و موجودی» یا فرم ثبت خرید اضافه کنید.</div>
    <div class="grid2">
      <div>
        <label>واحد</label>
        <select id="ai-unit" onchange="App.onAddItemUnitChange()"></select>
        <div class="field-note" id="ai-unit-note"></div>
      </div>
      <div>
        <label>تعداد</label>
        <input id="ai-qty" type="number" inputmode="decimal" step="0.01" value="1" oninput="App.onAddItemUnitChange(true)">
        <div class="field-note" id="ai-qty-hint"></div>
      </div>
    </div>
    <label id="ai-price-label">${mode==='purchase'?'قیمت خرید هر واحد':'قیمت فروش هر واحد'}${curLbl?' ('+escapeHtml(curLbl)+')':''}</label>
    <input id="ai-price" type="number" inputmode="decimal" step="0.01" placeholder="0" oninput="App.onAddItemUnitChange(true)">
    <div class="field-note" id="ai-price-hint"></div>
    <label>مبلغ ${mode==='purchase'?'پرداختی':'دریافتی'} نقدی برای همین قلم</label>
    <input id="ai-paid" type="number" inputmode="decimal" step="1" placeholder="خالی = تمام مبلغ این قلم">
    <div class="field-note">اگر نسیه است، صفر بگذارید.</div>`;
  },
  _aiProduct(){ const el=document.getElementById('ai-product'); return el ? (this.state.products.find(p=>p.id===el.value)||null) : null; },
  _aiUnit(){ const p=this._aiProduct(); if(!p) return null; const el=document.getElementById('ai-unit'); return this.unitByName(p, el?el.value:null); },
  onAddItemProductChange(){
    const p=this._aiProduct();
    const sel=document.getElementById('ai-unit'); if(!sel) return;
    if(!p){ sel.innerHTML=''; const pe=document.getElementById('ai-price'); if(pe) pe.value=''; this.onAddItemUnitChange(true); return; }
    const ladder=this.transactionUnits(p);
    const base='عدد';
    sel.innerHTML=ladder.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' — '+fmtQty(u.factor)+' '+escapeHtml(this.baseLabel(p)):''}</option>`).join('');
    sel.value = this._aiMode==='purchase'
      ? ladder[0].name
      : ((p.defaultSaleUnit && ladder.some(u=>u.name===p.defaultSaleUnit)) ? p.defaultSaleUnit : ladder[0].name);
    this.onAddItemUnitChange();
  },
  onAddItemUnitChange(keepPrice){
    const p=this._aiProduct(), u=this._aiUnit();
    const priceEl=document.getElementById('ai-price');
    if(!keepPrice && p && u && priceEl){
      const v = this._aiMode==='purchase' ? this.unitCost(p,u) : this.unitSellPrice(p,u);
      priceEl.value = v>0 ? v : '';
    }
    const lbl=document.getElementById('ai-price-label');
    if(lbl && u) lbl.textContent=(this._aiMode==='purchase'?'قیمت خرید هر ':'قیمت فروش هر ')+u.name+(this._aiCur?(' ('+this._aiCur+')'):'');
    const noteEl=document.getElementById('ai-unit-note');
    if(noteEl) noteEl.textContent = (p && u && u.factor>1) ? ('۱ '+u.name+' = '+fmtQty(u.factor)+' '+this.baseLabel(p)) : '';
    const qtyEl=document.getElementById('ai-qty');
    const qty=qtyEl?(parseFloat(qtyEl.value)||0):0;
    const qh=document.getElementById('ai-qty-hint');
    if(qh) qh.textContent = (p && u && u.factor>1 && qty>0) ? ('= '+fmtQty(round2(qty*u.factor))+' '+this.baseLabel(p)) : (p?('موجودی: '+this.qtyBreakdown(p,p.stock||0)):'');
    const price=priceEl?parseFloat(priceEl.value):NaN;
    const ph=document.getElementById('ai-price-hint');
    if(ph){
      const bits=[];
      if(p && u && !isNaN(price) && price>0){
        if(qty>0) bits.push('مجموع این قلم: '+fmt(round2(qty*price)));
        if(u.factor>1) bits.push('هر '+(p.unit||'عدد')+' = '+fmt2(round2(price/u.factor)));
      }
      ph.textContent=bits.join(' · ');
    }
  },
  _aiReadCommon(){
    const product=this._aiProduct();
    if(!product) throw new Error('یک محصول از فهرست انتخاب کنید.');
    const u=this._aiUnit();
    const qtyIn=parseFloat(document.getElementById('ai-qty').value);
    const priceIn=parseFloat(document.getElementById('ai-price').value);
    if(!qtyIn||qtyIn<=0) throw new Error('تعداد نامعتبر است.');
    if(!u || (u.key==='base' && !this.isBaseTradable(product))) throw new Error('واحد داخلی «عدد» فقط برای محاسبه است و در خرید/فروش عادی قابل انتخاب نیست.');
    if(this._aiMode==='sale' && !this.canSellFractional(product) && Math.abs(qtyIn-Math.round(qtyIn))>1e-9) throw new Error('برای این محصول فروش کسری فعال نیست.');
    if(isNaN(priceIn)||priceIn<0) throw new Error('قیمت نامعتبر است.');
    const qty=round2(qtyIn*u.factor);
    const perBase=priceIn/u.factor;
    const addAmount=round2(qty*perBase);
    const paidRaw=(document.getElementById('ai-paid').value||'').trim();
    let addPaid = paidRaw==='' ? addAmount : parseFloat(paidRaw);
    if(isNaN(addPaid)||addPaid<0) addPaid=0;
    if(addPaid>addAmount) addPaid=addAmount;
    return {product, u, qty, perBase, addAmount, addPaid};
  },
  saleAddItem(saleId){
    if(!this.guardWrite()) return;
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }
    if(!this.state.products.length){ this.toast('فهرست محصولات خالی است؛ اول یک محصول اضافه کنید.'); return; }
    this._aiMode='sale'; this._aiCur='';
    this.openCustomModal({
      title:'افزودن قلم جدید به فاکتور',
      sub:'محصول را از فهرست انتخاب کنید، بعد واحد (کارتن / قوطی / بسته / عدد) و قیمت.',
      bodyHtml:this._aiBody('sale',''),
      submitLabel:'افزودن به فاکتور',
      onSubmit:()=>{
        const {product, u, qty, perBase, addAmount, addPaid} = this._aiReadCommon();
        if(addPaid<addAmount-0.001 && !sale.customerId) throw new Error('برای نسیه باید فاکتور برای یک مشتری مشخص باشد.');
        const cost=Number(product.avgCost)||0;
        App._mv('SALE','افزودن قلم به فاکتور فروش'); const batch=writeBatch(db);
        batch.update(doc(cols.products, product.id), { stock: increment(-qty) });
        const newItem={productId:product.id, name:product.name, unit:product.unit, qty, unitPrice:perBase, cost, returnedQty:0, txUnit:u.name, txFactor:u.factor};
        const newItems=[...sale.items, newItem];
        const newTotal=round2(sale.total+addAmount), newPaid=round2(sale.paid+addPaid), newTotalCost=round2(sale.totalCost+qty*cost);
        batch.update(doc(cols.sales, sale.id), {
          items:newItems, total:newTotal, originalTotal: increment(addAmount),
          totalCost:newTotalCost, profit:round2(newTotal-newTotalCost), paid:newPaid, remaining:round2(newTotal-newPaid-(Number(sale.settled)||0)), ...this.editMeta()
        });
        if(sale.customerId && addAmount-addPaid>0.001){
          batch.update(doc(cols.customers, sale.customerId), { balance: increment(round2(addAmount-addPaid)) });
        }
        return batch.commit().then(()=>this.toast('قلم اضافه شد'));
      }
    });
  },

  /* ---------- Invoice adjustments: cancel / return / edit items (purchases) ---------- */
  purchaseReturnItem(purchaseId, idx){
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل خرید باطل شده است.'); return; }
    const it=pur.items[idx]; if(!it) return;
    const returnable = it.qty-(it.returnedQty||0);
    if(returnable<=0){ this.toast('این قلم قبلاً بطور کامل واپس شده است.'); return; }
    const p=this.state.products.find(pp=>pp.id===it.productId);
    const ladder=this.itemUnits(it);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(it.unit||'عدد')+')'):'')}));
    const defUnit=this.itemUnitName(it);
    const defFactor=this.itemFactor(it);
    this.openFormModal({
      title:'واپس‌کردن «'+it.name+'» به فروشنده',
      sub:'حداکثر قابل واپسی: '+this.itemQtyLabel(it, returnable) + (p?(' — موجودی فعلی انبار: '+this.qtyBreakdown(p,p.stock||0)):''),
      fields:[
        {key:'unit', label:'واحد', type:'select', options:unitOptions, value:defUnit},
        {key:'qty', label:'تعداد', type:'number', step:'0.01', value:round2(returnable/defFactor)}
      ],
      submitLabel:'ثبت',
      onSubmit:(v)=>{
        const u=ladder.find(x=>x.name===v.unit)||ladder[ladder.length-1];
        const baseQty=round2((Number(v.qty)||0)*u.factor);
        if(!baseQty||baseQty<=0||baseQty>returnable+1e-9) throw new Error('تعداد نامعتبر است — حداکثر '+this.itemQtyLabel(it,returnable)+'.');
        return this._applyPurchaseReturn(pur, idx, baseQty, fmtQty(v.qty)+' '+u.name).then(()=>this.toast('ثبت شد'));
      }
    });
  },
  async _applyPurchaseReturn(pur, idx, qty, qtyLabel){
    const it=pur.items[idx];
    const refund=round2(qty*it.unitCost);
    const oldRemaining=pur.total-pur.paid;
    const debtReduction=Math.min(refund, Math.max(0,oldRemaining));
    const cashRefund=refund-debtReduction;
    const newItems = pur.items.map((x,i)=> i===idx ? {...x, returnedQty:(x.returnedQty||0)+qty} : x);
    const newReturns = [...pur.returns, {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty, qtyLabel: qtyLabel||this.itemQtyLabel(it,qty), unitCost:it.unitCost, amount:refund}];
    const newTotal=round2(pur.total-refund), newPaid=round2(pur.paid-cashRefund);

    App._mv('RETURN','مرجوعی خرید به عمده‌فروش'); const batch=writeBatch(db);
    batch.update(doc(cols.purchases, pur.id), { items:newItems, returns:newReturns, total:newTotal, paid:newPaid, remaining:newTotal-newPaid, ...this.editMeta() });
    if(pur.supplierId && debtReduction>0){
      const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
      batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-debtReduction) });
    }
    batch.update(doc(cols.products, it.productId), { stock: increment(-qty) });
    try{ await batch.commit(); this._markWriteResult(true); }catch(e){ console.error(e); this._markWriteResult(false,e); throw new Error('خطا؛ واپسی ثبت نشد. '+(e.message||'')); }
  },
  /* «حالت استثنایی» روی بل خرید — دو معنیِ کاملاً جدا:
       short : جنس کم آمده و پولش را هم نمی‌پردازم → مبلغ بل، بدهی به شرکت و انبار هر سه کم می‌شود
       used  : پولش را پرداختم ولی جنس مصرف/ضایع شد → بل دست‌نخورده می‌ماند، فقط انبار کم می‌شود
               و همان مبلغ به‌عنوان مصرف ثبت می‌شود تا سود واقعی به‌هم نخورد */
  purchaseShrinkItem(purchaseId, idx){
    if(!this.guardWrite()) return;
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل باطل شده است.'); return; }
    const it=pur.items[idx]; if(!it) return;
    const baseName = it.unit || 'عدد';
    const remaining = round2((Number(it.qty)||0)-(Number(it.returnedQty)||0));
    if(remaining<=0){ this.toast('از این قلم چیزی نمانده است.'); return; }
    const curLbl = this.curLabel(pur.currency);
    this.openFormModal({
      title:'کم کردن چند '+baseName+' از «'+it.name+'»',
      sub:'این قلم الان: '+this.itemQtyLabel(it, remaining)+' · قیمت هر '+baseName+': '+fmt2(round2(Number(it.unitCost)||0))+' '+curLbl,
      fields:[
        {key:'qty', label:'چند '+baseName+' کم شود؟', type:'number', step:'0.01', value:1,
         hint:'مثلاً کارتنی که یک قوطی‌اش ۲ عدد کم داشت: عدد ۲ را بنویسید.'},
        {key:'mode', label:'ماجرا چه بود؟', type:'select', value:'short', options:[
          {value:'short', label:'جنس کم آمده و پولش را نمی‌پردازم — مبلغ بل هم کم شود'},
          {value:'used',  label:'پولش را پرداختم، ولی مصرف/ضایع شد — فقط از انبار کم شود'}
        ]},
        {key:'note', label:'یادداشت (اختیاری)', placeholder:'مثلاً مصرف شخصی یا کمبود شرکت'}
      ],
      submitLabel:'ثبت اصلاح',
      onSubmit:(v)=>{
        const qty=round2(Number(v.qty)||0);
        if(!qty || qty<=0) throw new Error('عدد نامعتبر است.');
        if(qty>remaining-1e-9) throw new Error('حداکثر '+fmtQty(remaining)+' '+baseName+' قابل کم کردن است؛ برای کل قلم از «واپس به فروشنده» استفاده کنید.');
        this._applyPurchaseShrink(pur, idx, qty, v.mode==='used'?'used':'short', (v.note||'').trim());
        this.toast(fmtQty(qty)+' '+baseName+' کم شد');
      }
    });
  },
  _applyPurchaseShrink(pur, idx, qty, mode, note){
    const it=pur.items[idx];
    const rate = (Number(pur.rateAtPurchase)||this.usdRate())||0;
    const costAFN = pur.currency==='USD' ? round4((Number(it.unitCost)||0)*rate) : round4(Number(it.unitCost)||0);
    App._mv(mode==='short'?'ADJUSTMENT':'WASTE', mode==='short'?'کاستی هنگام تحویل خرید':'مصرف/ضایعات جنس خریداری‌شده'); const batch=writeBatch(db);

    if(mode==='short'){
      const amount = round2(qty*(Number(it.unitCost)||0));   // به ارز همان بل
      const oldRemaining  = (Number(pur.total)||0)-(Number(pur.paid)||0);
      const debtReduction = Math.min(amount, Math.max(0, oldRemaining));
      const cashBack      = round2(amount-debtReduction);
      const newItems = pur.items.map((x,i)=> i===idx
        ? {...x, qty: round2((Number(x.qty)||0)-qty), adjBase: round2((Number(x.adjBase)||0)+qty), adjNote: note||x.adjNote||''}
        : x);
      const newTotal = round2((Number(pur.total)||0)-amount);
      const newPaid  = round2((Number(pur.paid)||0)-cashBack);
      const log = [...(pur.adjustments||[]), {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx,
        name:it.name, qty, unit:(it.unit||'عدد'), mode, note:note||'', amount}];
      batch.update(doc(cols.purchases, pur.id), {
        items:newItems, adjustments:log, total:newTotal, paid:newPaid,
        remaining:round2(newTotal-newPaid), ...this.editMeta()
      });
      if(pur.supplierId && debtReduction>0){
        const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
        batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-debtReduction) });
      }
      if(it.productId) batch.update(doc(cols.products, it.productId), { stock: increment(-qty) });
    } else {
      // بل دست‌نخورده؛ فقط انبار و یک سند مصرف به قیمت تمام‌شده
      const amountAFN = round2(qty*costAFN);
      const log = [...(pur.adjustments||[]), {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx,
        name:it.name, qty, unit:(it.unit||'عدد'), mode, note:note||'', amount:amountAFN}];
      batch.update(doc(cols.purchases, pur.id), { adjustments:log, ...this.editMeta() });
      if(it.productId) batch.update(doc(cols.products, it.productId), { stock: increment(-qty) });
      const expId=uid();
      if(amountAFN>0) batch.set(doc(cols.expenses, expId), {id:expId, ts:Date.now(), date:todayISO(),
        category:WASTE_CATEGORY, amount:amountAFN, nonCash:true, kind:'waste',
        wasteId:expId, productId:it.productId||'', quantity:qty, unit:(it.unit||'عدد'), cost:amountAFN,
        warehouseId:DEFAULT_WAREHOUSE, reason:note||'مصرف/ضایعات', userId:(this.user&&this.user.email)||'', reference:pur.id,
        note:(note?note+' — ':'')+it.name+' · '+fmtQty(qty)+' '+(it.unit||'عدد'), ...this.recordMeta()});
    }
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا در اصلاح این قلم؛ دوباره تلاش کنید.'); });
  },
  // نادیده‌گرفتن خردهٔ پولِ باقی‌ماندهٔ یک بل خرید (مثلاً وقتی ۷۷۹۳ افغانی شده ولی
  // ۷۷۹۰ پرداخت می‌کنید و طرفین ۳ افغانی باقی را نادیده می‌گیرند) — این مبلغ دیگر
  // به‌عنوان بدهیِ ما به عمده‌فروش ثبت نمی‌ماند.
  forgiveRoundoff(purchaseId){
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل باطل شده است.'); return; }
    const remaining=pur.remaining||0;
    if(remaining<=0.001){ this.toast('این بل باقیمانده‌ای ندارد.'); return; }
    const curLbl = pur.currency==='USD' ? '$' : this.state.settings.currency;
    this.openFormModal({
      title:'نادیده‌گرفتن خرده‌پول',
      sub:'باقیماندهٔ فعلی: '+fmt(remaining)+' '+curLbl,
      fields:[{key:'amt', label:'چقدر نادیده گرفته شود؟', type:'number', value:remaining, hint:'بقیهٔ مبلغ، در صورت وجود، همچنان به‌عنوان بدهی می‌ماند.'}],
      submitLabel:'ثبت',
      onSubmit:(v)=>{
        const amt=v.amt;
        if(!amt||amt<=0) throw new Error('عدد نامعتبر است.');
        if(amt>remaining+0.001) throw new Error('این مبلغ از باقیماندهٔ فعلی ('+fmt(remaining)+' '+curLbl+') بیشتر است.');
        const newTotal=pur.total-amt, newRemaining=pur.remaining-amt;
        const batch=writeBatch(db);
        batch.update(doc(cols.purchases, pur.id), {
          total:newTotal, remaining:newRemaining,
          roundoff:(pur.roundoff||0)+amt, ...this.editMeta()
        });
        if(pur.supplierId){
          const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
          batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-amt) });
        }
        return batch.commit().then(()=>this.toast('ثبت شد'));
      }
    });
  },
  cancelPurchase(purchaseId){
    if(!this.guardWrite()) return;
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل قبلاً باطل شده است.'); return; }
    let ok=true;
    pur.items.forEach((it)=>{
      const returnable=it.qty-(it.returnedQty||0);
      if(returnable>0){
        const p=this.state.products.find(pp=>pp.id===it.productId);
        if(p && returnable>p.stock){ ok=false; }
      }
    });
    const proceed = ()=> this.openConfirmModal({
      title:'کنسل کامل بل خرید',
      msg:'کل این بل خرید باطل شود؟ کالاها از انبار کم می‌شود و بدهی به فروشنده اصلاح می‌شود.',
      danger:true, confirmLabel:'بله، باطل شود',
      onConfirm: ()=> this._doCancelPurchase(purchaseId)
    });
    if(!ok){
      this.openConfirmModal({
        title:'موجودی کافی نیست',
        msg:'موجودی فعلی بعضی کالاها کمتر از مقدار خریداری‌شده است (احتمالاً فروخته شده‌اند). آیا باز هم باطل شود؟ (موجودی ممکن است منفی شود)',
        danger:true, confirmLabel:'باز هم باطل شود',
        onConfirm: proceed
      });
    } else proceed();
  },
  _doCancelPurchase(purchaseId){
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    let runningTotal=pur.total, runningPaid=pur.paid, supplierDebtReduction=0;
    const newItems=[...pur.items]; const newReturns=[...pur.returns]; const stockDeltas={};
    pur.items.forEach((it,idx)=>{
      const returnable=it.qty-(it.returnedQty||0);
      if(returnable<=0) return;
      const refund=returnable*it.unitCost;
      const oldRemaining=runningTotal-runningPaid;
      const debtReduction=Math.min(refund, Math.max(0,oldRemaining));
      const cashRefund=refund-debtReduction;
      newItems[idx]={...it, returnedQty:(it.returnedQty||0)+returnable};
      newReturns.push({id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty:returnable, qtyLabel:this.itemQtyLabel(it,returnable), unitCost:it.unitCost, amount:refund});
      runningTotal-=refund; runningPaid-=cashRefund; supplierDebtReduction+=debtReduction;
      stockDeltas[it.productId]=(stockDeltas[it.productId]||0)-returnable;
    });

    App._mv('RETURN','ابطال بل خرید'); const batch=writeBatch(db);
    batch.update(doc(cols.purchases, pur.id), { items:newItems, returns:newReturns, status:'cancelled', total:runningTotal, paid:runningPaid, remaining:runningTotal-runningPaid, ...this.editMeta() });
    if(pur.supplierId && supplierDebtReduction>0){
      const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
      batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-supplierDebtReduction) });
    }
    Object.keys(stockDeltas).forEach(pid=>{
      batch.update(doc(cols.products, pid), { stock: increment(stockDeltas[pid]) });
    });
    batch.commit().then(()=>{ this._markWriteResult(true); this.toast('بل خرید باطل شد'); }).catch(e=>{ console.error(e); this._markWriteResult(false,e); App.toastError('خطا؛ بل خرید تغییری نکرد.'); });
  },
  purchaseIncreaseItemQty(purchaseId, idx){
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل باطل شده است.'); return; }
    const it=pur.items[idx]; if(!it) return;
    const ladder=this.itemUnits(it);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(it.unit||'عدد')+')'):'')}));
    const defUnit=this.itemUnitName(it);
    this.openFormModal({
      title:'افزودن تعداد «'+it.name+'»',
      fields:[
        {key:'unit', label:'واحد', type:'select', options:unitOptions, value:defUnit},
        {key:'qty', label:'چند تا دیگر اضافه شود؟', type:'number', step:'0.01', value:1},
        {key:'paid', label:'مبلغ پرداختی نقدی برای همین اضافه', type:'number', step:'1', value:'', hint:'اگر نسیه است، صفر بگذارید.'}
      ],
      submitLabel:'افزودن',
      onSubmit:(v)=>{
        if(!v.qty||v.qty<=0) throw new Error('تعداد نامعتبر است.');
        const u=ladder.find(x=>x.name===v.unit)||ladder[ladder.length-1];
        const qty=round2((Number(v.qty)||0)*u.factor);
        const addAmount=round2(qty*it.unitCost);
        let addPaid = v.paid===null ? addAmount : v.paid;
        if(isNaN(addPaid)||addPaid<0) addPaid=0; if(addPaid>addAmount) addPaid=addAmount;
        if(addPaid<addAmount && !pur.supplierId) throw new Error('برای نسیه باید بل برای یک فروشنده/شرکت مشخص باشد.');
        const p=this.state.products.find(pp=>pp.id===it.productId);
        const newItems = pur.items.map((x,i)=> i===idx ? {...x, qty:x.qty+qty} : x);
        const newTotal=pur.total+addAmount, newPaid=pur.paid+addPaid;

        App._mv('PURCHASE','افزایش تعداد قلم بل خرید'); const batch=writeBatch(db);
        batch.update(doc(cols.purchases, pur.id), { items:newItems, total:newTotal, originalTotal: increment(addAmount), paid:newPaid, remaining:newTotal-newPaid, ...this.editMeta() });
        if(p){
          const unitCostAFN = pur.currency==='USD' ? it.unitCost*((Number(pur.rateAtPurchase)||this.usdRate())||0) : it.unitCost;
          const newAvgCost = nextAvgCost({ stockQty:p.stock, avgCost:p.avgCost, purchaseQty:qty, unitCost:unitCostAFN }).avgCost;
          batch.update(doc(cols.products, it.productId), { stock: increment(qty), avgCost: newAvgCost });
        }
        if(pur.supplierId && addAmount-addPaid>0){
          const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
          batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(addAmount-addPaid) });
        }
        return batch.commit().then(()=>this.toast('اضافه شد'));
      }
    });
  },
  viewPurchaseBillImage(purchaseId){
    const pur=this.state.purchases.find(x=>x.id===purchaseId);
    if(pur && pur.billImage) this.viewImage(pur.billImage);
  },
  addPurchaseBillPhoto(purchaseId){
    if(!this.guardWrite()) return;
    const input=document.createElement('input');
    input.type='file'; input.accept='image/*'; input.capture='environment';
    input.onchange=async ()=>{
      const file=input.files[0]; if(!file) return;
      try{
        const dataUrl=await compressImageForStorage(file);
        await updateDoc(doc(cols.purchases, purchaseId), { billImage: dataUrl });
      }catch(err){ App.toastError(err.message||'خطا در ذخیرهٔ عکس'); }
    };
    input.click();
  },
  purchaseAddItem(purchaseId){
    if(!this.guardWrite()) return;
    const pur=this.state.purchases.find(x=>x.id===purchaseId); if(!pur) return;
    if(pur.status==='cancelled'){ this.toast('این بل باطل شده است.'); return; }
    if(!this.state.products.length){ this.toast('فهرست محصولات خالی است؛ اول یک محصول اضافه کنید.'); return; }
    this._aiMode='purchase'; this._aiCur=this.curLabel(pur.currency);
    this.openCustomModal({
      title:'افزودن قلم جدید به بل خرید',
      sub:'محصول را از فهرست انتخاب کنید، بعد واحد خرید (کارتن / قوطی / بسته / عدد) و قیمت آن واحد.',
      bodyHtml:this._aiBody('purchase', this.curLabel(pur.currency)),
      submitLabel:'افزودن به بل',
      onSubmit:()=>{
        const {product, u, qty, perBase, addAmount, addPaid} = this._aiReadCommon();
        if(addPaid<addAmount-0.001 && !pur.supplierId) throw new Error('برای نسیه باید بل برای یک فروشنده/شرکت مشخص باشد.');
        const rate = (Number(pur.rateAtPurchase)||this.usdRate())||0;
        const unitCostAFN = pur.currency==='USD' ? perBase*rate : perBase;
        App._mv('PURCHASE','افزودن قلم به بل خرید'); const batch=writeBatch(db);
        const newAvgCost = nextAvgCost({ stockQty:Number(product.stock)||0, avgCost:Number(product.avgCost)||0, purchaseQty:qty, unitCost:unitCostAFN }).avgCost;
        const pFields={ stock: increment(qty), avgCost: newAvgCost };
        if(!product.sellPrice) pFields.sellPrice = round2(unitCostAFN*1.15);
        batch.update(doc(cols.products, product.id), pFields);
        const newItem={productId:product.id, name:product.name, unit:product.unit, qty, unitCost:perBase, returnedQty:0, txUnit:u.name, txFactor:u.factor};
        const newItems=[...pur.items, newItem];
        const newTotal=round2(pur.total+addAmount), newPaid=round2(pur.paid+addPaid);
        batch.update(doc(cols.purchases, pur.id), { items:newItems, total:newTotal, originalTotal: increment(addAmount), paid:newPaid, remaining:round2(newTotal-newPaid), ...this.editMeta() });
        if(pur.supplierId && addAmount-addPaid>0.001){
          const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
          batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(round2(addAmount-addPaid)) });
        }
        return batch.commit().then(()=>this.toast('قلم اضافه شد'));
      }
    });
  },

  /* ---------- Customers / Suppliers (debts) ---------- */
    openParty(type,id){ this.sub=type; this.detailId=id; this.payFormOpen=false; this.render(); },
  closeParty(){ this.detailId=null; this.payFormOpen=false; this.render(); },
    recordPartyPayment(type,id){
    this.payFormOpen = true;
    this._payTxId = uid(); // کلید یکتای همین فرم پرداخت
    this.render();
  },
  cancelPartyPaymentForm(){ this.payFormOpen=false; this.render(); },
  onPurchasePick(id){
    const pur=this.state.purchases.find(x=>x.id===id); const amtEl=document.getElementById('pay-amount');
    if(!pur || !amtEl) return;
    const curEl=document.getElementById('pay-currency');
    if(curEl) curEl.value = pur.currency==='USD' ? 'USD' : 'AFN';
    amtEl.value = (Math.round((Number(pur.remaining)||0)*100)/100).toString();
  },
  purchasePickHTML(p){
    const open=this.state.purchases.filter(s=>s.supplierId===p.id && s.status!=='cancelled' && (Number(s.remaining)||0)>0.001);
    if(!open.length) return '';
    return `<label>بابت کدام بل خرید؟</label>
          <select id="pay-purchase" onchange="App.onPurchasePick(this.value)"><option value="">بدون تخصیص (حساب عمومی شرکت)</option>${open.map(s=>`<option value="${s.id}">بل ${escapeHtml(this.purchaseNoLabel(s.id))} — باقی ${fmt(s.remaining)}${s.currency==='USD'?' دالر':''}</option>`).join('')}</select>
          <div class="field-note">اگر بل را انتخاب کنید، همان بل تسویه می‌شود و در صفحهٔ بل خرید دیگر بدهکار نشان داده نمی‌شود؛ مبلغ اضافه بدون تخصیص می‌ماند.</div>`;
  },
  /* ابطال پرداخت: پرداخت اصلی حذف نمی‌شود؛ یک رویداد معکوس (مبلغ منفی) ثبت می‌شود،
     مانده طرف حساب و فاکتور برمی‌گردد، و Audit ثبت می‌شود. همه داخل یک transaction. */
  voidPayment(paymentId){
    if(!this.isOwner()){ this.toast('ابطال پرداخت فقط برای مالک مجاز است.'); return; }
    const pay=this.state.payments.find(x=>x.id===paymentId);
    if(!pay){ this.toast('پرداخت پیدا نشد.'); return; }
    if(pay.voided||pay.reversalOf){ this.toast('این پرداخت قبلاً باطل شده است.'); return; }
    this.openFormModal({
      title:'ابطال پرداخت',
      sub:(pay.type==='receive'?'دریافت از ':'پرداخت به ')+(pay.partyName||'')+' — '+fmt(pay.amount)+' — '+pay.date,
      fields:[{key:'reason', label:'دلیل ابطال (الزامی)', type:'text', placeholder:'مثلاً مبلغ اشتباه ثبت شد'}],
      submitLabel:'ابطال پرداخت', danger:true,
      onSubmit:(v)=>{
        const reason=(v.reason||'').trim();
        if(!reason) throw new Error('دلیل ابطال را بنویسید.');
        return this._runVoidPayment(paymentId, reason);
      }
    });
  },
  async _runVoidPayment(paymentId, reason){
    /* قبلاً runTransaction بود که فقط با سرور کار می‌کند (آفلاین: «اتصال اینترنت را بررسی کنید»).
       حالا مثل بقیهٔ عملیات «اول محلی» است: مانده‌ها با increment (قابل جمع شدن) و شناسهٔ ثابتِ برگشت. */
    const revId='rev_'+paymentId; // شناسهٔ ثابت: هرگز دو برگشت برای یک پرداخت ساخته نمی‌شود
    try{
      const original=this.state.payments.find(x=>x.id===paymentId);
      if(!original) throw new Error('پرداخت پیدا نشد.');
      const built = buildPaymentReversal({ original, id:revId, ts:Date.now(), date:todayISO(), userId:(this.user&&this.user.email)||'', reason });
      const reversal=built.reversal, originalPatch=built.originalPatch;
      const amt=Number(original.amount)||0;
      const isCust=original.partyType==='customer';
      const partyRef=doc(cols[isCust?'customers':'suppliers'], original.partyId);
      const balField=(!isCust && original.currency==='USD') ? 'balanceUSD' : 'balance';
      const alloc=Number(original.allocatedAmount)||0;
      const s=(original.saleId && alloc>0) ? this.state.sales.find(x=>x.id===original.saleId) : null;
      const clean={}; Object.keys(reversal).forEach(k=>{ if(reversal[k]!==undefined) clean[k]=reversal[k]; });
      clean.allocatedAmount = -alloc;
      const batch=writeBatch(db);
      batch.set(doc(cols.payments, revId), clean);
      batch.update(doc(cols.payments, paymentId), originalPatch);
      batch.update(partyRef, { [balField]: increment(amt) });
      if(s){
        batch.update(doc(cols.sales, original.saleId), { settled: increment(-alloc), remaining: increment(alloc), ...this.editMeta() });
        this.audit(batch, { action:'reverse', entityType:'sale', entityId:original.saleId, before:s, after:{ ...s, remaining: round2((Number(s.remaining)||0)+alloc) } });
      }
      if(original.purchaseId && alloc>0){
        batch.update(doc(cols.purchases, original.purchaseId), { paid: increment(-alloc), remaining: increment(alloc), ...this.editMeta() });
      }
      this.audit(batch, { action:'void', entityType:'payment', entityId:paymentId, before:original, after:{ ...original, ...originalPatch } });
      await batch.commit();
      this.toast('پرداخت باطل شد');
    }catch(e){
      console.error('void payment', e);
      if(e && (e.code==='permission-denied' || e.code==='firestore/permission-denied')) throw new Error('اجازهٔ ابطال پرداخت داده نشد؛ قوانین Firestore را بررسی کنید (فقط مالک می‌تواند باطل کند).');
      throw new Error((e&&e.message&&e.message.indexOf('باطل')>=0)?e.message:('ابطال پرداخت انجام نشد. '+((e&&e.message)||'')));
    }
  },
  async submitPartyPayment(type,id){
    if(this._payBusy) return; // جلوگیری از ثبت دوبارهٔ پرداخت با دوبار لمس
    this._payBusy=true;
    try{ await this._submitPartyPaymentInner(type,id); } finally { this._payBusy=false; }
  },
  async _submitPartyPaymentInner(type,id){
    const amt = parseFloat(document.getElementById('pay-amount').value);
    if(!amt || amt<=0){ this.toast('مبلغ را درست بنویسید'); return; }
    const date = document.getElementById('pay-date').value || todayISO();
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p = arr.find(x=>x.id===id);
    if(!p) return;
    const currency = (type==='suppliers' && document.getElementById('pay-currency') && document.getElementById('pay-currency').value==='USD') ? 'USD' : 'AFN';
    let payRate = null;
    if(currency==='USD'){
      payRate = this.usdRate();
      if(payRate<=0){ this.toast('لطفاً ابتدا نرخ فعلی دالر را تنظیم کنید (از داشبورد یا تنظیمات).'); return; }
    }
    const photoInput = document.getElementById('pay-photo');
    const photoFile = photoInput && photoInput.files[0];
    let receiptImage = null;
    if(photoFile){
      try{ receiptImage = await compressImageForStorage(photoFile); }
      catch(err){ App.toastError(err.message||'خطا در پردازش عکس رسید'); return; }
    }
    const colName = type==='customers' ? 'customers' : 'suppliers';
    const balField = (type==='suppliers' && currency==='USD') ? 'balanceUSD' : 'balance';
    const paymentId=this._payTxId || uid();
    if(this.state.payments.some(x=>x.id===paymentId)){ this.toast('این پرداخت قبلاً ثبت شده است.'); return; } // جلوگیری از ثبت دوبارهٔ پرداخت
    const batch=writeBatch(db);
    batch.update(doc(cols[colName], id), { [balField]: increment(-amt) });
    const saleSel = (type==='customers' && document.getElementById('pay-sale')) ? document.getElementById('pay-sale').value : '';
    const allocSale = saleSel ? this.state.sales.find(s=>s.id===saleSel && s.customerId===id) : null;
    const alloc = allocatePayment({ sale: allocSale, amount: amt });
    const purSel = (type==='suppliers' && document.getElementById('pay-purchase')) ? document.getElementById('pay-purchase').value : '';
    const allocPur = purSel ? this.state.purchases.find(s=>s.id===purSel && s.supplierId===id) : null;
    if(allocPur && (allocPur.currency||'AFN')!==currency){ this.toast('ارز پرداخت با ارز این بل خرید یکی نیست.'); return; }
    const purApplied = allocPur ? Math.round(Math.min(Math.max(0,Number(allocPur.remaining)||0), amt)*100)/100 : 0;
    const paymentDoc = {id:paymentId, ts:Date.now(), date, type: type==='customers'?'receive':'pay', partyType:type==='customers'?'customer':'supplier', partyId:id, partyName:p.name, amount:amt, currency, status:'posted', userId:(this.user&&this.user.email)||'', allocatedAmount:0, ...this.recordMeta()};
    if(allocSale && alloc.applied>0){
      paymentDoc.saleId = allocSale.id; paymentDoc.allocatedAmount = alloc.applied;
      batch.update(doc(cols.sales, allocSale.id), { settled: increment(alloc.applied), remaining: increment(-alloc.applied), ...this.editMeta() });
      this.audit(batch, { action:'allocate', entityType:'sale', entityId:allocSale.id, before:allocSale, after:{ ...allocSale, remaining: round2((Number(allocSale.remaining)||0)-alloc.applied) } });
    }
    if(allocPur && purApplied>0.001){
      const purRem = Math.round(((Number(allocPur.remaining)||0)-purApplied)*100)/100;
      paymentDoc.purchaseId = allocPur.id; paymentDoc.allocatedAmount = purApplied;
      batch.update(doc(cols.purchases, allocPur.id), { paid: increment(purApplied), remaining: increment(-purApplied), ...this.editMeta() });
      this.audit(batch, { action:'allocate', entityType:'purchase', entityId:allocPur.id, before:allocPur, after:{ ...allocPur, paid:(Number(allocPur.paid)||0)+purApplied, remaining:purRem } });
    }
    this.audit(batch, { action:'create', entityType:'payment', entityId:paymentId, before:null, after:paymentDoc });
    if(currency==='USD') paymentDoc.rate = payRate;
    if(receiptImage) paymentDoc.receiptImage = receiptImage;
    batch.set(doc(cols.payments, paymentId), paymentDoc);
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
    this._payTxId = undefined;
    this.payFormOpen = false;
    this.render();
  },
  viewPaymentReceipt(paymentId){
    const pay = this.state.payments.find(x=>x.id===paymentId);
    if(pay && pay.receiptImage) this.viewImage(pay.receiptImage);
  },
  addPaymentReceiptPhoto(paymentId){
    const input=document.createElement('input');
    input.type='file'; input.accept='image/*'; input.capture='environment';
    input.onchange=async ()=>{
      const file=input.files[0]; if(!file) return;
      try{
        const dataUrl=await compressImageForStorage(file);
        await updateDoc(doc(cols.payments, paymentId), { receiptImage: dataUrl });
      }catch(err){ App.toastError(err.message||'خطا در ذخیرهٔ عکس'); }
    };
    input.click();
  },
  addPartyManual(type){
    if(!this.guardWrite()) return;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const fields = [
      {key:'name', label: type==='customers'?'نام مشتری جدید':'نام شرکت/عمده‌فروش جدید', type:'text'},
      {key:'phone', label:'شماره تماس (اختیاری)', type:'text'},
      {key:'address', label:'آدرس (اختیاری)', type:'text'},
      {key:'openAmt', label: type==='customers' ? 'بدهی قبلی این مشتری (اگر دارد)' : 'بدهی قبلی شما به این شرکت (اگر دارد)', type:'number', value:0, hint:'اگر بدهی قبلی وجود ندارد، صفر بگذارید.'}
    ];
    if(type==='suppliers'){
      fields.push({key:'openCurrency', label:'ارز این بدهی', type:'select', value:'AFN', options:[{value:'AFN',label:this.state.settings.currency},{value:'USD',label:'دالر'}]});
    }
    this.openFormModal({
      title: type==='customers' ? 'مشتری جدید' : 'عمده‌فروش جدید',
      fields, submitLabel:'ذخیره',
      onSubmit:(v)=>{
        const name=(v.name||'').trim();
        if(!name) throw new Error('نام را بنویسید.');
        if(arr.find(x=>x.name===name)) throw new Error('این نام قبلاً ثبت شده است.');
        const phone=(v.phone||'').trim(), address=(v.address||'').trim();
        let openAmt = v.openAmt||0;
        const openCurrency = (type==='suppliers' && v.openCurrency==='USD') ? 'USD' : 'AFN';
        const colName = type==='customers' ? 'customers' : 'suppliers';
        const partyId = uid();
        const batch=writeBatch(db);
        const partyFields = {id:partyId, name, phone, address, balance: openCurrency==='AFN' ? openAmt : 0, ...this.recordMeta()};
        if(type==='suppliers') partyFields.balanceUSD = openCurrency==='USD' ? openAmt : 0;
        batch.set(doc(cols[colName], partyId), partyFields);
        if(openAmt){
          const openId=uid();
          batch.set(doc(cols.openingEntries, openId), {id:openId, ts:Date.now(), date:todayISO(), partyType:type, partyId, partyName:name, amount:openAmt, currency:openCurrency, note:'بدهی افتتاحیه (قبل از این سیستم)', ...this.recordMeta()});
        }
        return batch.commit().then(()=>this.toast('ذخیره شد'));
      }
    });
  },
  setOpeningBalance(type,id){
    if(!this.guardWrite()) return;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p = arr.find(x=>x.id===id); if(!p) return;
    const label = type==='customers'
      ? 'مبلغی که این مشتری از قبل (قبل از این سیستم) به شما بدهکار است'
      : 'مبلغی که شما از قبل (قبل از این سیستم) به این شرکت/عمده‌فروش بدهکار هستید';
    const fields=[{key:'amt', label, type:'number', value:0}];
    if(type==='suppliers') fields.push({key:'currency', label:'ارز این بدهی', type:'select', value:'AFN', options:[{value:'AFN',label:this.state.settings.currency},{value:'USD',label:'دالر'}]});
    this.openFormModal({
      title:'ثبت بدهی افتتاحیه', fields, submitLabel:'ثبت',
      onSubmit:(v)=>{
        const amt=v.amt;
        if(!amt) throw new Error('مبلغ نامعتبر یا صفر است.');
        const currency = (type==='suppliers' && v.currency==='USD') ? 'USD' : 'AFN';
        const colName = type==='customers' ? 'customers' : 'suppliers';
        const balField = (type==='suppliers' && currency==='USD') ? 'balanceUSD' : 'balance';
        const batch=writeBatch(db);
        batch.update(doc(cols[colName], id), { [balField]: increment(amt) });
        const openId=uid();
        batch.set(doc(cols.openingEntries, openId), {id:openId, ts:Date.now(), date:todayISO(), partyType:type, partyId:id, partyName:p.name, amount:amt, currency, note:'بدهی افتتاحیه (قبل از این سیستم)', ...this.recordMeta()});
        return batch.commit().then(()=>this.toast('بدهی افتتاحیه ثبت شد'));
      }
    });
  },
  editParty(type,id){
    if(!this.guardWrite()) return;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p=arr.find(x=>x.id===id); if(!p) return;
    this.openFormModal({
      title:'ویرایش اطلاعات',
      fields:[
        {key:'name', label:'نام', type:'text', value:p.name},
        {key:'phone', label:'شماره تماس', type:'text', value:p.phone||''},
        {key:'address', label:'آدرس', type:'text', value:p.address||''}
      ],
      submitLabel:'ذخیره',
      onSubmit:(v)=>{
        const trimmed=(v.name||'').trim();
        if(!trimmed) throw new Error('نام نمی‌تواند خالی باشد.');
        if(arr.find(x=>x.name===trimmed && x.id!==id)) throw new Error('طرف‌حساب دیگری با همین نام موجود است.');
        const colName = type==='customers' ? 'customers' : 'suppliers';
        const batch=writeBatch(db);
        batch.update(doc(cols[colName], id), { name:trimmed, phone:(v.phone||'').trim(), address:(v.address||'').trim() });
        if(type==='customers'){
          this.state.sales.forEach(s=>{ if(s.customerId===id) batch.update(doc(cols.sales, s.id), { customerName:trimmed }); });
        } else {
          this.state.purchases.forEach(s=>{ if(s.supplierId===id) batch.update(doc(cols.purchases, s.id), { supplierName:trimmed }); });
        }
        return batch.commit().then(()=>this.toast('ذخیره شد'));
      }
    });
  },
  deleteParty(type,id){
    if(!this.guardWrite()) return;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p=arr.find(x=>x.id===id); if(!p) return;
    const hasDebt = Math.abs(p.balance||0)>0.5 || (type==='suppliers' && Math.abs(p.balanceUSD||0)>0.5);
    const hasActivity = type==='customers'
      ? (this.state.sales.some(s=>s.customerId===id) || this.state.payments.some(x=>x.partyId===id))
      : (this.state.purchases.some(s=>s.supplierId===id) || this.state.payments.some(x=>x.partyId===id));
    if(hasDebt && hasActivity){ this.toast('این طرف فاکتور یا پرداخت دارد؛ ابتدا حساب را تسویه کنید.'); return; }
    const openings = (this.state.openingEntries||[]).filter(x=>x.partyId===id);
    const openMsg = hasDebt ? '\nبدهی افتتاحیهٔ اشتباهی‌اش هم با آن پاک می‌شود.' : '';
    this.openConfirmModal({
      title:'حذف از فهرست',
      msg:'«'+p.name+'» از فهرست حذف شود؟'+openMsg+(hasActivity?' سابقهٔ فاکتورهای قبلی آن باقی می‌ماند.':''),
      danger:true, confirmLabel:'حذف شود',
      onConfirm: ()=>{
        const colName = type==='customers' ? 'customers' : 'suppliers';
        const batch=writeBatch(db);
        openings.forEach(o=>batch.delete(doc(cols.openingEntries, o.id)));
        batch.delete(doc(cols[colName], id));
        batch.commit().then(()=>this.toast('حذف شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
        this.detailId=null;
        this.render();
      }
    });
  },

  /* ---------- More menu ---------- */
  /* آستانهٔ کم‌موجودی باید به «واحد فروش» سنجیده شود، نه به واحد پایه.
     قبلاً موجودیِ خام (عدد) با آستانه (۱) مقایسه می‌شد؛ یعنی برای کالای کارتنی
     تا وقتی ۱ عدد کیک هم مانده بود، هرگز هشدار کمبود نمی‌داد. */
  isLowStock(p, threshold){
    const t = threshold!==undefined ? threshold
            : (this.state.settings.lowStockThreshold!==undefined ? this.state.settings.lowStockThreshold : 1);
    const u = this.unitByName(p, p.defaultSaleUnit);
    return this.stockInUnit(p, u) <= t;
  },
  lowStockList(){
    return [...this.state.products].filter(p=>!p.archived && this.isLowStock(p)).sort((a,b)=>(a.stock||0)-(b.stock||0));
  },
  
  /* ---------- Expenses ---------- */
  submitExpense(){
    let category = document.getElementById('exp-category').value;
    if(category==='__other__') category = (document.getElementById('exp-other').value||'متفرقه').trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const date = document.getElementById('exp-date').value || todayISO();
    const note = (document.getElementById('exp-note').value||'').trim();
    if(!amount || amount<=0){ this.toast('مبلغ مصرف را درست بنویسید'); return; }
    const expDoc = {id:uid(), ts:Date.now(), date, category, amount, note, ...this.recordMeta()};
    if(category===WITHDRAWAL_CATEGORY){
      const withdrawnBy=(document.getElementById('exp-withdrawn-by').value||'').trim();
      if(!withdrawnBy){ this.toast('نام شخصی که این پول را برداشت کرده بنویسید'); return; }
      expDoc.withdrawnBy = withdrawnBy;
    }
    setDoc(doc(cols.expenses, expDoc.id), expDoc).then(()=>this.toast(category===WITHDRAWAL_CATEGORY ? 'برداشت ثبت شد' : 'مصرف ثبت شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
    this.navigate('more','expenses');
  },
  deleteExpense(id){
    if(!this.isOwner()){ this.toastError(PARTNER_DENIED_MSG); return; }
    this.openConfirmModal({ title:'حذف مصرف', msg:'این مصرف حذف شود؟', danger:true, confirmLabel:'حذف شود',
      onConfirm: ()=> deleteDoc(doc(cols.expenses, id)).then(()=>this.toast('حذف شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); })
    });
  },
    onExpenseCategoryChange(){
    const v=document.getElementById('exp-category').value;
    document.getElementById('exp-other-wrap').style.display = v==='__other__' ? 'block':'none';
    document.getElementById('exp-withdrawn-wrap').style.display = v===WITHDRAWAL_CATEGORY ? 'block':'none';
  },

  /* ---------- Products ---------- */
  submitNewProductForm(){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند محصول اضافه کند.'); return; }
    const gs=id=>{ const el=document.getElementById(id); return el?String(el.value||'').trim():''; };
    const gn=id=>{ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; };
    const name=gs('np-name');
    const stock=gn('np-stock');
    const cost=gn('np-cost');
    if(!name){ this.toast('نام محصول را بنویسید'); return; }
    const pk=_buildPackaging({
      packName:gs('np-packunit'), packPer:gn('np-packper'),
      midName:gs('np-midunit'),   midPer:gn('np-midper')
    });
    if(!pk.ok){ this.toast(pk.error); return; }
    if(pk.packUnit && pk.packUnit===pk.midUnit){ this.toast('نام واحدها باید با هم متفاوت باشد.'); return; }
    const tradeNames=[...new Set([pk.packUnit, pk.midUnit, pk.baseTradable?pk.unit:''].filter(Boolean))];
    const pid=uid();
    App._mv('OPENING','موجودی اول دوره / ثبت محصول جدید');
    const _pb=writeBatch(db);
    _pb.set(doc(cols.products, pid), {id:pid, name, unit:pk.unit, unitQty:1, baseTradable:pk.baseTradable, stock, avgCost:cost, sellPrice:0,
      midUnit:pk.midUnit, midPer:pk.midPer,
      packUnit:pk.packUnit, packPer:pk.packPer,
      sellPriceMid:0, sellPricePack:0, defaultSaleUnit:tradeNames[0]||'', saleUnits:tradeNames, allowFractionalSale:false,
      ...this.recordMeta()});
    _pb.commit().then(()=>this.toast('محصول اضافه شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
  },
  /* پیش‌نمایش زندهٔ فرم «افزودن محصول جدید»: نشان می‌دهد برنامه چه ساختاری می‌سازد
     و موجودی/قیمت را به کدام واحد باید نوشت */
  previewNewProduct(){
    const gs=id=>{ const el=document.getElementById(id); return el?String(el.value||'').trim():''; };
    const gn=id=>{ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; };
    const pk=_buildPackaging({ packName:gs('np-packunit'), packPer:gn('np-packper'), midName:gs('np-midunit'), midPer:gn('np-midper') });
    const setTxt=(id,t)=>{ const el=document.getElementById(id); if(el) el.textContent=t; };
    let unitName='عدد داخلی', summary='';
    if(pk.ok){
      if(pk.kind==='single'){
        unitName=pk.unit;
        summary='✔ محصول تک‌واحدی: فقط با «'+pk.unit+'» خرید و فروش می‌شود (عدد داخلی ندارد).';
      } else if(pk.kind==='base'){
        unitName=pk.unit;
        summary='✔ بدون عدد داخلی: خرید و فروش با «'+pk.unit+'»'+(pk.packUnit?(' و «'+pk.packUnit+'» (۱ '+pk.packUnit+' = '+fmtQty(pk.packSize)+' '+pk.unit+')'):'')+'.';
      } else {
        const bits=[];
        if(pk.packUnit) bits.push('۱ '+pk.packUnit+' = '+fmtQty(pk.packSize)+' عدد داخلی');
        if(pk.midUnit) bits.push('۱ '+pk.midUnit+' = '+fmtQty(pk.midPer)+' عدد داخلی');
        summary='✔ '+bits.join(' · ');
      }
    } else {
      summary = gs('np-packunit')||gs('np-midunit') ? ('⚠ '+pk.error) : '';
    }
    setTxt('np-summary', summary);
    setTxt('np-stock-label','موجودی آغازین (به '+unitName+')');
    setTxt('np-cost-label','قیمت تمام‌شده هر '+unitName+' (اختیاری)');
  },
  editProduct(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند اطلاعات محصول را ویرایش کند.'); return; }
    // نکته: این تابع دیگر موجودی (stock) را دست نمی‌زند — چون بازنویسیِ مطلقِ موجودی
    // با یک عدد که ممکن است روی صفحه کهنه/آفلاین باشد، می‌تواند اثر برگشت-به-انبارِ
    // کنسل/مرجوعیِ فاکتورها را پاک کند. برای اصلاح موجودی از گزینهٔ «اصلاح موجودی» (adjustProductStock) استفاده کنید.
    const p=this.state.products.find(x=>x.id===id); if(!p) return;
    this.openFormModal({
      title:'ویرایش محصول',
      fields:[
        {key:'name', label:'نام محصول', type:'text', value:p.name}
      ],
      submitLabel:'ذخیره',
      onSubmit:(v)=>{
        const name=(v.name||'').trim()||p.name;
        return updateDoc(doc(cols.products, id), { name, ...this.editMeta() }).then(()=>this.toast('ذخیره شد'));
      }
    });
  },
  /* =========================================================
     ویرایش واحدهای تو در تو و قیمت‌های یک محصول موجود در انبار
     (کارتن ← قوطی/بسته + قیمت خرید و فروش واحدهای واقعی معامله)
     ========================================================= */
  editProductUnits(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند واحدها و قیمت‌ها را ویرایش کند.'); return; }
    const p=this.state.products.find(x=>x.id===id); if(!p) return;
    this._puId=id;
    const ladder=this.productUnits(p);
    const packU=ladder.find(u=>u.key==='pack');
    const midU=ladder.find(u=>u.key==='mid');
    const baseTr=this.isBaseTradable(p);
    const baseU=ladder.find(u=>u.key==='base');
    let packNameV='', packPer='', midNameV='', midPerV='';
    if(baseTr){
      // بدون عدد داخلی: خودِ واحد پایه قابل معامله است
      if(packU){ packNameV=packU.name; packPer=packU.factor; midNameV=baseU.name; }
      else { packNameV=baseU.name; }
    } else {
      packNameV=packU?packU.name:''; packPer=packU?round2(packU.factor/(midU?midU.factor:1)):'';
      midNameV=midU?midU.name:''; midPerV=midU?midU.factor:'';
    }
    const body = `
    <div class="field-note">${baseTr
      ? 'این محصول <b>عدد داخلی ندارد</b>؛ موجودی و قیمت‌ها به همان واحد پایهٔ «'+escapeHtml(baseU.name)+'» نگه‌داری می‌شود. (نوع بسته‌بندی بعد از ثبت محصول قابل تغییر نیست.)'
      : 'واحد داخلی <b>عدد</b> است و فقط برای محاسبهٔ موجودی استفاده می‌شود؛ در خرید و فروش عادی قابل انتخاب نیست.'}</div>
    <b class="u-font-size-13-5px">بسته‌بندی و واحدهای معامله</b>
    <div class="grid2">
      <div><label>نام واحد بزرگ (اختیاری)</label><input id="pu-pack" value="${escapeHtml(packNameV)}" placeholder="کارتن" oninput="App.previewProductUnits()"></div>
      <div><label id="pu-packper-label">هر واحد بزرگ حاوی چند ${midNameV?escapeHtml(midNameV):(baseTr?escapeHtml(baseU.name):'عدد')}؟</label><input id="pu-packper" type="number" inputmode="decimal" step="1" value="${packPer}" placeholder="6" oninput="App.previewProductUnits()"></div>
    </div>
    <div class="grid2">
      <div><label>نام واحد میانی (اختیاری)</label><input id="pu-mid" value="${escapeHtml(midNameV)}" placeholder="قوطی / بسته" oninput="App.previewProductUnits()"></div>
      <div><label id="pu-midper-label">هر واحد میانی حاوی چند عدد؟</label><input id="pu-midper" type="number" inputmode="decimal" step="1" value="${midPerV}" placeholder="24 — یا خالی" oninput="App.previewProductUnits()"></div>
    </div>
    <div class="field-note">مثال: ۱ کارتن = ۶ قوطی و ۱ قوطی = ۲۴ عدد. اگر عدد داخلی ندارد، «حاوی چند عدد» خالی بماند.</div>
    <div class="u-margin-top-12px"><label>واحدهای مجاز خرید و فروش</label><div id="pu-sale-units" class="grid2"></div></div>
    <label class="u-align-items-center u-gap-8px u-margin-top-10px" style="display:flex"><input id="pu-fractional" type="checkbox" ${p.allowFractionalSale?'checked':''}> فروش کسری این محصول مجاز باشد (مثلاً ۰٫۵ بسته)</label>
    <hr class="divider">
    <b class="u-font-size-13-5px">قیمت خرید (تمام‌شده)</b>
    <div class="grid2">
      <div><label>مبلغ</label><input id="pu-cost" type="number" inputmode="decimal" step="0.01" value="" oninput="this.dataset.touched='1'; App.previewProductUnits()"></div>
      <div><label>برای هر</label><select id="pu-costunit" onchange="App.previewProductUnits()"></select></div>
    </div>
    <div class="field-note">قیمت واحد خرید را وارد کنید؛ قیمت تمام‌شدهٔ واحدهای دیگر خودکار محاسبه می‌شود.</div>
    <hr class="divider">
    <b class="u-font-size-13-5px">قیمت فروش</b>
    <div id="pu-row-pack" style="display:none;">
      <label id="pu-lbl-sell-pack">قیمت فروش هر کارتن</label>
      <input id="pu-sell-pack" type="number" inputmode="decimal" step="0.01" value="${Number(p.sellPricePack)>0?round2(p.sellPricePack):''}" oninput="App.previewProductUnits()">
      <div class="field-note" id="pu-auto-pack"></div>
    </div>
    <div id="pu-row-mid" style="display:none;">
      <label id="pu-lbl-sell-mid">قیمت فروش هر قوطی</label>
      <input id="pu-sell-mid" type="number" inputmode="decimal" step="0.01" value="${Number(p.sellPriceMid)>0?round2(p.sellPriceMid):''}" oninput="App.previewProductUnits()">
      <div class="field-note" id="pu-auto-mid"></div>
    </div>
    <div id="pu-row-base" style="display:none;">
      <label id="pu-lbl-sell-base">قیمت فروش هر واحد</label>
      <input id="pu-sell-base" type="number" inputmode="decimal" step="0.01" value="${baseTr && Number(p.sellPrice)>0?round2(p.sellPrice):''}" oninput="App.previewProductUnits()">
    </div>
    <label>واحد پیش‌فرض در فرم فروش</label>
    <select id="pu-default"></select>
    <hr class="divider">
    <div id="pu-preview"></div>`;
    this.openCustomModal({
      title:'واحدها و قیمت «'+p.name+'»',
      sub:'موجودی فعلی: '+this.qtyBreakdown(p,p.stock||0)+' — موجودی از این‌جا تغییر نمی‌کند (برای آن «اصلاح موجودی»).',
      bodyHtml: body,
      submitLabel:'ذخیرهٔ واحدها و قیمت‌ها',
      onOpen: ()=>{
        const cu=document.getElementById('pu-costunit');
        if(cu) cu.dataset.want = packU?packU.name:(midU?midU.name:(p.unit||'عدد'));
        const du=document.getElementById('pu-default');
        if(du) du.dataset.want = p.defaultSaleUnit || (p.packUnit || (midU?midU.name:(p.unit||'عدد')));
        App.previewProductUnits();
        const costUnit=App.transactionUnits(p).find(u=>u.name===(cu&&cu.value)) || App.transactionUnits(p)[0];
        const ce=document.getElementById('pu-cost');
        if(ce && costUnit){ ce.value=App.unitCost(p,costUnit)>0?App.unitCost(p,costUnit):''; ce.dataset.touched=''; }
      },
      onSubmit: ()=> this.saveProductUnits(id)
    });
  },
  // خواندن وضعیت فعلی فرم واحدها (بدون ذخیره)
  _puRead(){
    const gs=id=>{ const el=document.getElementById(id); return el?String(el.value||'').trim():''; };
    const gn=id=>{ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; };
    const packName=gs('pu-pack'), packPer=gn('pu-packper');
    const midName=gs('pu-mid'), midPer=gn('pu-midper');
    const pk=_buildPackaging({packName, packPer, midName, midPer});
    const base = pk.ok ? pk.unit : 'عدد';
    const baseTradable = !!(pk.ok && pk.baseTradable);
    const hasMid = !!(pk.ok && pk.midUnit);
    const hasPack = !!(pk.ok && pk.packUnit);
    const packSize = pk.ok ? (pk.packSize||0) : 0;
    const ladder=[];
    if(hasPack) ladder.push({key:'pack', name:pk.packUnit, factor:packSize});
    if(hasMid)  ladder.push({key:'mid',  name:pk.midUnit,  factor:pk.midPer});
    if(pk.ok)   ladder.push({key:'base', name:base, factor:1});
    const txUnits=ladder.filter(u=>u.key!=='base' || baseTradable);
    return {pk, base, baseTradable, packName:hasPack?pk.packUnit:packName, packPer, midName:hasMid?pk.midUnit:midName, midPer:hasMid?pk.midPer:0,
      hasMid, hasPack, packSize, ladder, txUnits,
      cost:gn('pu-cost'), costUnit:gs('pu-costunit'),
      sellPack:gn('pu-sell-pack'), sellMid:gn('pu-sell-mid'), sellBase:gn('pu-sell-base'),
      defaultUnit:gs('pu-default'),
      saleUnits:Array.from(document.querySelectorAll('#pu-sale-units input[data-unit]')).filter(el=>el.checked).map(el=>el.dataset.unit),
      allowFractionalSale:!!document.getElementById('pu-fractional')?.checked};
  },
  previewProductUnits(){
    const r=this._puRead();
    const setTxt=(id,t)=>{ const el=document.getElementById(id); if(el) el.textContent=t; };
    const show=(id,on)=>{ const el=document.getElementById(id); if(el) el.style.display = on?'block':'none'; };
    const bl = r.baseTradable ? r.base : 'عدد داخلی';
    setTxt('pu-packper-label','هر '+(r.packName||'کارتن')+' حاوی چند '+(r.hasMid?r.midName:r.base)+'؟');
    setTxt('pu-midper-label','هر '+(r.midName||'قوطی/بسته')+' حاوی چند عدد؟ (خالی = بدون عدد داخلی)');
    setTxt('pu-lbl-sell-pack','قیمت فروش هر '+(r.packName||'کارتن'));
    setTxt('pu-lbl-sell-mid','قیمت فروش هر '+(r.midName||'قوطی'));
    setTxt('pu-lbl-sell-base','قیمت فروش هر '+r.base);
    show('pu-row-pack', r.hasPack);
    show('pu-row-mid', r.hasMid);
    show('pu-row-base', r.baseTradable);
    // پر کردن سلکت‌ها با حفظ انتخاب قبلی
    ['pu-costunit','pu-default'].forEach(selId=>{
      const sel=document.getElementById(selId); if(!sel) return;
      const want = sel.dataset.want || sel.value;
      const options=selId==='pu-costunit'?r.txUnits:r.txUnits;
      sel.innerHTML = options.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' (= '+fmtQty(u.factor)+' '+escapeHtml(bl)+')':''}</option>`).join('');
      sel.value = options.some(u=>u.name===want) ? want : (options[0]?options[0].name:'');
      delete sel.dataset.want;
    });
    const su=document.getElementById('pu-sale-units');
    if(su){
      const current=this.state.products.find(x=>x.id===this._puId);
      const selected=new Set(Array.isArray(current&&current.saleUnits)?current.saleUnits:r.txUnits.map(u=>u.name));
      su.innerHTML=r.txUnits.map(u=>`<label class="u-align-items-center u-gap-7px" style="display:flex"><input type="checkbox" data-unit="${escapeHtml(u.name)}" ${selected.has(u.name)?'checked':''}> ${escapeHtml(u.name)} <span class="sub">(${fmtQty(u.factor)} ${escapeHtml(bl)})</span></label>`).join('') || '<span class="sub">ابتدا حداقل یک واحد تعریف کنید.</span>';
    }
    const r2=this._puRead();
    const costUnit = r2.txUnits.find(u=>u.name===r2.costUnit) || r2.txUnits[0];
    const costEl=document.getElementById('pu-cost');
    const currentProduct=this.state.products.find(x=>x.id===this._puId);
    if(costEl && currentProduct && costUnit && costEl.dataset.touched!=='1') costEl.value=this.unitCost(currentProduct,costUnit)>0?this.unitCost(currentProduct,costUnit):'';
    const costPerBase = costUnit && r2.cost>0 ? r2.cost/costUnit.factor : 0;
    const inferredBasePrice = r2.baseTradable
      ? (r2.sellBase>0 ? r2.sellBase : (r2.sellPack>0 && r2.packSize>0 ? r2.sellPack/r2.packSize : Number(currentProduct?.sellPrice)||0))
      : (r2.hasMid && r2.sellMid>0 ? r2.sellMid/r2.midPer : (r2.hasPack && r2.sellPack>0 ? r2.sellPack/r2.packSize : Number(currentProduct?.sellPrice)||0));
    const priceOf=u=>{
      if(u.key==='pack' && r2.sellPack>0) return r2.sellPack;
      if(u.key==='mid'  && r2.sellMid>0)  return r2.sellMid;
      return round2(inferredBasePrice*u.factor);
    };
    if(r2.hasPack) setTxt('pu-auto-pack', r2.sellPack>0 ? ('قیمت دستی — بدون آن خودکار '+fmt2(round2(inferredBasePrice*r2.packSize))+' می‌شد') : ('خودکار: '+fmt2(round2(inferredBasePrice*r2.packSize))+' (خالی بگذارید تا خودکار بماند؛ برای تخفیف کارتنی عدد بنویسید)'));
    if(r2.hasMid)  setTxt('pu-auto-mid',  r2.sellMid>0  ? ('قیمت دستی — بدون آن خودکار '+fmt2(round2(inferredBasePrice*r2.midPer))+' می‌شد')  : ('خودکار: '+fmt2(round2(inferredBasePrice*r2.midPer))+' (خالی بگذارید تا خودکار بماند)'));
    const pv=document.getElementById('pu-preview');
    if(pv){
      const rows=r2.txUnits.map(u=>{
        const c=round2(costPerBase*u.factor), s=priceOf(u);
        const profit=round2(s-c);
        return `<tr><td>${escapeHtml(u.name)}</td><td class="num">${fmtQty(u.factor)} ${escapeHtml(r2.base)}</td><td class="num">${fmt2(c)}</td><td class="num">${fmt2(s)}</td><td class="num" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt2(profit)}</td></tr>`;
      }).join('');
      pv.innerHTML = `<b class="u-font-size-13-5px">پیش‌نمایش</b>
      <table class="inv-table"><thead><tr><th>واحد</th><th>ظرفیت</th><th>تمام‌شده</th><th>فروش</th><th>سود</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="field-note">${escapeHtml(r2.pk.ok?'حداقل یک واحد تعریف کنید.':r2.pk.error)}</td></tr>`}</tbody></table>
      <div class="field-note">${escapeHtml(this.unitLadderLabel({unit:r2.base, unitQty:1, midUnit:r2.hasMid?r2.midName:'', midPer:r2.hasMid?r2.midPer:0, packUnit:r2.hasPack?r2.packName:'', packPer:r2.hasPack?r2.packSize:0})||'این محصول فقط یک واحد دارد.')}</div>`;
    }
  },
  saveProductUnits(id){
    const p=this.state.products.find(x=>x.id===id); if(!p) throw new Error('محصول یافت نشد.');
    const r=this._puRead();
    if(!r.pk.ok) throw new Error(r.pk.error);
    if(!r.txUnits.length) throw new Error('حداقل یک واحد (کارتن، قوطی یا بسته) تعریف کنید.');
    if(r.hasPack && r.hasMid && r.packSize<=r.midPer) throw new Error('کارتن باید از قوطی/بسته بزرگ‌تر باشد.');
    // موجودی همیشه به واحد پایه نگه‌داری می‌شود؛ پس معنی «واحد پایه» (داشتن یا نداشتن عدد داخلی) بعد از ثبت عوض نمی‌شود
    const wasTradable=this.isBaseTradable(p);
    if(r.baseTradable!==wasTradable) throw new Error(wasTradable
      ? 'این محصول عدد داخلی ندارد و نوع بسته‌بندی‌اش قابل تغییر نیست. «چند عدد» را خالی بگذارید.'
      : 'این محصول با «عدد داخلی» ثبت شده و نوع بسته‌بندی‌اش قابل تغییر نیست. برای محصول بدون عدد داخلی، محصول جدید بسازید.');
    if(wasTradable){
      const curKind = (p.packUnit && Number(p.packPer)>1) ? 'base' : 'single';
      if(r.pk.kind!==curKind && r.pk.unit!==p.unit) throw new Error('واحد پایهٔ این محصول «'+p.unit+'» است؛ نام آن را عوض نکنید وقتی واحد بزرگ اضافه/حذف می‌کنید.');
    }
    const names=r.ladder.map(u=>u.name);
    if(new Set(names).size!==names.length) throw new Error('نام واحدها باید با هم متفاوت باشد.');
    if(!r.saleUnits.length) throw new Error('حداقل یک واحد فروش را انتخاب کنید.');
    const costUnit=r.txUnits.find(u=>u.name===r.costUnit)||r.txUnits[0];
    const avgCost = r.cost>0 ? round4(r.cost/costUnit.factor) : 0;
    const basePrice = r.baseTradable
      ? (r.sellBase>0 ? round2(r.sellBase) : (r.sellPack>0 && r.packSize>0 ? round2(r.sellPack/r.packSize) : round2(p.sellPrice||0)))
      : (r.hasMid && r.sellMid>0 ? round2(r.sellMid/r.midPer) : (r.hasPack && r.sellPack>0 ? round2(r.sellPack/r.packSize) : round2(p.sellPrice||0)));
    const fields={
      unit:r.base,
      unitQty:1,
      baseTradable:r.baseTradable,
      midUnit:r.hasMid ? r.midName : '',
      midPer:r.hasMid ? round4(r.midPer) : 0,
      packUnit:r.hasPack ? r.packName : '',
      packPer:r.hasPack ? round4(r.packSize) : 0,
      avgCost,
      sellPrice: round2(basePrice),
      sellPriceMid: (r.hasMid && r.sellMid>0)?round2(r.sellMid):0,
      sellPricePack: (r.hasPack && r.sellPack>0)?round2(r.sellPack):0,
      saleUnits:r.saleUnits,
      allowFractionalSale:!!r.allowFractionalSale,
      defaultSaleUnit:r.saleUnits.includes(r.defaultUnit)?r.defaultUnit:r.saleUnits[0],
      ...this.editMeta()
    };
    return updateDoc(doc(cols.products, id), fields).then(()=>this.toast('واحدها و قیمت‌ها ذخیره شد'));
  },
  // اصلاح موجودی همیشه افزایشی (increment) است، نه جایگزینی مطلق — یعنی حتی اگر
  // هم‌زمان یک فاکتور دیگر (فروش/خرید/کنسل) روی همین محصول در حال ثبت باشد،
  // هیچ تغییری گم نمی‌شود، چون سرور مقدار را نسبت به آخرین عدد واقعی خودش جمع/کم می‌کند.
  // فقط مدیر می‌تواند دستی موجودی را اصلاح کند — تغییرات خودکار خرید/فروش/کنسل برای همه باز است.
  adjustProductStock(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند موجودی را دستی اصلاح کند.'); return; }
    const p=this.state.products.find(x=>x.id===id); if(!p) return;
    const ladder=this.transactionUnits(p);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+this.baseLabel(p)+')'):'')}));
    this._adjustId=id; this._adjustProduct=p; this._adjustLadder=ladder;
    const body = `
    <label>انتخاب کار</label>
    <div class="u-gap-8px u-margin-bottom-12px" style="display:flex">
      <button class="btn btn-outline u-flex-1" id="adj-mode-delta" onclick="App.setAdjustMode('delta')">۱. اضافه یا کم کردن موجودی</button>
      <button class="btn btn-outline u-flex-1" id="adj-mode-unit" onclick="App.setAdjustMode('unit')">۲. تنها تغییر واحد</button>
    </div>
    <div id="adj-mode-content"></div>`;
    this.openCustomModal({
      title:'اصلاح یا تغییر «'+p.name+'»',
      sub:'موجودی فعلی: '+this.qtyBreakdown(p,p.stock||0),
      bodyHtml: body,
      submitLabel:'ثبت',
      onOpen: ()=>{
        App.setAdjustMode('delta'); // پیش‌فرض
      },
      onSubmit: ()=> App.submitAdjustStock(id)
    });
  },
  setAdjustMode(mode){
    this._adjustMode=mode;
    const p=this._adjustProduct, ladder=this._adjustLadder;
    const unitOpts=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(p.unit||'عدد')+')'):'')}));
    const body=mode==='delta'
      ? `<label>واحد</label><select id="adj-unit">${unitOpts.map(o=>'<option value="'+escapeHtml(String(o.value))+'">'+escapeHtml(o.label)+'</option>').join('')}</select>
        <label class="u-margin-top-10px">افزایش یا کاهش؟</label>
        <div class="u-gap-8px u-margin-bottom-8px" style="display:flex">
          <button type="button" class="btn btn-outline u-flex-1" id="adj-sign-plus" onclick="App.setAdjustSign(1)">＋ اضافه شود</button>
          <button type="button" class="btn btn-outline u-flex-1" id="adj-sign-minus" onclick="App.setAdjustSign(-1)">－ کم شود</button>
        </div>
        <label>تعداد</label><input id="adj-delta" type="text" inputmode="decimal" placeholder="فقط عدد، مثال: 5 یا 3.5">
        <label class="u-margin-top-10px">دلیل</label>
        <select id="adj-reason"><option value="count">اصلاح بعد از شمارش فیزیکی</option><option value="damaged">خراب/ضایع شده (زیان، بدون کم شدن پول نقد)</option><option value="personal">مصرف شخصی</option><option value="other">سایر</option></select>
        <input class="u-margin-top-6px" id="adj-note" type="text" placeholder="توضیح (اختیاری)">
        <div class="field-note">برای کاستی/مصرف شخصی، واحد فروش را انتخاب کنید، دکمهٔ <b>«کم شود»</b> را بزنید و مقدار را بنویسید؛ مثلاً <b>2 بسته</b>. ${this.isBaseTradable(p)?'':'عدد داخلی در اینجا انتخاب نمی‌شود.'}</div>`
      : `<label>تغییر واحد پیش‌فرض نمایش موجودی به</label><select id="adj-newunit">${unitOpts.map(o=>'<option value="'+o.value+'">'+o.label+'</option>').join('')}</select><div class="field-note u-margin-top-8px">فقط واحد نمایش تغییر می‌کند، موجودی ثابت می‌ماند.</div>`;
    document.getElementById('adj-mode-content').innerHTML = body;
    if(mode==='delta') this.setAdjustSign(this._adjustSign||1);
    ['adj-mode-delta','adj-mode-unit'].forEach(id=>{
      const btn=document.getElementById(id);
      if(btn) btn.style.opacity = (id==='adj-mode-'+(mode))?'1':'0.5';
    });
  },
  /* کیبورد موبایل برای عدد اعشاری علامت منفی ندارد؛ پس علامت با دو دکمهٔ جدا انتخاب می‌شود */
  setAdjustSign(sign){
    this._adjustSign = sign<0 ? -1 : 1;
    const plus=document.getElementById('adj-sign-plus'), minus=document.getElementById('adj-sign-minus');
    if(plus){ plus.style.opacity = this._adjustSign>0 ? '1' : '0.45'; plus.style.fontWeight = this._adjustSign>0 ? '700' : '400'; }
    if(minus){ minus.style.opacity = this._adjustSign<0 ? '1' : '0.45'; minus.style.fontWeight = this._adjustSign<0 ? '700' : '400'; }
  },
  submitAdjustStock(id){
    const mode=this._adjustMode;
    const p=this._adjustProduct, ladder=this._adjustLadder;
    if(mode==='delta'){
      // ارقام فارسی/عربی و ممیز فارسی را به لاتین برمی‌گردانیم؛ علامت از دکمهٔ «اضافه/کم» می‌آید (تایپ + یا - هم هنوز کار می‌کند)
      const rawStr=document.getElementById('adj-delta').value.trim()
        .replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[٫،,]/g,'.').replace(/[−–—]/g,'-');
      if(!rawStr||isNaN(rawStr)) throw new Error('عدد نامعتبر است.');
      const typedNeg = rawStr.startsWith('-');
      const absVal = Math.abs(parseFloat(rawStr));
      const sign = typedNeg ? -1 : (this._adjustSign||1);
      const deltaStr = String(sign*absVal);
      const unitName=document.getElementById('adj-unit').value;
      const u=this.unitByName(p,unitName);
      const delta=round2(parseFloat(deltaStr)*u.factor);
      if(!delta) throw new Error('مقدار صفر است.');
      const kind=(document.getElementById('adj-reason')||{}).value||'count';
      const noteTxt=((document.getElementById('adj-note')||{}).value||'').trim();
      const reasonLbl={count:'اصلاح بعد از شمارش فیزیکی',damaged:'خراب/ضایع شده',personal:'مصرف شخصی',other:'سایر'}[kind]||'سایر';
      const isWaste = kind==='damaged' && delta<0;
      App._mv(isWaste?'WASTE':'ADJUSTMENT', reasonLbl+(noteTxt?(' — '+noteTxt):''), { refType:'manual' });
      const batch=writeBatch(db);
      batch.update(doc(cols.products, id), { stock: increment(delta), ...this.editMeta() });
      if(isWaste){
        // ضایعات: موجودی ↓ و زیان ↑ ، ولی پول نقد بدون تغییر (nonCash)
        const expId=uid(); const cost=round2(Math.abs(delta)*(Number(p.avgCost)||0));
        if(cost>0) batch.set(doc(cols.expenses, expId), {id:expId, ts:Date.now(), date:todayISO(), category:WASTE_CATEGORY, amount:cost, nonCash:true, kind:'waste',
          wasteId:expId, productId:id, quantity:Math.abs(delta), unit:'عدد', cost, warehouseId:DEFAULT_WAREHOUSE, reason:reasonLbl+(noteTxt?(' — '+noteTxt):''),
          userId:(this.user&&this.user.email)||'', reference:'stock-adjustment', note:p.name+' · '+fmtQty(Math.abs(parseFloat(deltaStr)))+' '+u.name+(noteTxt?(' — '+noteTxt):''), ...this.recordMeta()});
      }
      this.audit(batch, { action:'adjust', entityType:'product', entityId:id, before:{ id, stock:p.stock }, after:{ id, stock:round4((Number(p.stock)||0)+delta) } });
      return batch.commit().then(()=>this.toast((delta>0?'+':'-')+fmtQty(Math.abs(parseFloat(deltaStr)))+' '+u.name+' ثبت شد'));
    } else {
      const newUnit=document.getElementById('adj-newunit').value;
      if(!newUnit || !ladder.some(u=>u.name===newUnit)) throw new Error('واحد نامعتبر است.');
      return updateDoc(doc(cols.products, id), { defaultSaleUnit: newUnit }).then(()=>this.toast('واحد نمایش تغییر کرد: '+newUnit));
    }
  },
  deleteProduct(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند محصول را بایگانی کند.'); return; }
    const p=this.state.products.find(x=>x.id===id); if(!p || p.archived) return;
    this.openConfirmModal({
      title:'بایگانی محصول',
      msg:'«'+p.name+'» بایگانی شود؟ کالا از سابقه حذف نمی‌شود و همچنان در فهرست خرید و فروش قابل انتخاب خواهد بود.',
      danger:true, confirmLabel:'بایگانی شود',
      onConfirm: ()=> updateDoc(doc(cols.products, id), { archived:true, archivedAt:Date.now(), archivedBy:(this.user&&this.user.email)||'' }).then(()=>this.toast('محصول بایگانی شد؛ در فهرست خرید و فروش هم باقی می‌ماند.')).catch(e=>{ console.error(e); App.toastError('خطا در بایگانی محصول؛ دوباره تلاش کنید.'); })
    });
  },
    
  /* ---------- تاریخچهٔ کامل معاملات ----------
     برخلاف «آخرین معاملات» در داشبورد (فقط ۸ مورد آخر) و «سابقهٔ معاملات» در پروفایل
     مشتری/عمده‌فروش (فقط برای طرف‌های ثبت‌شده)، این صفحه همهٔ فروش‌ها (چه مشتری نقدی
     چه ثبت‌شده)، خریدها، مصارف/برداشت‌ها، و دریافت/پرداخت‌ها را با فیلتر تاریخ و نوع
     نشان می‌دهد — چیزی گم نمی‌شود. */
  setHistoryPeriod(p){ this.historyPeriod=p; this.render(); },
  setHistoryType(t){ this.historyType=t; this.render(); },
  // ---- جستجو و فیلتر لیست‌ها ----
  listState(key){ this.listUI = this.listUI || {}; return (this.listUI[key] = this.listUI[key] || {q:'', f:'all'}); },
  setListQuery(key, value, caret){
    this.listState(key).q = value;
    this._restoreFocus = { id:'lq-'+key, pos: (caret==null ? value.length : caret) };   // تا کاربر وسط تایپ، کیبورد نپرد
    this.render();
  },
  setListFilter(key, f){ this.listState(key).f = f; this.render(); },
  
  /* ---------- Reports ---------- */
  setPeriod(p){ this.reportPeriod=p; this.render(); },
  /* نمودار روند فروش و سود — SVG داخلی (بدون Chart.js و بدون اینترنت). همزمان با خود صفحه ساخته می‌شود. */
  trendChartHtml(start,end){
    const { buckets, step } = trendBuckets({ sales:this.state.sales, returns:this.state.returns, expenses:this.state.expenses, start, end });
    const n = buckets.length;
    const key = start+'|'+end;
    // انتخاب پیش‌فرض: جدیدترین بازه. با تغییر دوره دوباره از همان‌جا شروع می‌شود.
    if(this._chartKey !== key || this._chartSel == null || this._chartSel >= n){
      // پیش‌فرض: آخرین بازه‌ای که معامله دارد (اگر امروز هنوز فروشی نداشته باشد، روز قبل نشان داده شود)
      let last = n-1;
      for(let i=n-1;i>=0;i--){ if(buckets[i].invoices || buckets[i].sales || buckets[i].expenses){ last = i; break; } }
      this._chartKey = key; this._chartSel = last;
    }
    const view = buckets.map(b=>({
      label: b.from.slice(5),
      title: b.from===b.to ? dateLabelFa(b.from) : (b.from+' تا '+b.to),
      from: b.from, to: b.to, sales: b.sales, profit: b.profit, expenses: b.expenses, grossProfit: b.grossProfit, invoices: b.invoices
    }));
    const note = step>1 ? ('هر بازه '+step+' روز') : 'هر ستون یک روز';
    const allZero = view.every(b=>!b.sales && !b.profit);
    return buildTrendChart({ buckets:view, hidden:this._chartHidden||[], sel:this._chartSel, cur:this.state.settings.currency,
      rangeNote:note, pickFn:'App.chartPick', toggleFn:'App.chartToggle' })
      + (allZero ? '<div class="field-note">در این بازه هنوز فروشی ثبت نشده؛ خط‌ها صفر نشان داده می‌شوند.</div>' : '');
  },
  /* کلیک روی یک بازهٔ نمودار: فقط همان بازه را انتخاب کن و گزارش را دوباره بساز (اسکرول افقی حفظ می‌شود) */
  chartPick(i){ this._chartSel = i; this._rerenderKeepChart(); },
  chartToggle(k){
    const hidden = (this._chartHidden||[]).slice();
    const i = hidden.indexOf(k);
    if(i >= 0) hidden.splice(i,1);
    else if(hidden.length === 0) hidden.push(k);   // حداقل یک سری باید دیده شود
    this._chartHidden = hidden;
    this._rerenderKeepChart();
  },
  _rerenderKeepChart(){
    const el = document.getElementById('trend-scroll') || document.querySelector('.trend-scroll');
    const pos = el ? el.scrollLeft : null;
    this.render();
    if(pos !== null) requestAnimationFrame(()=>{ const e = document.querySelector('.trend-scroll'); if(e) e.scrollLeft = pos; });
  },
  async exportReportExcel(start,end,label){
    if(typeof XLSX==='undefined'){
      this.toast('در حال آماده‌سازی خروجی اکسل...');
      try{ await loadExternalScript(XLSX_JS_URL); }
      catch(e){ this.toast('اتصال اینترنت برای دانلود ابزار اکسل لازم است؛ دوباره تلاش کنید.'); return; }
    }
    const sales=this.salesInRange(start,end).filter(s=>s.status!=='cancelled');
    const purchases=this.purchasesInRange(start,end).filter(p=>p.status!=='cancelled');
    const expenses=this.expensesInRange(start,end);
    const wb=XLSX.utils.book_new();
    const salesRows=sales.map(s=>({ 'شماره فاکتور':this.invoiceNoLabel(s.id), 'تاریخ':s.date, 'مشتری':s.customerName, 'مجموع':s.total, 'پرداخت‌شده':(Number(s.paid)||0)+(Number(s.settled)||0), 'باقیمانده':s.remaining, 'سود':s.profit }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), 'فروش');
    const purchRows=purchases.map(p=>({ 'تاریخ':p.date, 'شماره بل عمده‌فروش':p.supplierInvoiceNo||'', 'عمده‌فروش':p.supplierName||'نقدی', 'ارز':p.currency||'AFN', 'مجموع':p.total, 'پرداخت‌شده':p.paid, 'باقیمانده':p.remaining }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchRows), 'خرید');
    const expRows=expenses.map(e=>({ 'تاریخ':e.date, 'نوع':e.category, 'مبلغ':e.amount, 'یادداشت':e.note||'' }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'مصارف');
    const sm=salesSummary({ sales:this.state.sales, returns:this.state.returns, from:start, to:end });
    const revenue=sm.net, cogs=sm.cogs, expTotal=sum(expenses.filter(e=>e.category!==WITHDRAWAL_CATEGORY),'amount');
    const retRows=this.state.returns.filter(r=>r.date>=start&&r.date<=end).sort((a,b)=>(a.ts||0)-(b.ts||0)).map(r=>({ 'تاریخ مرجوعی':r.date, 'نوع':({return:'مرجوعی',cancel:'ابطال فاکتور',shortage:'کاستی'})[r.kind]||r.kind, 'فاکتور':this.invoiceNoLabel(r.originalSaleId), 'مشتری':r.customerName||'', 'مبلغ':r.amount, 'بهای کالای برگشتی':r.cost, 'دلیل':r.reason||'' }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(retRows), 'مرجوعی');
    const summaryRows=[
      {'شرح':'فروش ناخالص (پیش از تخفیف و مرجوعی)','مبلغ':sm.gross},
      {'شرح':'تخفیف‌ها','مبلغ':-sm.discounts},
      {'شرح':'مرجوعی و ابطال و کاستی','مبلغ':-sm.returns},
      {'شرح':'فروش خالص','مبلغ':revenue},
      {'شرح':'قیمت تمام‌شدهٔ کالای فروخته‌شده','مبلغ':cogs},
      {'شرح':'سود ناخالص','مبلغ':revenue-cogs},
      {'شرح':'مجموع مصارف','مبلغ':expTotal},
      {'شرح':'سود خالص','مبلغ':revenue-cogs-expTotal},
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'خلاصه');

    // جزئیات سود هر محصول؛ همان محاسبه‌ای که در گزارش روی صفحه نمایش داده می‌شود.
    const productRows = productProfitSummary({ sales:this.state.sales, from:start, to:end }).map(r=>({
      'شناسه محصول':r.id, 'نام محصول':r.name, 'مقدار فروخته‌شده':r.qty,
      'فروش خالص قلم':r.revenue, 'بهای تمام‌شده':r.cost, 'سود':r.profit
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), 'سود محصولات');

    // سن بدهی مشتریان وضعیت امروز است و عمداً مستقل از بازه گزارش فروش باقی می‌ماند.
    const aging = debtAging({ customers:this.state.customers, sales:this.state.sales, today:todayISO() });
    const agingRows = aging.rows.map(r=>({
      'شناسه مشتری':r.id, 'نام مشتری':r.name, 'مجموع بدهی':r.balance,
      '۰ تا ۳۰ روز':r.d0_30, '۳۱ تا ۶۰ روز':r.d31_60,
      '۶۱ تا ۹۰ روز':r.d61_90, 'بیش از ۹۰ روز':r.d90p,
      'بدون فاکتور':r.noInvoice, 'قدیمی‌ترین بدهی (روز)':r.oldestDays
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agingRows), 'سن بدهی مشتریان');

    // تفکیک مصارف بر اساس دسته و ثبت جداگانه برداشت‌های شخصی، بدون شمردن آن‌ها در سود خالص.
    const categoryTotals = {};
    expenses.filter(e=>e.category!==WITHDRAWAL_CATEGORY).forEach(e=>{
      const category = e.category || 'بدون دسته';
      categoryTotals[category] = (categoryTotals[category] || 0) + (Number(e.amount) || 0);
    });
    const categoryRows = Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]).map(([category,amount])=>({ 'دسته مصرف':category, 'مجموع مبلغ':round2(amount) }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows), 'تفکیک مصارف');
    const withdrawalRows = expenses.filter(e=>e.category===WITHDRAWAL_CATEGORY).map(e=>({
      'تاریخ':e.date, 'برداشت‌کننده':e.withdrawnBy || 'نامشخص', 'مبلغ':e.amount, 'یادداشت':e.note || ''
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(withdrawalRows), 'برداشت شخصی');

    // Snapshot of current stock; valuation uses the same weighted-average cost stored in avgCost.
    const inventoryRows = this.inventoryReportRows();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventoryRows), 'وضعیت انبار');
    const inventorySummary = this.inventorySummaryRows(inventoryRows);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inventorySummary), 'خلاصه انبار');

    // ثبت‌های دریافت و پرداخت واقعی؛ ابطال‌ها با مبلغ منفی باقی می‌مانند تا خالص محاسبه شود.
    // فاکتورهای فروش/خرید و پرداخت‌های تخصیص‌یافته جداگانه جمع نمی‌شوند تا دوباره‌شماری نشود.
    const paymentRows = this.state.payments
      .filter(p=>p.date>=start && p.date<=end && !p.voided)
      .sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.ts||0)-(b.ts||0))
      .map(p=>({
        'شناسه پرداخت':p.id, 'تاریخ':p.date,
        'نوع':p.reversalOf ? 'ابطال دریافت/پرداخت' : (p.type==='receive'?'دریافت از مشتری':'پرداخت به فروشنده'),
        'طرف حساب':p.partyName||'', 'ارز':p.currency||'AFN',
        'مبلغ خالص رویداد':Number(p.amount)||0,
        'شناسه فاکتور فروش':p.saleId||'', 'شناسه فاکتور خرید':p.purchaseId||'',
        'یادداشت':p.note||'', 'وضعیت':p.status||''
      }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), 'گردش دریافت پرداخت');
    const paymentTotals = {};
    paymentRows.forEach(p=>{
      const key=(p['ارز']||'AFN')+'|'+p['نوع'];
      paymentTotals[key]=(paymentTotals[key]||0)+(Number(p['مبلغ خالص رویداد'])||0);
    });
    const paymentSummaryRows=Object.entries(paymentTotals).map(([key,amount])=>{
      const [currency,type]=key.split('|');
      return {'ارز':currency,'نوع رویداد':type,'مجموع خالص رویدادها':round2(amount)};
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentSummaryRows), 'خلاصه دریافت پرداخت');

    XLSX.writeFile(wb, 'گزارش-'+label+'-'+todayISO()+'.xlsx');
  },
  
  /* ---------- Settings / Backup ---------- */
  saveDeviceLabelFromInput(){
    const val=(document.getElementById('set-device-label').value||'').trim();
    setDeviceLabel(val);
    this.toast('نام دستگاه ذخیره شد');
    this.render();
  },
  saveSettings(){
    if(!this.guardWrite()) return;
    const fields = {
      businessName:(document.getElementById('set-name').value||'').trim()||'فروشگاه صانع',
      currency:(document.getElementById('set-currency').value||'').trim()||'افغانی',
      openingCash:parseFloat(document.getElementById('set-cash').value)||0,
      usdRate:parseFloat(document.getElementById('set-usdrate').value)||0,
      logoEmoji:(document.getElementById('set-logo').value||'').trim()||'🏪',
      businessPhone:(document.getElementById('set-phone').value||'').trim(),
      businessAddress:(document.getElementById('set-address').value||'').trim(),
      openingNote:(document.getElementById('set-opening-note').value||'').trim(),
      lowStockThreshold: parseFloat(document.getElementById('set-lowstock').value)||0,
      timezone: (document.getElementById('set-timezone')||{}).value || 'Asia/Kabul',
    };
    updateDoc(settingsDocRef, fields).then(()=>{
      setBusinessTimezone(fields.timezone);
      document.getElementById('biz-name').textContent=fields.businessName;
      this.toast('تنظیمات ذخیره شد');
    }).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
  },
  _downloadJSON(data, filename){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    // بعضی مرورگرهای موبایل دانلود را غیرهم‌زمان آغاز می‌کنند؛ فوراً آزادکردن URL ممکن است فایل را خراب کند.
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  },
  exportBackup(){
    this._downloadJSON(buildBackup({ businessId:BIZ_ID, state:this.state, appVersion:'hesabdari-app' }), 'backup-hesabdari-'+todayISO()+'.json');
  },
  async exportBackupExcel(){
    if(typeof XLSX==='undefined'){
      this.toast('در حال آماده‌سازی خروجی اکسل...');
      try{ await loadExternalScript(XLSX_JS_URL); }
      catch(e){ this.toast('اتصال اینترنت برای دانلود ابزار اکسل لازم است؛ دوباره تلاش کنید.'); return; }
    }
    const wb=XLSX.utils.book_new();
    const s=this.state;
    const inventoryRows = this.inventoryReportRows();
    const inventorySummary = this.inventorySummaryRows(inventoryRows);
    const sheets = {
      'محصولات': s.products.map(p=>({شناسه:p.id, نام:p.name, واحد:p.unit, موجودی:p.stock, 'میانگین قیمت خرید':p.avgCost, 'قیمت فروش':p.sellPrice})),
      'مشتریان': s.customers.map(c=>({شناسه:c.id, نام:c.name, تلفن:c.phone||'', آدرس:c.address||'', مانده:c.balance||0})),
      'عمده‌فروشان': s.suppliers.map(c=>({شناسه:c.id, نام:c.name, تلفن:c.phone||'', آدرس:c.address||'', 'مانده افغانی':c.balance||0, 'مانده دالر':c.balanceUSD||0})),
      'فروش': s.sales.map(x=>({شناسه:x.id, شماره:this.invoiceNoLabel(x.id), تاریخ:x.date, مشتری:x.customerName||'', مجموع:x.total, پرداختی:x.paid, باقیمانده:x.remaining, سود:x.profit, وضعیت:x.status||''})),
      'خرید': s.purchases.map(x=>({شناسه:x.id, تاریخ:x.date, 'شماره بل عمده‌فروش':x.supplierInvoiceNo||'', عمده‌فروش:x.supplierName||'نقدی', ارز:x.currency||'AFN', مجموع:x.total, پرداختی:x.paid, باقیمانده:x.remaining, وضعیت:x.status||''})),
      'مصارف': s.expenses.map(x=>({شناسه:x.id, تاریخ:x.date, نوع:x.category||'', مبلغ:x.amount, یادداشت:x.note||''})),
      'دریافت-پرداخت': s.payments.map(x=>({شناسه:x.id, تاریخ:x.date, نوع:x.type==='receive'?'دریافت':'پرداخت', طرف:x.partyName||'', شناسه_طرف:x.partyId||'', ارز:x.currency||'AFN', مبلغ:x.amount})),
      'گردش دریافت پرداخت': s.payments.filter(x=>!x.voided).map(x=>({
        شناسه:x.id, تاریخ:x.date||'', نوع:x.reversalOf?'ابطال دریافت/پرداخت':(x.type==='receive'?'دریافت':'پرداخت'),
        طرف:x.partyName||'', شناسه_طرف:x.partyId||'', ارز:x.currency||'AFN',
        مبلغ_خالص_رویداد:Number(x.amount)||0, شناسه_فاکتور_فروش:x.saleId||'',
        شناسه_فاکتور_خرید:x.purchaseId||'', یادداشت:x.note||'', وضعیت:x.status||''
      })),
      'بدهی افتتاحیه': (s.openingEntries||[]).map(x=>({شناسه:x.id, تاریخ:x.date||'', نوع_طرف:x.partyType||'', طرف:x.partyName||'', شناسه_طرف:x.partyId||'', ارز:x.currency||'AFN', مبلغ:x.amount, یادداشت:x.note||''})),
      'مرجوعی و ابطال': (s.returns||[]).map(x=>({شناسه:x.id, تاریخ:x.date||'', نوع:({return:'مرجوعی',cancel:'ابطال فاکتور',shortage:'کاستی'})[x.kind]||x.kind||'', شماره_فاکتور:x.originalSaleId?this.invoiceNoLabel(x.originalSaleId):'', مشتری:x.customerName||'', مبلغ:x.amount, بهای_کالا:x.cost, دلیل:x.reason||''})),
      'وضعیت انبار': inventoryRows,
      'خلاصه انبار': inventorySummary,
    };
    Object.entries(sheets).forEach(([name, rows])=>{
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    });
    XLSX.writeFile(wb, 'پشتیبان-اکسل-'+todayISO()+'.xlsx');
  },
  async importBackup(input){
    if(!this.isAdmin()){ this.toast('این کار فقط برای مالک/مدیر مجاز است.'); input.value=''; return; }
    const file=input.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=(e)=>{
      let parsed;
      try{ parsed=JSON.parse(e.target.result); }
      catch(err){ console.error(err); this.toastError('فایل پشتیبان معتبر نیست.'); input.value=''; return; }
      // بررسی کامل قبل از هر تغییری: ساختار، شناسه‌ها، نوع مقدارها، فیلدهای الزامی
      const check = validateBackup(parsed);
      if(!check.ok){
        console.error('backup validation', check.errors);
        this.toastError('فایل پشتیبان معتبر نیست: '+check.errors.slice(0,3).join(' | '));
        input.value=''; return;
      }
      const normalized = (parsed.schemaVersion!==undefined) ? { ...parsed.collections, settings: parsed.settings||{} } : parsed;
      this.toast('فایل بررسی شد — '+Object.keys(check.counts).map(k=>k+': '+check.counts[k]).join('، '));
      /* دو confirm() خام مرورگر با یک مودال داخلی جایگزین شد — همان دو هشدار، در یک متن */
      this.openConfirmModal({
        title:'بازیابی از فایل پشتیبان',
        msg:'این کار دیتابیس مشترک همهٔ کاربران (نه فقط همین گوشی) را با فایل انتخابی جایگزین می‌کند. قبل از جایگزینی، یک نسخهٔ پشتیبان از وضعیت فعلی خودکار دانلود می‌شود تا اگر اشتباهی رخ داد بتوانید برگردید. ادامه می‌دهید؟',
        danger:true, confirmLabel:'بله، بازیابی کن',
        onConfirm: ()=>{ this._runImportBackup(normalized, input); }
      });
      input.value='';
    };
    reader.readAsText(file);
  },
  async _runImportBackup(parsed, input){
    if(!navigator.onLine){ this.toastError('بازیابی از فایل پشتیبان فقط با اینترنت ممکن است (حجم زیاد و باید سرور تأیید کند).'); return; }
    try{
      this._downloadJSON(buildBackup({ businessId:BIZ_ID, state:this.state, appVersion:'hesabdari-app' }), 'auto-backup-before-import-'+Date.now()+'.json');

        migrateSettings(parsed.settings);
        migrateRecordArrays(parsed.sales, parsed.purchases);

        for(const name of COLLECTIONS){
          const existing = await getDocs(cols[name]);
          const importedIds = new Set((parsed[name]||[]).map(r=>r.id));
          const opsBatchLimit=400;
          let batch=writeBatch(db,{noLedger:true}); let opCount=0;
          const flush=async()=>{ if(opCount>0){ await batch.commit(); batch=writeBatch(db,{noLedger:true}); opCount=0; } };
          /* «returns» در firestore.rules فقط‌افزودنی است (update ممنوع). پس هنگام بازیابی، همهٔ سندهای
             موجودش اول پاک می‌شود (و commit می‌شود) و بعد از نو «ساخته» می‌شود، نه «بازنویسی». */
          const replaceAll = (name==='returns');
          for(const d of existing.docs){
            if(replaceAll || !importedIds.has(d.id)){ batch.delete(d.ref); opCount++; if(opCount>=opsBatchLimit) await flush(); }
          }
          if(replaceAll) await flush();
          for(const rec of (parsed[name]||[])){
            if(!rec.id) rec.id=uid();
            if((name==='sales'||name==='purchases') && !rec.invoiceNo) rec.invoiceNo=this.invoiceNoForNew(rec.id,name==='sales'?'S':'B');
            batch.set(doc(cols[name], rec.id), rec); opCount++; if(opCount>=opsBatchLimit) await flush();
          }
          await flush();
        }
        await setDoc(settingsDocRef, migrateSettings(parsed.settings||{}));
        // Stock Ledger از نو ساخته می‌شود: حرکت‌های قبلی پاک، و برای هر کالا «موجودی اول دوره» ثبت می‌شود
        await this._resetStockLedger(parsed.products||[], 'بازیابی از فایل پشتیبان');
        { const ab=writeBatch(db,{noLedger:true}); this.audit(ab,{ action:'restore', entityType:'backup', entityId:'import', before:null, after:{ id:'import' } }); await ab.commit(); }
        this.toast('بازیابی موفقانه انجام شد');
        this.navigate('dashboard');
    }catch(err){ console.error(err); this.toastError('بازیابی ناکام شد؛ فایل پشتیبان معتبر نیست یا خطایی رخ داد.'); }
    if(input) input.value='';
  },
  /* دو تأیید متوالی (مثل قبل) ولی با مودال داخلی، نه confirm() مرورگر */
  wipeAll(){
    if(!this.isAdmin()){ this.toast('این کار فقط برای مالک/مدیر مجاز است.'); return; }
    this.openConfirmModal({
      title:'پاک کردن همهٔ اطلاعات',
      msg:'تمام اطلاعات (فروش، خرید، مصارف، محصولات) برای همهٔ کاربران و برای همیشه پاک می‌شود. مطمئن هستید؟',
      danger:true, confirmLabel:'ادامه',
      onConfirm: ()=> this.openConfirmModal({
        title:'تأیید نهایی',
        msg:'این کار قابل بازگشت نیست. یک نسخهٔ پشتیبان خودکار دانلود می‌شود و بعد همه‌چیز پاک می‌گردد.',
        danger:true, confirmLabel:'بله، همه را پاک کن',
        onConfirm: ()=> this._runWipeAll()
      })
    });
  },
  async runReconcile(kind){
    if(!this.isAdmin()){ this.toast('این ابزار فقط برای مالک است.'); return; }
    const s=this.state; let rows=[], title='', extra='';
    try{
      if(kind==='customers'){ title='تطبیق مانده مشتریان'; rows=reconcileCustomers({ customers:s.customers, sales:s.sales, payments:s.payments, openingEntries:s.openingEntries }); }
      else if(kind==='suppliers'){ title='تطبیق مانده عمده‌فروشان'; rows=reconcileSuppliers({ suppliers:s.suppliers, purchases:s.purchases, payments:s.payments, openingEntries:s.openingEntries }); }
      else if(kind==='invoices'){ title='تطبیق مجموع فاکتورها'; rows=reconcileInvoices({ sales:s.sales }); }
      else if(kind==='returns'){ title='تطبیق مرجوعی‌ها'; rows=reconcileReturns({ sales:s.sales, returns:s.returns }); }
      else if(kind==='stock'){
        title='تطبیق موجودی انبار';
        const snap=await getDocs(cols.stockLedger);
        rows=reconcileStock({ products:s.products, movements:snap.docs.map(d=>d.data()) });
        const neg=negativeStockProducts(s.products);
        if(neg.length) extra='<div class="field-note u-color-var-red">کالاهای با موجودی منفی: '+neg.map(n=>escapeHtml(n.name)+' ('+fmtQty(n.stock)+' عدد)').join('، ')+'</div>';
      } else return;
    }catch(e){ console.error(e); this.toastError('خطا در محاسبه؛ دوباره تلاش کنید.'); return; }
    const isCust=kind==='customers';
    const body = rows.length ? rows.map(r=>{
      if(kind==='invoices') return '<div class="row-item"><div class="r-left"><b>فاکتور '+escapeHtml(this.invoiceNoLabel(r.id))+' — '+escapeHtml(r.name)+'</b><span class="sub">مجموع ثبت‌شده '+fmt(r.cachedTotal)+' · محاسبه‌شده '+fmt(r.expectedTotal)+' · باقی ثبت‌شده '+fmt(r.cachedRemaining)+' · محاسبه‌شده '+fmt(r.expectedRemaining)+'</span></div></div>';
      if(kind==='returns') return '<div class="row-item"><div class="r-left"><b>'+escapeHtml(r.name)+' — فاکتور '+escapeHtml(this.invoiceNoLabel(r.id))+'</b><span class="sub">جمع مرجوعیِ ثبت‌شده روی فاکتور '+fmt(r.cached)+' · مجموع رویدادها '+fmt(r.expected)+'</span></div></div>';
      const btn = kind==='stock'
        ? '<button class="btn btn-outline u-margin-0 u-width-auto u-padding-6px-10px" onclick="App.repairStock(\''+r.id+'\','+r.expected+')">اصلاح</button>'
        : '<button class="btn btn-outline u-margin-0 u-width-auto u-padding-6px-10px" onclick="App.repairBalance(\''+(isCust?'customers':'suppliers')+'\',\''+r.id+'\','+r.expected+','+(/\(\$\)$/.test(r.name)?'\'USD\'':'\'AFN\'')+')">اصلاح</button>';
      return '<div class="row-item"><div class="r-left"><b>'+escapeHtml(r.name)+'</b><span class="sub">ثبت‌شده '+fmt(r.cached)+' · محاسبه‌شده '+fmt(r.expected)+' · اختلاف '+fmt(r.diff)+'</span></div>'+btn+'</div>';
    }).join('') : '<div class="empty">هیچ اختلافی پیدا نشد ✓</div>';
    this.openCustomModal({ title, sub: rows.length ? (rows.length+' مورد اختلاف') : 'همه‌چیز با تاریخچه می‌خواند', bodyHtml: extra+body, submitLabel:'بستن', onSubmit:()=>{} });
  },
  repairBalance(type,id,expected,cur){
    this.openConfirmModal({ title:'اصلاح مانده', danger:true, confirmLabel:'اصلاح شود',
      msg:'مانده ذخیره‌شده با مقدار محاسبه‌شده از تاریخچه ('+fmt(expected)+') جایگزین شود؟ (یک رکورد Audit ثبت می‌شود)',
      onConfirm:()=>{
        const arr=type==='customers'?this.state.customers:this.state.suppliers; const p=arr.find(x=>x.id===id); if(!p) return;
        const f=(type==='suppliers'&&cur==='USD')?'balanceUSD':'balance';
        const b=writeBatch(db);
        b.update(doc(cols[type],id),{ [f]:expected, ...this.editMeta() });
        this.audit(b,{ action:'adjust', entityType:type==='customers'?'customer':'supplier', entityId:id, before:{ id, [f]:p[f] }, after:{ id, [f]:expected } });
        return b.commit().then(()=>this.toast('مانده اصلاح شد')).catch(e=>{ console.error(e); this.toastError('خطا؛ دوباره تلاش کنید.'); });
      } });
  },
  repairStock(id,expected){
    this.openConfirmModal({ title:'اصلاح موجودی', danger:true, confirmLabel:'اصلاح شود',
      msg:'موجودی ذخیره‌شده با مجموع حرکت‌های انبار ('+fmtQty(expected)+' عدد) جایگزین شود؟ فقط وقتی انجام دهید که مطمئنید تاریخچهٔ حرکت‌ها کامل است.',
      onConfirm:()=>{
        const p=this.state.products.find(x=>x.id===id); if(!p) return;
        const b=writeBatch(db,{noLedger:true});
        b.update(doc(cols.products,id),{ stock:expected, ...this.editMeta() });
        this.audit(b,{ action:'adjust', entityType:'product', entityId:id, before:{ id, stock:p.stock }, after:{ id, stock:expected } });
        return b.commit().then(()=>this.toast('موجودی اصلاح شد')).catch(e=>{ console.error(e); this.toastError('خطا؛ دوباره تلاش کنید.'); });
      } });
  },
  async _resetStockLedger(products, reason){
    const existing = await getDocs(cols.stockLedger);
    let batch=writeBatch(db,{noLedger:true}); let n=0;
    const flush=async()=>{ if(n>0){ await batch.commit(); batch=writeBatch(db,{noLedger:true}); n=0; } };
    for(const d of existing.docs){ batch.delete(d.ref); n++; if(n>=400) await flush(); }
    for(const p of products){
      const q=Number(p.stock)||0; if(!q) continue;
      const id=uid();
      batch.set(doc(cols.stockLedger,id), buildMovement({ id, ts:Date.now(), date:todayISO(), productId:p.id, warehouseId:DEFAULT_WAREHOUSE, type:'OPENING',
        quantityBase:q, unit:'عدد', unitCost:Number(p.avgCost)||0, userId:(this.user&&this.user.email)||'', referenceType:'restore', reason }));
      n++; if(n>=400) await flush();
    }
    await flush();
  },
  async _runWipeAll(){
    if(!navigator.onLine){ this.toastError('پاک‌کردن کامل اطلاعات فقط با اینترنت ممکن است.'); return; }
    this._downloadJSON(buildBackup({ businessId:BIZ_ID, state:this.state, appVersion:'hesabdari-app' }), 'auto-backup-before-wipe-'+Date.now()+'.json');
    try{
      for(const name of COLLECTIONS){
        const existing = await getDocs(cols[name]);
        let batch=writeBatch(db,{noLedger:true}); let opCount=0;
        for(const d of existing.docs){
          batch.delete(d.ref); opCount++;
          if(opCount>=400){ await batch.commit(); batch=writeBatch(db,{noLedger:true}); opCount=0; }
        }
        if(opCount>0) await batch.commit();
      }
      await this._resetStockLedger([], 'پاک کردن همهٔ اطلاعات');
      { const ab=writeBatch(db,{noLedger:true}); this.audit(ab,{ action:'wipe', entityType:'business', entityId:BIZ_ID, before:null, after:null }); await ab.commit(); }
      await setDoc(settingsDocRef, defaultSettings());
      this.navigate('dashboard');
    }catch(e){ console.error(e); App.toastError('خطا در پاک کردن اطلاعات؛ دوباره تلاش کنید.'); }
  },
  };

bindViews(App);
Object.assign(App, viewMethods);

window.App = App;
App.init();

// هر جا جدول فاکتور/بل روی صفحه یا در مودال ساخته شود، برچسب ستون‌ها برایش گذاشته می‌شود
// (فقط یک ویژگی نمایشی data-label است؛ به هیچ داده یا محاسبه‌ای دست نمی‌زند)
new MutationObserver(()=>App._labelTables()).observe(document.body,{childList:true,subtree:true});