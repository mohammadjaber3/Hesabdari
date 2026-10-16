/* =====================================================================
   ledger.js — رویدادهای انبار/حساب و ابزارهای «تطبیق» (Reconcile)
   منطق خالص (بدون صفحه/Firebase) تا هم برنامه هم تست‌ها از یک کد استفاده کنند.
   ===================================================================== */
import { round2, round4, daysBetweenISO, addDaysISO } from "./core.js";

export const MOVEMENT_TYPES = ['PURCHASE','SALE','RETURN','WASTE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','OPENING','COST_CORRECTION'];
export const WASTE_CATEGORY = 'کاستی و ضایعات جنس';
export const WITHDRAWAL_CATEGORY = 'برداشت شخصی';
export const DEFAULT_WAREHOUSE = 'main';

/* ---------- یک حرکت انبار ---------- */
export function buildMovement({ id, ts, date, productId, warehouseId, type, quantityBase, unit, unitCost, userId, referenceType, referenceId, reason, stockBefore }){
  if(!MOVEMENT_TYPES.includes(type)) throw new Error('نوع حرکت انبار نامعتبر: '+type);
  const q = round4(quantityBase);
  const cost = round4(unitCost || 0);
  const m = {
    id, movementId: id, ts, date, productId, warehouseId: warehouseId || DEFAULT_WAREHOUSE,
    type, quantityBase: q, unit: unit || 'عدد', unitCost: cost, totalCost: round2(Math.abs(q) * cost),
    userId: userId || '', referenceType: referenceType || '', referenceId: referenceId || '', reason: reason || ''
  };
  if(typeof stockBefore === 'number' && stockBefore + q < -1e-9) m.negativeStock = true; // سیاست B: فروش منفی مجاز، ولی علامت می‌خورد
  return m;
}

/* ---------- ضایعات پول نقد را کم نمی‌کند ----------
   ضایعات = موجودی ↓ و زیان ↑ ، ولی صندوق دست‌نخورده. (پولِ خریدِ آن جنس قبلاً هنگام
   خرید پرداخت/بدهی ثبت شده؛ دوباره کم کردنش از صندوق «شمارش دوباره» است.) */
export function isNonCashExpense(e){
  return !!e && (e.nonCash === true || e.category === WASTE_CATEGORY);
}
export function cashExpensesTotal(expenses){
  return (expenses||[]).filter(e=>!isNonCashExpense(e)).reduce((a,e)=>a+(Number(e.amount)||0),0);
}

/* ---------- ابطال پرداخت (Reversal) — حذف نمی‌شود، رویداد معکوس ساخته می‌شود ---------- */
export function buildPaymentReversal({ original, id, ts, date, userId, reason }){
  if(!original) throw new Error('پرداخت اصلی پیدا نشد.');
  if(original.voided) throw new Error('این پرداخت قبلاً باطل شده است.');
  if(original.reversalOf) throw new Error('نمی‌شود یک برگشتِ پرداخت را دوباره باطل کرد.');
  const amt = Number(original.amount)||0;
  return {
    reversal: {
      ...original, id, ts, date, amount: -amt, reversalOf: original.id, status: 'reversal',
      allocatedAmount: -(Number(original.allocatedAmount)||0),
      note: 'ابطال پرداخت'+(reason?(' — '+reason):''), voidReason: reason||'', userId: userId||'',
      receiptImage: undefined
    },
    originalPatch: { voided: true, voidedTs: ts, voidedBy: userId||'', voidReason: reason||'', status: 'voided' }
  };
}

/* ---------- تخصیص پرداخت به فاکتور ---------- */
export function allocatePayment({ sale, amount }){
  const amt = Math.max(0, Number(amount)||0);
  if(!sale) return { applied: 0, unallocated: amt };
  const room = Math.max(0, Number(sale.remaining)||0);
  const applied = round2(Math.min(room, amt));
  return { applied, unallocated: round2(amt - applied) };
}

/* ---------- Reconcile (فقط گزارش می‌دهد؛ چیزی را خودکار عوض نمی‌کند) ---------- */
const EPS = 0.01;
const diffRow = (id, name, cached, expected) => ({ id, name, cached: round2(cached), expected: round2(expected), diff: round2(cached - expected) });

