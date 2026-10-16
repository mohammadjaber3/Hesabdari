/* ---------- توابع کمکی مشترک: قالب‌بندی عدد و تاریخ، آیکون‌ها، ابزار فایل ----------
   (از app.js جدا شد؛ رفتار بدون تغییر است) */
import { dateLabelFa, startOfWeekISO, startOfMonthISO } from "./core.js";

export function uid(){ return 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8); }

export function immutableInvoiceNo(id,prefix){
  const raw=String(id||'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
  const stamp=raw.slice(2,8) || Date.now().toString(36).slice(-6).toUpperCase();
  const tail=raw.slice(-6) || Math.random().toString(36).slice(2,8).toUpperCase();
  return String(prefix||'S')+'-'+stamp+'-'+tail;
}

export function getDeviceId(){
  let id;
  try{ id = localStorage.getItem('hesabdari_device_id'); }catch(e){}
  if(!id){
    id = 'dev_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    try{ localStorage.setItem('hesabdari_device_id', id); }catch(e){}
  }
  return id;
}

export function getDeviceLabel(){
  try{ return localStorage.getItem('hesabdari_device_label') || ''; }catch(e){ return ''; }
}

export function setDeviceLabel(label){
  try{ localStorage.setItem('hesabdari_device_label', label||''); }catch(e){}
}

export function fmt(n){ n = Math.round(Number(n)||0); return n.toLocaleString('en-US'); }

export function fmt2(n){
  n = Number(n)||0;
  const neg = n<0; n = Math.abs(n);
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  return (neg?'-':'') + Number(intPart).toLocaleString('en-US') + '.' + decPart;
}

export function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export const _SAFE_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/;

export const _IMG_KEYS = new Set(['billImage','receiptImage','image','photo']);

export function sanitizeDoc(v, key){
  if(Array.isArray(v)) return v.map(x=>sanitizeDoc(x, key));
  if(v && typeof v==='object'){ const o={}; for(const k of Object.keys(v)) o[k]=sanitizeDoc(v[k], k); return o; }
  if(typeof v!=='string') return v;
  const k = key||'';
  if(_IMG_KEYS.has(k)) return (v==='' || _SAFE_IMG.test(v)) ? v : '';
  if(k==='id' || /Id$/.test(k)) return v.replace(/[^A-Za-z0-9_.:\-]/g,'');
  if(k==='date' || /Date$/.test(k)) return v.replace(/[^0-9\-:T.+Z ]/g,'');
  return v;
}

export function sum(arr,key){ return arr.reduce((a,b)=>a+(Number(b[key])||0),0); }

export function _loadImageFromFile(file){
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

export function _resizeImageToDataUrl(img, maxDim, quality){
  let w=img.width, h=img.height;
  if(w>=h && w>maxDim){ h=Math.round(h*maxDim/w); w=maxDim; }
  else if(h>w && h>maxDim){ w=Math.round(w*maxDim/h); h=maxDim; }
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  canvas.getContext('2d').drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function compressImageForStorage(file){
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

export function dateLabel(d){ return dateLabelFa(d); }

export function startOfWeek(d){ return startOfWeekISO(d, 6); }

export function startOfMonth(d){ return startOfMonthISO(d); }

export const ICON_PATHS = {
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

export const XLSX_JS_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

export const _scriptLoadPromises = {};

export function loadExternalScript(url){
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

export function ic(name, size, extraClass){
  const d = ICON_PATHS[name];
  if(!d) return '';
  const s = size || 18;
  return '<svg class="icn'+(extraClass?' '+extraClass:'')+'" viewBox="0 0 24 24" width="'+s+'" height="'+s+
    '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
}
