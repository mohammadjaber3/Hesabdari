/* ---------- Firebase ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc as _setDoc, updateDoc as _updateDoc, deleteDoc as _deleteDoc, onSnapshot,
  collection, writeBatch as _writeBatch, increment
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/* ---------- قفل نرمِ نقش «شریک» (فقط دیدن) ----------
   دیوارِ اصلی همان firestore.rules است، ولی اگر همان‌جا جلوی نوشتن گرفته شود
   کاربر یک خطای انگلیسیِ نامفهوم می‌بیند. پس همهٔ نوشتن‌ها از یک نقطه رد می‌شوند
   و برای شریک با یک پیام فارسیِ روشن متوقف می‌شوند.
   استثنا: setDocRaw — فقط برای PIN شخصی خودِ کاربر. */
function _assertCanWrite(){
  let _r=null;
  try{ _r = App && App.role; }catch(e){ _r=null; }
  if(_r==='partner'){
    throw new Error('حساب شما «شریک» است: همه‌چیز را می‌بینید، اما اجازهٔ تغییر، ثبت یا حذف ندارید.');
  }
}
const setDocRaw = _setDoc;
function setDoc(...a){ _assertCanWrite(); return _setDoc(...a); }
function updateDoc(...a){ _assertCanWrite(); return _updateDoc(...a); }
function deleteDoc(...a){ _assertCanWrite(); return _deleteDoc(...a); }
function writeBatch(d){
  const b=_writeBatch(d);
  const commit=b.commit.bind(b);
  b.commit=function(){ try{ _assertCanWrite(); }catch(e){ return Promise.reject(e); } return commit(); };
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
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
setPersistence(auth, browserLocalPersistence).catch(()=>{});

const BIZ_ID = 'main';
/* هر نوع رکورد حالا کالکشن جدای خودش را دارد — دیگر یک سند مشترک بزرگ نیست.
   یعنی ویرایش یک فاکتور، رکورد فاکتور دیگری را از دست نمی‌برد. */
const COLLECTIONS = ['products','customers','suppliers','sales','purchases','expenses','payments','openingEntries'];
const cols = {};
COLLECTIONS.forEach(name => { cols[name] = collection(db, 'businesses', BIZ_ID, name); });
const settingsDocRef   = doc(db, 'businesses', BIZ_ID, 'meta', 'settings');
const migratedFlagRef  = doc(db, 'businesses', BIZ_ID, 'meta', 'migratedV2');
const oldStateDocRef   = doc(db, 'businesses', BIZ_ID, 'data', 'state'); // ساختار قدیمی (فقط برای مهاجرت یک‌باره)
const teamDocRef       = (uid_) => doc(db, 'businesses', BIZ_ID, 'team', uid_);
/* PIN شخصی هر کاربر: سند نقش (team) از سمت کلاینت قابل نوشتن نیست (و نباید باشد)،
   پس هَشِ PIN در کالکشن جدا ذخیره می‌شود که هر کس فقط سند خودش را می‌نویسد.
   قبلاً PIN داخل همان سند team ذخیره می‌شد و همیشه بی‌صدا ناکام می‌ماند. */
const pinDocRef = (uid_) => doc(db, 'businesses', BIZ_ID, 'pins', uid_);

/* ---------- Helpers ---------- */
function uid(){ return 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8); }
function todayISO(){ return new Date().toISOString().slice(0,10); }

/* ---------- شناسهٔ دستگاه (گوشی) ----------
   هر گوشی/مرورگر یک شناسهٔ ثابت محلی می‌گیرد که در تمام رکوردهای ثبت‌شده از همان گوشی ذخیره می‌شود.
   کاربر می‌تواند یک نام دلخواه (مثلاً «گوشی احمد») هم برای این دستگاه در تنظیمات بگذارد. */
const WITHDRAWAL_CATEGORY = 'برداشت شخصی';
function getDeviceId(){
  let id;
  try{ id = localStorage.getItem('hesabdari_device_id'); }catch(e){}
  if(!id){
    id = 'dev_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    try{ localStorage.setItem('hesabdari_device_id', id); }catch(e){}
  }
  return id;
}
function getDeviceLabel(){
  try{ return localStorage.getItem('hesabdari_device_label') || ''; }catch(e){ return ''; }
}
function setDeviceLabel(label){
  try{ localStorage.setItem('hesabdari_device_label', label||''); }catch(e){}
}
function fmt(n){ n = Math.round(Number(n)||0); return n.toLocaleString('en-US'); }
// برای مبالغ دالری/سنتی و نرخ دالر — هیچ‌وقت گرد نمی‌شود، همیشه با اعشار (سنت) نشان داده می‌شود.
function fmt2(n){
  n = Number(n)||0;
  const neg = n<0; n = Math.abs(n);
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  return (neg?'-':'') + Number(intPart).toLocaleString('en-US') + '.' + decPart;
}
/* ---------- واحدهای تو در تو (کارتن ← قوطی/بسته ← عدد) ----------
   مدل داده (سازگار با نسخهٔ قبلی، هیچ مهاجرتی لازم نیست):
     unit        = واحد پایه (کوچک‌ترین واحد فروش، مثلاً «عدد»)
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
function round2(n){ return Math.round((Number(n)||0)*100)/100; }
/* قیمت تمام‌شدهٔ واحد پایه هرگز نباید گرد شود: یک کارتن ۱۶۰۰ افغانی با ۱۴۴ عدد
   می‌شود ۱۱.۱۱۱۱ — اگر ۱۱.۱۱ ذخیره شود، ارزش انبار و سود به‌مرور جابه‌جا می‌شود. */
function round4(n){ return Math.round((Number(n)||0)*10000)/10000; }
function fmtQty(n){
  const r = Math.round((Number(n)||0)*1000)/1000;
  return Number.isInteger(r) ? r.toLocaleString('en-US') : String(r);
}
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sum(arr,key){ return arr.reduce((a,b)=>a+(Number(b[key])||0),0); }
/* ---------- فشرده‌سازی عکس (بل شرکت / رسید پرداخت) ----------
   عکس‌ها به‌صورت JPEG فشرده و base64 مستقیم داخل سند Firestore ذخیره می‌شوند
   (نه Firebase Storage) تا کاملاً با ذخیره‌سازی آفلاین فایراستور سازگار بمانند
   و بدون اتصال اینترنت هم ثبت و بعداً خودکار سینک شوند. سقف سند فایراستور ۱ مگابایت
   است، پس عکس تا حد امن (~700 کیلوبایت base64) فشرده می‌شود. */
