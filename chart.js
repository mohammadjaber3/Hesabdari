/* =====================================================================
   chart.js — نمودار روند فروش و سود (SVG خالص، بدون کتابخانهٔ بیرونی)
   - ستون‌ها: فروش خالص هر بازه (طلایی)
   - خط + ناحیه: سود خالص هر بازه (سبز؛ زیر صفر قرمز)
   - لمس/کلیک روی هر ستون: جزئیات همان بازه زیر نمودار
   - دکمه‌های راهنما: نمایش/پنهان کردن هر سری
   - بازه‌های طولانی: محور افقی اسکرول می‌شود و از آخرین (جدیدترین) بازه شروع می‌کند
   منطق خالص است (رشته HTML برمی‌گرداند) تا جدا تست شود.
   ===================================================================== */

const COL = {
  sales: '#C9922B',
  profit: '#227A57',
  loss: '#B5473A',
  grid: 'var(--line, #e6e6e6)',
  axis: 'var(--ink-500, #777)',
  sel: 'rgba(120,120,120,.13)'
};

function num(n){ const x = Number(n); return Number.isFinite(x) ? x : 0; }

/* گام «گرد» برای محور عمودی: ۱، ۲، ۲.۵، ۵ یا ۱۰ برابر توان ده */
export function niceStep(range, ticks){
  const raw = range / Math.max(1, ticks);
  if(!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * pow;
}

/* عدد کوتاه برای برچسب محور: 1,200,000 → 1.2M */
export function shortNum(n){
  const v = num(n), a = Math.abs(v);
  const trim = (x)=> String(Math.round(x*10)/10).replace(/\.0$/,'');
  if(a >= 1e9) return trim(v/1e9)+'B';
  if(a >= 1e6) return trim(v/1e6)+'M';
  if(a >= 1e3) return trim(v/1e3)+'K';
  return String(Math.round(v*100)/100);
}

export function fmtInt(n){ return Math.round(num(n)).toLocaleString('en-US'); }

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const r1 = (x)=> Math.round(x*10)/10;

/* بازهٔ محور عمودی «گرد» برای یک سری؛ includeZero یعنی صفر همیشه دیده شود */
function scaleFor(vals, includeZero){
  let lo = Math.min.apply(null, vals.concat(includeZero ? [0] : []));
  let hi = Math.max.apply(null, vals.concat(includeZero ? [0] : []));
  if(hi === lo){ hi = lo + 4; }
  const step = niceStep(hi - lo, 3);
  const kLo = Math.floor(lo / step), kHi = Math.ceil(hi / step);
  return { lo: kLo*step, hi: kHi*step, step, kLo, kHi };
}

/* buckets: [{ label, title, from, to, sales, profit, expenses, grossProfit, invoices }]
   hidden: ['sales'|'profit'] پنهان‌ها ؛ sel: اندیس بازهٔ انتخاب‌شده
   دو پنل جدا: فروش (خط + ناحیه، محور خودش) و سود (ستون سبز/قرمز، محور خودش).
   سود روزانه چند صد افغانی است و فروش چند ده هزار؛ روی یک محور سود دیده نمی‌شد. */
export function buildTrendChart({ buckets, hidden, sel, cur, rangeNote, pickFn, toggleFn }){
  const list = buckets || [];
  const n = list.length;
  const hid = hidden || [];
  const showS = hid.indexOf('sales') < 0, showP = hid.indexOf('profit') < 0;
  const selI = Math.min(Math.max(0, sel == null ? n - 1 : sel), Math.max(0, n - 1));

  const L = 56, R = 12, CAP = 18, GAP = 14, XL = 26, T = 6;
  const band = 36;
  const W = Math.max(330, n * band + L + R);
  const pw = W - L - R;
  const both = showS && showP;
  const plotS = both ? 104 : 150;
  const plotP = both ? 96 : 150;
  const H = T + (showS ? CAP + plotS : 0) + (both ? GAP : 0) + (showP ? CAP + plotP : 0) + XL;
  if(!n || (!showS && !showP)){
    return buildChips(showS, showP, toggleFn) + '<div class="field-note">یک سری را روشن کنید.</div>';
  }

  const sv = list.map(b=>num(b.sales)), pv = list.map(b=>num(b.profit));
  const X = (i)=> L + band * (i + 0.5);
  const selX = L + band * selI;
  let g = '';

  /* ---- پنل فروش ---- */
  const aTop = T + CAP, aBot = aTop + plotS;
  let yA = null, zeroA = null;
  if(showS){
    const sc = scaleFor(sv, true);
    yA = (v)=> aBot - ((v - sc.lo) / (sc.hi - sc.lo)) * plotS;
    zeroA = r1(yA(0));
    g += '<text x="4" y="'+(T+11)+'" font-size="10.5" font-weight="700" fill="'+COL.sales+'">فروش خالص</text>';
    for(let k = sc.kLo; k <= sc.kHi; k++){
      const v = k * sc.step, y = r1(yA(v));
      g += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="'+(k===0?'var(--ink-400, #999)':COL.grid)+'" stroke-width="'+(k===0?1.2:1)+'"'+(k===0?'':' stroke-dasharray="3 4"')+'/>';
      g += '<text x="'+(L-7)+'" y="'+(y+3.5)+'" text-anchor="end" font-size="10.5" fill="'+COL.axis+'">'+esc(shortNum(v))+'</text>';
    }
  }

  /* ---- پنل سود ---- */
  const pTop = (showS ? aBot + (both ? GAP : 0) + CAP : T + CAP), pBot = pTop + plotP;
  let yP = null, zeroP = null;
  if(showP){
    const sc = scaleFor(pv, true);
    yP = (v)=> pBot - ((v - sc.lo) / (sc.hi - sc.lo)) * plotP;
    zeroP = r1(yP(0));
    g += '<text x="4" y="'+(pTop-7)+'" font-size="10.5" font-weight="700" fill="'+COL.profit+'">سود خالص</text>';
    for(let k = sc.kLo; k <= sc.kHi; k++){
      const v = k * sc.step, y = r1(yP(v));
      g += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="'+(k===0?'var(--ink-400, #999)':COL.grid)+'" stroke-width="'+(k===0?1.2:1)+'"'+(k===0?'':' stroke-dasharray="3 4"')+'/>';
      g += '<text x="'+(L-7)+'" y="'+(y+3.5)+'" text-anchor="end" font-size="10.5" fill="'+COL.axis+'">'+esc(shortNum(v))+'</text>';
    }
  }

  /* ---- ناحیهٔ انتخاب‌شده (روی هر دو پنل) ---- */
  const hlTop = showS ? T + CAP - 4 : pTop - 4;
  const hlBot = showP ? pBot + 4 : aBot + 4;
  g += '<rect x="'+r1(selX+2)+'" y="'+hlTop+'" width="'+(band-4)+'" height="'+r1(hlBot-hlTop)+'" rx="6" fill="'+COL.sel+'"/>';

  /* ---- خط فروش + ناحیه + نقطه ---- */
  if(showS){
    const pts = sv.map((v,i)=>[r1(X(i)), r1(yA(v))]);
    g += '<path d="M'+pts[0][0]+' '+aBot+' L'+pts.map(p=>p[0]+' '+p[1]).join(' L')+' L'+pts[pts.length-1][0]+' '+aBot+' Z" fill="'+COL.sales+'" fill-opacity=".16"/>';
    if(pts.length > 1) g += '<polyline points="'+pts.map(p=>p[0]+','+p[1]).join(' ')+'" fill="none" stroke="'+COL.sales+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    pts.forEach((p,i)=>{
      const isSel = i === selI;
      g += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(isSel?5.5:3)+'" fill="'+COL.sales+'" stroke="var(--surface, #fff)" stroke-width="'+(isSel?2:1.2)+'"/>';
    });
  }

  /* ---- ستون‌های سود (سبز مثبت، قرمز منفی) ---- */
  if(showP) list.forEach((b,i)=>{
    const bw = Math.min(22, band*0.56);
    const y1 = yP(pv[i]);
    const top = r1(Math.min(y1, zeroP)), h = Math.max(1.2, r1(Math.abs(y1 - zeroP)));
    const col = pv[i] < 0 ? COL.loss : COL.profit;
    g += '<rect x="'+r1(X(i)-bw/2)+'" y="'+top+'" width="'+r1(bw)+'" height="'+h+'" rx="3" fill="'+col+'" fill-opacity="'+(i===selI?'1':'.7')+'"/>';
  });

  /* ---- برچسب افقی ---- */
  const every = Math.max(1, Math.ceil(48 / band));
  const xBase = H - 9;
  list.forEach((b,i)=>{
    if(i % every !== 0 && i !== n-1) return;
    const bold = i === selI;
    g += '<text x="'+r1(X(i))+'" y="'+xBase+'" text-anchor="middle" font-size="10.5" fill="'+(bold?'var(--ink-900, #222)':COL.axis)+'"'+(bold?' font-weight="700"':'')+'>'+esc(b.label)+'</text>';
  });

  /* ---- ناحیه‌های لمس ---- */
  if(pickFn) list.forEach((b,i)=>{
    const t = esc(b.title)+': فروش '+fmtInt(sv[i])+' · سود '+fmtInt(pv[i]);
    g += '<rect class="trend-hit" x="'+r1(L+band*i)+'" y="0" width="'+band+'" height="'+H+'" fill="transparent" role="button" tabindex="0" aria-label="'+t+'" onclick="'+pickFn+'('+i+')" onkeydown="if(event.key===\'Enter\')'+pickFn+'('+i+')"><title>'+t+'</title></rect>';
  });

  const svg = '<svg viewBox="0 0 '+W+' '+H+'" width="'+(W>330?W+'px':'100%')+'" role="img" aria-label="نمودار فروش و سود" style="display:block;font-family:inherit;user-select:none;-webkit-user-select:none">'+g+'</svg>';

  /* ---- جزئیات بازهٔ انتخاب‌شده ---- */
  const b = list[selI], pr = pv[selI];
  const detail = '<div class="trend-detail">'
    + '<div class="td-head"><b>'+esc(b.title)+'</b><span class="sub">'+(b.invoices||0)+' فاکتور</span></div>'
    + '<div class="td-grid">'
    +   '<div><span>فروش خالص</span><b class="num">'+fmtInt(sv[selI])+' '+esc(cur||'')+'</b></div>'
    +   '<div><span>سود خالص</span><b class="num '+(pr<0?'neg':'pos')+'">'+fmtInt(pr)+' '+esc(cur||'')+'</b></div>'
    +   '<div><span>مصارف</span><b class="num">'+fmtInt(b.expenses)+'</b></div>'
    +   '<div><span>سود ناخالص</span><b class="num">'+fmtInt(b.grossProfit)+'</b></div>'
    + '</div></div>';

  const totS = sv.reduce((a,x)=>a+x,0), totP = pv.reduce((a,x)=>a+x,0);
  const totals = '<div class="trend-total"><span>مجموع بازه'+(rangeNote?' ('+esc(rangeNote)+')':'')+'</span><span class="num">فروش '+fmtInt(totS)+' · سود <b class="'+(totP<0?'neg':'pos')+'">'+fmtInt(totP)+'</b></span></div>';

  const scroll = '<div class="trend-scroll" dir="rtl">'+svg+'</div>';
  return buildChips(showS, showP, toggleFn) + scroll + detail + totals;
}

function buildChips(showS, showP, toggleFn){
  const chip = (key, label, color, on)=>
    '<button type="button" class="trend-chip" aria-pressed="'+(on?'true':'false')+'"'+(toggleFn?' onclick="'+toggleFn+'(\''+key+'\')"':'')+'>'
    +'<i style="background:'+color+'"></i>'+esc(label)+'</button>';
  return '<div class="trend-chips">'+chip('sales','فروش خالص',COL.sales,showS)+chip('profit','سود خالص',COL.profit,showP)+'</div>';
}
