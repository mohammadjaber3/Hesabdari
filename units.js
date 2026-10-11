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

/* محصولی که «عدد داخلی» ندارد: خودِ واحد پایه (مثلاً «کارتن» یا «قوطی») واحد خرید/فروش است.
   مثال ۱: ککو — فقط ۱ کارتن (unit='کارتن')
   مثال ۲: کارتن ← قوطی بدون عدد داخلی (unit='قوطی'، packUnit='کارتن'، packPer=تعداد قوطی در کارتن) */
export function isBaseTradable(p){ return !!(p && p.baseTradable); }

/* نام واحد پایه برای نمایش: «عدد داخلی» یا (اگر واحد پایه قابل معامله است) نام خودش */
export function baseLabel(p){
  if(isBaseTradable(p)) return String((p&&p.unit)||'').trim() || 'عدد';
  return 'عدد داخلی';
}

/* از چهار فیلد فرم (نام/مقدار واحد بزرگ و میانی) ساختار بسته‌بندی را می‌سازد.
   سه حالت:
   ۱) واحد میانی با «چند عدد» بیشتر از ۱  → کارتن ← قوطی ← عدد داخلی (حالت قبلی، «عدد» پنهان)
   ۲) واحد میانی بدون «چند عدد»           → خودِ قوطی واحد پایه است (کارتن ← قوطی، بدون عدد داخلی)
   ۳) فقط یک نام و بدون ظرفیت              → تک‌واحدی (مثلاً فقط «کارتن»)
   (واحد بزرگ + ظرفیت بدون واحد میانی هم مثل قبل: کارتن ← عدد داخلی) */
export function buildPackaging({packName='', packPer=0, midName='', midPer=0}={}){
  packName=String(packName||'').trim(); midName=String(midName||'').trim();
  packPer=Number(packPer)||0; midPer=Number(midPer)||0;
  const hasMidInner = !!(midName && midPer>1);
  if(hasMidInner){
    const packSize=(packName && packPer>0) ? round2(packPer*midPer) : 0;
    return {ok:true, kind:'inner', unit:'عدد', baseTradable:false,
      midUnit:midName, midPer:round4(midPer),
      packUnit:packSize>1?packName:'', packPer:packSize>1?round4(packSize):0,
      packSize: packSize>1?packSize:0};
  }
  if(midName){
    // قوطی/بسته = واحد پایه
    if(packName && !(packPer>1)) return {ok:false, error:'برای «'+packName+'» بنویسید هر کدام چند '+midName+' دارد (بیشتر از ۱).'};
    if(packName && packName===midName) return {ok:false, error:'نام واحد بزرگ و واحد میانی نباید یکی باشد.'};
    return {ok:true, kind:'base', unit:midName, baseTradable:true, midUnit:'', midPer:0,
      packUnit:packName?packName:'', packPer:packName?round4(packPer):0, packSize:packName?packPer:0};
  }
  if(packName){
    if(packPer>1){
      // کارتن ← عدد داخلی (بدون واحد میانی)
      return {ok:true, kind:'inner', unit:'عدد', baseTradable:false, midUnit:'', midPer:0,
        packUnit:packName, packPer:round4(packPer), packSize:packPer};
    }
    // تک‌واحدی: فقط «کارتن»
    return {ok:true, kind:'single', unit:packName, baseTradable:true, midUnit:'', midPer:0,
      packUnit:'', packPer:0, packSize:0};
  }
  return {ok:false, error:'حداقل یک واحد (مثلاً کارتن یا قوطی) بنویسید.'};
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
  const packaged=all.filter(u=>u.key!=='base' || isBaseTradable(p));
  const configured=Array.isArray(p&&p.saleUnits) ? p.saleUnits.map(String) : null;
  return packaged.filter(u=>!configured || configured.includes(u.name));
}
/* خرید/فروش معمولی فقط در واحدهای بسته‌بندی‌شده؛ «عدد» واحد داخلی است */
export function transactionUnits(p){
  return productUnits(p).filter(u=>u.key!=='base' || isBaseTradable(p));
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
    if(u.factor===1){ // واحد پایهٔ قابل معامله (بدون عدد داخلی): باقی‌مانده همان است
      if(q>0.0005) parts.push(fmtQty(round2(q))+' '+u.name);
      q=0; continue;
    }
    const n=Math.floor(q/u.factor+1e-9);
    if(n>0){ parts.push(fmtQty(n)+' '+u.name); q-=n*u.factor; }
  }
  // باقی‌ماندهٔ کمتر از کوچک‌ترین واحد بسته‌بندی (مثلاً ۳ عدد) قبلاً نمایش داده نمی‌شد و موجودی کمتر از واقعیت دیده می‌شد
  const baseName=productUnits(p).find(u=>u.key==='base').name;
  if(q>0.0005) parts.push(fmtQty(q)+' '+baseName);
  if(!parts.length) parts.push('0 '+ladder[ladder.length-1].name);
  return (neg?'-':'')+parts.join(' و ');
}