/* مانده مشتری = افتتاحیه + مجموع باقیماندهٔ فاکتورها − پرداخت‌های تخصیص‌نیافته
   (پرداخت‌های تخصیص‌یافته قبلاً در باقیماندهٔ فاکتور اثر کرده‌اند) */
export function reconcileCustomers({ customers, sales, payments, openingEntries }){
  return (customers||[]).map(c=>{
    const opening = (openingEntries||[]).filter(o=>o.partyType==='customers' && o.partyId===c.id).reduce((a,o)=>a+(Number(o.amount)||0),0);
    const owed = (sales||[]).filter(s=>s.customerId===c.id).reduce((a,s)=>a+(Number(s.remaining)||0),0);
    const unalloc = (payments||[]).filter(p=>p.type==='receive' && p.partyId===c.id).reduce((a,p)=>a+(Number(p.amount)||0)-(Number(p.allocatedAmount)||0),0);
    return diffRow(c.id, c.name, Number(c.balance)||0, opening + owed - unalloc);
  }).filter(r=>Math.abs(r.diff) > EPS);
}
export function reconcileSuppliers({ suppliers, purchases, payments, openingEntries }){
  const out = [];
  (suppliers||[]).forEach(s=>{
    ['AFN','USD'].forEach(cur=>{
      const field = cur==='USD' ? 'balanceUSD' : 'balance';
      const opening = (openingEntries||[]).filter(o=>o.partyType==='suppliers' && o.partyId===s.id && (o.currency||'AFN')===cur).reduce((a,o)=>a+(Number(o.amount)||0),0);
      const owed = (purchases||[]).filter(p=>p.supplierId===s.id && (p.currency||'AFN')===cur).reduce((a,p)=>a+(Number(p.remaining)||0),0);
      const paidLater = (payments||[]).filter(p=>p.type==='pay' && p.partyId===s.id && (p.currency||'AFN')===cur).reduce((a,p)=>a+(Number(p.amount)||0)-(Number(p.allocatedAmount)||0),0);
      const r = diffRow(s.id, s.name+(cur==='USD'?' ($)':''), Number(s[field])||0, opening + owed - paidLater);
      if(Math.abs(r.diff) > EPS) out.push(r);
    });
  });
  return out;
}
/* موجودی هر کالا باید با مجموع حرکت‌های Stock Ledger برابر باشد */
export function reconcileStock({ products, movements }){
  const sums = {};
  (movements||[]).forEach(m=>{ sums[m.productId] = (sums[m.productId]||0) + (Number(m.quantityBase)||0); });
  return (products||[]).map(p=>diffRow(p.id, p.name, Number(p.stock)||0, sums[p.id]||0)).filter(r=>Math.abs(r.diff) > 0.0005);
}
/* فاکتور: total = subtotal − discount ، remaining = total − paid − settled ، و total با اقلام یکی باشد */
export function reconcileInvoices({ sales }){
  const out = [];
  (sales||[]).forEach(s=>{
    const sub = (s.items||[]).reduce((a,it)=>a+Math.max(0,(Number(it.qty)||0)-(Number(it.returnedQty)||0))*(Number(it.unitPrice)||0),0);
    const expTotal = Math.max(0, round2(sub - (Number(s.discount)||0)));
    const expRemaining = round2(expTotal - (Number(s.paid)||0) - (Number(s.settled)||0));
    const totalOff = Math.abs(round2(Number(s.total)||0) - expTotal) > EPS;
    const remOff = s.status!=='cancelled' && Math.abs(round2(Number(s.remaining)||0) - Math.max(0,expRemaining)) > EPS;
    if(totalOff || remOff) out.push({ id:s.id, name:s.customerName||'', cachedTotal:round2(s.total), expectedTotal:expTotal, cachedRemaining:round2(s.remaining), expectedRemaining:Math.max(0,expRemaining) });
  });
  return out;
}
export function negativeStockProducts(products){
  return (products||[]).filter(p=>(Number(p.stock)||0) < -1e-9).map(p=>({ id:p.id, name:p.name, stock:round4(p.stock) }));
}

