/* ---------- جستجو و فیلتر لیست‌ها (مشتری‌ها، محصولات، تاریخچه) ----------
   فقط نمایش است؛ هیچ داده یا محاسبه‌ای را تغییر نمی‌دهد. */
import { escapeHtml, ic } from './helpers.js';

// نرمال‌سازی فارسی: «ي/ك» عربی → فارسی، ارقام فارسی/عربی → لاتین، حذف اعراب و کشیده
export function normQ(s){
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[يى]/g,'ی').replace(/ك/g,'ک')
    .replace(/[\u064B-\u065F\u0640\u200C]/g,'')
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/\s+/g,' ').trim();
}

// همهٔ کلمات جستجو باید در یکی از فیلدها (هر ترتیبی) پیدا شوند
export function matchQ(q, ...fields){
  const terms = normQ(q).split(' ').filter(Boolean);
  if(!terms.length) return true;
  const hay = normQ(fields.filter(x => x != null && x !== '').join(' '));
  return terms.every(t => hay.includes(t));
}

// نوار جستجو + چیپ‌های فیلتر. key شناسهٔ لیست است.
export function listBar({key, placeholder, q, chips, active}){
  const chipHtml = chips && chips.length
    ? `<div class="chip-row">${chips.map(c =>
        `<button type="button" class="fchip${active===c.k?' active':''}" aria-pressed="${active===c.k}" onclick="App.setListFilter('${key}','${c.k}')">${escapeHtml(c.label)}${c.count!==undefined?`<span class="fchip-n num">${c.count}</span>`:''}</button>`
      ).join('')}</div>` : '';
  return `<div class="list-tools">
    <div class="search-box">${ic('search',16)}
      <input id="lq-${key}" type="search" value="${escapeHtml(q||'')}" placeholder="${escapeHtml(placeholder||'جستجو')}" autocomplete="off" enterkeyhint="search"
        oninput="App.setListQuery('${key}', this.value, this.selectionStart)">
      ${q?`<button type="button" class="search-clear" onclick="App.setListQuery('${key}','',0)" aria-label="پاک کردن جستجو">×</button>`:''}
    </div>
    ${chipHtml}
  </div>`;
}

export function noMatchHtml(){
  return `<div class="empty"><span class="ic">${ic('search',26)}</span><b>موردی پیدا نشد</b>جستجو یا فیلتر را تغییر بدهید</div>`;
}
