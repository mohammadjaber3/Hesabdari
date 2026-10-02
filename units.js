/* =====================================================================
   units.js — واحدهای تو در تو (کارتن ← قوطی/بسته ← عدد داخلی)
   منطق خالص؛ دقیقاً همان کدی که قبلاً داخل App بود، بدون تغییر رفتار،
   تا هم برنامه هم تست‌ها از یک کد واحد استفاده کنند.
   ===================================================================== */
import { round2, round4, fmtQty } from "./core.js";

/* محصولات قدیمی (unit=قوطی و unitQty=24) را به مدل جدید تبدیل می‌کند */
export function normalizeProductUnitsRecord(raw){
  const p={...raw};
  const oldUnit=String(p.unit||'عدد').trim();
  const oldQty=Number(p.unitQty)||1;
  if(oldUnit!=='عدد' && oldQty>1 && !p.midUnit){
    const oldStock=Number(p.stock)||0;
    const oldAvg=Number(p.avgCost)||0;
    const oldSell=Number(p.sellPrice)||0;
    p.unit='عدد';
    p.unitQty=1;
    p.midUnit=oldUnit;
    p.midPer=oldQty;
    p.stock=round4(oldStock*oldQty);
    p.avgCost=round4(oldAvg/oldQty);
    p.sellPrice=round2(oldSell/oldQty);
    p.sellPriceMid=Number(p.sellPriceMid)>0?Number(p.sellPriceMid):round2(oldSell);
    if(p.packUnit && Number(p.packPer)>0 && Number(p.packPer)<=oldQty){
      p.packPer=round4(Number(p.packPer)*oldQty);
    }
    p.defaultSaleUnit=p.defaultSaleUnit===oldUnit ? oldUnit : (p.packUnit||oldUnit);
    p.saleUnits=Array.isArray(p.saleUnits)?p.saleUnits:[p.packUnit||oldUnit];
    p._unitSchemaMigrated=true;
  }
  return p;
}

export function productUnits(p){
  const rawUnit = (p && p.unit) ? String(p.unit).trim() : 'عدد';
  const legacyMid = !p?.midUnit && Number(p?.unitQty)>1 && rawUnit!=='عدد';
  const base = legacyMid ? 'عدد' : rawUnit;
  const out = [];
  const midPer = legacyMid ? Number(p.unitQty) : Number(p && p.midPer)||0;
  const midUnit = legacyMid ? rawUnit : (p && p.midUnit ? String(p.midUnit).trim() : '');
  const packPer = Number(p && p.packPer)||0;
  const packUnit = p && p.packUnit ? String(p.packUnit).trim() : '';
  if(packUnit && packPer>1) out.push({key:'pack', name:packUnit, factor:packPer});
  if(midUnit && midPer>1) out.push({key:'mid', name:midUnit, factor:midPer});
  out.push({key:'base', name:base, factor:1});
  return out;
}
export function saleUnits(p){
  const all=productUnits(p);
  const packaged=all.filter(u=>u.key!=='base');
  const configured=Array.isArray(p&&p.saleUnits) ? p.saleUnits.map(String) : null;
  return packaged.filter(u=>!configured || configured.includes(u.name));
}
/* خرید/فروش معمولی فقط در واحدهای بسته‌بندی‌شده؛ «عدد» واحد داخلی است */
export function transactionUnits(p){
  return productUnits(p).filter(u=>u.key!=='base');
}
export function unitByName(p, name){
  const ladder=productUnits(p);
  return ladder.find(u=>u.name===name) || ladder[ladder.length-1];
}
export function unitSellPrice(p, u){
  if(!p||!u) return 0;
  if(u.key==='pack' && Number(p.sellPricePack)>0) return Number(p.sellPricePack);
  return round2((Number(p.sellPrice)||0)*u.factor);
}
/* موجودی به‌صورت «۹ کارتن و ۳ قوطی» (نه ۱۲۹۹ عدد) */
export function qtyBreakdown(p, baseQty){
  const q0=Number(baseQty)||0;
  const neg=q0<0; let q=Math.abs(q0);
  const ladder=saleUnits(p);
  if(!ladder.length) return (neg?'-':'')+fmtQty(q);
  const parts=[];
  for(const u of ladder){
    const n=Math.floor(q/u.factor+1e-9);
    if(n>0){ parts.push(fmtQty(n)+' '+u.name); q-=n*u.factor; }
  }
  if(!parts.length) parts.push('0 '+ladder[ladder.length-1].name);
  return (neg?'-':'')+parts.join(' و ');
}