/* ---------- Audit ---------- */
export const AUDIT_ACTIONS = ['create','edit','void','reverse','cancel','adjust','restore','wipe','return','allocate'];
export function buildAuditEntry({ id, ts, action, entityType, entityId, userId, userRole, before, after }){
  return { id, ts, action, entityType, entityId, userId: userId||'', userRole: userRole||'',
    before: before === undefined ? null : before, after: after === undefined ? null : after };
}
/* خلاصهٔ کم‌حجم از فاکتور/خرید برای before/after */
export function summarizeDoc(d){
  if(!d) return null;
  const keep = ['id','date','total','paid','settled','remaining','discount','status','amount','partyId','customerId','supplierId','stock','balance','balanceUSD','invoiceNo','lastEditReason','cancelledTs'];
  const out = {}; keep.forEach(k=>{ if(d[k] !== undefined) out[k] = d[k]; });
  if(Array.isArray(d.items)) out.itemsCount = d.items.length;
  return out;
}


/* =====================================================================
   مرجوعی / لغو / کاستی به‌صورت «رویداد جدا» + گزارش ناخالص و خالص
   ---------------------------------------------------------------------
   فاکتور اصلی تاریخ خودش را حفظ می‌کند. هر مرجوعی/لغو/کاستی یک سند جدا در
   کالکشن returns است (با تاریخ خودش). روی فاکتور فقط دو عددِ جمع‌شده
   (returnedAmount و returnedCost) نگه داشته می‌شود که همیشه از رویدادها
   قابل بازسازی و تطبیق است.
   ===================================================================== */
export const RETURN_KINDS = ['return','cancel','shortage'];

/* amount = مقداری که «مجموع فاکتور» واقعاً از آن کم شد؛ cost = قیمت تمام‌شده‌ای که به انبار برگشت */
export function buildReturnEvent({ id, ts, date, sale, kind, items, amount, cost, reason, userId, cashRefund, debtReduction, releasedSettled }){
  if(!sale) throw new Error('فاکتور اصلی پیدا نشد.');
  if(!RETURN_KINDS.includes(kind)) throw new Error('نوع رویداد نامعتبر: '+kind);
  const list = (items||[]).map(it=>({
    productId: it.productId || '', name: it.name || '', qty: round4(it.qty), unit: it.unit || 'عدد',
    qtyLabel: it.qtyLabel || '', unitPrice: round2(it.unitPrice), cost: round4(it.cost || 0),
    amount: round2(it.amount != null ? it.amount : (Number(it.qty)||0) * (Number(it.unitPrice)||0))
  }));
  return {
    id, returnId: id, originalSaleId: sale.id, customerId: sale.customerId || '', customerName: sale.customerName || '',
    ts, date, kind, items: list,
    quantities: round4(list.reduce((a,x)=>a + x.qty, 0)),
    amount: round2(amount), cost: round2(cost || 0), reason: reason || '', userId: userId || '',
    cashRefund: round2(cashRefund || 0), debtReduction: round2(debtReduction || 0), releasedSettled: round2(releasedSettled || 0)
  };
}

function sumBy(arr, f){ return (arr||[]).reduce((a,x)=>a + (Number(f(x))||0), 0); }
/* مجموع مرجوعیِ یک فاکتور؛ اگر فیلد جمع‌شده نبود از آرایهٔ قدیمی sale.returns */
export function saleReturnedAmount(s){
  if(s && s.returnedAmount !== undefined && s.returnedAmount !== null) return Number(s.returnedAmount)||0;
  return sumBy(s && s.returns, r=>r.amount);
}
export function saleReturnedCost(s){ return Number(s && s.returnedCost) || 0; }

/* گزارش یک بازه:
   فروش ناخالص (با تاریخ خود فاکتور، پیش از تخفیف و مرجوعی) − تخفیف − مرجوعی (با تاریخ خود مرجوعی) = فروش خالص
   بهای تمام‌شده هم همین‌طور: بهای فروش‌های بازه − بهای کالاهای برگشتی در بازه. */