function _loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('خواندن فایل عکس ناکام شد'));
    reader.onload = (e)=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('این فایل یک عکس معتبر نیست'));
      img.onload = ()=>resolve(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function _resizeImageToDataUrl(img, maxDim, quality){
  let w=img.width, h=img.height;
  if(w>=h && w>maxDim){ h=Math.round(h*maxDim/w); w=maxDim; }
  else if(h>w && h>maxDim){ w=Math.round(w*maxDim/h); h=maxDim; }
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  canvas.getContext('2d').drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg', quality);
}
async function compressImageForStorage(file){
  if(!file || !file.type || file.type.indexOf('image/')!==0){ throw new Error('لطفاً یک فایل عکس انتخاب کنید'); }
  const img = await _loadImageFromFile(file);
  const attempts = [[1100,0.62],[850,0.5],[650,0.4],[500,0.32]];
  let lastUrl=null;
  for(const [dim,q] of attempts){
    lastUrl = _resizeImageToDataUrl(img, dim, q);
    if(lastUrl.length < 700000) return lastUrl; // ~500KB باینری، امن زیر سقف ۱ مگابایتی سند
  }
  if(lastUrl.length < 950000) return lastUrl;
  throw new Error('حجم عکس بعد از فشرده‌سازی هنوز زیاد است؛ لطفاً با نور بهتر یا نزدیک‌تر دوباره عکس بگیرید.');
}
function dateLabel(d){
  const dt=new Date(d+'T00:00:00');
  const days=['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
  return days[dt.getDay()]+' '+d;
}
function startOfWeek(d){
  const dt=new Date(d+'T00:00:00');
  const day=dt.getDay();
  dt.setDate(dt.getDate()-day);
  return dt.toISOString().slice(0,10);
}
function startOfMonth(d){ return d.slice(0,7)+'-01'; }
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function defaultSettings(){
  return { businessName:'فروشگاه صانع', currency:'افغانی', openingCash:0,
    invoiceCounter:0, businessPhone:'', businessAddress:'', logoEmoji:'🏪', openingNote:'', usdRate:0, lowStockThreshold:1 };
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
const ICON_PATHS = {
  home:'<path d="M3 10.2 12 3.5l9 6.7V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"/><path d="M9.5 21.5v-7h5v7"/>',
  receipt:'<path d="M5 3.5h14v18l-2.3-1.6-2.3 1.6-2.4-1.6-2.3 1.6L7.3 21.5 5 21.5z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  package:'<path d="M20.5 8.2v7.6a1.6 1.6 0 0 1-.85 1.4l-6.9 3.7a1.6 1.6 0 0 1-1.5 0l-6.9-3.7a1.6 1.6 0 0 1-.85-1.4V8.2"/><path d="M3.8 7.3 12 3l8.2 4.3L12 11.7z"/><path d="M12 11.7V21"/>',
  users:'<path d="M15.5 20v-1.6a3.5 3.5 0 0 0-3.5-3.5H6.5A3.5 3.5 0 0 0 3 18.4V20"/><circle cx="9.2" cy="8" r="3.4"/><path d="M17 4.3a3.4 3.4 0 0 1 0 6.6M21 20v-1.6a3.5 3.5 0 0 0-2.6-3.4"/>',
  'user-plus':'<path d="M14 20v-1.6a3.5 3.5 0 0 0-3.5-3.5H6A3.5 3.5 0 0 0 2.5 18.4V20"/><circle cx="8.2" cy="8" r="3.4"/><path d="M18.5 7.5v6M21.5 10.5h-6"/>',
  factory:'<path d="M3 20.5h18"/><path d="M3.5 20.5V10l5 3.2V10l5 3.2V6.5h7v14"/><path d="M17 11h1.5M17 15h1.5"/>',
  menu:'<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="M20 20l-4.4-4.4"/>',
  settings:'<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .33 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.06-.06a1.6 1.6 0 0 0-2.72 1.14v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-2.8-1.13l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0-1.14-2.72h-.17a1.9 1.9 0 1 1 0-3.8h.09A1.6 1.6 0 0 0 4.9 6.9l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 2.72-1.14V3a1.9 1.9 0 1 1 3.8 0v.09a1.6 1.6 0 0 0 2.72 1.14l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0 1.14 2.72H21a1.9 1.9 0 1 1 0 3.8h-.09a1.6 1.6 0 0 0-1.51.95"/>',
  sliders:'<path d="M4 7.5h10M18 7.5h2M4 16.5h3M11 16.5h9"/><circle cx="16" cy="7.5" r="2.1"/><circle cx="9" cy="16.5" r="2.1"/>',
  wallet:'<path d="M20.5 9.5V7.8A1.8 1.8 0 0 0 18.7 6H4.8A1.8 1.8 0 0 1 3 4.2A1.8 1.8 0 0 1 4.8 2.4h12.4"/><path d="M3 4.2v14a1.8 1.8 0 0 0 1.8 1.8h13.9a1.8 1.8 0 0 0 1.8-1.8v-3.7"/><path d="M21.5 9.5h-4.2a2.5 2.5 0 0 0 0 5h4.2z"/>',
  boxes:'<path d="M3 8.6 7.5 6l4.5 2.6-4.5 2.6z"/><path d="M3 8.6v5.2l4.5 2.6 4.5-2.6V8.6"/><path d="M12 13.8 16.5 11.2 21 13.8l-4.5 2.6z"/><path d="M12 13.8V19l4.5 2.6L21 19v-5.2"/>',
  'trending-up':'<path d="M3.5 17.5 9.8 11.2l3.6 3.6L20.5 7.7"/><path d="M15.5 7.7h5v5"/>',
  'trending-down':'<path d="M3.5 7.7 9.8 14l3.6-3.6 7.1 6.1"/><path d="M15.5 16.5h5v-5"/>',
  banknote:'<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 10v4M18 10v4"/>',
  coins:'<circle cx="9" cy="8.5" r="5"/><path d="M15.6 4.2a5 5 0 0 1 0 8.6"/><path d="M4.3 13.8v2.7c0 2 2.1 3.5 4.7 3.5s4.7-1.6 4.7-3.5v-2.7"/>',
  'hand-coins':'<circle cx="16.5" cy="6.5" r="3"/><path d="M2.5 15.5l3-3a2 2 0 0 1 1.4-.6h3.3a2 2 0 0 1 1.4.6l1 1a1.6 1.6 0 0 1-2.3 2.2l-.8-.8"/><path d="M11.5 15.8l2.4 2.4a1.7 1.7 0 0 0 2.4 0l4.2-4.2a1.7 1.7 0 0 0-2.4-2.4l-1.8 1.8"/>',
  'alert-triangle':'<path d="M10.3 3.9 2.6 17.2a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 16.6h.01"/>',
  pencil:'<path d="M17 3.5 20.5 7 8.6 18.9l-4.1.9.9-4.1z"/><path d="M14.6 5.9 18.1 9.4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  check:'<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  'check-circle':'<circle cx="12" cy="12" r="8.8"/><path d="M8.2 12.3 11 15l4.8-5.4"/>',
  'x-circle':'<circle cx="12" cy="12" r="8.8"/><path d="M9 9l6 6M15 9l-6 6"/>',
  trash:'<path d="M3.8 6.5h16.4M9 6.5V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2V6.5"/><path d="M5.8 6.5l1 13.2A1.4 1.4 0 0 0 8.2 21h7.6a1.4 1.4 0 0 0 1.4-1.3l1-13.2"/><path d="M10.3 10.5v6M13.7 10.5v6"/>',
  printer:'<path d="M6.5 9V3.5h11V9"/><rect x="3" y="9" width="18" height="7.5" rx="1.8"/><path d="M6.5 14.5h11v6h-11z"/>',
  'message-circle':'<path d="M20.5 11.6a8 8 0 0 1-11.9 7L3.5 20.5l1.9-5.1a8 8 0 1 1 15.1-3.8z"/>',
  'rotate-ccw':'<path d="M3.5 6.5v5h5"/><path d="M4.6 14a8 8 0 1 0 1.6-8L3.5 8.6"/>',
  percent:'<path d="M18.5 5.5 5.5 18.5"/><circle cx="7.6" cy="7.6" r="2.4"/><circle cx="16.4" cy="16.4" r="2.4"/>',
  tag:'<path d="M20.2 12.6 12.6 20.2a1.8 1.8 0 0 1-2.6 0L3.8 14a1.8 1.8 0 0 1-.5-1.4l.5-7A1.8 1.8 0 0 1 5.6 3.8l7-.5a1.8 1.8 0 0 1 1.4.5l6.2 6.2a1.8 1.8 0 0 1 0 2.6z"/><path d="M8.2 8.2h.01"/>',
  ban:'<circle cx="12" cy="12" r="8.8"/><path d="M5.8 18.2 18.2 5.8"/>',
  lock:'<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8.2 10.5V7.3a3.8 3.8 0 0 1 7.6 0v3.2"/><path d="M12 15v2.2"/>',
  key:'<circle cx="8" cy="15.6" r="3.6"/><path d="M10.6 13 20 3.6"/><path d="M17 3.6h3.4V7"/><path d="M15.6 8.4 18 10.8"/>',
  'chevron-right':'<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  'chevron-left':'<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  'arrow-right':'<path d="M20 12H4"/><path d="M9.5 6.5 4 12l5.5 5.5"/>',
  'arrow-left':'<path d="M4 12h16"/><path d="M14.5 6.5 20 12l-5.5 5.5"/>',
  'more-vertical':'<circle cx="12" cy="5.2" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.8" r="1.3"/>',
  info:'<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.4M12 7.9h.01"/>',
  download:'<path d="M12 3.5v11.5"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
  upload:'<path d="M12 15.5V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1"/>',
  save:'<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h9.2L20 8.8V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z"/><path d="M8 4v5.5h7"/><path d="M8 20.5v-6h8v6"/>',
  sheet:'<rect x="4" y="3.5" width="16" height="17" rx="1.8"/><path d="M4 9.2h16M4 14.8h16M9.7 3.5v17M14.3 3.5v17"/>',
  'bar-chart':'<path d="M3.5 20.5h17"/><path d="M6.5 18V11h3.4v7"/><path d="M12 18V6.5h3.4V18"/><path d="M17.3 18v-4.5"/>',
  history:'<path d="M3.5 12a8.5 8.5 0 1 0 3-6.5"/><path d="M3.5 4v3.8h3.8"/><path d="M12 8v4.4l3.2 1.9"/>',
  'log-out':'<path d="M9.5 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h3.5"/><path d="M14.5 8 18.5 12l-4 4"/><path d="M18.5 12H9"/>',
  camera:'<path d="M3 8.8A1.8 1.8 0 0 1 4.8 7h2.4l1.3-2.2h6.9L16.7 7h2.5A1.8 1.8 0 0 1 21 8.8v9.4A1.8 1.8 0 0 1 19.2 20H4.8A1.8 1.8 0 0 1 3 18.2z"/><circle cx="12" cy="13.2" r="3.3"/>',
  image:'<rect x="3.2" y="4" width="17.6" height="16" rx="2"/><circle cx="8.6" cy="9.4" r="1.7"/><path d="M20.8 15.5 16 11.2l-8.8 8.8"/>',
  archive:'<rect x="3" y="4" width="18" height="4.5" rx="1.4"/><path d="M4.8 8.5v10.1A1.4 1.4 0 0 0 6.2 20h11.6a1.4 1.4 0 0 0 1.4-1.4V8.5"/><path d="M9.8 12.2h4.4"/>',
  clipboard:'<rect x="7.5" y="3.5" width="9" height="4" rx="1.4"/><path d="M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15"/><path d="M8.8 12h6.4M8.8 16h4.2"/>',
  'file-text':'<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.8 12.5h6.4M8.8 16h4.4"/>',
  'shopping-cart':'<circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17.5" cy="19.5" r="1.4"/><path d="M2.5 3.5h2.3l2.6 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2l1.4-6.9H6"/>',
  phone:'<path d="M20.5 16.6v2.6a1.7 1.7 0 0 1-1.9 1.7 16.6 16.6 0 0 1-7.2-2.6 16.3 16.3 0 0 1-5-5 16.6 16.6 0 0 1-2.6-7.3A1.7 1.7 0 0 1 5.5 4h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.9.3 1.7.6 2.5a1.7 1.7 0 0 1-.4 1.8l-1.1 1.1a13.4 13.4 0 0 0 5 5l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.5.6a1.7 1.7 0 0 1 1.2 1.6z"/>',
  'map-pin':'<path d="M19.5 10.4c0 5.4-7.5 11.1-7.5 11.1s-7.5-5.7-7.5-11.1a7.5 7.5 0 0 1 15 0z"/><circle cx="12" cy="10.2" r="2.7"/>',
  delete:'<path d="M20.5 5.5H9.6a1.6 1.6 0 0 0-1.2.5L3 12l5.4 6a1.6 1.6 0 0 0 1.2.5h10.9a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5z"/><path d="M17 9.5 12.5 14M12.5 9.5 17 14"/>',
  frown:'<circle cx="12" cy="12" r="8.8"/><path d="M8.5 15.6a4.6 4.6 0 0 1 7 0"/><path d="M9.2 9.4h.01M14.8 9.4h.01"/>',
  'wifi-off':'<path d="M2.5 8.5a15 15 0 0 1 5-3"/><path d="M21.5 8.5a15 15 0 0 0-8.5-3.4"/><path d="M6.3 12.3a10 10 0 0 1 2.6-1.7"/><path d="M17.7 12.3a10 10 0 0 0-3.4-2"/><path d="M10 15.9a5 5 0 0 1 4 0"/><path d="M12 19.7h.01"/><path d="M2.5 2.5l19 19"/>',
  building:'<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2"/><path d="M10 20.5v-4h4v4"/>'
};
/* ---------- بارگذاری تنبلِ کتابخانه‌های بیرونیِ سنگین (Chart.js / xlsx) ----------
   قبلاً این دو با <script defer> در <head> بودند، یعنی هر بار که اپ باز می‌شد
   (حتی فقط برای ثبت یک فروش ساده)، خودِ باز شدنِ صفحه به رسیدن به cdnjs.cloudflare.com
   گره خورده بود. در اتصال ضعیف/آفلاین، مرورگر تا رسیدن به timeout شبکه صبر می‌کرد و رویداد
   load (که ثبتِ سرویس‌ورکر هم به آن گره خورده) خیلی دیر یا هیچ‌وقت اجرا نمی‌شد.
   حالا این کتابخانه‌ها فقط وقتی واقعاً لازم می‌شوند (صفحهٔ گزارش، خروجی اکسل) بارگذاری
   می‌شوند — بازشدنِ اصلِ اپ دیگر به این دو وابسته نیست. */
const CHART_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';
const XLSX_JS_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const _scriptLoadPromises = {};
function loadExternalScript(url){
  if(_scriptLoadPromises[url]) return _scriptLoadPromises[url];
  _scriptLoadPromises[url] = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = url;
    s.onload = ()=>resolve();
    s.onerror = ()=>{ delete _scriptLoadPromises[url]; reject(new Error('load failed: '+url)); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[url];
}

function ic(name, size, extraClass){
  const d = ICON_PATHS[name];
  if(!d) return '';
  const s = size || 18;
  return '<svg class="icn'+(extraClass?' '+extraClass:'')+'" viewBox="0 0 24 24" width="'+s+'" height="'+s+
    '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
}

/* ---------- App ---------- */
const App = {
  state: { settings: defaultSettings(), products:[], customers:[], suppliers:[], sales:[], purchases:[], expenses:[], payments:[], openingEntries:[] },
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
    onAuthStateChanged(auth, (u)=>{
      this.user = u;
      if(u){ this.afterLogin(u); }
      else { this.role=null; this.dataReady=false; this._teardown(); this.renderLogin(); }
    });
  },

  renderLoading(){
    document.getElementById('bottomnav').innerHTML='';
    document.getElementById('biz-name').textContent='فروشگاه صانع';
    {const _bd=document.getElementById('biz-date'); if(_bd) _bd.textContent='';}
    document.getElementById('screen').innerHTML = `
    <div class="load-mark">
      <div class="badge-round">${ic('boxes',24)}</div>
      <div>در حال بارگذاری...</div>
    </div>
    <div class="skel-wrap">
      <div class="skel" style="height:132px;"></div>
      <div class="skel" style="height:62px;"></div>
      <div class="skel" style="height:190px;"></div>
    </div>`;
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
    try{
      const teamSnap = await getDoc(teamDocRef(u.uid));
      this.role = teamSnap.exists() ? (teamSnap.data().role||'staff') : 'staff';
      try{ localStorage.setItem(cacheKey, this.role); }catch(e){}
    }catch(e){
      let cached=null;
      try{ cached = localStorage.getItem(cacheKey); }catch(e2){}
      this.role = cached || 'staff';
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
      this.render();
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
        const arr = [];
        snap.forEach(d=>arr.push(d.data()));
        this.state[name] = arr;
        if(name==='sales' || name==='purchases') migrateRecordArrays(this.state.sales, this.state.purchases);
        this._loadedParts.add(name);
        markPart(name, snap.metadata.hasPendingWrites);
        checkReady();
      }, (err)=>console.error('sync error ('+name+')', err));
      this._unsubs.push(unsub);
    });

    const unsubSettings = onSnapshot(settingsDocRef, {includeMetadataChanges:true}, async (snap)=>{
      if(snap.exists()){
        this.state.settings = migrateSettings(snap.data());
      } else {
        this.state.settings = defaultSettings();
        try{ await setDoc(settingsDocRef, this.state.settings); }catch(e){}
      }
      this._loadedParts.add('settings');
      markPart('settings', snap.metadata.hasPendingWrites);
      checkReady();
    }, (err)=>console.error('sync error (settings)', err));
    this._unsubs.push(unsubSettings);

    window.addEventListener('online', ()=> this._recomputeSyncState());
    window.addEventListener('offline', ()=> this._recomputeSyncState());
    this._recomputeSyncState();
  },
  // یک نقطهٔ واحد برای تصمیم‌گیری دربارهٔ وضعیت نمایشی: آفلاین (اصلاً وصل نیست)،
  // در حال همگام‌سازی (وصل است ولی هنوز چیزی در صفِ ارسال به سرور مانده)، یا آنلاین (همه‌چیز رسیده).
  _recomputeSyncState(){
    if(!navigator.onLine){ this.setSyncState('offline'); return; }
    this.setSyncState(this._pendingParts && this._pendingParts.size>0 ? 'pending' : 'ok');
  },

  // فقط کسی «مالک» حساب می‌شود که هم نقش «owner» در Firestore داشته باشد و هم دقیقاً
  // با همین ایمیل وارد شده باشد — یعنی حتی اگر یک نقش owner به‌اشتباه به کاربر دیگری
  // داده شود، تا وقتی ایمیلش manager@motar.com نباشد، دسترسی مدیریتی نمی‌گیرد.
  OWNER_EMAIL: 'manager@motar.com',
  isOwner(){ return this.role==='owner' && !!this.user && this.user.email===this.OWNER_EMAIL; },
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
    return this.role==='owner' ? 'مالک' : this.role==='partner' ? 'شریک (فقط دیدن)'
         : this.role==='seller' ? 'فروشنده' : 'کارمند';
  },
  guardWrite(){
    if(!this.canWrite()){ this.toastError('حساب شما «شریک» است: فقط دیدن، بدون تغییر یا حذف.'); return false; }
    return true;
  },
  guardBooks(){
    if(!this.canSeeBooks()){ this.toastError('این بخش برای حساب فروشنده باز نیست.'); return false; }
    return true;
  },
  renderNoAccess(what){
    return `<div class="empty"><span class="ic">${ic('lock',26)}</span><b>دسترسی ندارید</b>بخش «${escapeHtml(what||'')}» برای نقش «${escapeHtml(this.roleLabel())}» بسته است.</div>`;
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

  renderLogin(){
    document.getElementById('bottomnav').innerHTML='';
    document.getElementById('biz-name').textContent='پخش موتر';
    {const _bd=document.getElementById('biz-date'); if(_bd) _bd.textContent='';}
    document.getElementById('screen').innerHTML = `
    <div class="login-mark">
      <div class="ring">${ic('boxes',26)}</div>
      <b>فروشگاه صانع</b>
      <span>سیستم حساب‌داری و مدیریت انبار</span>
    </div>
    <div class="card">
      <h2 class="section-title" style="margin-top:0;">${ic('key',17)}ورود به سیستم</h2>
      <label>ایمیل</label>
      <input id="login-email" type="email" placeholder="ایمیل خود را بنویسید" autocomplete="username">
      <label>رمز عبور</label>
      <input id="login-pass" type="password" placeholder="رمز عبور" autocomplete="current-password" onkeydown="if(event.key==='Enter') App.doLogin()">
      <div id="login-err" class="err-line"></div>
      <button class="btn btn-primary" onclick="App.doLogin()">${ic('log-out',17)}ورود</button>
      <div class="field-note">اگر اینترنت ندارید ولی قبلاً یک‌بار وارد شده‌اید، برنامه به‌صورت آفلاین باز می‌شود.</div>
    </div>`;
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
      errBox.textContent = 'ورود ناکام شد. ایمیل یا رمز عبور اشتباه است.';
    }
  },
  resetSaleDraft(){ this.saleDraft = { items:[] }; },
  onSaleCustomerNameChange(){
    const name=(document.getElementById('sale-customer-name').value||'').trim();
    const c=this.state.customers.find(x=>x.name===name);
    const phoneEl=document.getElementById('sale-customer-phone');
    const addrEl=document.getElementById('sale-customer-address');
    if(c){ phoneEl.value=c.phone||''; addrEl.value=c.address||''; }
  },
  resetPurchaseDraft(){ this.purchaseDraft = { items:[], currency:'AFN' }; },

  navigate(tab,sub){ this.tab=tab; this.sub=sub||null; this.renderNav(); this.render(); window.scrollTo(0,0); },

  renderNav(){
    const tabs=[
      {id:'dashboard',ic:'home',lb:'داشبورد'},
      {id:'sale',ic:'receipt',lb:'فروش'},
      {id:'purchase',ic:'package',lb:'خرید'},
      {id:'customers',ic:'users',lb:'بدهی‌ها'},
      {id:'more',ic:'menu',lb:'بیشتر'},
    ];
    if(!this.dataReady){ document.getElementById('bottomnav').innerHTML=''; return; }
    const visibleTabs = tabs.filter(t=> t.id!=='purchase' || this.canSeeBooks());
    const lowCount = this.lowStockList().length;
    document.getElementById('bottomnav').innerHTML = visibleTabs.map(t=>
      `<button class="${this.tab===t.id?'active':''}" onclick="App.navigate('${t.id}')" style="position:relative;">
        <span class="ic">${ic(t.ic,21)}</span><span class="lb">${t.lb}</span>
        ${t.id==='more' && lowCount ? `<span class="nav-dot">${lowCount>9?'9+':lowCount}</span>` : ''}
      </button>`).join('');
  },

  render(){
    if(!this.dataReady){ this.renderLoading(); return; }
    this.renderNav();
    const s = document.getElementById('screen');
    let html='';
    switch(this.tab){
      case 'dashboard': html=this.renderDashboard(); break;
      case 'sale': html=this.renderSale(); break;
      case 'purchase': html=this.canSeeBooks()?this.renderPurchase():this.renderNoAccess('خرید'); break;
      case 'customers': html=this.renderCustomers(); break;
      case 'more': html=this.renderMore(); break;
      case 'invoice': html=this.renderInvoiceView(); break;
      case 'purchase-view': html=this.canSeeBooks()?this.renderPurchaseView():this.renderNoAccess('بل خرید'); break;
      default: html=this.renderDashboard();
    }
    s.innerHTML = html + this.renderImageViewer();
    if(this.tab==='more' && this.sub==='reports') setTimeout(()=>this.drawTrendChart(),0);
  },
  renderImageViewer(){
    if(!this.imageViewerSrc) return '';
    return `<div class="img-viewer-overlay" onclick="App.closeImageViewer()">
      <img src="${this.imageViewerSrc}" onclick="event.stopPropagation()">
      <button class="img-viewer-close" onclick="App.closeImageViewer()">${ic('x',16)}بستن</button>
    </div>`;
  },
  viewImage(src){ if(!src) return; this.imageViewerSrc=src; this.render(); },
  closeImageViewer(){ this.imageViewerSrc=null; this.render(); },

  /* =========================================================
     سیستم مودال/فرم داخل‌اپ — جایگزین prompt()/confirm() مرورگر
     ========================================================= */
  openFormModal({title, sub, fields, submitLabel, danger, onSubmit}){
    this.modal = {kind:'form', title, sub, fields, submitLabel:submitLabel||'ذخیره', danger:!!danger, onSubmit};
    this.renderModalRoot();
  },
  // مودال با بدنهٔ دلخواه (برای فرم‌هایی که فیلدهایشان به هم وابسته‌اند،
  // مثلاً انتخاب محصول ← واحد ← قیمت خودکار)
  openCustomModal({title, sub, bodyHtml, submitLabel, danger, onSubmit, onOpen}){
    this.modal = {kind:'custom', title, sub, bodyHtml, submitLabel:submitLabel||'ذخیره', danger:!!danger, onSubmit};
    this.renderModalRoot();
    if(onOpen) setTimeout(onOpen,0);
  },
  openConfirmModal({title, msg, danger, confirmLabel, onConfirm}){
    this.modal = {kind:'confirm', title, msg, danger:!!danger, confirmLabel:confirmLabel||'تأیید', onConfirm};
    this.renderModalRoot();
  },
  closeModal(){ this.modal=null; this.renderModalRoot(); },
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
      if(errEl) errEl.textContent = err && err.message ? err.message : 'خطا؛ دوباره تلاش کنید.';
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
      if(errEl) errEl.textContent = err && err.message ? err.message : 'خطا؛ دوباره تلاش کنید.';
    }
  },
  confirmModalYes(){
    if(!this.modal || this.modal.kind!=='confirm') return;
    const fn=this.modal.onConfirm;
    this.closeModal();
    if(fn) fn();
  },
  renderModalRoot(){
    const root=document.getElementById('modal-root'); if(!root) return;
    if(!this.modal){ root.innerHTML=''; return; }
    const m=this.modal;
    if(m.kind==='confirm'){
      root.innerHTML = `
      <div class="modal-overlay center" onclick="if(event.target===this) App.closeModal()">
        <div class="modal-sheet" style="max-width:380px;">
          <div class="modal-title">${escapeHtml(m.title||'تأیید')}<span class="close" onclick="App.closeModal()">${ic('x',18)}</span></div>
          <div class="modal-sub">${escapeHtml(m.msg||'')}</div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="App.closeModal()">انصراف</button>
            <button class="btn ${m.danger?'btn-danger':'btn-primary'}" onclick="App.confirmModalYes()">${ic(m.danger?'alert-triangle':'check',16)}${escapeHtml(m.confirmLabel)}</button>
          </div>
        </div>
      </div>`;
      return;
    }
    if(m.kind==='custom'){
      root.innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) App.closeModal()">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="modal-title">${escapeHtml(m.title||'')}<span class="close" onclick="App.closeModal()">${ic('x',18)}</span></div>
          ${m.sub?`<div class="modal-sub">${escapeHtml(m.sub)}</div>`:''}
          ${m.bodyHtml||''}
          <div id="modal-err" class="err-line"></div>
          <div class="modal-actions">
            <button class="btn btn-outline" onclick="App.closeModal()">انصراف</button>
            <button class="btn ${m.danger?'btn-danger':'btn-primary'}" onclick="App.submitCustomModal()">${ic(m.danger?'alert-triangle':'check',16)}${escapeHtml(m.submitLabel)}</button>
          </div>
        </div>
      </div>`;
      return;
    }
    const fieldsHtml = m.fields.map(f=>{
      if(f.type==='select'){
        return `<label>${escapeHtml(f.label)}</label>
        <select id="mf-${f.key}">${(f.options||[]).map(o=>`<option value="${escapeHtml(String(o.value))}" ${String(o.value)===String(f.value)?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
        ${f.hint?`<div class="field-note">${escapeHtml(f.hint)}</div>`:''}`;
      }
      if(f.type==='textarea'){
        return `<label>${escapeHtml(f.label)}</label><textarea id="mf-${f.key}" placeholder="${escapeHtml(f.placeholder||'')}">${escapeHtml(f.value||'')}</textarea>
        ${f.hint?`<div class="field-note">${escapeHtml(f.hint)}</div>`:''}`;
      }
      const type = f.type==='number' ? 'number' : 'text';
      const inputmode = f.type==='number' ? 'decimal' : 'text';
      const step = f.step || (f.type==='number' ? '1' : undefined);
      return `<label>${escapeHtml(f.label)}</label>
      <input id="mf-${f.key}" type="${type}" inputmode="${inputmode}" ${step?`step="${step}"`:''} placeholder="${escapeHtml(f.placeholder||'')}" value="${f.value!==undefined && f.value!==null ? escapeHtml(String(f.value)) : ''}">
      ${f.hint?`<div class="field-note">${escapeHtml(f.hint)}</div>`:''}`;
    }).join('');
    root.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) App.closeModal()">
      <div class="modal-sheet">
        <div class="sheet-handle"></div>
        <div class="modal-title">${escapeHtml(m.title||'')}<span class="close" onclick="App.closeModal()">${ic('x',18)}</span></div>
        ${m.sub?`<div class="modal-sub">${escapeHtml(m.sub)}</div>`:''}
        ${fieldsHtml}
        <div id="modal-err" class="err-line"></div>
        <div class="modal-actions">
          <button class="btn btn-outline" onclick="App.closeModal()">انصراف</button>
          <button class="btn ${m.danger?'btn-danger':'btn-primary'}" onclick="App.submitFormModal()">${ic(m.danger?'alert-triangle':'check',16)}${escapeHtml(m.submitLabel)}</button>
        </div>
      </div>
    </div>`;
  },

  openActionMenu(items){ this.actionMenu = items; this.renderActionMenuRoot(); },
  closeActionMenu(){ this.actionMenu=null; this.renderActionMenuRoot(); },
  runActionMenuItem(idx){
    const items=this.actionMenu; this.closeActionMenu();
    if(items && items[idx] && items[idx].onClick) items[idx].onClick();
  },
  renderActionMenuRoot(){
    const root=document.getElementById('actionmenu-root'); if(!root) return;
    if(!this.actionMenu){ root.innerHTML=''; return; }
    const opts = this.actionMenu.map((it,idx)=>
      `<div class="opt ${it.danger?'danger':''}" onclick="App.runActionMenuItem(${idx})"><span class="ic">${it.icon?ic(it.icon,17):''}</span><span>${escapeHtml(it.label)}</span></div>`
    ).join('');
    root.innerHTML = `
    <div class="action-menu" onclick="if(event.target===this) App.closeActionMenu()">
      <div class="sheet">
        ${opts}
        <div class="cancel" onclick="App.closeActionMenu()">انصراف</div>
      </div>
    </div>`;
  },

  openSearch(){ this.searchOpen=true; this.searchQuery=''; this.renderSearchRoot(); setTimeout(()=>{ const el=document.getElementById('global-search-input'); if(el) el.focus(); },50); },
  closeSearch(){ this.searchOpen=false; this.renderSearchRoot(); },
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
  renderSearchResultsOnly(){
    const results=document.querySelector('#search-root .search-results');
    if(!results) return;
    results.innerHTML = this.buildSearchResultsBody(this.searchQuery);
  },
  renderSearchRoot(){
    const root=document.getElementById('search-root'); if(!root) return;
    if(!this.searchOpen){ root.innerHTML=''; return; }
    const q=this.searchQuery;
    const body = this.buildSearchResultsBody(q);
    root.innerHTML = `
    <div class="search-overlay">
      <div class="search-bar">
        <div class="field">
          ${ic('search',17)}
          <input id="global-search-input" type="search" placeholder="نام یا شمارهٔ فاکتور..." value="${escapeHtml(q)}" oninput="App.onSearchInput(this.value)">
        </div>
        <span class="cancel" onclick="App.closeSearch()">انصراف</span>
      </div>
      <div class="search-results">${body}</div>
    </div>`;
  },
  // نکته: تابع openParty(type,id) از قبل در بخش مشتریان/فروشندگان تعریف شده
  // (پایین‌تر در همین فایل) و همان‌جا استفاده می‌شود — اینجا دوباره تعریف نشد.

  setSyncState(st){
    this.syncState = st;
    const el=document.getElementById('sync-badge'); const txt=document.getElementById('sync-text');
    if(!el||!txt) return;
    el.className = 'sync-badge '+st;
    txt.textContent = st==='ok' ? 'آنلاین' : st==='pending' ? 'در حال همگام‌سازی...' : 'آفلاین';
  },

  pinDigit(d){
    if(this.pinEntry.length>=4) return;
    this.pinEntry += d;
    this.renderPinRoot();
    if(this.pinEntry.length===4) setTimeout(()=>this.checkPin(),120);
  },
  pinBackspace(){ this.pinEntry=this.pinEntry.slice(0,-1); this.renderPinRoot(); },
  async checkPin(){
    let savedHash;
    try{
      savedHash = (this.myPinHash!==undefined) ? this.myPinHash : await this.getMyPinHash();
      this.myPinHash = savedHash;
    }catch(e){
      // نتوانستیم مطمئن شویم PIN قبلی چه بوده (مثلاً قطعی اینترنت) — به‌هیچ‌وجه نباید این را
      // به‌معنی «هنوز PIN نداریم» بگیریم، وگرنه هرکسی می‌تواند صفحه را با هر عددی باز/بازتنظیم کند.
      this.pinEntry=''; this.pinCheckError=true; this.renderPinRoot();
      setTimeout(()=>{ this.pinCheckError=false; this.renderPinRoot(); }, 1800);
      return;
    }
    if(!savedHash){
      await this.setMyPinHash(this.pinEntry);
      this.myPinHash = await sha256Hex(this.pinEntry);
      this.pinLocked=false; this.pinEntry=''; this.renderPinRoot();
      this.toast('قفل PIN تنظیم شد');
      return;
    }
    const h = await sha256Hex(this.pinEntry);
    if(h===savedHash){ this.pinLocked=false; this.pinEntry=''; this.renderPinRoot(); }
    else { this.pinEntry=''; this.pinShake=true; this.renderPinRoot(); setTimeout(()=>{this.pinShake=false;},400); }
  },
  async getMyPinHash(){
    if(!this.user) return null;
    const snap = await getDoc(pinDocRef(this.user.uid)); // اگر خطا بدهد، عمداً throw می‌کند (fail-safe نه fail-open)
    if(snap.exists() && snap.data().pinHash) return snap.data().pinHash;
    // سازگاری با نسخهٔ قبلی که (بی‌اثر) در سند team ذخیره می‌کرد
    try{
      const old = await getDoc(teamDocRef(this.user.uid));
      return old.exists() ? (old.data().pinHash||null) : null;
    }catch(e){ return null; }
  },
  async setMyPinHash(pin){
    if(!this.user) return;
    const h = await sha256Hex(pin);
    try{ await setDocRaw(pinDocRef(this.user.uid), {pinHash:h, uid:this.user.uid, ts:Date.now()}, {merge:true}); }
    catch(e){ this.toastError('PIN ذخیره نشد؛ اتصال اینترنت را بررسی کنید.'); }
  },
  async resetPin(){
    if(!this.user) return;
    try{ await setDocRaw(pinDocRef(this.user.uid), {pinHash:null}, {merge:true}); this.myPinHash=null; this.toast('قفل PIN حذف شد — دفعهٔ بعد یک PIN جدید تعیین کنید'); }
    catch(e){ this.toast('خطا در حذف PIN؛ اتصال اینترنت را بررسی کنید'); }
  },
  lockNow(){ if(!this.user) return; this.pinLocked=true; this.pinEntry=''; this.renderPinRoot(); },
  renderPinRoot(){
    const root=document.getElementById('pin-root'); if(!root) return;
    if(!this.pinLocked){ root.innerHTML=''; return; }
    const dots = [0,1,2,3].map(i=>`<span class="${i<this.pinEntry.length?'filled':''}"></span>`).join('');
    const pad = ['1','2','3','4','5','6','7','8','9','','0','del'];
    const msg = this.pinCheckError
      ? 'اتصال قطع است — نمی‌توان تأیید کرد، دوباره تلاش می‌شود...'
      : (this.pinShake ? 'کد اشتباه بود، دوباره' : 'کد ۴ رقمی خود را وارد کنید');
    root.innerHTML = `
    <div class="pin-screen">
      <div class="lock-mark">${ic(this.pinCheckError?'wifi-off':'lock',24)}</div>
      <div class="pin-title">${escapeHtml(this.state.settings.businessName||'ورود امن')}</div>
      <div class="pin-msg">${msg}</div>
      <div class="pin-dots${this.pinShake?' shake':''}">${dots}</div>
      <div class="pin-pad">
        ${pad.map(k=> k==='del' ? `<button onclick="App.pinBackspace()" aria-label="پاک کردن">${ic('delete',22)}</button>` : (k===''?`<button class="ghost"></button>`:`<button onclick="App.pinDigit('${k}')">${k}</button>`)).join('')}
      </div>
    </div>`;
  },

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
      const amtAFN = p.currency==='USD' ? (Number(p.amount)||0)*((Number(p.rate)||this.usdRate())||0) : (Number(p.amount)||0);
      cash -= amtAFN;
    });
    cash -= sum(s.expenses,'amount');
    return cash;
  },
  inventoryValue(){
    return this.state.products.reduce((a,p)=>a+(p.stock*p.avgCost),0);
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
  renderDashboard(){
    const today = todayISO();
    const todaySales = this.salesInRange(today,today);
    const todayExpensesAll = this.expensesInRange(today,today);
    const todayExpenses = todayExpensesAll.filter(e=>e.category!==WITHDRAWAL_CATEGORY);
    const todayWithdrawals = todayExpensesAll.filter(e=>e.category===WITHDRAWAL_CATEGORY);
    const todayProfit = sum(todaySales,'profit') - sum(todayExpenses,'amount');
    const cur = this.state.settings.currency;

    const recent = [
      ...this.state.sales.map(x=>({...x,_type:'sale'})),
      ...this.state.purchases.map(x=>({...x,_type:'purchase'})),
      ...this.state.expenses.map(x=>({...x,_type:'expense'})),
    ].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,8);

    const recentHtml = recent.length ? recent.map(x=>{
      const who=this.whoLabel(x);
      const whoHtml = who?`<span class="sub">${escapeHtml(who)}</span>`:'';
      if(x._type==='sale'){
        const tag = x.status==='cancelled' ? ' <span class="badge gold">باطل</span>' : '';
        return `<div class="row-item clickable" onclick="App.viewInvoice('${x.id}')"><span class="avt">${ic('receipt',16)}</span><div class="r-left"><b>فروش ${this.invoiceNoLabel(x.id)} · ${escapeHtml(x.customerName)}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${whoHtml}</div><div class="r-right num" style="color:var(--green)">+${fmt(x.paid)}</div></div>`;
      } else if(x._type==='purchase'){
        const tag = x.status==='cancelled' ? ' <span class="badge gold">باطل</span>' : (x.currency==='USD' ? ' <span class="badge gold">دالر</span>' : '');
        return `<div class="row-item clickable" onclick="App.viewPurchase('${x.id}')"><span class="avt out">${ic('package',16)}</span><div class="r-left"><b>خرید${x.supplierInvoiceNo?' (بل #'+escapeHtml(x.supplierInvoiceNo)+')':''} · ${escapeHtml(x.supplierName||'—')}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${whoHtml}</div><div class="r-right num" style="color:var(--red)">-${x.currency==='USD'?fmt2(x.paid)+' $':fmt(x.paid)}</div></div>`;
      } else {
        const isW = x.category===WITHDRAWAL_CATEGORY;
        return `<div class="row-item"><span class="avt neu">${ic(isW?'hand-coins':'banknote',16)}</span><div class="r-left"><b>${isW?'برداشت · '+escapeHtml(x.withdrawnBy||''):'مصرف · '+escapeHtml(x.category)}</b><span class="sub">${x.date}${x.note?(' · '+escapeHtml(x.note)):''}</span>${whoHtml}</div><div class="r-right num" style="color:var(--red)">-${fmt(x.amount)}</div></div>`;
      }
    }).join('') : `<div class="empty"><span class="ic">${ic('receipt',26)}</span><b>هنوز معامله‌ای ثبت نشده</b>از دکمه‌های «فروش جدید» یا «خرید جدید» شروع کنید</div>`;

    return `
    <div class="hero">
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic('wallet',15)}موجودی نقد</span><span class="val num">${fmt(this.cashBalance())} ${cur}</span></div>`:`<div class="row"><span class="label">${ic('receipt',15)}فروش امروز</span><span class="val num">${fmt(sum(todaySales,'total'))} ${cur}</span></div>`}
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic('boxes',15)}ارزش کالای انبار</span><span class="val num">${fmt(this.inventoryValue())} ${cur}</span></div>`:''}
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic(todayProfit>=0?'trending-up':'trending-down',15)}سود امروز</span><span class="val num ${todayProfit>=0?'green':'red'}">${fmt(todayProfit)} ${cur}</span></div>`:''}
    </div>
    <div class="ledger-strip">
      <div class="chip"><div class="t">فروش امروز</div><div class="v num">${fmt(sum(todaySales,'total'))}</div></div>
      ${this.canSeeBooks()?`<div class="chip"><div class="t">مصرف امروز</div><div class="v num">${fmt(sum(todayExpenses,'amount'))}</div></div>`:''}
      ${todayWithdrawals.length?`<div class="chip"><div class="t">${ic('hand-coins',12)}برداشت امروز</div><div class="v num">${fmt(sum(todayWithdrawals,'amount'))}</div></div>`:''}
      <div class="chip"><div class="t">طلب از مشتریان</div><div class="v num">${fmt(this.totalReceivable())}</div></div>
      ${this.canSeeBooks()?`<div class="chip"><div class="t">قرض از عمده‌فروش (${cur})</div><div class="v num">${fmt(this.totalPayable())}</div></div>`:''}
      ${this.totalPayableUSD()!==0?`<div class="chip"><div class="t">قرض از عمده‌فروش (دالر)</div><div class="v num">$${fmt2(this.totalPayableUSD())}</div></div>`:''}
      ${this.lowStockList().length?`<div class="chip warn" onclick="App.navigate('more','lowstock')" style="cursor:pointer;"><div class="t">${ic('alert-triangle',12)}کم‌موجودی</div><div class="v num">${this.lowStockList().length} کالا</div></div>`:''}
      ${this.totalPayableUSD()!==0 && this.usdRate()>0?`<div class="chip"><div class="t">مجموع کل قرض به ${cur}</div><div class="v num">${fmt(this.totalPayableCombinedAFN())}</div></div>`:''}
      <div class="chip set" onclick="App.quickSetUsdRate()" style="cursor:pointer;"><div class="t">${ic('pencil',12)}نرخ دالر</div><div class="v num">${this.usdRate()>0?fmt2(this.usdRate()):'تنظیم کنید'}</div></div>
    </div>
    <div class="quick-actions">
      <div class="qa-btn" onclick="App.navigate('sale')"><span class="ic">${ic('receipt',19)}</span>فروش جدید</div>
      ${this.canSeeBooks()?`<div class="qa-btn neutral" onclick="App.navigate('purchase')"><span class="ic">${ic('package',19)}</span>خرید جدید</div>`:''}
      ${this.canSeeBooks()?`<div class="qa-btn spend" onclick="App.navigate('more','expenses')"><span class="ic">${ic('banknote',19)}</span>ثبت مصرف</div>`:''}
    </div>
    <div class="eyebrow"><span>آخرین معاملات</span>${this.state.sales.length+this.state.purchases.length+this.state.expenses.length>8?`<span onclick="App.navigate('more','history')" style="cursor:pointer;color:var(--gold-700);">تاریخچهٔ کامل</span>`:''}</div>
    <div class="card">${recentHtml}</div>
    `;
  },

  /* =========================================================
     واحدهای تو در تو — توابع کمکی مشترک بین خرید، فروش و انبار
     ========================================================= */
  // نردبان واحدها از بزرگ به کوچک؛ همیشه واحد پایه را هم شامل است
  productUnits(p){
    const base = (p && p.unit) ? p.unit : 'عدد';
    const out = [];
    const packSize = Number(p && p.packSize)||0;
    const midPer   = Number(p && p.midPer)||0;
    if(p && p.packUnit && packSize>1) out.push({key:'pack', name:p.packUnit, factor:packSize});
    if(p && p.midUnit && midPer>1)    out.push({key:'mid',  name:p.midUnit,  factor:midPer});
    out.push({key:'base', name:base, factor:1});
    out.sort((a,b)=>b.factor-a.factor);
    return out.filter((u,i,a)=> a.findIndex(x=>x.factor===u.factor)===i && a.findIndex(x=>x.name===u.name)===i);
  },
  unitByName(p, name){
    const ladder=this.productUnits(p);
    return ladder.find(u=>u.name===name) || ladder[ladder.length-1];
  },
  // قیمت فروش یک واحد: اگر دستی تنظیم شده همان، وگرنه خودکار = قیمت پایه × ظرفیت
  unitSellPrice(p, u){
    if(!p||!u) return 0;
    if(u.key==='pack' && Number(p.sellPricePack)>0) return Number(p.sellPricePack);
    if(u.key==='mid'  && Number(p.sellPriceMid)>0)  return Number(p.sellPriceMid);
    return round2((Number(p.sellPrice)||0)*u.factor);
  },
  isUnitPriceManual(p,u){
    if(!p||!u) return false;
    return (u.key==='pack' && Number(p.sellPricePack)>0) || (u.key==='mid' && Number(p.sellPriceMid)>0);
  },
  // قیمت تمام‌شدهٔ یک واحد، همیشه خودکار از قیمت تمام‌شدهٔ واحد پایه
  unitCost(p, u){ return round2((Number(p&&p.avgCost)||0)*(u?u.factor:1)); },
  // «۲ کارتن و ۳ قوطی و ۵ عدد»
  qtyBreakdown(p, baseQty){
    const q0=Number(baseQty)||0;
    const neg=q0<0; let q=Math.abs(q0);
    const ladder=this.productUnits(p);
    const parts=[];
    // Iterate from largest (first) to smallest (last)
    for(let i=0;i<ladder.length;i++){
      const u=ladder[i];
      const n=Math.floor(q/u.factor+1e-9);
      if(n>0){ 
        parts.push(fmtQty(n)+' '+u.name); 
        q-=n*u.factor; 
      }
      // If this is the last unit and there's remainder, show it
      if(i===ladder.length-1){
        const rest=Math.round(q*1000)/1000;
        if(rest>0.0001 && parts.length>0) parts.push(fmtQty(rest)+' '+u.name);
        else if(rest>0.0001 || parts.length===0) parts.push(fmtQty(rest)+' '+u.name);
        break;
      }
    }
    return (neg?'-':'')+parts.join(' و ');
  },
  unitLadderLabel(p){
    const ladder=this.productUnits(p);
    if(ladder.length<2) return '';
    const parts=[];
    for(let i=0;i<ladder.length-1;i++){
      const child=ladder[i+1];
      parts.push('۱ '+ladder[i].name+' = '+fmtQty(ladder[i].factor/child.factor)+' '+child.name);
    }
    if(ladder.length>2) parts.push('۱ '+ladder[0].name+' = '+fmtQty(ladder[0].factor)+' '+ladder[ladder.length-1].name);
    return parts.join(' · ');
  },
  /* --- کمکی‌های نمایشِ اقلام فاکتور --- */
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
  // معادل واحد پایه، فقط وقتی واحد معامله بزرگ‌تر از پایه بوده
  itemBaseNote(it){
    const f=this.itemFactor(it);
    if(f<=1) return '';
    return '= '+fmtQty(it.qty)+' '+(it.unit||'عدد');
  },
  // نمایش برای فاکتور: فقط واحدهای بزرگتر، بدون عدد کوچک
  /* نمایش مقدار در فاکتور. سه قانون:
     ۱) اگر معامله سرِ راست به یک واحد بود («۳ قوطی») همان نشان داده شود؛
     ۲) اگر چند واحد پایه از قلم کم شده باشد («۱ قوطی منهای ۲ عدد») صریح نوشته شود؛
     ۳) هیچ‌وقت مقدارِ ناقص گرد نشود — قبلاً ۲۲ عدد به «۱ قوطی» گرد می‌شد و
        باقی‌ماندهٔ واحد پایه در فاکتور کلاً حذف می‌شد، یعنی مشتری چیزی می‌دید که با مبلغ نمی‌خواند. */
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

  // موجودی در یک واحد خاص
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
    const base=gs(prefix+'-newunit')||'عدد';
    const midUnit=gs(prefix+'-newmidunit'), midPer=gn(prefix+'-newmidper');
    const packUnit=gs(prefix+'-newpackunit'), packPer=gn(prefix+'-newpackper');
    const hasMid = !!(midUnit && midPer>1);
    const packSize = (packUnit && packPer>0) ? (hasMid ? packPer*midPer : packPer) : 0;
    return {
      name: gs(prefix+'-newname'), unit: base, stock:0, avgCost:0, sellPrice:0,
      midUnit: hasMid?midUnit:'', midPer: hasMid?midPer:0,
      packUnit: packSize>1?packUnit:'', packSize: packSize>1?packSize:0,
      defaultSaleUnit: packSize>0?packUnit:(hasMid?midUnit:base)
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
    const ladder = p ? this.productUnits(p) : [];
    const prev=sel.value;
    const baseName = p ? (p.unit||'عدد') : 'عدد';
    sel.innerHTML = ladder.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' — '+fmtQty(u.factor)+' '+escapeHtml(baseName):''}</option>`).join('');
    let def=prev;
    if(!ladder.some(u=>u.name===prev)){
      if(prefix==='pp') def = ladder.length?ladder[0].name:'';
      else def = (p&&p.defaultSaleUnit && ladder.some(u=>u.name===p.defaultSaleUnit)) ? p.defaultSaleUnit : (ladder.length?ladder[ladder.length-1].name:'');
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
      if(u&&u.factor>1&&qty>0) bits.push('= '+fmtQty(round2(qty*u.factor))+' '+base);
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
          ? (prefix==='sp'?'یعنی هر ':'قیمت تمام‌شده: هر ')+smaller.map(x=>x.name+' = '+fmt2(round2(per*x.factor))).join(' · هر ')
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
    } else {
      product = this.state.products.find(p=>p.id===pid);
    }
    if(!product){ this.toast('محصول یافت نشد'); return; }
    const u = this.unitByName(product, (document.getElementById('sp-unit')||{}).value);
    const qtyIn = parseFloat(document.getElementById('sp-qty').value);
    const priceIn = parseFloat(document.getElementById('sp-price').value);
    if(!qtyIn||qtyIn<=0){ this.toast('تعداد را درست بنویسید'); return; }
    if(isNaN(priceIn)||priceIn<0){ this.toast('قیمت فروش را بنویسید'); return; }
    // همه‌چیز به واحد پایه تبدیل و ذخیره می‌شود؛ واحد انتخابی فقط برای نمایش نگه داشته می‌شود
    const qty = round2(qtyIn*u.factor);
    const price = priceIn/u.factor;
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

  submitSale(){
    if(this.saleDraft.items.length===0){ this.toast('حداقل یک محصول اضافه کنید'); return; }
    const total = round2(this.saleDraft.items.reduce((a,i)=>a+i.qty*i.unitPrice,0));
    const totalCost = round2(this.saleDraft.items.reduce((a,i)=>a+i.qty*i.cost,0));
    let paid = parseFloat(document.getElementById('sale-paid').value);
    if(isNaN(paid)) paid=0;
    if(paid>total) paid=total;
    if(paid<0) paid=0;
    const custName = (document.getElementById('sale-customer-name').value||'').trim();
    const custPhone = (document.getElementById('sale-customer-phone').value||'').trim();
    const custAddress = (document.getElementById('sale-customer-address').value||'').trim();
    const date = document.getElementById('sale-date').value || todayISO();
    const note = (document.getElementById('sale-note').value||'').trim();
    const remaining = total-paid;

    const batch = writeBatch(db);
    let customerId=null, customerNameFinal='مشتری نقدی';
    if(custName){
      let customer=this.state.customers.find(c=>c.name===custName);
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
      this.toast('برای فروش قرضی (نسیه) باید نام مشتری را بنویسید'); return;
    }

    // محصولات جدیدی که فقط در پیش‌نویس بودند، حالا برای اولین بار ذخیره می‌شوند
    const draftProducts = this.saleDraft._draftProducts || [];
    this.saleDraft.items.forEach(it=>{
      const draftP = draftProducts.find(dp=>dp.id===it.productId);
      if(draftP){
        batch.set(doc(cols.products, draftP.id), {id:draftP.id, name:draftP.name, unit:draftP.unit, stock:-it.qty, avgCost:0, sellPrice:it.unitPrice,
          midUnit:draftP.midUnit||'', midPer:draftP.midPer||0, packUnit:draftP.packUnit||'', packSize:draftP.packSize||0,
          defaultSaleUnit:draftP.defaultSaleUnit||draftP.packUnit||draftP.midUnit||draftP.unit, sellPriceMid:0, sellPricePack:0});
      } else {
        batch.update(doc(cols.products, it.productId), { stock: increment(-it.qty) });
      }
    });

    const saleId = uid();
    const newSale = {
      id:saleId, ts:Date.now(), date, customerId, customerName:customerNameFinal,
      customerPhone: custPhone, customerAddress: custAddress,
      items:this.saleDraft.items.map(it=>({...it,returnedQty:0})), total, totalCost, profit: round2(total-totalCost),
      paid, remaining, note, status:'active', returns:[], originalTotal: total, discount:0,
      ...this.recordMeta()
    };
    batch.set(doc(cols.sales, saleId), newSale);

    batch.commit().catch(e=>{ console.error('submitSale error',e); App.toastError('خطا در ذخیرهٔ فاکتور؛ اتصال اینترنت را بررسی کنید (در حالت آفلاین هم باید ذخیره شود، دوباره تلاش کنید).'); });

    this.resetSaleDraft();
    this.viewInvoiceId = saleId;
    this.navigate('invoice');
  },

  /* ---------- Invoice view / print / whatsapp ---------- */
  viewInvoice(id){ this.viewInvoiceId=id; this.navigate('invoice'); },
  printInvoice(){ window.print(); },
  // شمارهٔ فاکتور دیگر یک شمارندهٔ مشترک نیست (که در حالت آفلاین/هم‌زمان می‌توانست
  // برای دو فاکتور مختلف یک عدد تکراری بسازد)، بلکه از ترتیب زمانی خود فاکتورها
  // محاسبه می‌شود. چون هر فاکتور یک id یکتا دارد، هیچ‌وقت دو فاکتور شمارهٔ یکسان نمی‌گیرند،
  // حتی اگر چند نفر هم‌زمان و آفلاین فاکتور ثبت کرده باشند.
  saleSeqNo(saleId){
    const sorted = [...this.state.sales].sort((a,b)=> (a.ts||0)-(b.ts||0) || (a.id<b.id?-1:1));
    const idx = sorted.findIndex(s=>s.id===saleId);
    return idx>=0 ? idx+1 : 0;
  },
  invoiceNoLabel(saleId){ return '#'+String(this.saleSeqNo(saleId)).padStart(5,'0'); },
  // همان منطق شماره‌گذاری فاکتور فروش، برای فاکتورهای خرید نیز (جدا از شمارهٔ فروش).
  purchaseSeqNo(purchaseId){
    const sorted = [...this.state.purchases].sort((a,b)=> (a.ts||0)-(b.ts||0) || (a.id<b.id?-1:1));
    const idx = sorted.findIndex(s=>s.id===purchaseId);
    return idx>=0 ? idx+1 : 0;
  },
  purchaseNoLabel(purchaseId){ return '#'+String(this.purchaseSeqNo(purchaseId)).padStart(5,'0'); },
  // برای نمایش، اگر شمارهٔ بلِ واقعی عمده‌فروش ثبت شده باشد همان نشان داده می‌شود
  // (چون این همان چیزی است که کاربر می‌شناسد)، وگرنه شمارهٔ داخلی برنامه به‌عنوان جایگزین.
  purchaseBillLabel(pur){ return pur.supplierInvoiceNo ? ('بل #'+pur.supplierInvoiceNo) : this.purchaseNoLabel(pur.id); },
  editPurchaseInvoiceNo(purchaseId){
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
  renderInvoiceView(){
    const sale=this.state.sales.find(x=>x.id===this.viewInvoiceId);
    if(!sale){
      return `<button class="back-btn" onclick="App.navigate('dashboard')">${ic('chevron-right',16)}بازگشت</button><div class="empty">فاکتور یافت نشد.</div>`;
    }
    if(this.editingInvoiceId===sale.id){
      return this.renderInvoiceEditForm(sale);
    }
    const s=this.state.settings;
    const cancelled = sale.status==='cancelled';
    const itemsHtml = sale.items.map((it,idx)=>{
      const returned = it.returnedQty||0;
      return `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml(it.name)}${returned>0?`<div class="sub" style="color:var(--red);">${escapeHtml(this.itemQtyLabel(it,returned))} مرجوعی</div>`:''}</td>
        <td class="num">${escapeHtml(this.itemQtyLabelForInvoice(it))}${this.itemBaseNote(it)?`<div class="sub">${escapeHtml(this.itemBaseNote(it))}</div>`:''}</td>
        <td class="num">${fmt(this.itemPricePerTxUnit(it))}<div class="sub">هر ${escapeHtml(this.itemUnitName(it))}</div></td>
        <td class="num">${fmt(it.qty*it.unitPrice)}</td>
        <td class="no-print">${!cancelled?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"مرجوعی این قلم", icon:"rotate-ccw", onClick:()=>App.saleReturnItem("${sale.id}",${idx})},
          {label:"افزودن تعداد", icon:"plus", onClick:()=>App.saleIncreaseItemQty("${sale.id}",${idx})},
          {label:"کم کردن چند ${escapeHtml(it.unit||'عدد')} (کاستی)", icon:"minus", onClick:()=>App.saleShrinkItem("${sale.id}",${idx})}
        ])'>${ic('more-vertical',17)}</span>`:''}</td>
      </tr>`;
    }).join('');

    const returnsHtml = sale.returns && sale.returns.length ? `
      <h2 class="section-title">${ic('rotate-ccw',17)}کالاهای مرجوعی</h2>
      <div class="card no-print">${sale.returns.map(r=>`<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">${r.date} · ${escapeHtml(r.qtyLabel||(r.qty+' عدد'))}</span></div><div class="r-right num" style="color:var(--red)">-${fmt(r.amount)}</div></div>`).join('')}</div>
    ` : '';

    return `
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.navigate('dashboard')">${ic('home',15)}داشبورد</button>
      <button class="btn btn-primary" onclick="App.printInvoice()">${ic('printer',15)}چاپ فاکتور</button>
      <button class="btn btn-wa" onclick="App.sendInvoiceWhatsApp('${sale.id}')">${ic('message-circle',15)}ارسال واتساپ</button>
    </div>
    ${!cancelled?`
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.startEditInvoice('${sale.id}')">${ic('pencil',15)}ویرایش فاکتور</button>
      <button class="btn btn-outline" onclick="App.saleAddItem('${sale.id}')">${ic('plus',15)}افزودن قلم</button>
      ${sale.remaining>0.5?`<button class="btn btn-outline" onclick="App.applySaleDiscount('${sale.id}')">${ic('percent',15)}تخفیف به‌جای بدهی</button>`:''}
      <button class="btn btn-danger" onclick="App.cancelSale('${sale.id}')">${ic('ban',15)}کنسل کامل فاکتور</button>
    </div>`:''}
    <div id="invoice-print" class="card">
      ${cancelled?`<div class="inv-void">${ic('ban',16)}این فاکتور باطل شده است</div>`:''}
      <div class="inv-head">
        <div class="logo">${s.logoEmoji||'🏪'}</div>
        <div class="biz">${escapeHtml(s.businessName)}</div>
        ${s.businessPhone?`<div class="sub"><a href="tel:${escapeHtml(s.businessPhone)}" class="num">${escapeHtml(s.businessPhone)}</a></div>`:''}
        ${s.businessAddress?`<div class="sub">${escapeHtml(s.businessAddress)}</div>`:''}
        <div class="doc-kind">${ic('receipt',12)}فاکتور فروش${cancelled?' — باطل شده':''}</div>
      </div>
      <div class="inv-meta">
        <span>شماره فاکتور: <b class="num">${this.invoiceNoLabel(sale.id)}</b></span>
        <span>تاریخ: <b class="num">${sale.date}</b></span>
      </div>
      ${this.whoLabel(sale)?`<div class="field-note no-print">${escapeHtml(this.whoLabel(sale))}${sale.lastEditedByEmail?` · آخرین ویرایش: ${escapeHtml([sale.lastEditedByEmail,sale.lastEditedByDevice].filter(Boolean).join(' · '))}`:''}</div>`:''}
      <div class="inv-cust">
        <div class="l1">مشتری: ${escapeHtml(sale.customerName)}</div>
        ${sale.customerPhone?`<div>تماس: <span class="num">${escapeHtml(sale.customerPhone)}</span></div>`:''}
        ${sale.customerAddress?`<div>آدرس: ${escapeHtml(sale.customerAddress)}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>#</th><th>شرح کالا</th><th>تعداد</th><th>فی واحد</th><th>مجموع</th><th class="no-print"></th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="inv-totals">
        ${sale.originalTotal!==undefined && Math.abs(sale.originalTotal-sale.total)>0.5?`<div class="row-item"><div class="r-left">مجموع اولیهٔ فاکتور</div><div class="r-right num">${fmt(sale.originalTotal)} ${s.currency}</div></div>`:''}
        ${sale.discount>0.5?`<div class="row-item"><div class="r-left">تخفیف داده‌شده</div><div class="r-right num" style="color:var(--gold-d)">-${fmt(sale.discount)} ${s.currency}</div></div>`:''}
        <div class="row-item"><div class="r-left">مجموع فعلی فاکتور</div><div class="r-right num">${fmt(sale.total)} ${s.currency}</div></div>
        <div class="row-item"><div class="r-left">مبلغ دریافت‌شده</div><div class="r-right num" style="color:var(--green)">${fmt(sale.paid)} ${s.currency}</div></div>
        <div class="row-item"><div class="r-left"><b>${sale.remaining>0.5?'باقیمانده (قرض)':'وضعیت'}</b></div><div class="r-right num" style="color:${sale.remaining>0.5?'var(--red)':'var(--green)'}"><b>${cancelled?'باطل شده':(sale.remaining>0.5?fmt(sale.remaining)+' '+s.currency:`<span class="inv-stamp">${ic('check',12)}تسویه‌شده</span>`)}</b></div></div>
      </div>
      ${sale.note?`<div class="inv-note">یادداشت: ${escapeHtml(sale.note)}</div>`:''}
      <div class="inv-sign">
        <div class="line">امضای فروشنده</div>
        <div class="line">امضای مشتری</div>
      </div>
    </div>
    ${returnsHtml}
    `;
  },

  /* ---------- Invoice full edit (items price/qty + customer info) ----------
     برخلاف افزودن/مرجوعی که فقط یک تغییر کوچک را ثبت می‌کنند، این حالت به کاربر
     اجازه می‌دهد قیمت و تعداد هر قلم و نیز اطلاعات مشتری (نام/شماره/آدرس) را
     یک‌جا ویرایش کند. بعد از ذخیره، مجموع فاکتور، بدهی مشتری (قدیم/جدید) و
     موجودی انبار همگی بر اساس مقدار جدید دوباره محاسبه و اصلاح می‌شوند. */
  renderInvoiceEditForm(sale){
    const itemsHtml = sale.items.map((it,idx)=>{
      const returned = it.returnedQty||0;
      const f=this.itemFactor(it);
      const un=this.itemUnitName(it);
      const minLbl = returned>0 ? this.itemQtyLabel(it,returned) : '';
      return `
      <div class="grid2" style="align-items:end;margin-bottom:10px;">
        <div>
          <label>${escapeHtml(it.name)} — تعداد (${escapeHtml(un)})${returned>0?` <span class="sub" style="color:var(--red);">(حداقل ${escapeHtml(minLbl)}، به‌دلیل مرجوعی)</span>`:''}</label>
          <input id="edit-item-qty-${idx}" type="number" inputmode="decimal" step="0.01" value="${round2(it.qty/f)}">
          ${f>1?`<div class="field-note">۱ ${escapeHtml(un)} = ${fmtQty(f)} ${escapeHtml(it.unit||'عدد')}</div>`:''}
        </div>
        <div>
          <label>قیمت هر ${escapeHtml(un)}</label>
          <input id="edit-item-price-${idx}" type="number" inputmode="decimal" step="0.01" value="${this.itemPricePerTxUnit(it)}">
        </div>
      </div>`;
    }).join('');

    return `
    <button class="back-btn" onclick="App.cancelEditInvoice()">${ic('chevron-right',16)}انصراف از ویرایش</button>
    <h2 class="section-title" style="margin-top:0;">${ic('pencil',17)}ویرایش فاکتور ${this.invoiceNoLabel(sale.id)}</h2>
    <div class="card">
      <b style="font-size:13.5px;">اقلام فاکتور</b>
      <hr class="divider">
      ${itemsHtml}
      <hr class="divider">
      <label>تاریخ</label>
      <input id="edit-sale-date" type="date" value="${sale.date}">

      <label>نام مشتری (خالی = فروش نقدی)</label>
      <input id="edit-customer-name" list="customers-list" placeholder="مثلاً دوکان احمد" value="${escapeHtml(sale.customerName==='مشتری نقدی'?'':sale.customerName)}">
      <datalist id="customers-list">${this.state.customers.map(c=>`<option value="${escapeHtml(c.name)}">`).join('')}</datalist>

      <div class="grid2">
        <div><label>شماره تماس مشتری (اختیاری)</label><input id="edit-customer-phone" type="tel" placeholder="07xxxxxxxx" value="${escapeHtml(sale.customerPhone||'')}"></div>
        <div><label>آدرس مشتری (اختیاری)</label><input id="edit-customer-address" value="${escapeHtml(sale.customerAddress||'')}"></div>
      </div>
      <div class="field-note">حتی اگر نام مشتری خالی بماند، شماره واتساپ ثبت‌شده در اینجا برای ارسال فاکتور استفاده می‌شود.</div>

      <label>مبلغ دریافت‌شده (نقد)</label>
      <input id="edit-sale-paid" type="number" inputmode="decimal" value="${sale.paid}">
      <div class="field-note">اگر مبلغ دریافتی کمتر از مجموع باشد، باقیمانده به عنوان بدهی مشتری ثبت می‌شود.</div>

      <label>یادداشت</label>
      <input id="edit-sale-note" value="${escapeHtml(sale.note||'')}">

      <div class="field-note">با ذخیره: مجموع فاکتور، بدهی مشتری (چه مشتری قبلی و چه جدید) و موجودی انبار همگی بر اساس مقادیر جدید دوباره محاسبه می‌شوند.</div>

      <div class="inv-actions" style="margin-top:12px;">
        <button class="btn btn-primary" onclick="App.saveEditInvoice('${sale.id}')">${ic('save',17)}ذخیرهٔ ویرایش</button>
        <button class="btn btn-outline" onclick="App.cancelEditInvoice()">انصراف</button>
      </div>
    </div>
    `;
  },

  startEditInvoice(saleId){
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است و قابل ویرایش نیست.'); return; }
    this.editingInvoiceId=saleId;
    this.render();
  },
  cancelEditInvoice(){
    this.editingInvoiceId=null;
    this.render();
  },
  saveEditInvoice(saleId, confirmedNegative){
    const sale=this.state.sales.find(x=>x.id===saleId); if(!sale) return;
    if(sale.status==='cancelled'){ this.toast('این فاکتور باطل شده است.'); return; }

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
      if(isNaN(it.qty)||it.qty<=0){ App.toastError('تعداد نامعتبر برای «'+it.name+'»'); return; }
      if(isNaN(it.unitPrice)||it.unitPrice<0){ App.toastError('قیمت نامعتبر برای «'+it.name+'»'); return; }
      if(it.qty < (it.returnedQty||0)-1e-9){ App.toastError('تعداد «'+it.name+'» نمی‌تواند کمتر از مقدار مرجوعی‌شدهٔ آن ('+App.itemQtyLabel(it,it.returnedQty||0)+') باشد.'); return; }
    }

    const custName=(document.getElementById('edit-customer-name').value||'').trim();
    const custPhone=(document.getElementById('edit-customer-phone').value||'').trim();
    const custAddress=(document.getElementById('edit-customer-address').value||'').trim();
    const date=document.getElementById('edit-sale-date').value || sale.date;
    const note=(document.getElementById('edit-sale-note').value||'').trim();

    const newTotal = round2(newItems.reduce((a,i)=>a+(i.qty-(i.returnedQty||0))*i.unitPrice,0));
    const newTotalCost = round2(newItems.reduce((a,i)=>a+(i.qty-(i.returnedQty||0))*(i.cost||0),0));

    let paid=parseFloat(document.getElementById('edit-sale-paid').value);
    if(isNaN(paid)||paid<0) paid=0;
    if(paid>newTotal) paid=newTotal;
    const newRemaining=newTotal-paid;

    if(!custName && newRemaining>0.001){ this.toast('برای فروش قرضی (نسیه) باید نام مشتری مشخص باشد.'); return; }

    // موجودی انبار: فقط تفاوت تعداد نسبت به مقدار قبلیِ همان قلم اعمال می‌شود
    const stockDeltas={};
    newItems.forEach((it,idx)=>{
      const deltaQty = it.qty - sale.items[idx].qty;
      if(deltaQty!==0) stockDeltas[it.productId]=(stockDeltas[it.productId]||0)-deltaQty;
    });
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

    const batch=writeBatch(db);
    const oldCustomerId=sale.customerId;
    const oldRemaining=sale.remaining||0;
    let newCustomerId=null, newCustomerNameFinal='مشتری نقدی';

    if(custName){
      const existing=this.state.customers.find(c=>c.name===custName);
      if(existing){ newCustomerId=existing.id; newCustomerNameFinal=existing.name; }
      else { newCustomerId=uid(); newCustomerNameFinal=custName; }
    }

    // اصلاح بدهی مشتری قدیم/جدید (delta-based، تا با ویرایش هم‌زمان تداخل نکند)
    if(oldCustomerId && newCustomerId && oldCustomerId===newCustomerId){
      const existing=this.state.customers.find(c=>c.id===oldCustomerId);
      const fields={ balance: increment(newRemaining-oldRemaining) };
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
          if(Math.abs(newRemaining)>0.0001) fields.balance=increment(newRemaining);
          if(custPhone && custPhone!==existing.phone) fields.phone=custPhone;
          if(custAddress && custAddress!==existing.address) fields.address=custAddress;
          if(Object.keys(fields).length) batch.update(doc(cols.customers,newCustomerId), fields);
        } else {
          batch.set(doc(cols.customers,newCustomerId), {id:newCustomerId,name:custName,phone:custPhone,address:custAddress,balance:newRemaining, ...this.recordMeta()});
        }
      }
    }

    Object.keys(stockDeltas).forEach(pid=>{
      if(stockDeltas[pid]!==0) batch.update(doc(cols.products,pid), { stock: increment(stockDeltas[pid]) });
    });

    batch.update(doc(cols.sales, sale.id), {
      items:newItems, customerId:newCustomerId, customerName:newCustomerNameFinal,
      customerPhone:custPhone, customerAddress:custAddress, date, note,
      total:newTotal, totalCost:newTotalCost, profit:newTotal-newTotalCost,
      paid, remaining:newRemaining, ...this.editMeta()
    });

    batch.commit().then(()=>{
      this.editingInvoiceId=null;
      this.render();
    }).catch(e=>{ console.error('saveEditInvoice error',e); this.toast('خطا در ذخیرهٔ ویرایش؛ اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.'); });
  },

  renderSale(){
    const items = this.saleDraft.items;
    const total = items.reduce((a,i)=>a+i.qty*i.unitPrice,0);
    const itemsHtml = items.length ? items.map((it,idx)=>
      `<div class="item-row"><span>${escapeHtml(it.name)} — ${escapeHtml(this.itemQtyLabel(it))} × <span class="num">${fmt(this.itemPricePerTxUnit(it))}</span>${this.itemBaseNote(it)?`<span class="sub" style="display:block;">${escapeHtml(this.itemBaseNote(it))}</span>`:''}</span>
      <span style="display:flex;align-items:center;gap:8px;"><b class="num">${fmt(it.qty*it.unitPrice)}</b><span class="x" onclick="App.removeSaleItem(${idx})" title="حذف قلم">${ic('trash',15)}</span></span></div>`
    ).join('') : `<div class="field-note">هنوز محصولی اضافه نشده.</div>`;

    return `
    <h2 class="section-title" style="margin-top:0;">${ic('receipt',17)}ثبت فروش جدید</h2>
    <div class="card">
      <label>محصول</label>
      <select id="sp-product" onchange="App.onSaleProductChange()">${this.productOptions()}</select>
      <div id="sp-new-fields" style="display:none;">
        <div class="grid2">
          <div><label>نام محصول جدید</label><input id="sp-newname" placeholder="مثلاً بطری موتر"></div>
          <div><label>واحد پایه (کوچک‌ترین)</label><input id="sp-newunit" placeholder="عدد" value="عدد" oninput="App.fillUnitSelect('sp',true)"></div>
        </div>
        <div class="grid2">
          <div><label>واحد بزرگ (اختیاری)</label><input id="sp-newpackunit" placeholder="کارتن" oninput="App.fillUnitSelect('sp',true)"></div>
          <div><label>هر کارتن حاوی چند؟</label><input id="sp-newpackper" type="number" inputmode="decimal" placeholder="6" oninput="App.fillUnitSelect('sp',true)"></div>
        </div>
        <div class="grid2">
          <div><label>واحد میانی (اختیاری)</label><input id="sp-newmidunit" placeholder="قوطی / بسته" oninput="App.fillUnitSelect('sp',true)"></div>
          <div><label>هر قوطی/بسته حاوی چند عدد؟</label><input id="sp-newmidper" type="number" inputmode="decimal" placeholder="24" oninput="App.fillUnitSelect('sp',true)"></div>
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>واحد فروش</label>
          <select id="sp-unit" onchange="App.onSaleUnitChange()"></select>
          <div class="field-note" id="sp-unit-note"></div>
        </div>
        <div>
          <label>تعداد</label>
          <input id="sp-qty" type="number" inputmode="decimal" placeholder="0" oninput="App.updateUnitHint('sp')">
          <div class="field-note" id="sp-qty-hint"></div>
        </div>
      </div>
      <label id="sp-price-label">قیمت فروش هر واحد</label>
      <input id="sp-price" type="number" inputmode="decimal" placeholder="0" oninput="App.updateUnitHint('sp')">
      <div class="field-note" id="sp-price-hint">با انتخاب واحد (کارتن، قوطی/بسته یا عدد) قیمت آن واحد خودکار می‌آید؛ اگر تخفیف می‌دهید همین‌جا تغییرش دهید.</div>
      <button class="btn btn-outline" onclick="App.addSaleItem()">${ic('plus',16)}افزودن به فاکتور</button>
      <hr class="divider">
      ${itemsHtml}
      <div class="total-line"><span>مجموع فاکتور</span><span class="num">${fmt(total)} ${this.state.settings.currency}</span></div>

      <label>نام مشتری (خالی = فروش نقدی)</label>
      <input id="sale-customer-name" list="customers-list" placeholder="مثلاً دوکان احمد" oninput="App.onSaleCustomerNameChange()">
      <datalist id="customers-list">${this.state.customers.map(c=>`<option value="${escapeHtml(c.name)}">`).join('')}</datalist>

      <div class="grid2">
        <div><label>شماره تماس مشتری (اختیاری)</label><input id="sale-customer-phone" type="tel" placeholder="07xxxxxxxx"></div>
        <div><label>آدرس مشتری (اختیاری)</label><input id="sale-customer-address" placeholder="مثلاً ناحیه ۳، سوپرمارکت..."></div>
      </div>

      <div class="grid2">
        <div><label>مبلغ دریافت‌شده (نقد)</label><input id="sale-paid" type="number" inputmode="decimal" value="${total?Math.round(total):''}"></div>
        <div><label>تاریخ</label><input id="sale-date" type="date" value="${todayISO()}"></div>
      </div>
      <div class="field-note">اگر مبلغ دریافتی کمتر از مجموع باشد، باقیمانده به عنوان بدهی مشتری ثبت می‌شود.</div>
      <label>یادداشت (اختیاری)</label>
      <input id="sale-note" placeholder="مثلاً تحویل با موتر شرکت">
      <button class="btn btn-primary" onclick="App.submitSale()">${ic('check',17)}ثبت فروش</button>
    </div>
    `;
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
    const sorted=[...this.state.products].sort((a,b)=>String(a.name).localeCompare(String(b.name),'fa'));
    return '<option value="">— انتخاب محصول از فهرست —</option>' +
      sorted.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — موجودی: ${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</option>`).join('') +
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
    if(!product){ this.toast('محصول یافت نشد'); return; }
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
    if(this.purchaseDraft.items.length===0){ this.toast('حداقل یک محصول اضافه کنید'); return; }
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
    const remaining = total-paid;

    const batch = writeBatch(db);
    let supplierId=null, supplierNameFinal=supName||'—';
    if(supName){
      let supplier=this.state.suppliers.find(c=>c.name===supName);
      if(!supplier){
        supplierId=uid(); supplierNameFinal=supName;
        batch.set(doc(cols.suppliers,supplierId), {id:supplierId,name:supName,phone:'',address:'',balance:currency==='AFN'?remaining:0,balanceUSD:currency==='USD'?remaining:0, ...this.recordMeta()});
      } else {
        supplierId=supplier.id; supplierNameFinal=supplier.name;
        batch.update(doc(cols.suppliers,supplier.id), { [balField]: increment(remaining) });
      }
    } else if(remaining>0.001){
      this.toast('برای خرید نسیه باید نام عمده‌فروش/شرکت را بنویسید'); return;
    }

    const draftProducts = this.purchaseDraft._draftProducts || [];
    this.purchaseDraft.items.forEach(it=>{
      const unitCostAFN = currency==='USD' ? it.unitCost*rateAtPurchase : it.unitCost;
      const draftP = draftProducts.find(dp=>dp.id===it.productId);
      if(draftP){
        batch.set(doc(cols.products, draftP.id), {id:draftP.id, name:draftP.name, unit:draftP.unit, stock:it.qty, avgCost:unitCostAFN, sellPrice:round2(unitCostAFN*1.15),
          midUnit:draftP.midUnit||'', midPer:draftP.midPer||0, packUnit:draftP.packUnit||'', packSize:draftP.packSize||0,
          defaultSaleUnit:draftP.defaultSaleUnit||draftP.packUnit||draftP.midUnit||draftP.unit, sellPriceMid:0, sellPricePack:0, ...this.recordMeta()});
      } else {
        const p = this.state.products.find(pp=>pp.id===it.productId);
        if(p){
          const newStock = p.stock + it.qty;
          const newAvgCost = newStock>0 ? round4(((p.stock*p.avgCost)+(it.qty*unitCostAFN))/newStock) : unitCostAFN;
          const fields = { stock: increment(it.qty), avgCost: newAvgCost };
          if(!p.sellPrice) fields.sellPrice = round2(unitCostAFN*1.15);
          batch.update(doc(cols.products, it.productId), fields);
        }
      }
    });

    const photoInput = document.getElementById('purchase-bill-photo');
    const photoFile = photoInput && photoInput.files[0];
    let billImage = null;
    if(photoFile){
      try{ billImage = await compressImageForStorage(photoFile); }
      catch(err){ App.toastError(err.message||'خطا در پردازش عکس بل'); return; }
    }

    const purchaseId = uid();
    const newPurchase = {
      id:purchaseId, ts:Date.now(), date, supplierId, supplierName:supplierNameFinal, currency, rateAtPurchase,
      items:this.purchaseDraft.items.map(it=>({...it,returnedQty:0})), total, paid, remaining, note, supplierInvoiceNo,
      status:'active', returns:[], originalTotal: total,
      ...this.recordMeta()
    };
    if(billImage) newPurchase.billImage = billImage;
    batch.set(doc(cols.purchases, purchaseId), newPurchase);

    batch.commit().catch(e=>{ console.error('submitPurchase error',e); this.toast('خطا در ذخیرهٔ بل خرید؛ اتصال اینترنت را بررسی کنید.'); });

    this.resetPurchaseDraft();
    this.viewPurchaseId = purchaseId;
    this.navigate('purchase-view');
  },

  renderPurchase(){
    const items = this.purchaseDraft.items;
    const total = items.reduce((a,i)=>a+i.qty*i.unitCost,0);
    const cur = this.purchaseDraft.currency || 'AFN';
    const rate = this.usdRate();
    const itemsHtml = items.length ? items.map((it,idx)=>
      `<div class="item-row"><span>${escapeHtml(it.name)} — ${escapeHtml(this.itemQtyLabelForInvoice(it))} × <span class="num">${cur==='USD'?fmt2(this.itemCostPerTxUnit(it)):fmt(this.itemCostPerTxUnit(it))}</span>${this.itemBaseNote(it)?`<span class="sub" style="display:block;">${escapeHtml(this.itemBaseNote(it))} · قیمت تمام‌شدهٔ هر ${escapeHtml(it.unit||'عدد')}: <span class="num">${fmt2(round2(it.unitCost))}</span></span>`:''}</span>
      <span style="display:flex;align-items:center;gap:8px;"><b class="num">${cur==='USD'?fmt2(it.qty*it.unitCost):fmt(it.qty*it.unitCost)}</b><span class="x" onclick="App.removePurchaseItem(${idx})" title="حذف قلم">${ic('trash',15)}</span></span></div>`
    ).join('') : `<div class="field-note">هنوز محصولی اضافه نشده.</div>`;

    return `
    <h2 class="section-title" style="margin-top:0;">${ic('package',17)}ثبت خرید جدید</h2>
    <div class="card">
      <label>ارز این معامله</label>
      <select id="purchase-currency" onchange="App.purchaseDraft.currency=this.value; App.render();">
        <option value="AFN" ${cur==='AFN'?'selected':''}>${this.state.settings.currency} (افغانی)</option>
        <option value="USD" ${cur==='USD'?'selected':''}>دالر</option>
      </select>
      ${cur==='USD'?`
      <div class="row-item" style="padding:10px 0;">
        <div class="r-left"><b>نرخ فعلی دالر</b><span class="sub">${rate>0?('۱ دالر = '+fmt2(rate)+' '+this.state.settings.currency):'هنوز تنظیم نشده'}</span></div>
        <div class="r-right"><button class="btn btn-outline btn-sm" onclick="App.quickSetUsdRate()">${ic('pencil',15)}نرخ دالر</button></div>
      </div>
      ${rate>0 && total>0?`<div class="field-note">معادل مجموع فاکتور به ${this.state.settings.currency} (به نرخ امروز): <b class="num">${fmt(total*rate)}</b></div>`:''}
      <div class="field-note">قیمت میانگین و فروش کالاها خودکار بر اساس همین نرخ به ${this.state.settings.currency} محاسبه و ذخیره می‌شود.</div>
      `:''}
      <label>محصول</label>
      <select id="pp-product" onchange="App.onPurchaseProductChange()">${this.productOptions()}</select>
      <div id="pp-new-fields" style="display:none;">
        <div class="grid2">
          <div><label>نام محصول جدید</label><input id="pp-newname" placeholder="مثلاً بسکیت شیری"></div>
          <div><label>واحد پایه (کوچک‌ترین)</label><input id="pp-newunit" placeholder="عدد" value="عدد" oninput="App.fillUnitSelect('pp',true)"></div>
        </div>
        <div class="field-note">بسته‌بندی این محصول را همین‌جا بنویسید تا بعداً بتوانید هم کارتن، هم قوطی/بسته و هم عدد بفروشید.</div>
        <div class="grid2">
          <div><label>نام واحد بزرگ (اختیاری)</label><input id="pp-newpackunit" placeholder="کارتن" oninput="App.fillUnitSelect('pp',true)"></div>
          <div><label>هر کارتن حاوی چند؟</label><input id="pp-newpackper" type="number" inputmode="decimal" placeholder="4" oninput="App.fillUnitSelect('pp',true)"></div>
        </div>
        <div class="grid2">
          <div><label>نام واحد میانی (اختیاری)</label><input id="pp-newmidunit" placeholder="قوطی / بسته" oninput="App.fillUnitSelect('pp',true)"></div>
          <div><label>هر قوطی/بسته حاوی چند عدد؟</label><input id="pp-newmidper" type="number" inputmode="decimal" placeholder="8" oninput="App.fillUnitSelect('pp',true)"></div>
        </div>
        <div class="field-note">نمونه‌ها — کارتن بسکیت ۵۴۰ افغانی: واحد بزرگ «کارتن» حاوی ۴، واحد میانی «بسته» حاوی ۸ عدد. کارتن ۱۶۰۰ افغانی با ۶ قوطی ۲۴ عددی: کارتن حاوی ۶، قوطی حاوی ۲۴ عدد. کوکو سطلی ۱۷ عددی: کارتن حاوی ۱۷ و واحد میانی خالی.</div>
      </div>
      <div class="grid2">
        <div>
          <label>واحد خرید</label>
          <select id="pp-unit" onchange="App.onPurchaseUnitChange()"></select>
          <div class="field-note" id="pp-unit-note"></div>
        </div>
        <div>
          <label>تعداد</label>
          <input id="pp-qty" type="number" inputmode="decimal" placeholder="0" oninput="App.updateUnitHint('pp')">
          <div class="field-note" id="pp-qty-hint"></div>
        </div>
      </div>
      <label id="pp-price-label">قیمت خرید هر واحد (${this.curLabel(cur)})</label>
      <input id="pp-cost" type="number" inputmode="decimal" step="0.01" placeholder="0" oninput="App.updateUnitHint('pp')">
      <div class="field-note" id="pp-price-hint">قیمت یک کارتن (یا بسته) را بنویسید؛ قیمت تمام‌شدهٔ قوطی، بسته و عدد خودکار حساب می‌شود.</div>
      <button class="btn btn-outline" onclick="App.addPurchaseItem()">${ic('plus',16)}افزودن به فاکتور</button>
      <hr class="divider">
      ${itemsHtml}
      <div class="total-line"><span>مجموع فاکتور</span><span class="num">${cur==='USD'?fmt2(total):fmt(total)} ${this.curLabel(cur)}</span></div>

      <label>نام شرکت / عمده‌فروش (خالی = خرید نقدی)</label>
      <input id="purchase-supplier-name" list="suppliers-list" placeholder="مثلاً شرکت البرز">
      <datalist id="suppliers-list">${this.state.suppliers.map(c=>`<option value="${escapeHtml(c.name)}">`).join('')}</datalist>

      <label>شمارهٔ بل/فاکتوری که عمده‌فروش به شما داده (اختیاری)</label>
      <input id="purchase-supplier-invoice-no" placeholder="مثلاً 1042 — همان شماره‌ای که روی رسید کاغذی نوشته">
      <div class="field-note">این همان شمارهٔ بل کاغذی عمده‌فروش است، نه شمارهٔ داخلی برنامه. با نوشتن آن، بعداً می‌توانید همین خرید را با تایپ این شماره در جستجو پیدا کنید.</div>

      <div class="grid2">
        <div><label>مبلغ پرداخت‌شده (نقد، ${this.curLabel(cur)})</label><input id="purchase-paid" type="number" inputmode="decimal" step="${cur==='USD'?'0.01':'1'}" value="${total?(cur==='USD'?total:Math.round(total)):''}"></div>
        <div><label>تاریخ</label><input id="purchase-date" type="date" value="${todayISO()}"></div>
      </div>
      <div class="field-note">اگر مبلغ پرداختی کمتر از مجموع باشد، باقیمانده به عنوان بدهی شما به آن شرکت/عمده‌فروش به ${this.curLabel(cur)} ثبت می‌شود.</div>
      <label>یادداشت (اختیاری)</label>
      <input id="purchase-note" placeholder="مثلاً توضیح اضافه دربارهٔ این خرید">
      <label>عکس بل/فاکتور شرکت (اختیاری)</label>
      <input id="purchase-bill-photo" type="file" accept="image/*" capture="environment">
      <div class="field-note">اگر از یک شرکت یا عمده‌فروش خرید کردید، عکس بل آن‌ها را اینجا ضمیمه کنید تا همیشه همراه این خرید ذخیره و قابل مشاهده باشد.</div>
      <button class="btn btn-primary" onclick="App.submitPurchase()">${ic('check',17)}ثبت خرید</button>
    </div>
    `;
  },

  viewPurchase(id){ this.viewPurchaseId=id; this.navigate('purchase-view'); },
  renderPurchaseView(){
    const pur=this.state.purchases.find(x=>x.id===this.viewPurchaseId);
    if(!pur){
      return `<button class="back-btn" onclick="App.navigate('dashboard')">${ic('chevron-right',16)}بازگشت</button><div class="empty">بل خرید یافت نشد.</div>`;
    }
    const s=this.state.settings;
    const cancelled = pur.status==='cancelled';
    const curLbl = this.curLabel(pur.currency);
    const itemsHtml = pur.items.map((it,idx)=>{
      const returned = it.returnedQty||0;
      return `
      <tr>
        <td>${idx+1}</td>
        <td>${escapeHtml(it.name)}${returned>0?`<div class="sub" style="color:var(--red);">${escapeHtml(this.itemQtyLabel(it,returned))} واپس شده</div>`:''}</td>
        <td class="num">${escapeHtml(this.itemQtyLabelForInvoice(it))}${this.itemBaseNote(it)?`<div class="sub">${escapeHtml(this.itemBaseNote(it))}</div>`:''}</td>
        <td class="num">${pur.currency==='USD'?fmt2(this.itemCostPerTxUnit(it)):fmt(this.itemCostPerTxUnit(it))}<div class="sub">هر ${escapeHtml(this.itemUnitName(it))}${this.itemFactor(it)>1?` · هر ${escapeHtml(it.unit||'عدد')}: ${fmt2(round2(it.unitCost))}`:''}</div></td>
        <td class="num">${pur.currency==='USD'?fmt2(it.qty*it.unitCost):fmt(it.qty*it.unitCost)}</td>
        <td class="no-print">${!cancelled?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"واپس به فروشنده", icon:"rotate-ccw", onClick:()=>App.purchaseReturnItem("${pur.id}",${idx})},
          {label:"افزودن تعداد", icon:"plus", onClick:()=>App.purchaseIncreaseItemQty("${pur.id}",${idx})},
          {label:"کم کردن چند ${escapeHtml(it.unit||'عدد')} (کاستی)", icon:"minus", onClick:()=>App.purchaseShrinkItem("${pur.id}",${idx})}
        ])'>${ic('more-vertical',17)}</span>`:''}</td>
      </tr>`;
    }).join('');

    const returnsHtml = pur.returns && pur.returns.length ? `
      <h2 class="section-title">${ic('rotate-ccw',17)}کالاهای واپس‌شده به فروشنده</h2>
      <div class="card no-print">${pur.returns.map(r=>`<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">${r.date} · ${escapeHtml(r.qtyLabel||(r.qty+' عدد'))}</span></div><div class="r-right num" style="color:var(--red)">-${fmt(r.amount)}</div></div>`).join('')}</div>
    ` : '';

    return `
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.navigate('dashboard')">${ic('home',15)}داشبورد</button>
      <button class="btn btn-primary" onclick="App.printInvoice()">${ic('printer',15)}چاپ</button>
    </div>
    ${!cancelled?`
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.purchaseAddItem('${pur.id}')">${ic('plus',15)}افزودن قلم</button>
      ${pur.remaining>0.5?`<button class="btn btn-outline" onclick="App.forgiveRoundoff('${pur.id}')">${ic('coins',15)}نادیده‌گرفتن خرده‌پول</button>`:''}
      <button class="btn btn-danger" onclick="App.cancelPurchase('${pur.id}')">${ic('ban',15)}کنسل کامل بل خرید</button>
    </div>`:''}
    <div class="card no-print">
      <b style="display:flex;align-items:center;gap:6px;">${ic('camera',16)}عکس بل/فاکتور شرکت</b>
      ${pur.billImage
        ? `<img src="${pur.billImage}" class="bill-thumb" style="margin-top:10px;" onclick="App.viewPurchaseBillImage('${pur.id}')">`
        : `<div class="field-note">هنوز عکسی برای این خرید ثبت نشده.</div>`}
      <button class="btn btn-outline" onclick="App.addPurchaseBillPhoto('${pur.id}')">${ic('camera',16)}${pur.billImage?'تغییر عکس بل':'افزودن عکس بل شرکت'}</button>
    </div>
    <div id="invoice-print" class="card">
      ${cancelled?`<div class="inv-void">${ic('ban',16)}این بل خرید باطل شده است</div>`:''}
      ${!cancelled && pur.currency==='USD'?`<div style="margin-bottom:10px;"><span class="badge gold">${ic('banknote',12)}این بل به دالر ثبت شده</span></div>`:''}
      <div class="inv-head">
        <div class="logo">${s.logoEmoji||'🏪'}</div>
        <div class="biz">${escapeHtml(s.businessName)}</div>
        <div class="doc-kind">${ic('package',12)}سند خرید${cancelled?' — باطل شده':''}</div>
      </div>
      <div class="inv-meta">
        <span>تاریخ: <b class="num">${pur.date}</b></span>
      </div>
      ${this.whoLabel(pur)?`<div class="field-note no-print">${escapeHtml(this.whoLabel(pur))}${pur.lastEditedByEmail?` · آخرین ویرایش: ${escapeHtml([pur.lastEditedByEmail,pur.lastEditedByDevice].filter(Boolean).join(' · '))}`:''}</div>`:''}
      <div class="inv-cust">
        <div class="l1">شرکت / عمده‌فروش: ${escapeHtml(pur.supplierName||'—')}</div>
        ${pur.supplierInvoiceNo?`<div class="l1">شمارهٔ بل عمده‌فروش: <b class="num">${escapeHtml(pur.supplierInvoiceNo)}</b></div>`:''}
        <div class="l1 no-print" style="margin-top:4px;color:var(--gold-d);cursor:pointer;display:flex;align-items:center;gap:5px;" onclick="App.editPurchaseInvoiceNo('${pur.id}')">${ic('pencil',14)}${pur.supplierInvoiceNo?'ویرایش شمارهٔ بل':'ثبت شمارهٔ بل عمده‌فروش'}</div>
      </div>
      <table class="inv-table">
        <thead><tr><th>#</th><th>شرح کالا</th><th>تعداد</th><th>فی واحد</th><th>مجموع</th><th class="no-print"></th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="inv-totals">
        ${pur.currency==='USD'?`<div class="row-item"><div class="r-left">نرخ دالر در روز خرید</div><div class="r-right num">${fmt2(pur.rateAtPurchase||this.usdRate()||0)} ${s.currency}</div></div>`:''}
        ${pur.originalTotal!==undefined && Math.abs(pur.originalTotal-pur.total)>0.5?`<div class="row-item"><div class="r-left">مجموع اولیهٔ بل</div><div class="r-right num">${pur.currency==='USD'?fmt2(pur.originalTotal):fmt(pur.originalTotal)} ${curLbl}</div></div>`:''}
        <div class="row-item"><div class="r-left">مجموع فعلی بل</div><div class="r-right num">${pur.currency==='USD'?fmt2(pur.total):fmt(pur.total)} ${curLbl}${pur.currency==='USD'?` (≈ ${fmt(pur.total*(pur.rateAtPurchase||this.usdRate()||0))} ${s.currency})`:''}</div></div>
        <div class="row-item"><div class="r-left">پرداخت‌شده</div><div class="r-right num" style="color:var(--green)">${pur.currency==='USD'?fmt2(pur.paid):fmt(pur.paid)} ${curLbl}</div></div>
        <div class="row-item"><div class="r-left"><b>${pur.remaining>0.5?'باقیمانده (بدهی ما)':'وضعیت'}</b></div><div class="r-right num" style="color:${pur.remaining>0.5?'var(--red)':'var(--green)'}"><b>${cancelled?'باطل شده':(pur.remaining>0.5?(pur.currency==='USD'?fmt2(pur.remaining):fmt(pur.remaining))+' '+curLbl:`<span class="inv-stamp">${ic('check',12)}تسویه‌شده</span>`)}</b></div></div>
        ${!cancelled && pur.currency==='USD' && pur.remaining>0.5 && this.usdRate()>0?`<div class="row-item"><div class="r-left">معادل باقیمانده به نرخ امروز</div><div class="r-right num" style="color:var(--red)">${fmt(pur.remaining*this.usdRate())} ${s.currency}</div></div>`:''}
      </div>
      ${pur.note?`<div class="inv-note">یادداشت: ${escapeHtml(pur.note)}</div>`:''}
    </div>
    ${returnsHtml}
    `;
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
        {key:'qty', label:'تعداد مرجوعی', type:'number', step:'0.01', value:round2(sellable/defFactor)}
      ],
      submitLabel:'ثبت مرجوعی',
      onSubmit: (v)=>{
        const u=ladder.find(x=>x.name===v.unit)||ladder[ladder.length-1];
        const baseQty=round2((Number(v.qty)||0)*u.factor);
        if(!baseQty || baseQty<=0 || baseQty>sellable+1e-9) throw new Error('تعداد نامعتبر است — حداکثر '+this.itemQtyLabel(it,sellable)+'.');
        this._applySaleReturn(sale, idx, baseQty, fmtQty(v.qty)+' '+u.name);
        this.toast('مرجوعی ثبت شد');
      }
    });
  },
  _applySaleReturn(sale, idx, qty, qtyLabel){
    const it=sale.items[idx];
    const refund = round2(qty*it.unitPrice);
    const refundCost = round2(qty*(it.cost||0));
    const oldRemaining = sale.total-sale.paid;
    const debtReduction = Math.min(refund, Math.max(0,oldRemaining));
    const cashRefund = refund-debtReduction;

    const newItems = sale.items.map((x,i)=> i===idx ? {...x, returnedQty:(x.returnedQty||0)+qty} : x);
    const newReturns = [...sale.returns, {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty, qtyLabel: qtyLabel||this.itemQtyLabel(it,qty), unitPrice:it.unitPrice, amount:refund}];

    const newTotal = round2(sale.total-refund), newPaid = round2(sale.paid-cashRefund);
    const batch = writeBatch(db);
    batch.update(doc(cols.sales, sale.id), {
      items: newItems, returns: newReturns,
      total: newTotal, totalCost: sale.totalCost-refundCost, profit: newTotal-(sale.totalCost-refundCost),
      paid: newPaid, remaining: newTotal-newPaid, ...this.editMeta()
    });
    if(sale.customerId && debtReduction>0){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(-debtReduction) });
    }
    batch.update(doc(cols.products, it.productId), { stock: increment(qty) });
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا در ثبت مرجوعی؛ دوباره تلاش کنید.'); });
  },
  cancelSale(saleId){
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
    let customerDebtReduction=0;
    const newItems=[...sale.items];
    const newReturns=[...sale.returns];
    const stockDeltas={};
    sale.items.forEach((it,idx)=>{
      const sellable=it.qty-(it.returnedQty||0);
      if(sellable<=0) return;
      const refund=sellable*it.unitPrice, refundCost=sellable*(it.cost||0);
      const oldRemaining=runningTotal-runningPaid;
      const debtReduction=Math.min(refund, Math.max(0,oldRemaining));
      const cashRefund=refund-debtReduction;
      newItems[idx]={...it, returnedQty:(it.returnedQty||0)+sellable};
      newReturns.push({id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty:sellable, qtyLabel:this.itemQtyLabel(it,sellable), unitPrice:it.unitPrice, amount:refund});
      runningTotal-=refund; runningPaid-=cashRefund; runningCost-=refundCost;
      customerDebtReduction+=debtReduction;
      stockDeltas[it.productId]=(stockDeltas[it.productId]||0)+sellable;
    });

    const batch=writeBatch(db);
    batch.update(doc(cols.sales, sale.id), {
      items:newItems, returns:newReturns, status:'cancelled',
      total:runningTotal, totalCost:runningCost, profit:runningTotal-runningCost,
      paid:runningPaid, remaining:runningTotal-runningPaid, ...this.editMeta()
    });
    if(sale.customerId && customerDebtReduction>0){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(-customerDebtReduction) });
    }
    Object.keys(stockDeltas).forEach(pid=>{
      batch.update(doc(cols.products, pid), { stock: increment(stockDeltas[pid]) });
    });
    batch.commit().then(()=>this.toast('فاکتور باطل شد')).catch(e=>{ console.error(e); App.toastError('خطا در باطل کردن فاکتور؛ دوباره تلاش کنید.'); });
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

        const batch=writeBatch(db);
        batch.update(doc(cols.sales, sale.id), {
          items:newItems, total:newTotal, originalTotal: increment(addAmount),
          totalCost:newTotalCost, profit:newTotal-newTotalCost, paid:newPaid, remaining:newTotal-newPaid, ...this.editMeta()
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
    const oldRemaining  = (Number(sale.total)||0)-(Number(sale.paid)||0);
    const debtReduction = Math.min(amount, Math.max(0, oldRemaining));
    const cashRefund    = round2(amount-debtReduction);

    const newItems = sale.items.map((x,i)=> i===idx
      ? {...x, qty: round2((Number(x.qty)||0)-qty), adjBase: round2((Number(x.adjBase)||0)+qty), adjNote: note||x.adjNote||''}
      : x);
    const newTotal = round2((Number(sale.total)||0)-amount);
    const newCost  = round2((Number(sale.totalCost)||0)-costBack);
    const newPaid  = round2((Number(sale.paid)||0)-cashRefund);
    const log = [...(sale.adjustments||[]), {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx,
      name:it.name, qty, unit:(it.unit||'عدد'), mode, note:note||'', amount}];

    const batch=writeBatch(db);
    batch.update(doc(cols.sales, sale.id), {
      items:newItems, adjustments:log,
      total:newTotal, totalCost:newCost, profit:round2(newTotal-newCost),
      paid:newPaid, remaining:round2(newTotal-newPaid), ...this.editMeta()
    });
    if(sale.customerId && debtReduction>0){
      batch.update(doc(cols.customers, sale.customerId), { balance: increment(-debtReduction) });
    }
    if(mode==='back' && it.productId){
      batch.update(doc(cols.products, it.productId), { stock: increment(qty) });
    }
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا در اصلاح این قلم؛ دوباره تلاش کنید.'); });
  },
  // تبدیل بخشی یا کل «باقی‌مانده» یک فاکتور به «تخفیف» به‌جای بدهی مشتری.
  // مثال: مجموع ۱۳۰۵ شده ولی فقط ۱۳۰۰ از مشتری می‌گیرید — ۵ افغانی باقی‌مانده
  // را با این دکمه به‌عنوان تخفیف می‌بخشید تا در «طلب از مشتریان» باقی نماند.
  applySaleDiscount(saleId){
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
    const sorted=[...this.state.products].sort((a,b)=>String(a.name).localeCompare(String(b.name),'fa'));
    return '<option value="">— انتخاب از فهرست محصولات —</option>' +
      sorted.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — موجودی: ${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</option>`).join('');
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
    const ladder=this.productUnits(p);
    const base=p.unit||'عدد';
    sel.innerHTML=ladder.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' — '+fmtQty(u.factor)+' '+escapeHtml(base):''}</option>`).join('');
    sel.value = this._aiMode==='purchase'
      ? ladder[0].name
      : ((p.defaultSaleUnit && ladder.some(u=>u.name===p.defaultSaleUnit)) ? p.defaultSaleUnit : ladder[ladder.length-1].name);
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
    if(noteEl) noteEl.textContent = (p && u && u.factor>1) ? ('۱ '+u.name+' = '+fmtQty(u.factor)+' '+(p.unit||'عدد')) : '';
    const qtyEl=document.getElementById('ai-qty');
    const qty=qtyEl?(parseFloat(qtyEl.value)||0):0;
    const qh=document.getElementById('ai-qty-hint');
    if(qh) qh.textContent = (p && u && u.factor>1 && qty>0) ? ('= '+fmtQty(round2(qty*u.factor))+' '+(p.unit||'عدد')) : (p?('موجودی: '+this.qtyBreakdown(p,p.stock||0)):'');
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
        const batch=writeBatch(db);
        batch.update(doc(cols.products, product.id), { stock: increment(-qty) });
        const newItem={productId:product.id, name:product.name, unit:product.unit, qty, unitPrice:perBase, cost, returnedQty:0, txUnit:u.name, txFactor:u.factor};
        const newItems=[...sale.items, newItem];
        const newTotal=round2(sale.total+addAmount), newPaid=round2(sale.paid+addPaid), newTotalCost=round2(sale.totalCost+qty*cost);
        batch.update(doc(cols.sales, sale.id), {
          items:newItems, total:newTotal, originalTotal: increment(addAmount),
          totalCost:newTotalCost, profit:round2(newTotal-newTotalCost), paid:newPaid, remaining:round2(newTotal-newPaid), ...this.editMeta()
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
        this._applyPurchaseReturn(pur, idx, baseQty, fmtQty(v.qty)+' '+u.name);
        this.toast('ثبت شد');
      }
    });
  },
  _applyPurchaseReturn(pur, idx, qty, qtyLabel){
    const it=pur.items[idx];
    const refund=round2(qty*it.unitCost);
    const oldRemaining=pur.total-pur.paid;
    const debtReduction=Math.min(refund, Math.max(0,oldRemaining));
    const cashRefund=refund-debtReduction;
    const newItems = pur.items.map((x,i)=> i===idx ? {...x, returnedQty:(x.returnedQty||0)+qty} : x);
    const newReturns = [...pur.returns, {id:uid(), ts:Date.now(), date:todayISO(), itemIndex:idx, name:it.name, qty, qtyLabel: qtyLabel||this.itemQtyLabel(it,qty), unitCost:it.unitCost, amount:refund}];
    const newTotal=round2(pur.total-refund), newPaid=round2(pur.paid-cashRefund);

    const batch=writeBatch(db);
    batch.update(doc(cols.purchases, pur.id), { items:newItems, returns:newReturns, total:newTotal, paid:newPaid, remaining:newTotal-newPaid, ...this.editMeta() });
    if(pur.supplierId && debtReduction>0){
      const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
      batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-debtReduction) });
    }
    batch.update(doc(cols.products, it.productId), { stock: increment(-qty) });
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
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
    const batch=writeBatch(db);

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
      batch.set(doc(cols.expenses, expId), {id:expId, ts:Date.now(), date:todayISO(),
        category:'کاستی و ضایعات جنس', amount:amountAFN,
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

    const batch=writeBatch(db);
    batch.update(doc(cols.purchases, pur.id), { items:newItems, returns:newReturns, status:'cancelled', total:runningTotal, paid:runningPaid, remaining:runningTotal-runningPaid, ...this.editMeta() });
    if(pur.supplierId && supplierDebtReduction>0){
      const balField = pur.currency==='USD' ? 'balanceUSD' : 'balance';
      batch.update(doc(cols.suppliers, pur.supplierId), { [balField]: increment(-supplierDebtReduction) });
    }
    Object.keys(stockDeltas).forEach(pid=>{
      batch.update(doc(cols.products, pid), { stock: increment(stockDeltas[pid]) });
    });
    batch.commit().then(()=>this.toast('بل خرید باطل شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
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

        const batch=writeBatch(db);
        batch.update(doc(cols.purchases, pur.id), { items:newItems, total:newTotal, originalTotal: increment(addAmount), paid:newPaid, remaining:newTotal-newPaid, ...this.editMeta() });
        if(p){
          const unitCostAFN = pur.currency==='USD' ? it.unitCost*((Number(pur.rateAtPurchase)||this.usdRate())||0) : it.unitCost;
          const newStock=p.stock+qty;
          const newAvgCost = newStock>0 ? ((p.stock*p.avgCost)+(qty*unitCostAFN))/newStock : unitCostAFN;
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
        const batch=writeBatch(db);
        const newStock=(Number(product.stock)||0)+qty;
        const newAvgCost = newStock>0 ? round4((((Number(product.stock)||0)*(Number(product.avgCost)||0))+(qty*unitCostAFN))/newStock) : unitCostAFN;
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
  renderCustomers(){
    const sub = this.sub || 'customers';
    if(this.detailId){
      return this.renderPartyDetail();
    }
    if(sub==='suppliers' && !this.canSeeBooks()) return this.renderNoAccess('شرکت‌ها / عمده‌فروشان');
    const listArr = sub==='customers' ? this.state.customers : this.state.suppliers;
    const sorted = [...listArr].sort((a,b)=>(b.balance||0)-(a.balance||0));
    const totalKey = sub==='customers' ? this.totalReceivable() : this.totalPayable();
    const rows = sorted.length ? sorted.map(c=>{
      const bal=c.balance||0;
      let badge;
      if(sub==='suppliers'){
        const balUSD=c.balanceUSD||0;
        const parts=[];
        if(Math.abs(bal)>0.5) parts.push(`<span class="badge ${bal>0.5?'red':'green'} num">${fmt(Math.abs(bal))}${bal<-0.5?' طلب شما':''}</span>`);
        if(Math.abs(balUSD)>0.5) parts.push(`<span class="badge ${balUSD>0.5?'red':'green'} num">$${fmt(Math.abs(balUSD))}${balUSD<-0.5?' طلب شما':''}</span>`);
        badge = parts.length ? parts.join(' ') : `<span class="badge gold">تسویه</span>`;
      } else {
        badge = bal>0.5 ? `<span class="badge red num">${fmt(bal)}</span>` : (bal<-0.5? `<span class="badge green num">${fmt(-bal)}- طلب شما</span>` : `<span class="badge gold">تسویه</span>`);
      }
      return `<div class="row-item">
        <div class="r-left" onclick="App.openParty('${sub}','${c.id}')" style="cursor:pointer;">
          <b>${escapeHtml(c.name)}</b>${c.phone?`<span class="sub">${escapeHtml(c.phone)}</span>`:''}${c.address?`<span class="sub">${escapeHtml(c.address)}</span>`:''}
        </div>
        <div class="r-right" style="display:flex;align-items:center;gap:10px;">
          ${badge}
          <span class="icon-btn" onclick="event.stopPropagation(); App.editParty('${sub}','${c.id}')" title="ویرایش">${ic('pencil',16)}</span>
        </div>
      </div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic(sub==='customers'?'users':'factory',26)}</span><b>${sub==='customers'?'هنوز مشتری‌ای ثبت نشده':'هنوز عمده‌فروش/شرکتی ثبت نشده'}</b>با دکمهٔ بالا اضافه کنید، یا با ثبت اولین فروش/خرید خودکار ساخته می‌شود</div>`;

    return `
    <h2 class="section-title" style="margin-top:0;">${ic('users',17)}مشتریان و فروشندگان</h2>
    <div class="tabbar-sub">
      <button class="${sub==='customers'?'active':''}" onclick="App.navigate('customers','customers')">مشتریان</button>
      ${this.canSeeBooks()?`<button class="${sub==='suppliers'?'active':''}" onclick="App.navigate('customers','suppliers')">شرکت‌ها / عمده‌فروشان</button>`:''}
    </div>
    <button class="btn btn-outline" onclick="App.addPartyManual('${sub}')">${ic('user-plus',16)}افزودن ${sub==='customers'?'مشتری':'شرکت/عمده‌فروش'} جدید</button>
    <div class="card" style="text-align:center;margin-top:12px;">
      <div class="field-note">مجموع ${sub==='customers'?'طلب از مشتریان':'بدهی به عمده‌فروشان ('+this.state.settings.currency+')'}</div>
      <div class="num" style="font-size:20px;font-weight:800;color:${sub==='customers'?'var(--green)':'var(--red)'}">${fmt(totalKey)} ${sub==='customers'?this.state.settings.currency:''}</div>
      ${sub==='suppliers'?`<div class="field-note" style="margin-top:10px;">مجموع بدهی به عمده‌فروشان (دالر)</div>
      <div class="num" style="font-size:20px;font-weight:800;color:var(--red)">$${fmt2(this.totalPayableUSD())}</div>
      ${this.totalPayableUSD()!==0?`<div class="field-note" style="margin-top:10px;">مجموع کل بدهی به ${this.state.settings.currency} (شامل تبدیل دالر به نرخ امروز)</div>
      <div class="num" style="font-size:18px;font-weight:800;color:var(--gold-d);">${this.usdRate()>0?fmt(this.totalPayableCombinedAFN())+' '+this.state.settings.currency:'نرخ دالر تنظیم نشده'}</div>`:''}
      <div class="field-note" style="margin-top:10px;">نرخ فعلی دالر: <b class="num">${this.usdRate()>0?fmt2(this.usdRate()):'—'}</b> <span onclick="App.quickSetUsdRate()" style="cursor:pointer;color:var(--gold-d);text-decoration:underline;">ویرایش نرخ</span></div>`:''}
    </div>
    <div class="card">${rows}</div>
    `;
  },
  openParty(type,id){ this.sub=type; this.detailId=id; this.payFormOpen=false; this.render(); },
  closeParty(){ this.detailId=null; this.payFormOpen=false; this.render(); },
  renderPartyDetail(){
    const type=this.sub;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p = arr.find(x=>x.id===this.detailId);
    if(!p){ this.detailId=null; return this.renderCustomers(); }
    let history=[];
    if(type==='customers'){
      history = this.state.sales.filter(s=>s.customerId===p.id).map(s=>({date:s.date,ts:s.ts,label:'فروش '+this.invoiceNoLabel(s.id),amount:s.total,paid:s.paid,saleId:s.id,status:s.status,currency:'AFN'}));
    } else {
      history = this.state.purchases.filter(s=>s.supplierId===p.id).map(s=>({date:s.date,ts:s.ts,label:'خرید'+(s.currency==='USD'?' (دالر)':''),amount:s.total,paid:s.paid,purchaseId:s.id,status:s.status,currency:s.currency||'AFN'}));
    }
    const pays = this.state.payments.filter(x=>x.partyId===p.id).map(x=>({date:x.date,ts:x.ts,label:(x.type==='receive'?'دریافت پول':'پرداخت پول')+(x.currency==='USD'?' (دالر)':''),amount:x.amount,paid:null,isPayment:true,paymentId:x.id,receiptImage:x.receiptImage||null,who:this.whoLabel(x),currency:x.currency||'AFN'}));
    const openings = (this.state.openingEntries||[]).filter(x=>x.partyId===p.id).map(x=>({date:x.date,ts:x.ts,label:'بدهی افتتاحیه (قبل از سیستم)'+(x.currency==='USD'?' (دالر)':''),amount:x.amount,isOpening:true,currency:x.currency||'AFN'}));
    history = [...history,...pays,...openings].sort((a,b)=>(b.ts||0)-(a.ts||0));

    const rows = history.length ? history.map(h=>{
      const f = h.currency==='USD' ? fmt2 : fmt;
      if(h.isPayment){
        const color = (type==='customers') ? 'var(--green)' : 'var(--red)';
        const photoBtn = h.receiptImage
          ? `<span class="icon-btn" onclick="App.viewPaymentReceipt('${h.paymentId}')" title="مشاهده عکس رسید">${ic('image',15)}</span>`
          : `<span class="icon-btn" onclick="App.addPaymentReceiptPhoto('${h.paymentId}')" title="افزودن عکس رسید">${ic('camera',15)}</span>`;
        return `<div class="row-item"><div class="r-left"><b>${h.label}</b>${photoBtn}<span class="sub">${h.date}</span>${h.who?`<span class="sub" style="opacity:.75;">${escapeHtml(h.who)}</span>`:''}</div><div class="r-right num" style="color:${color}">${f(h.amount)}</div></div>`;
      }
      if(h.isOpening){
        return `<div class="row-item"><div class="r-left"><b>${h.label}</b><span class="sub">${h.date}</span></div><div class="r-right num" style="color:var(--gold-d)">${f(h.amount)}</div></div>`;
      }
      const clickAttr = h.saleId ? ` onclick="App.viewInvoice('${h.saleId}')" style="cursor:pointer;"` : (h.purchaseId ? ` onclick="App.viewPurchase('${h.purchaseId}')" style="cursor:pointer;"` : '');
      const cancelledTag = h.status==='cancelled' ? ' <span class="badge gold">باطل شده</span>' : '';
      return `<div class="row-item"${clickAttr}><div class="r-left"><b>${h.label} — مجموع ${f(h.amount)}</b>${cancelledTag}<span class="sub">${h.date} · پرداخت‌شده: ${f(h.paid)}</span></div><div class="r-right num" style="color:var(--red)">${f(h.amount-h.paid)}</div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('history',24)}</span>هنوز معامله‌ای با این ${type==='customers'?'مشتری':'عمده‌فروش'} ثبت نشده</div>`;

    const actionLabel = type==='customers' ? 'دریافت پول از مشتری' : 'پرداخت پول به عمده‌فروش';

    return `
    <button class="back-btn" onclick="App.closeParty()">${ic('chevron-right',16)}بازگشت به فهرست</button>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b style="font-size:16px;">${escapeHtml(p.name)}</b>
        <span class="badge ${p.balance>0.5?'red':'green'} num">${fmt(Math.abs(p.balance||0))} ${p.balance>0.5?'بدهکار':((p.balance||0)<-0.5?'طلبکار':'تسویه')}</span>
      </div>
      ${type==='suppliers' && Math.abs(p.balanceUSD||0)>0.5 ? `<div style="margin-top:6px;text-align:left;"><span class="badge ${p.balanceUSD>0.5?'red':'green'} num">$${fmt2(Math.abs(p.balanceUSD))} ${p.balanceUSD>0.5?'بدهکار (دالر)':'طلبکار (دالر)'}</span>${this.usdRate()>0?`<div class="sub" style="margin-top:2px;">معادل امروز: ${fmt(Math.abs(p.balanceUSD)*this.usdRate())} ${this.state.settings.currency} (به نرخ ${fmt2(this.usdRate())})</div>`:`<div class="sub" style="margin-top:2px;color:var(--red);">نرخ دالر تنظیم نشده — <span onclick="App.quickSetUsdRate()" style="cursor:pointer;text-decoration:underline;">تنظیم کنید</span></div>`}</div>` : ''}
      ${p.phone?`<div class="sub" style="margin-top:6px;display:flex;align-items:center;gap:5px;">${ic('phone',13)}<span class="num">${escapeHtml(p.phone)}</span></div>`:''}
      ${p.address?`<div class="sub" style="display:flex;align-items:center;gap:5px;">${ic('map-pin',13)}${escapeHtml(p.address)}</div>`:''}
      <div class="grid2" style="margin-top:12px;">
        <button class="btn btn-outline" style="margin-top:0;" onclick="App.editParty('${type}','${p.id}')">${ic('pencil',15)}ویرایش</button>
        <button class="btn btn-danger" style="margin-top:0;" onclick="App.deleteParty('${type}','${p.id}')">${ic('trash',15)}حذف</button>
      </div>
      <button class="btn btn-green" onclick="App.recordPartyPayment('${type}','${p.id}')">${ic(type==='customers'?'arrow-left':'arrow-right',16)}${actionLabel}</button>
      <button class="btn btn-outline" onclick="App.setOpeningBalance('${type}','${p.id}')">${ic('clipboard',16)}ثبت/اصلاح بدهی افتتاحیه (قبل از سیستم)</button>
      ${this.payFormOpen ? `
      <div class="subpanel">
        <div>
          ${type==='suppliers' ? `<label>ارز پرداخت</label>
          <select id="pay-currency">
            <option value="AFN">${this.state.settings.currency} (افغانی)</option>
            <option value="USD">دالر</option>
          </select>
          <div class="field-note">نرخ فعلی دالر: <b class="num">${this.usdRate()>0?fmt2(this.usdRate()):'تنظیم نشده'}</b> <span onclick="App.quickSetUsdRate()" style="cursor:pointer;color:var(--gold-d);">ویرایش</span></div>` : ''}
          <label>${type==='customers'?'مبلغ دریافتی از مشتری':'مبلغ پرداختی به شرکت/عمده‌فروش'}</label>
          <input id="pay-amount" type="number" inputmode="decimal" step="0.01" placeholder="0">
          <label>تاریخ</label>
          <input id="pay-date" type="date" value="${todayISO()}">
          <label>عکس رسید ${type==='suppliers'?'(پیشنهاد می‌شود ضمیمه کنید)':'(اختیاری)'}</label>
          <input id="pay-photo" type="file" accept="image/*" capture="environment">
          <div class="grid2" style="margin-top:10px;">
            <button class="btn btn-outline" style="margin-top:0;" onclick="App.cancelPartyPaymentForm()">انصراف</button>
            <button class="btn btn-primary" style="margin-top:0;" onclick="App.submitPartyPayment('${type}','${p.id}')">${ic('check',16)}ثبت</button>
          </div>
        </div>
      </div>` : ''}
    </div>
    <h2 class="section-title">سابقهٔ معاملات (${history.length})</h2>
    <div class="card">${rows}</div>
    `;
  },
  recordPartyPayment(type,id){
    this.payFormOpen = true;
    this.render();
  },
  cancelPartyPaymentForm(){ this.payFormOpen=false; this.render(); },
  async submitPartyPayment(type,id){
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
    const batch=writeBatch(db);
    batch.update(doc(cols[colName], id), { [balField]: increment(-amt) });
    const paymentId=uid();
    const paymentDoc = {id:paymentId, ts:Date.now(), date, type: type==='customers'?'receive':'pay', partyType:type==='customers'?'customer':'supplier', partyId:id, partyName:p.name, amount:amt, currency, ...this.recordMeta()};
    if(currency==='USD') paymentDoc.rate = payRate;
    if(receiptImage) paymentDoc.receiptImage = receiptImage;
    batch.set(doc(cols.payments, paymentId), paymentDoc);
    batch.commit().catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
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
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p=arr.find(x=>x.id===id); if(!p) return;
    const hasDebt = Math.abs(p.balance||0)>0.5 || (type==='suppliers' && Math.abs(p.balanceUSD||0)>0.5);
    if(hasDebt){ this.toast('این مشتری/فروشنده هنوز بدهی یا طلب دارد؛ ابتدا حساب را تسویه کنید.'); return; }
    this.openConfirmModal({
      title:'حذف از فهرست',
      msg:'«'+p.name+'» از فهرست حذف شود؟ سابقهٔ فاکتورهای قبلی آن باقی می‌ماند.',
      danger:true, confirmLabel:'حذف شود',
      onConfirm: ()=>{
        const colName = type==='customers' ? 'customers' : 'suppliers';
        deleteDoc(doc(cols[colName], id)).then(()=>this.toast('حذف شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
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
    return [...this.state.products].filter(p=>this.isLowStock(p)).sort((a,b)=>(a.stock||0)-(b.stock||0));
  },
  renderMore(){
    if(this.sub==='settings' && !this.isOwner()){
      return this.renderNoAccess('تنظیمات');
    }
    if(this.sub==='reports' && !this.canSeeReports()){
      return this.renderNoAccess('گزارش سود');
    }
    if((this.sub==='expenses' || this.sub==='lowstock') && !this.canSeeBooks() && this.sub==='expenses'){
      return this.renderNoAccess('مصارف');
    }
    if(this.sub==='expenses') return this.renderExpenses();
    if(this.sub==='reports') return this.renderReports();
    if(this.sub==='products') return this.renderProducts();
    if(this.sub==='settings') return this.renderSettings();
    if(this.sub==='history') return this.renderFullHistory();
    if(this.sub==='lowstock') return this.renderLowStock();
    const lowCount = this.lowStockList().length;
    return `
    <h2 class="section-title" style="margin-top:0;">${ic('menu',17)}بیشتر</h2>
    <div class="more-list">
      <button onclick="App.navigate('more','lowstock')"><span class="ic">${ic('alert-triangle',17)}</span><span class="lbl">کالاهای کم‌موجود/تمام‌شده ${lowCount?`<span class="stock-badge">${lowCount}</span>`:''}</span><span class="chev">${ic('chevron-left',17)}</span></button>
      <button onclick="App.navigate('more','history')"><span class="ic">${ic('history',17)}</span><span class="lbl">تاریخچهٔ کامل معاملات</span><span class="chev">${ic('chevron-left',17)}</span></button>
      ${this.canSeeBooks()?`<button onclick="App.navigate('more','expenses')"><span class="ic">${ic('banknote',17)}</span><span class="lbl">مصارف روزانه و برداشت شخصی</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      ${this.canSeeReports()?`<button onclick="App.navigate('more','reports')"><span class="ic">${ic('bar-chart',17)}</span><span class="lbl">گزارش سود روزانه / هفته‌وار / ماهوار</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      <button onclick="App.navigate('more','products')"><span class="ic">${ic('archive',17)}</span><span class="lbl">${this.isOwner()?'مدیریت محصولات و موجودی':'مشاهدهٔ محصولات و موجودی (فقط خواندنی)'}</span><span class="chev">${ic('chevron-left',17)}</span></button>
      ${this.isOwner()?`<button onclick="App.navigate('more','settings')"><span class="ic">${ic('settings',17)}</span><span class="lbl">تنظیمات و پشتیبان‌گیری</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      ${this.user?`<button onclick="App.lockNow()"><span class="ic">${ic('lock',17)}</span><span class="lbl">قفل صفحه</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      <button class="danger" onclick="App.logout()"><span class="ic">${ic('log-out',17)}</span><span class="lbl">خروج از حساب <span class="sub" style="font-size:var(--fs-xs);color:var(--ink-500);">${escapeHtml(this.user?this.user.email:'')}</span></span></button>
    </div>
    `;
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
    this.openConfirmModal({ title:'حذف مصرف', msg:'این مصرف حذف شود؟', danger:true, confirmLabel:'حذف شود',
      onConfirm: ()=> deleteDoc(doc(cols.expenses, id)).then(()=>this.toast('حذف شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); })
    });
  },
  renderExpenses(){
    const today = todayISO();
    const sorted = [...this.state.expenses].sort((a,b)=>(b.ts||0)-(a.ts||0));
    const rows = sorted.length ? sorted.slice(0,40).map(e=>{
      const isW = e.category===WITHDRAWAL_CATEGORY;
      const subParts=[e.date];
      if(isW && e.withdrawnBy) subParts.push('برداشت‌کننده: '+e.withdrawnBy);
      if(e.note) subParts.push(e.note);
      const who=this.whoLabel(e);
      return `<div class="row-item"><span class="avt neu">${ic(isW?'hand-coins':'banknote',16)}</span><div class="r-left"><b>${escapeHtml(e.category)}</b><span class="sub">${subParts.map(escapeHtml).join(' · ')}</span>${who?`<span class="sub">${escapeHtml(who)}</span>`:''}</div>
      <div class="r-right"><span class="num" style="color:var(--red)">-${fmt(e.amount)}</span><span class="icon-btn danger" onclick="App.deleteExpense('${e.id}')" title="حذف">${ic('trash',15)}</span></div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('banknote',24)}</span>هنوز مصرفی ثبت نشده</div>`;

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('banknote',17)}ثبت مصرف روزانه / برداشت شخصی</h2>
    <div class="card">
      <label>نوع مصرف</label>
      <select id="exp-category" onchange="App.onExpenseCategoryChange()">
        <option value="کرایه">کرایه دکان/گدام</option>
        <option value="تیل/بنزین">تیل / بنزین موتر</option>
        <option value="تعمیرات">تعمیرات موتر</option>
        <option value="معاش">معاش کارمند</option>
        <option value="حمل و نقل">کرایه حمل و نقل بار</option>
        <option value="${WITHDRAWAL_CATEGORY}">برداشت شخصی (مالک/شریک)</option>
        <option value="__other__">متفرقه / دیگر</option>
      </select>
      <div id="exp-other-wrap" style="display:none;"><label>نام مصرف</label><input id="exp-other" placeholder="مثلاً چای و نان"></div>
      <div id="exp-withdrawn-wrap" style="display:none;">
        <label>نام شخصی که این پول را برداشت کرده</label>
        <input id="exp-withdrawn-by" placeholder="مثلاً رضوان یا یحیی مرادی">
        <div class="field-note">این مقدار به‌عنوان مصرف واقعی کسب‌وکار حساب نمی‌شود و در محاسبهٔ سود خالص کم نمی‌گردد؛ فقط از موجودی نقد کسر می‌شود و در گزارش‌ها جدا نشان داده می‌شود.</div>
      </div>
      <div class="grid2">
        <div><label>مبلغ</label><input id="exp-amount" type="number" inputmode="decimal" placeholder="0"></div>
        <div><label>تاریخ</label><input id="exp-date" type="date" value="${today}"></div>
      </div>
      <label>یادداشت (اختیاری)</label>
      <input id="exp-note" placeholder="توضیح کوتاه">
      <button class="btn btn-primary" onclick="App.submitExpense()">${ic('check',17)}ثبت</button>
    </div>
    <div class="eyebrow"><span>آخرین مصارف و برداشت‌ها</span></div>
    <div class="card">${rows}</div>
    `;
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
    const unit=gs('np-unit')||'عدد';
    const stock=gn('np-stock');
    const cost=gn('np-cost');
    const sell=gn('np-sell');
    const midUnit=gs('np-midunit'), midPer=gn('np-midper');
    const packUnit=gs('np-packunit'), packPer=gn('np-packper');
    const hasMid=!!(midUnit && midPer>1);
    const packSize=(packUnit && packPer>0) ? (hasMid?round2(packPer*midPer):packPer) : 0;
    if(!name){ this.toast('نام محصول را بنویسید'); return; }
    const pid=uid();
    setDoc(doc(cols.products, pid), {id:pid, name, unit, stock, avgCost:cost, sellPrice:sell,
      midUnit:hasMid?midUnit:'', midPer:hasMid?midPer:0,
      packUnit:packSize>1?packUnit:'', packSize:packSize>1?packSize:0,
      sellPriceMid:0, sellPricePack:0, defaultSaleUnit:packSize>0?packUnit:(hasMid?midUnit:unit),
      ...this.recordMeta()}).then(()=>this.toast('محصول اضافه شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); });
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
        {key:'name', label:'نام محصول', type:'text', value:p.name},
        {key:'unit', label:'واحد پایه (که موجودی بر اساس آن است)', type:'text', value:p.unit},
        {key:'sellPrice', label:'قیمت فروش یک '+(p.unit||'عدد'), type:'number', value:p.sellPrice, hint:'برای تنظیم کارتن/قوطی/بسته و قیمت هر کدام، از گزینهٔ «ویرایش واحدها و قیمت‌ها» استفاده کنید.'}
      ],
      submitLabel:'ذخیره',
      onSubmit:(v)=>{
        const name=(v.name||'').trim()||p.name, unit=(v.unit||'').trim()||p.unit;
        return updateDoc(doc(cols.products, id), { name, unit, sellPrice: v.sellPrice||0, ...this.editMeta() }).then(()=>this.toast('ذخیره شد'));
      }
    });
  },
  /* =========================================================
     ویرایش واحدهای تو در تو و قیمت‌های یک محصول موجود در انبار
     (کارتن ← قوطی/بسته ← عدد + قیمت خرید و قیمت فروش هر واحد)
     ========================================================= */
  editProductUnits(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند واحدها و قیمت‌ها را ویرایش کند.'); return; }
    const p=this.state.products.find(x=>x.id===id); if(!p) return;
    this._puId=id;
    const ladder=this.productUnits(p);
    const packU=ladder.find(u=>u.key==='pack');
    const midU=ladder.find(u=>u.key==='mid');
    const packPer = packU ? round2(packU.factor/(midU?midU.factor:1)) : '';
    const body = `
    <label>واحد پایه — کوچک‌ترین واحدی که می‌فروشید</label>
    <input id="pu-base" value="${escapeHtml(p.unit||'عدد')}" placeholder="عدد" oninput="App.previewProductUnits()">
    <hr class="divider">
    <b style="font-size:13.5px;">بسته‌بندی</b>
    <div class="grid2">
      <div><label>نام واحد بزرگ (اختیاری)</label><input id="pu-pack" value="${escapeHtml(packU?packU.name:'')}" placeholder="کارتن" oninput="App.previewProductUnits()"></div>
      <div><label id="pu-packper-label">هر کارتن حاوی چند؟</label><input id="pu-packper" type="number" inputmode="decimal" step="0.01" value="${packPer}" placeholder="6" oninput="App.previewProductUnits()"></div>
    </div>
    <div class="grid2">
      <div><label>نام واحد میانی (اختیاری)</label><input id="pu-mid" value="${escapeHtml(midU?midU.name:'')}" placeholder="قوطی / بسته" oninput="App.previewProductUnits()"></div>
      <div><label id="pu-midper-label">هر قوطی حاوی چند عدد؟</label><input id="pu-midper" type="number" inputmode="decimal" step="0.01" value="${midU?midU.factor:''}" placeholder="24" oninput="App.previewProductUnits()"></div>
    </div>
    <div class="field-note">اگر کارتن مستقیم عدد دارد (مثل کوکو سطلی ۱۷ عددی)، واحد میانی را خالی بگذارید.</div>
    <hr class="divider">
    <b style="font-size:13.5px;">قیمت خرید (تمام‌شده)</b>
    <div class="grid2">
      <div><label>مبلغ</label><input id="pu-cost" type="number" inputmode="decimal" step="0.01" value="${round2(p.avgCost||0)}" oninput="App.previewProductUnits()"></div>
      <div><label>برای هر</label><select id="pu-costunit" onchange="App.previewProductUnits()"></select></div>
    </div>
    <div class="field-note">قیمت خرید یک کارتن را بنویسید و واحد «کارتن» را انتخاب کنید؛ قیمت تمام‌شدهٔ قوطی/بسته و عدد خودکار حساب می‌شود.</div>
    <hr class="divider">
    <b style="font-size:13.5px;">قیمت فروش</b>
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
    <div>
      <label id="pu-lbl-sell-base">قیمت فروش هر عدد</label>
      <input id="pu-sell-base" type="number" inputmode="decimal" step="0.01" value="${round2(p.sellPrice||0)}" oninput="App.previewProductUnits()">
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
      },
      onSubmit: ()=> this.saveProductUnits(id)
    });
  },
  // خواندن وضعیت فعلی فرم واحدها (بدون ذخیره)
  _puRead(){
    const gs=id=>{ const el=document.getElementById(id); return el?String(el.value||'').trim():''; };
    const gn=id=>{ const el=document.getElementById(id); const v=el?parseFloat(el.value):NaN; return isNaN(v)?0:v; };
    const base=gs('pu-base')||'عدد';
    const packName=gs('pu-pack'), packPer=gn('pu-packper');
    const midName=gs('pu-mid'), midPer=gn('pu-midper');
    const hasMid=!!(midName && midPer>1);
    const packSize=(packName && packPer>0) ? (hasMid?round2(packPer*midPer):packPer) : 0;
    const hasPack=!!(packName && packSize>1);
    const ladder=[];
    if(hasPack) ladder.push({key:'pack', name:packName, factor:packSize});
    if(hasMid)  ladder.push({key:'mid',  name:midName,  factor:midPer});
    ladder.push({key:'base', name:base, factor:1});
    return {base, packName, packPer, midName, midPer, hasMid, hasPack, packSize, ladder,
      cost:gn('pu-cost'), costUnit:gs('pu-costunit'),
      sellPack:gn('pu-sell-pack'), sellMid:gn('pu-sell-mid'), sellBase:gn('pu-sell-base'),
      defaultUnit:gs('pu-default')};
  },
  previewProductUnits(){
    const r=this._puRead();
    const setTxt=(id,t)=>{ const el=document.getElementById(id); if(el) el.textContent=t; };
    const show=(id,on)=>{ const el=document.getElementById(id); if(el) el.style.display = on?'block':'none'; };
    setTxt('pu-packper-label','هر '+(r.packName||'کارتن')+' حاوی چند '+(r.hasMid?r.midName:r.base)+'؟');
    setTxt('pu-midper-label','هر '+(r.midName||'قوطی/بسته')+' حاوی چند '+r.base+'؟');
    setTxt('pu-lbl-sell-pack','قیمت فروش هر '+(r.packName||'کارتن'));
    setTxt('pu-lbl-sell-mid','قیمت فروش هر '+(r.midName||'قوطی'));
    setTxt('pu-lbl-sell-base','قیمت فروش هر '+r.base);
    show('pu-row-pack', r.hasPack);
    show('pu-row-mid', r.hasMid);
    // پر کردن سلکت‌ها با حفظ انتخاب قبلی
    ['pu-costunit','pu-default'].forEach(selId=>{
      const sel=document.getElementById(selId); if(!sel) return;
      const want = sel.dataset.want || sel.value;
      sel.innerHTML = r.ladder.map(u=>`<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}${u.factor>1?' (= '+fmtQty(u.factor)+' '+escapeHtml(r.base)+')':''}</option>`).join('');
      sel.value = r.ladder.some(u=>u.name===want) ? want : r.ladder[0].name;
      delete sel.dataset.want;
    });
    const r2=this._puRead();
    const costUnit = r2.ladder.find(u=>u.name===r2.costUnit) || r2.ladder[r2.ladder.length-1];
    const costPerBase = r2.cost>0 ? r2.cost/costUnit.factor : 0;
    // قیمت فروش پایه: اگر خالی باشد از واحد بزرگ‌تر حساب می‌شود
    let basePrice=r2.sellBase;
    if(!(basePrice>0)){
      if(r2.hasMid && r2.sellMid>0) basePrice=r2.sellMid/r2.midPer;
      else if(r2.hasPack && r2.sellPack>0) basePrice=r2.sellPack/r2.packSize;
    }
    const priceOf=u=>{
      if(u.key==='pack' && r2.sellPack>0) return r2.sellPack;
      if(u.key==='mid'  && r2.sellMid>0)  return r2.sellMid;
      return round2(basePrice*u.factor);
    };
    if(r2.hasPack) setTxt('pu-auto-pack', r2.sellPack>0 ? ('قیمت دستی — بدون آن خودکار '+fmt2(round2(basePrice*r2.packSize))+' می‌شد') : ('خودکار: '+fmt2(round2(basePrice*r2.packSize))+' (خالی بگذارید تا خودکار بماند؛ برای تخفیف کارتنی عدد بنویسید)'));
    if(r2.hasMid)  setTxt('pu-auto-mid',  r2.sellMid>0  ? ('قیمت دستی — بدون آن خودکار '+fmt2(round2(basePrice*r2.midPer))+' می‌شد')  : ('خودکار: '+fmt2(round2(basePrice*r2.midPer))+' (خالی بگذارید تا خودکار بماند)'));
    const pv=document.getElementById('pu-preview');
    if(pv){
      const rows=r2.ladder.map(u=>{
        const c=round2(costPerBase*u.factor), s=priceOf(u);
        const profit=round2(s-c);
        return `<tr><td>${escapeHtml(u.name)}</td><td class="num">${fmtQty(u.factor)} ${escapeHtml(r2.base)}</td><td class="num">${fmt2(c)}</td><td class="num">${fmt2(s)}</td><td class="num" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt2(profit)}</td></tr>`;
      }).join('');
      pv.innerHTML = `<b style="font-size:13.5px;">پیش‌نمایش</b>
      <table class="inv-table"><thead><tr><th>واحد</th><th>ظرفیت</th><th>تمام‌شده</th><th>فروش</th><th>سود</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="field-note">${escapeHtml(this.unitLadderLabel({unit:r2.base, midUnit:r2.hasMid?r2.midName:'', midPer:r2.hasMid?r2.midPer:0, packUnit:r2.hasPack?r2.packName:'', packSize:r2.hasPack?r2.packSize:0})||'این محصول فقط یک واحد دارد.')}</div>`;
    }
  },
  saveProductUnits(id){
    const p=this.state.products.find(x=>x.id===id); if(!p) throw new Error('محصول یافت نشد.');
    const r=this._puRead();
    if(!r.base) throw new Error('واحد پایه را بنویسید (مثلاً عدد).');
    if(r.packName && !(r.packPer>0)) throw new Error('برای «'+r.packName+'» بنویسید هر کدام چند '+(r.hasMid?r.midName:r.base)+' دارد.');
    if(r.midName && !(r.midPer>1)) throw new Error('برای «'+r.midName+'» بنویسید هر کدام چند '+r.base+' دارد (بیشتر از ۱).');
    if(r.hasPack && r.hasMid && r.packSize<=r.midPer) throw new Error('کارتن باید از قوطی/بسته بزرگ‌تر باشد.');
    const names=r.ladder.map(u=>u.name);
    if(new Set(names).size!==names.length) throw new Error('نام واحدها باید با هم متفاوت باشد.');
    const costUnit=r.ladder.find(u=>u.name===r.costUnit)||r.ladder[r.ladder.length-1];
    const avgCost = r.cost>0 ? round2(r.cost/costUnit.factor) : 0;
    let basePrice=r.sellBase;
    if(!(basePrice>0)){
      if(r.hasMid && r.sellMid>0) basePrice=round2(r.sellMid/r.midPer);
      else if(r.hasPack && r.sellPack>0) basePrice=round2(r.sellPack/r.packSize);
      else basePrice=0;
    }
    const fields={
      unit:r.base,
      midUnit: r.hasMid?r.midName:'', midPer: r.hasMid?r.midPer:0,
      packUnit: r.hasPack?r.packName:'', packSize: r.hasPack?r.packSize:0,
      avgCost,
      sellPrice: round2(basePrice),
      sellPriceMid: (r.hasMid && r.sellMid>0)?round2(r.sellMid):0,
      sellPricePack: (r.hasPack && r.sellPack>0)?round2(r.sellPack):0,
      defaultSaleUnit: names.includes(r.defaultUnit)?r.defaultUnit:(r.packUnit||r.midUnit||r.base),
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
    const ladder=this.productUnits(p);
    const unitOptions=ladder.map(u=>({value:u.name, label:u.name+(u.factor>1?(' (= '+fmtQty(u.factor)+' '+(p.unit||'عدد')+')'):'')}));
    this._adjustId=id; this._adjustProduct=p; this._adjustLadder=ladder;
    const body = `
    <label>انتخاب کار</label>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="btn btn-outline" style="flex:1;" id="adj-mode-delta" onclick="App.setAdjustMode('delta')">۱. اضافه یا کم کردن موجودی</button>
      <button class="btn btn-outline" style="flex:1;" id="adj-mode-unit" onclick="App.setAdjustMode('unit')">۲. تنها تغییر واحد</button>
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
        <label style="margin-top:10px;">تعداد (مثبت یا منفی)</label><input id="adj-delta" type="text" inputmode="decimal" placeholder="مثال: +5 یا -3.2">
        <div class="field-note">برای کاستی/مصرف شخصی، واحد «${escapeHtml(p.unit||'عدد')}» را انتخاب کنید و عدد منفی بنویسید — مثلاً <b>-2</b>.</div>`
      : `<label>تغییر واحد پیش‌فرض نمایش موجودی به</label><select id="adj-newunit">${unitOpts.map(o=>'<option value="'+o.value+'">'+o.label+'</option>').join('')}</select><div class="field-note" style="margin-top:8px;">فقط واحد نمایش تغییر می‌کند، موجودی ثابت می‌ماند.</div>`;
    document.getElementById('adj-mode-content').innerHTML = body;
    ['adj-mode-delta','adj-mode-unit'].forEach(id=>{
      const btn=document.getElementById(id);
      if(btn) btn.style.opacity = (id==='adj-mode-'+(mode))?'1':'0.5';
    });
  },
  submitAdjustStock(id){
    const mode=this._adjustMode;
    const p=this._adjustProduct, ladder=this._adjustLadder;
    if(mode==='delta'){
      const deltaStr=document.getElementById('adj-delta').value.trim();
      if(!deltaStr||isNaN(deltaStr)) throw new Error('عدد نامعتبر است.');
      const unitName=document.getElementById('adj-unit').value;
      const u=this.unitByName(p,unitName);
      const delta=round2(parseFloat(deltaStr)*u.factor);
      return updateDoc(doc(cols.products, id), { stock: increment(delta) }).then(()=>this.toast((delta>0?'+':'-')+fmtQty(Math.abs(parseFloat(deltaStr)))+' '+u.name+' ثبت شد'));
    } else {
      const newUnit=document.getElementById('adj-newunit').value;
      if(!newUnit || !ladder.some(u=>u.name===newUnit)) throw new Error('واحد نامعتبر است.');
      return updateDoc(doc(cols.products, id), { defaultSaleUnit: newUnit }).then(()=>this.toast('واحد نمایش تغییر کرد: '+newUnit));
    }
  },
  deleteProduct(id){
    if(!this.isOwner()){ this.toast('فقط مدیر می‌تواند محصول را حذف کند.'); return; }
    const p=this.state.products.find(x=>x.id===id); if(!p) return;
    this.openConfirmModal({
      title:'حذف محصول',
      msg:'«'+p.name+'» حذف شود؟ این کار سابقهٔ فروش/خرید را تغییر نمی‌دهد.',
      danger:true, confirmLabel:'حذف شود',
      onConfirm: ()=> deleteDoc(doc(cols.products, id)).then(()=>this.toast('حذف شد')).catch(e=>{ console.error(e); App.toastError('خطا؛ دوباره تلاش کنید.'); })
    });
  },
  renderLowStock(){
    const threshold = this.state.settings.lowStockThreshold!==undefined ? this.state.settings.lowStockThreshold : 1;
    const list = this.lowStockList();
    const rows = list.length ? list.map(p=>`
      <div class="row-item">
        <div class="r-left"><b>${escapeHtml(p.name)}</b><span class="sub">قیمت فروش هر ${escapeHtml(p.unit||'عدد')}: <span class="num">${fmt(p.sellPrice)}</span></span></div>
        <div class="r-right num" style="color:${p.stock<=0?'var(--red)':'var(--gold-d)'}">${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</div>
      </div>`).join('') : `<div class="empty"><span class="ic">${ic('check-circle',26)}</span><b>همه‌چیز کافی است</b>هیچ کالای کم‌موجودی نیست</div>`;
    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('alert-triangle',17)}کالاهای کم‌موجود/تمام‌شده</h2>
    <div class="field-note" style="margin-bottom:10px;">حد هشدار فعلی: ${threshold} واحد یا کمتر ${this.isOwner()?'— از تنظیمات قابل تغییر است.':''}</div>
    <div class="card">${rows}</div>
    ${list.length?`<button class="btn btn-primary" onclick="App.navigate('purchase')">${ic('shopping-cart',17)}برو به ثبت خرید و همه را یک‌جا بخر</button>`:''}
    `;
  },
  renderProducts(){
    const owner=this.isOwner();
    const threshold = this.state.settings.lowStockThreshold!==undefined ? this.state.settings.lowStockThreshold : 1;
    const sorted=[...this.state.products].sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    const rows = sorted.length ? sorted.map(p=>{
      const ladder=this.productUnits(p);
      const defUnit=this.unitByName(p, p.defaultSaleUnit);
      const stockInDef=this.stockInUnit(p,defUnit);
      const priceLine = ladder.map(u=>u.name+': '+fmt2(this.unitSellPrice(p,u))+(this.isUnitPriceManual(p,u)?'*':'')).join(' · ');
      const costLine  = ladder.map(u=>u.name+': '+fmt2(this.unitCost(p,u))).join(' · ');
      return `<div class="row-item"><div class="r-left"><b>${escapeHtml(p.name)}</b>${ladder.length>1?`<span class="sub">${escapeHtml(this.unitLadderLabel(p))}</span>`:''}<span class="sub">فروش — ${escapeHtml(priceLine)}</span><span class="sub">تمام‌شده — ${escapeHtml(costLine)}</span></div>
      <div class="r-right" style="display:flex;align-items:center;gap:10px;">
        <span class="badge ${this.isLowStock(p,threshold)?'red':'gold'} num" title="${escapeHtml(fmtQty(stockInDef)+' '+defUnit.name)}">${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</span>
        ${owner?`<span class="icon-btn" onclick="App.editProductUnits('${p.id}')" title="ویرایش واحدها و قیمت">${ic('sliders',16)}</span>`:''}
        ${owner?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"ویرایش واحدها و قیمت‌ها", icon:"sliders", onClick:()=>App.editProductUnits("${p.id}")},
          {label:"اصلاح موجودی", icon:"package", onClick:()=>App.adjustProductStock("${p.id}")},
          {label:"ویرایش نام و قیمت پایه", icon:"pencil", onClick:()=>App.editProduct("${p.id}")},
          {label:"حذف محصول", icon:"trash", danger:true, onClick:()=>App.deleteProduct("${p.id}")}
        ])'>${ic('more-vertical',17)}</span>`:''}
      </div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('archive',26)}</span><b>هنوز محصولی اضافه نشده</b>با ثبت اولین خرید یا فروش، محصول خودکار ساخته می‌شود</div>`;

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('archive',17)}محصولات و موجودی</h2>
    ${!owner?`<div class="hint">${ic('lock',13)}این بخش فقط برای مشاهده است — تغییر موجودی/قیمت/محصولات فقط با حساب مدیر ممکن است. موجودی همچنان با ثبت خرید یا فروش شما به‌صورت خودکار درست می‌شود.</div>`:''}
    ${owner?`
    <div class="card">
      <label>افزودن محصول جدید</label>
      <input id="np-name" placeholder="نام محصول">
      <div class="grid2">
        <div><label>واحد پایه (کوچک‌ترین)</label><input id="np-unit" placeholder="عدد" value="عدد"></div>
        <div><label>موجودی آغازین (به واحد پایه)</label><input id="np-stock" type="number" inputmode="decimal" placeholder="0"></div>
      </div>
      <div class="grid2">
        <div><label>نام واحد بزرگ (اختیاری)</label><input id="np-packunit" placeholder="کارتن"></div>
        <div><label>هر کارتن حاوی چند؟</label><input id="np-packper" type="number" inputmode="decimal" placeholder="6"></div>
      </div>
      <div class="grid2">
        <div><label>نام واحد میانی (اختیاری)</label><input id="np-midunit" placeholder="قوطی / بسته"></div>
        <div><label>هر قوطی/بسته حاوی چند عدد؟</label><input id="np-midper" type="number" inputmode="decimal" placeholder="24"></div>
      </div>
      <div class="grid2">
        <div><label>قیمت تمام‌شدهٔ یک واحد پایه</label><input id="np-cost" type="number" inputmode="decimal" placeholder="0"></div>
        <div><label>قیمت فروش یک واحد پایه</label><input id="np-sell" type="number" inputmode="decimal" placeholder="0"></div>
      </div>
      <div class="field-note">قیمت کارتن و قوطی خودکار از قیمت واحد پایه حساب می‌شود؛ بعد از افزودن، با «ویرایش واحدها و قیمت‌ها» می‌توانید برای هر واحد قیمت جدا (مثلاً تخفیف کارتنی) بگذارید.</div>
      <button class="btn btn-primary" onclick="App.submitNewProductForm()">${ic('plus',17)}افزودن محصول</button>
    </div>`:''}
    <div class="eyebrow"><span>فهرست محصولات</span><span>${sorted.length} قلم</span></div>
    ${owner&&sorted.length?`<div class="field-note" style="margin-bottom:8px;">با دکمهٔ ${ic('sliders',13)} روی هر محصول، واحدها (کارتن ← قوطی/بسته ← عدد) و قیمت خرید و فروش هر واحد را ویرایش کنید. قیمت واحدهای کوچک‌تر خودکار از قیمت کارتن حساب می‌شود؛ ستارهٔ کنار قیمت یعنی برای آن واحد قیمت دستی گذاشته‌اید.</div>`:''}
    <div class="card">${rows}</div>
    `;
  },

  /* ---------- تاریخچهٔ کامل معاملات ----------
     برخلاف «آخرین معاملات» در داشبورد (فقط ۸ مورد آخر) و «سابقهٔ معاملات» در پروفایل
     مشتری/عمده‌فروش (فقط برای طرف‌های ثبت‌شده)، این صفحه همهٔ فروش‌ها (چه مشتری نقدی
     چه ثبت‌شده)، خریدها، مصارف/برداشت‌ها، و دریافت/پرداخت‌ها را با فیلتر تاریخ و نوع
     نشان می‌دهد — چیزی گم نمی‌شود. */
  setHistoryPeriod(p){ this.historyPeriod=p; this.render(); },
  setHistoryType(t){ this.historyType=t; this.render(); },
  renderFullHistory(){
    const today=todayISO();
    let start,end=today,label='امروز';
    if(this.historyPeriod==='week'){ start=startOfWeek(today); label='این هفته'; }
    else if(this.historyPeriod==='month'){ start=startOfMonth(today); label='این ماه'; }
    else if(this.historyPeriod==='all'){ start='0000-01-01'; label='همهٔ زمان‌ها'; }
    else if(this.historyPeriod==='custom'){ start=this.historyStart||today; end=this.historyEnd||today; label='بازهٔ دلخواه'; }
    else { start=today; label='امروز'; this.historyPeriod='today'; }

    const type=this.historyType||'all';
    let rows=[];
    if(type==='all'||type==='sales'){
      this.salesInRange(start,end).forEach(x=>{
        const tag=x.status==='cancelled'?' <span class="badge gold">باطل</span>':'';
        rows.push({ts:x.ts, html:`<div class="row-item clickable" onclick="App.viewInvoice('${x.id}')"><span class="avt">${ic('receipt',16)}</span><div class="r-left"><b>فروش ${this.invoiceNoLabel(x.id)} · ${escapeHtml(x.customerName)}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم${x.remaining>0.5?' · باقی‌مانده '+fmt(x.remaining):''}</span>${this.whoLabel(x)?`<span class="sub" style="opacity:.75;">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num" style="color:var(--green)">+${fmt(x.paid)}</div></div>`});
      });
    }
    if(type==='all'||type==='purchases'){
      this.purchasesInRange(start,end).forEach(x=>{
        const tag=x.status==='cancelled'?' <span class="badge gold">باطل</span>':(x.currency==='USD'?' <span class="badge gold">دالر</span>':'');
        rows.push({ts:x.ts, html:`<div class="row-item clickable" onclick="App.viewPurchase('${x.id}')"><span class="avt out">${ic('package',16)}</span><div class="r-left"><b>خرید${x.supplierInvoiceNo?' (بل #'+escapeHtml(x.supplierInvoiceNo)+')':''} · ${escapeHtml(x.supplierName||'—')}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${this.whoLabel(x)?`<span class="sub" style="opacity:.75;">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num" style="color:var(--red)">-${x.currency==='USD'?fmt2(x.paid)+' $':fmt(x.paid)}</div></div>`});
      });
    }
    if(type==='all'||type==='expenses'){
      this.expensesInRange(start,end).forEach(x=>{
        const isW=x.category===WITHDRAWAL_CATEGORY;
        rows.push({ts:x.ts, html:`<div class="row-item"><span class="avt neu">${ic(isW?'hand-coins':'banknote',16)}</span><div class="r-left"><b>${isW?'برداشت · '+escapeHtml(x.withdrawnBy||''):'مصرف · '+escapeHtml(x.category)}</b><span class="sub">${x.date}${x.note?(' · '+escapeHtml(x.note)):''}</span>${this.whoLabel(x)?`<span class="sub" style="opacity:.75;">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num" style="color:var(--red)">-${fmt(x.amount)}</div></div>`});
      });
    }
    if(type==='all'||type==='payments'){
      this.state.payments.filter(x=>x.date>=start && x.date<=end).forEach(x=>{
        const color=x.type==='receive'?'var(--green)':'var(--red)';
        const photoBtn = x.receiptImage ? `<span class="icon-btn" onclick="App.viewPaymentReceipt('${x.id}')" title="مشاهده عکس رسید">${ic('image',15)}</span>` : '';
        rows.push({ts:x.ts, html:`<div class="row-item"><span class="avt ${x.type==='receive'?'':'out'}">${ic(x.type==='receive'?'arrow-left':'arrow-right',16)}</span><div class="r-left"><b>${x.type==='receive'?'دریافت از':'پرداخت به'} ${escapeHtml(x.partyName||'')}</b>${photoBtn}<span class="sub">${x.date}${x.currency==='USD'?' · دالری':''}</span>${this.whoLabel(x)?`<span class="sub" style="opacity:.75;">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num" style="color:${color}">${x.currency==='USD'?fmt2(x.amount)+' $':fmt(x.amount)}</div></div>`});
      });
    }
    rows.sort((a,b)=>(b.ts||0)-(a.ts||0));

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('history',17)}تاریخچهٔ کامل معاملات</h2>
    <div class="period-btns">
      <button class="${this.historyPeriod==='today'||!this.historyPeriod?'active':''}" onclick="App.setHistoryPeriod('today')">امروز</button>
      <button class="${this.historyPeriod==='week'?'active':''}" onclick="App.setHistoryPeriod('week')">این هفته</button>
      <button class="${this.historyPeriod==='month'?'active':''}" onclick="App.setHistoryPeriod('month')">این ماه</button>
      <button class="${this.historyPeriod==='all'?'active':''}" onclick="App.setHistoryPeriod('all')">همه</button>
      <button class="${this.historyPeriod==='custom'?'active':''}" onclick="App.setHistoryPeriod('custom')">بازهٔ دلخواه</button>
    </div>
    ${this.historyPeriod==='custom'?`
    <div class="card">
      <div class="grid2">
        <div><label>از تاریخ</label><input type="date" value="${this.historyStart||today}" onchange="App.historyStart=this.value; App.render();"></div>
        <div><label>تا تاریخ</label><input type="date" value="${this.historyEnd||today}" onchange="App.historyEnd=this.value; App.render();"></div>
      </div>
    </div>`:''}
    <div class="tabbar-sub">
      <button class="${type==='all'?'active':''}" onclick="App.setHistoryType('all')">همه</button>
      <button class="${type==='sales'?'active':''}" onclick="App.setHistoryType('sales')">فروش</button>
      <button class="${type==='purchases'?'active':''}" onclick="App.setHistoryType('purchases')">خرید</button>
      <button class="${type==='expenses'?'active':''}" onclick="App.setHistoryType('expenses')">مصرف</button>
      <button class="${type==='payments'?'active':''}" onclick="App.setHistoryType('payments')">دریافت/پرداخت</button>
    </div>
    <div class="field-note">بازه: ${label} (${start==='0000-01-01'?'ابتدا':start} تا ${end}) — ${rows.length} مورد</div>
    <div class="card">${rows.length?rows.map(r=>r.html).join(''):`<div class="empty"><span class="ic">${ic('history',24)}</span>در این بازه معامله‌ای نیست</div>`}</div>
    `;
  },

  /* ---------- Reports ---------- */
  setPeriod(p){ this.reportPeriod=p; this.render(); },
  _trendChartInstance:null,
  drawTrendChart(chartRetries){
    const canvas=document.getElementById('trend-chart'); if(!canvas) return;
    if(typeof Chart==='undefined'){
      if(!chartRetries) loadExternalScript(CHART_JS_URL).catch(()=>{}); // فقط یک‌بار درخواست دانلود را شروع کن
      // تا کتابخانه برسد (چه از کش سرویس‌ورکر، چه از شبکه)، چند بار با فاصله چک می‌کنیم —
      // ولی نه برای همیشه — وگرنه اگر واقعاً هیچ‌وقت نرسد، این تلاش هر ۲۰۰ میلی‌ثانیه تا ابد ادامه پیدا می‌کند.
      const tries=(chartRetries||0)+1;
      if(tries<=15){ setTimeout(()=>this.drawTrendChart(tries), 200); return; }
      /* سقف تلاش: بعد از ۱۵ بار دیگر تلاش نمی‌کنیم (قبلاً بی‌نهایت بود) و یک پیام ساکت می‌دهیم */
      console.warn('Chart.js بارگذاری نشد؛ نمودار نمایش داده نمی‌شود.');
      const box=canvas.parentElement;
      if(box) box.innerHTML = '<div class="field-note">نمودار بارگذاری نشد (احتمالاً اولین اجرای آفلاین). بعد از وصل شدن اینترنت و باز کردن دوبارهٔ این صفحه، نمودار نشان داده می‌شود. بقیهٔ ارقام گزارش درست است.</div>';
      return;
    }
    const today=todayISO();
    let start,end=today;
    if(this.reportPeriod==='today'){ start=today; }
    else if(this.reportPeriod==='week'){ start=startOfWeek(today); }
    else if(this.reportPeriod==='month'){ start=startOfMonth(today); }
    else { start=this.reportStart||today; end=this.reportEnd||today; }
    // برای دورهٔ «امروز» یا بازه‌های خیلی کوتاه، ۷ روز آخر را نشان بده تا نمودار خالی نباشد
    const dStart=new Date(start+'T00:00:00'), dEnd=new Date(end+'T00:00:00');
    let days = Math.round((dEnd-dStart)/86400000)+1;
    if(days<7){ dStart.setDate(dEnd.getDate()-6); days=7; }
    if(days>60){ dStart.setTime(dEnd.getTime()-59*86400000); days=60; }
    const labels=[], salesSeries=[], profitSeries=[];
    for(let i=0;i<days;i++){
      const d=new Date(dStart); d.setDate(dStart.getDate()+i);
      const iso=d.toISOString().slice(0,10);
      const daySales=this.salesInRange(iso,iso);
      labels.push(iso.slice(5));
      salesSeries.push(sum(daySales,'total'));
      profitSeries.push(sum(daySales,'profit') - sum(this.expensesInRange(iso,iso).filter(e=>e.category!==WITHDRAWAL_CATEGORY),'amount'));
    }
    if(this._trendChartInstance){ this._trendChartInstance.destroy(); }
    this._trendChartInstance = new Chart(canvas.getContext('2d'), {
      type:'line',
      data:{ labels, datasets:[
        {label:'فروش', data:salesSeries, borderColor:'#C9922B', backgroundColor:'rgba(201,146,43,.12)', tension:.3, fill:true},
        {label:'سود', data:profitSeries, borderColor:'#227A57', backgroundColor:'rgba(34,122,87,.12)', tension:.3, fill:true}
      ]},
      options:{ responsive:true, plugins:{legend:{position:'bottom', labels:{font:{family:'Vazirmatn'}}}}, scales:{ x:{ticks:{font:{size:10}}}, y:{ticks:{font:{size:10}}} } }
    });
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
    const salesRows=sales.map(s=>({ 'شماره فاکتور':this.invoiceNoLabel(s.id), 'تاریخ':s.date, 'مشتری':s.customerName, 'مجموع':s.total, 'پرداخت‌شده':s.paid, 'باقیمانده':s.remaining, 'سود':s.profit }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), 'فروش');
    const purchRows=purchases.map(p=>({ 'تاریخ':p.date, 'شماره بل عمده‌فروش':p.supplierInvoiceNo||'', 'عمده‌فروش':p.supplierName||'نقدی', 'ارز':p.currency||'AFN', 'مجموع':p.total, 'پرداخت‌شده':p.paid, 'باقیمانده':p.remaining }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchRows), 'خرید');
    const expRows=expenses.map(e=>({ 'تاریخ':e.date, 'نوع':e.category, 'مبلغ':e.amount, 'یادداشت':e.note||'' }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'مصارف');
    const revenue=sum(sales,'total'), cogs=sum(sales,'totalCost'), expTotal=sum(expenses.filter(e=>e.category!==WITHDRAWAL_CATEGORY),'amount');
    const summaryRows=[
      {'شرح':'مجموع فروش','مبلغ':revenue},
      {'شرح':'قیمت تمام‌شدهٔ کالای فروخته‌شده','مبلغ':cogs},
      {'شرح':'سود ناخالص','مبلغ':revenue-cogs},
      {'شرح':'مجموع مصارف','مبلغ':expTotal},
      {'شرح':'سود خالص','مبلغ':revenue-cogs-expTotal},
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'خلاصه');
    XLSX.writeFile(wb, 'گزارش-'+label+'-'+todayISO()+'.xlsx');
  },
  renderReports(){
    const today=todayISO();
    let start,end=today,label='امروز';
    if(this.reportPeriod==='today'){ start=today; label='امروز'; }
    else if(this.reportPeriod==='week'){ start=startOfWeek(today); label='این هفته'; }
    else if(this.reportPeriod==='month'){ start=startOfMonth(today); label='این ماه'; }
    else { start=this.reportStart||today; end=this.reportEnd||today; label='بازهٔ دلخواه'; }

    const sales=this.salesInRange(start,end);
    const purchases=this.purchasesInRange(start,end);
    const expensesAll=this.expensesInRange(start,end);
    const expenses=expensesAll.filter(e=>e.category!==WITHDRAWAL_CATEGORY);
    const withdrawals=expensesAll.filter(e=>e.category===WITHDRAWAL_CATEGORY);
    const revenue=sum(sales,'total');
    const cogs=sum(sales,'totalCost');
    const grossProfit=revenue-cogs;
    const expTotal=sum(expenses,'amount');
    const netProfit=grossProfit-expTotal;
    const withdrawalTotal=sum(withdrawals,'amount');
    const purchTotal = purchases.reduce((a,p)=> a + (p.currency==='USD' ? (Number(p.total)||0)*(Number(p.rateAtPurchase)||this.usdRate()||0) : (Number(p.total)||0)), 0);

    const catMap={};
    expenses.forEach(e=>{ catMap[e.category]=(catMap[e.category]||0)+e.amount; });
    const catRows = Object.keys(catMap).length ? Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(k)}</b></div><div class="r-right num">${fmt(v)}</div></div>`
    ).join('') : `<div class="empty">مصرفی در این بازه ثبت نشده.</div>`;

    const wdByPerson={};
    withdrawals.forEach(w=>{ const name=w.withdrawnBy||'نامشخص'; wdByPerson[name]=(wdByPerson[name]||0)+w.amount; });
    const wdSummaryRows = Object.keys(wdByPerson).length ? Object.entries(wdByPerson).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(k)}</b></div><div class="r-right num" style="color:var(--red)">${fmt(v)}</div></div>`
    ).join('') : '';
    const wdListRows = [...withdrawals].sort((a,b)=>(b.ts||0)-(a.ts||0)).map(w=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(w.withdrawnBy||'نامشخص')}</b><span class="sub">${w.date}${w.note?(' · '+escapeHtml(w.note)):''}</span><span class="sub" style="opacity:.8;">${escapeHtml(this.whoLabel(w))}</span></div><div class="r-right num" style="color:var(--red)">-${fmt(w.amount)}</div></div>`
    ).join('');

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('bar-chart',17)}گزارش سود و زیان</h2>
    <div class="period-btns">
      <button class="${this.reportPeriod==='today'?'active':''}" onclick="App.setPeriod('today')">امروز</button>
      <button class="${this.reportPeriod==='week'?'active':''}" onclick="App.setPeriod('week')">این هفته</button>
      <button class="${this.reportPeriod==='month'?'active':''}" onclick="App.setPeriod('month')">این ماه</button>
      <button class="${this.reportPeriod==='custom'?'active':''}" onclick="App.setPeriod('custom')">بازهٔ دلخواه</button>
    </div>
    ${this.reportPeriod==='custom'?`
    <div class="card">
      <div class="grid2">
        <div><label>از تاریخ</label><input type="date" value="${this.reportStart||today}" onchange="App.reportStart=this.value; App.render();"></div>
        <div><label>تا تاریخ</label><input type="date" value="${this.reportEnd||today}" onchange="App.reportEnd=this.value; App.render();"></div>
      </div>
    </div>`:''}
    <div class="card">
      <div class="eyebrow" style="margin-top:0;"><span>روند فروش و سود</span></div>
      <div class="chart-box"><canvas id="trend-chart" height="170"></canvas></div>
    </div>
    <button class="btn btn-outline" onclick="App.exportReportExcel('${start}','${end}','${escapeHtml(label)}')">${ic('sheet',16)}خروجی اکسل از همین گزارش</button>
    <div class="card">
      <div class="field-note">بازه: ${label} (${start} تا ${end})</div>
      <div class="field-note">تمام ارقام این گزارش به ${this.state.settings.currency} است؛ خریدهای دالری نیز به نرخ روز خودشان به ${this.state.settings.currency} تبدیل شده‌اند.</div>
      <div class="row-item"><div class="r-left">مجموع فروش</div><div class="r-right num">${fmt(revenue)}</div></div>
      <div class="row-item"><div class="r-left">قیمت تمام‌شدهٔ کالای فروخته‌شده</div><div class="r-right num">${fmt(cogs)}</div></div>
      <div class="row-item"><div class="r-left"><b>سود ناخالص</b></div><div class="r-right num" style="color:var(--green)"><b>${fmt(grossProfit)}</b></div></div>
      <div class="row-item"><div class="r-left">مجموع مصارف کسب‌وکار (بدون برداشت شخصی)</div><div class="r-right num" style="color:var(--red)">-${fmt(expTotal)}</div></div>
      <div class="total-line"><span>سود خالص</span><span class="num ${netProfit>=0?'':'red'}" style="color:${netProfit>=0?'var(--green)':'var(--red)'}">${fmt(netProfit)}</span></div>
    </div>
    <div class="card">
      <div class="row-item"><div class="r-left">مجموع خرید در این بازه (${this.state.settings.currency}، شامل تبدیل خریدهای دالری)</div><div class="r-right num">${fmt(purchTotal)}</div></div>
      <div class="row-item"><div class="r-left">تعداد فاکتور فروش (فعال)</div><div class="r-right num">${sales.filter(s=>s.status!=='cancelled').length}</div></div>
      ${sales.some(s=>s.status==='cancelled')?`<div class="row-item"><div class="r-left">فاکتورهای باطل‌شده در این بازه</div><div class="r-right num" style="color:var(--red)">${sales.filter(s=>s.status==='cancelled').length}</div></div>`:''}
    </div>
    <div class="eyebrow"><span>مصارف بر اساس نوع</span></div>
    <div class="card">${catRows}</div>
    <h2 class="section-title">${ic('hand-coins',17)}برداشت‌های شخصی (جدا از سود/زیان)</h2>
    <div class="card">
      <div class="field-note">برداشت شخصی، سود/زیان کسب‌وکار را تغییر نمی‌دهد؛ فقط از موجودی نقد کم می‌شود. این بخش فقط برای این است که بدانید هرکس چقدر برداشت کرده.</div>
      <div class="row-item"><div class="r-left"><b>مجموع برداشت در این بازه</b></div><div class="r-right num" style="color:var(--red)"><b>${fmt(withdrawalTotal)}</b></div></div>
      ${wdSummaryRows}
    </div>
    ${withdrawals.length?`<div class="card">${wdListRows}</div>`:''}
    `;
  },

  /* ---------- Settings / Backup ---------- */
  saveDeviceLabelFromInput(){
    const val=(document.getElementById('set-device-label').value||'').trim();
    setDeviceLabel(val);
    this.toast('نام دستگاه ذخیره شد');
    this.render();
  },
  saveSettings(){
    const fields = {
      businessName:(document.getElementById('set-name').value||'').trim()||'پخش موتر من',
      currency:(document.getElementById('set-currency').value||'').trim()||'افغانی',
      openingCash:parseFloat(document.getElementById('set-cash').value)||0,
      usdRate:parseFloat(document.getElementById('set-usdrate').value)||0,
      logoEmoji:(document.getElementById('set-logo').value||'').trim()||'🏪',
      businessPhone:(document.getElementById('set-phone').value||'').trim(),
      businessAddress:(document.getElementById('set-address').value||'').trim(),
      openingNote:(document.getElementById('set-opening-note').value||'').trim(),
      lowStockThreshold: parseFloat(document.getElementById('set-lowstock').value)||0,
    };
    updateDoc(settingsDocRef, fields).then(()=>{
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
    URL.revokeObjectURL(url);
  },
  exportBackup(){
    this._downloadJSON(this.state, 'backup-hesabdari-'+todayISO()+'.json');
  },
  async exportBackupExcel(){
    if(typeof XLSX==='undefined'){
      this.toast('در حال آماده‌سازی خروجی اکسل...');
      try{ await loadExternalScript(XLSX_JS_URL); }
      catch(e){ this.toast('اتصال اینترنت برای دانلود ابزار اکسل لازم است؛ دوباره تلاش کنید.'); return; }
    }
    const wb=XLSX.utils.book_new();
    const s=this.state;
    const sheets = {
      'محصولات': s.products.map(p=>({name:p.name, unit:p.unit, stock:p.stock, avgCost:p.avgCost, sellPrice:p.sellPrice})),
      'مشتریان': s.customers.map(c=>({name:c.name, phone:c.phone||'', address:c.address||'', balance:c.balance||0})),
      'عمده‌فروشان': s.suppliers.map(c=>({name:c.name, phone:c.phone||'', address:c.address||'', balance:c.balance||0, balanceUSD:c.balanceUSD||0})),
      'فروش': s.sales.map(x=>({شماره:this.invoiceNoLabel(x.id), تاریخ:x.date, مشتری:x.customerName, مجموع:x.total, پرداختی:x.paid, باقیمانده:x.remaining, سود:x.profit, وضعیت:x.status})),
      'خرید': s.purchases.map(x=>({تاریخ:x.date, شماره_بل_عمده_فروش:x.supplierInvoiceNo||'', عمده_فروش:x.supplierName||'نقدی', ارز:x.currency||'AFN', مجموع:x.total, پرداختی:x.paid, باقیمانده:x.remaining, وضعیت:x.status})),
      'مصارف': s.expenses.map(x=>({تاریخ:x.date, نوع:x.category, مبلغ:x.amount, یادداشت:x.note||''})),
      'دریافت-پرداخت': s.payments.map(x=>({تاریخ:x.date, نوع:x.type==='receive'?'دریافت':'پرداخت', طرف:x.partyName||'', ارز:x.currency||'AFN', مبلغ:x.amount})),
    };
    Object.entries(sheets).forEach(([name, rows])=>{
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    });
    XLSX.writeFile(wb, 'پشتیبان-اکسل-'+todayISO()+'.xlsx');
  },
  async importBackup(input){
    if(!this.isOwner()){ this.toast('این کار فقط برای مالک/مدیر مجاز است.'); input.value=''; return; }
    const file=input.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=(e)=>{
      let parsed;
      try{ parsed=JSON.parse(e.target.result); }
      catch(err){ console.error(err); this.toastError('فایل پشتیبان معتبر نیست.'); input.value=''; return; }
      /* دو confirm() خام مرورگر با یک مودال داخلی جایگزین شد — همان دو هشدار، در یک متن */
      this.openConfirmModal({
        title:'بازیابی از فایل پشتیبان',
        msg:'این کار دیتابیس مشترک همهٔ کاربران (نه فقط همین گوشی) را با فایل انتخابی جایگزین می‌کند. قبل از جایگزینی، یک نسخهٔ پشتیبان از وضعیت فعلی خودکار دانلود می‌شود تا اگر اشتباهی رخ داد بتوانید برگردید. ادامه می‌دهید؟',
        danger:true, confirmLabel:'بله، بازیابی کن',
        onConfirm: ()=>{ this._runImportBackup(parsed, input); }
      });
      input.value='';
    };
    reader.readAsText(file);
  },
  async _runImportBackup(parsed, input){
    try{
      this._downloadJSON(this.state, 'auto-backup-before-import-'+Date.now()+'.json');

        migrateSettings(parsed.settings);
        migrateRecordArrays(parsed.sales, parsed.purchases);

        for(const name of COLLECTIONS){
          const existing = await getDocs(cols[name]);
          const importedIds = new Set((parsed[name]||[]).map(r=>r.id));
          const opsBatchLimit=400;
          let batch=writeBatch(db); let opCount=0;
          const flush=async()=>{ if(opCount>0){ await batch.commit(); batch=writeBatch(db); opCount=0; } };
          for(const d of existing.docs){
            if(!importedIds.has(d.id)){ batch.delete(d.ref); opCount++; if(opCount>=opsBatchLimit) await flush(); }
          }
          for(const rec of (parsed[name]||[])){
            if(!rec.id) rec.id=uid();
            batch.set(doc(cols[name], rec.id), rec); opCount++; if(opCount>=opsBatchLimit) await flush();
          }
          await flush();
        }
        await setDoc(settingsDocRef, migrateSettings(parsed.settings||{}));
        this.toast('بازیابی موفقانه انجام شد');
        this.navigate('dashboard');
    }catch(err){ console.error(err); this.toastError('بازیابی ناکام شد؛ فایل پشتیبان معتبر نیست یا خطایی رخ داد.'); }
    if(input) input.value='';
  },
  /* دو تأیید متوالی (مثل قبل) ولی با مودال داخلی، نه confirm() مرورگر */
  wipeAll(){
    if(!this.isOwner()){ this.toast('این کار فقط برای مالک/مدیر مجاز است.'); return; }
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
  async _runWipeAll(){
    this._downloadJSON(this.state, 'auto-backup-before-wipe-'+Date.now()+'.json');
    try{
      for(const name of COLLECTIONS){
        const existing = await getDocs(cols[name]);
        let batch=writeBatch(db); let opCount=0;
        for(const d of existing.docs){
          batch.delete(d.ref); opCount++;
          if(opCount>=400){ await batch.commit(); batch=writeBatch(db); opCount=0; }
        }
        if(opCount>0) await batch.commit();
      }
      await setDoc(settingsDocRef, defaultSettings());
      this.navigate('dashboard');
    }catch(e){ console.error(e); App.toastError('خطا در پاک کردن اطلاعات؛ دوباره تلاش کنید.'); }
  },
  renderSettings(){
    const s=this.state.settings;
    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title" style="margin-top:0;">${ic('settings',17)}تنظیمات</h2>
    <div class="card">
      <label>نام این گوشی/دستگاه (برای شناسایی ثبت‌کننده در فاکتورها)</label>
      <input id="set-device-label" value="${escapeHtml(getDeviceLabel())}" placeholder="مثلاً گوشی احمد، دفتر مرکزی">
      <div class="field-note">این نام فقط روی همین گوشی ذخیره می‌شود و کنار هر فروش/خرید/مصرفی که از این گوشی ثبت کنید نشان داده می‌شود. حساب ورودی فعلی: <b>${escapeHtml(this.user?this.user.email:'')}</b></div>
      <button class="btn btn-outline" onclick="App.saveDeviceLabelFromInput()">${ic('save',16)}ذخیرهٔ نام دستگاه</button>
    </div>
    <div class="card">
      <label>نام کسب‌وکار</label>
      <input id="set-name" value="${escapeHtml(s.businessName)}">
      <label>واحد پول</label>
      <select id="set-currency">
        <option value="افغانی" ${s.currency==='افغانی'?'selected':''}>افغانی</option>
        <option value="دالر" ${s.currency==='دالر'?'selected':''}>دالر</option>
        <option value="کلدار" ${s.currency==='کلدار'?'selected':''}>کلدار پاکستانی</option>
      </select>
      <label>موجودی نقد آغازین صندوق</label>
      <input id="set-cash" type="number" value="${s.openingCash}">
      <label>نرخ فعلی دالر (۱ دالر = چند ${s.currency}؟)</label>
      <input id="set-usdrate" type="number" inputmode="decimal" value="${s.usdRate||''}" placeholder="مثلاً 70">
      <div class="field-note">این نرخ برای تبدیل خودکار خریدها و بدهی‌های دالری به ${s.currency} استفاده می‌شود. بهتر است هر روز که خرید دالری دارید، این نرخ را به‌روز کنید (یا از دکمهٔ «نرخ دالر» در داشبورد/فرم خرید استفاده کنید).</div>
      <label>حد هشدار «کم‌موجودی» (چند واحد یا کمتر، کم‌موجود حساب شود)</label>
      <input id="set-lowstock" type="number" value="${s.lowStockThreshold!==undefined?s.lowStockThreshold:1}">
      <hr class="divider">
      <div class="row-item"><span class="avt neu">${ic('lock',16)}</span><div class="r-left"><b>قفل PIN اپ</b><span class="sub">قفل محلی برای همین حساب کاربری شما</span></div><div class="r-right"><button class="btn btn-outline btn-sm" onclick="App.resetPin()">حذف/تنظیم مجدد</button></div></div>
      <hr class="divider">
      <div class="field-note">این اطلاعات در بالای فاکتور فروش چاپ می‌شود.</div>
      <label>لوگو / آیکن فروشگاه (ایموجی)</label>
      <input id="set-logo" value="${escapeHtml(s.logoEmoji||'🏪')}" placeholder="🏪">
      <label>شماره تماس فروشگاه</label>
      <input id="set-phone" value="${escapeHtml(s.businessPhone||'')}" placeholder="07xxxxxxxx">
      <label>آدرس فروشگاه</label>
      <input id="set-address" value="${escapeHtml(s.businessAddress||'')}" placeholder="مثلاً کابل، شهرنو">
      <hr class="divider">
      <label>یادداشت افتتاحیه (اختیاری — فقط یادداشت شماست، در هیچ محاسبه‌ای اثر ندارد)</label>
      <textarea id="set-opening-note" placeholder="مثلاً: قبل از استفاده از این سیستم تقریباً ۵۰۰,۰۰۰ افغانی مصرف شده بود که در حساب نقد فعلی از قبل لحاظ شده است">${escapeHtml(s.openingNote||'')}</textarea>
      <button class="btn btn-primary" onclick="App.saveSettings()">${ic('save',17)}ذخیره تنظیمات</button>
    </div>
    <h2 class="section-title">${ic('archive',17)}پشتیبان‌گیری و سینک</h2>
    <div class="card">
      <div class="field-note">این برنامه آفلاین هم کار می‌کند: هر تغییری روی گوشی شما فوراً ذخیره می‌شود و به‌محض وصل شدن اینترنت، خودکار با بقیهٔ اعضای تیم در فضای ابری سینک می‌شود (یک دیتابیس مشترک برای همه). دانلود/بازیابی فایل پشتیبان فقط برای نسخهٔ اضافی یا انتقال کامل داده به یک نصب جدید است.</div>
      <button class="btn btn-outline" onclick="App.exportBackup()">${ic('download',16)}دانلود فایل پشتیبان (JSON — برای بازیابی کامل)</button>
      <button class="btn btn-outline" onclick="App.exportBackupExcel()">${ic('sheet',16)}دانلود پشتیبان اکسل (برای مطالعه/حسابدار)</button>
      ${this.isOwner()?`
      <label style="margin-top:14px;">بازیابی از فایل پشتیبان</label>
      <div class="hint" style="color:var(--red-700);background:var(--red-050);border-color:oklch(89% .04 27);">${ic('alert-triangle',13)}این کار دیتابیس مشترک همهٔ کاربران را جایگزین می‌کند، نه فقط اطلاعات همین گوشی را.</div>
      <input type="file" accept="application/json" onchange="App.importBackup(this)">
      `:`<div class="field-note">بازیابی از فایل پشتیبان فقط برای مالک/مدیر در دسترس است.</div>`}
    </div>
    ${this.isOwner()?`
    <h2 class="section-title">${ic('alert-triangle',17)}منطقهٔ خطر</h2>
    <div class="card">
      <div class="hint" style="color:var(--red-700);background:var(--red-050);border-color:oklch(89% .04 27);">${ic('alert-triangle',13)}این کار همهٔ اطلاعات را برای همهٔ کاربران پاک می‌کند. قبل از پاک کردن، یک نسخهٔ پشتیبان خودکار دانلود می‌شود.</div>
      <button class="btn btn-danger" onclick="App.wipeAll()">${ic('trash',17)}پاک کردن همهٔ اطلاعات</button>
    </div>`:''}
    `;
  },
};

window.App = App;
App.init();