export function salesSummary({ sales, returns, from, to }){
  const inRange = (d)=> d >= from && d <= to;
  const periodSales = (sales||[]).filter(s=>inRange(s.date));
  const periodReturns = (returns||[]).filter(r=>inRange(r.date));
  const gross = round2(sumBy(periodSales, s=>(Number(s.total)||0) + (Number(s.discount)||0) + saleReturnedAmount(s)));
  const discounts = round2(sumBy(periodSales, s=>s.discount));
  const returnsAmount = round2(sumBy(periodReturns, r=>r.amount));
  const net = round2(gross - discounts - returnsAmount);
  const cogsGross = round2(sumBy(periodSales, s=>(Number(s.totalCost)||0) + saleReturnedCost(s)));
  const cogsReturned = round2(sumBy(periodReturns, r=>r.cost));
  const cogs = round2(cogsGross - cogsReturned);
  return {
    gross, discounts, returns: returnsAmount, net,
    cogsGross, cogsReturned, cogs, grossProfit: round2(net - cogs),
    invoices: periodSales.filter(s=>s.status!=='cancelled').length,
    cancelledInvoices: periodSales.filter(s=>s.status==='cancelled').length,
    returnEvents: periodReturns.length
  };
}

/* تطبیق: returnedAmount روی فاکتور باید با مجموع رویدادهای همان فاکتور برابر باشد */
export function reconcileReturns({ sales, returns }){
  const byId = {};
  (returns||[]).forEach(r=>{ byId[r.originalSaleId] = (byId[r.originalSaleId]||0) + (Number(r.amount)||0); });
  const out = [];
  (sales||[]).forEach(s=>{
    const cached = saleReturnedAmount(s), expected = byId[s.id] || 0;
    if(Math.abs(cached - expected) > EPS) out.push({ id:s.id, name:s.customerName||'', cached:round2(cached), expected:round2(expected), diff:round2(cached-expected) });
  });
  const known = new Set((sales||[]).map(s=>s.id));
  Object.keys(byId).forEach(id=>{ if(!known.has(id)) out.push({ id, name:'(فاکتور پیدا نشد)', cached:0, expected:round2(byId[id]), diff:round2(-byId[id]) }); });
  return out;
}


/* =====================================================================
   سود به تفکیک محصول (بر اساس تاریخ فاکتور، پس از کسر مرجوعیِ ثبت‌شده روی قلم‌ها)
   تخفیف کلی فاکتور به نسبت مبلغ هر قلم پخش می‌شود. چون مرجوعی‌ها اینجا با تاریخِ خودِ فاکتور
   حساب می‌شوند (نه تاریخ مرجوعی)، جمع این جدول ممکن است با «سود ناخالص» گزارش کمی فرق کند.
   ===================================================================== */
export function productProfitSummary({ sales, from, to }){
  const map = new Map();
  (sales||[]).filter(s=>s && s.status!=='cancelled' && s.date>=from && s.date<=to).forEach(s=>{
    const rows = (s.items||[]).map(it=>{
      const q = Math.max(0, (Number(it.qty)||0) - (Number(it.returnedQty)||0));
      return { it, q, rev: q * Math.max(0, Number(it.unitPrice)||0) };
    });
    const sub = rows.reduce((a,x)=>a+x.rev, 0);
    const disc = Math.min(sub, Math.max(0, Number(s.discount)||0));
    rows.forEach(x=>{
      if(x.q <= 0) return;
      const revenue = x.rev - (sub > 0 ? disc * x.rev / sub : 0);
      const cost = x.q * (Number(x.it.cost)||0);
      const key = x.it.productId || x.it.name || '?';
      const cur = map.get(key) || { id:key, name:x.it.name||'', revenue:0, cost:0, profit:0, qty:0 };
      cur.revenue += revenue; cur.cost += cost; cur.profit += revenue - cost; cur.qty += x.q;
      map.set(key, cur);
    });
  });
  return Array.from(map.values()).map(r=>({ ...r, revenue:round2(r.revenue), cost:round2(r.cost), profit:round2(r.profit), qty:round4(r.qty) }))
    .sort((a,b)=>b.profit-a.profit);
}

/* =====================================================================
   سن بدهی مشتریان
   مانده هر مشتری مرجع است. اگر مانده از مجموع باقیماندهٔ فاکتورها کمتر بود (یعنی پرداخت
   تخصیص‌نیافته دارد)، آن مبلغ از قدیمی‌ترین فاکتورها کم می‌شود. اگر بیشتر بود (مانده
   افتتاحیه/قدیمی بدون فاکتور)، در گروه «بدون فاکتور» می‌آید.
   ===================================================================== */
export const AGING_BUCKETS = [
  { key:'d0_30',  label:'۰ تا ۳۰ روز',   max:30 },
  { key:'d31_60', label:'۳۱ تا ۶۰ روز',  max:60 },
  { key:'d61_90', label:'۶۱ تا ۹۰ روز',  max:90 },
  { key:'d90p',   label:'بیش از ۹۰ روز', max:Infinity }
];
function agingKey(age){ return (AGING_BUCKETS.find(b=>age<=b.max)||AGING_BUCKETS[AGING_BUCKETS.length-1]).key; }
export function debtAging({ customers, sales, today }){
  const inv = new Map();
  (sales||[]).forEach(s=>{
    const r = Number(s && s.remaining) || 0;
    if(!s || s.status==='cancelled' || r <= 0.001) return;
    const list = inv.get(s.customerId) || []; list.push({ date:s.date, remaining:r }); inv.set(s.customerId, list);
  });
  const totals = { d0_30:0, d31_60:0, d61_90:0, d90p:0, noInvoice:0, total:0 };
  const rows = [];
  (customers||[]).forEach(c=>{
    const bal = Number(c.balance) || 0;
    if(bal <= 0.001) return;
    const list = (inv.get(c.id)||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const sum = list.reduce((a,x)=>a+x.remaining, 0);
    let credit = Math.max(0, sum - bal);
    const per = { d0_30:0, d31_60:0, d61_90:0, d90p:0, noInvoice:0 };
    let oldest = 0;
    list.forEach(x=>{
      const used = Math.min(credit, x.remaining); credit -= used;
      const left = x.remaining - used;
      if(left <= 0.001) return;
      const age = Math.max(0, daysBetweenISO(x.date, today));
      per[agingKey(age)] += left; if(age > oldest) oldest = age;
    });
    per.noInvoice = Math.max(0, bal - sum);
    Object.keys(per).forEach(k=>{ per[k] = round2(per[k]); totals[k] = round2(totals[k] + per[k]); });
    totals.total = round2(totals.total + bal);
    rows.push({ id:c.id, name:c.name||'', balance:round2(bal), oldestDays:oldest, ...per });
  });
  rows.sort((a,b)=>b.balance-a.balance);
  return { totals, rows };
}

/* =====================================================================
   نقاط نمودار روند: هر «نقطه» یک بازهٔ زمانی است.
   - تا ۴۵ روز: هر روز یک نقطه
   - تا ۱۸۰ روز: هر هفته یک نقطه (بدون بریدن بی‌صدای بازه)
   - بیشتر: هر ۳۰ روز
   دورهٔ «امروز» (کمتر از ۷ روز) به ۷ روز آخر گسترش می‌یابد تا نمودار خالی نباشد.
   ===================================================================== */
export function trendBuckets({ sales, returns, expenses, start, end }){
  let s = start;
  const n0 = daysBetweenISO(start, end) + 1;
  if(n0 < 7) s = addDaysISO(end, -6);
  const n = daysBetweenISO(s, end) + 1;
  const step = n <= 45 ? 1 : n <= 180 ? 7 : 30;
  const buckets = [];
  for(let i = 0; i < n; i += step){
    const from = addDaysISO(s, i);
    const to = addDaysISO(s, Math.min(n - 1, i + step - 1));
    const sm = salesSummary({ sales, returns, from, to });
    const exp = round2((expenses||[]).filter(x=>x.date>=from && x.date<=to && x.category!==WITHDRAWAL_CATEGORY)
      .reduce((a,x)=>a+(Number(x.amount)||0),0));
    buckets.push({ from, to, sales: sm.net, grossProfit: sm.grossProfit, expenses: exp,
      profit: round2(sm.grossProfit - exp), invoices: sm.invoices });
  }
  return { buckets, step };
}
