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

/* buckets: [{ label:'10-16', title:'جمعه ۲۰۲۶-۱۰-۱۶', from, to, sales, profit, expenses, invoices }]
   hidden: ['sales'|'profit'] سری‌های پنهان ؛ sel: اندیس بازهٔ انتخاب‌شده ؛ cur: واحد پول
   toggleFn / pickFn: نام تابع‌های سراسری (App) که کلیک‌ها را می‌گیرند */
export function buildTrendChart({ buckets, hidden, sel, cur, rangeNote, pickFn, toggleFn }){
  const list = buckets || [];
  const n = list.length;
  const hid = hidden || [];
  const showS = hid.indexOf('sales') < 0, showP = hid.indexOf('profit') < 0;
  const selI = Math.min(Math.max(0, sel == null ? n - 1 : sel), Math.max(0, n - 1));

  /* ---- ابعاد: هر بازه ستونی با عرض ثابت؛ اگر زیاد بود، SVG عریض‌تر و اسکرول می‌شود ---- */
  const H = 236, L = 50, R = 14, T = 16, B = 30;
  const band = 36;
  const W = Math.max(330, n * band + L + R);
  const pw = W - L - R, ph = H - T - B;

  const sv = list.map(b=>num(b.sales)), pv = list.map(b=>num(b.profit));
  const all = [0].concat(showS ? sv : [], showP ? pv : []);
  let lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  if(hi === lo) hi = lo + 4;   // همه صفر: محور ۰ تا ۴ (گام ۱) نه ۰٫۲۵
  const yStep = niceStep(hi - lo, 4);
  const kLo = Math.floor(lo / yStep), kHi = Math.ceil(hi / yStep);
  lo = kLo * yStep; hi = kHi * yStep;

  const X = (i)=> L + band * (i + 0.5);
  const Y = (v)=> T + ph - ((v - lo) / (hi - lo)) * ph;
  const zeroY = r1(Y(0));

  let g = '';
  /* خطوط شبکه و برچسب محور عمودی */
  for(let k = kLo; k <= kHi; k++){
    const v = k * yStep;
    const y = r1(Y(v));
    const isZero = k === 0;
    g += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="'+(isZero?'var(--ink-400, #999)':COL.grid)+'" stroke-width="'+(isZero?1.2:1)+'"'+(isZero?'':' stroke-dasharray="3 4"')+'/>';
    g += '<text x="'+(L-7)+'" y="'+(y+3.5)+'" text-anchor="end" font-size="10.5" fill="'+COL.axis+'">'+esc(shortNum(v))+'</text>';
  }

  /* ناحیهٔ انتخاب‌شده */
  if(n) g += '<rect x="'+r1(L+band*selI+2)+'" y="'+T+'" width="'+(band-4)+'" height="'+ph+'" rx="6" fill="'+COL.sel+'"/>';

  /* ستون‌های فروش */
  if(showS) list.forEach((b,i)=>{
    const bw = Math.min(22, band*0.56);
    const y1 = Y(sv[i]);
    const top = r1(Math.min(y1, zeroY)), h = Math.max(1, r1(Math.abs(y1 - zeroY)));
    g += '<rect x="'+r1(X(i)-bw/2)+'" y="'+top+'" width="'+r1(bw)+'" height="'+h+'" rx="3" fill="'+COL.sales+'" fill-opacity="'+(i===selI?'1':'.6')+'"/>';
  });

  /* خط سود + ناحیه */
  if(showP && n){
    const pts = pv.map((v,i)=>[r1(X(i)), r1(Y(v))]);
    if(pts.length > 1){
      g += '<path d="M'+pts[0][0]+' '+zeroY+' L'+pts.map(p=>p[0]+' '+p[1]).join(' L')+' L'+pts[pts.length-1][0]+' '+zeroY+' Z" fill="'+COL.profit+'" fill-opacity=".1"/>';
      g += '<polyline points="'+pts.map(p=>p[0]+','+p[1]).join(' ')+'" fill="none" stroke="'+COL.profit+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    pts.forEach((p,i)=>{
      const neg = pv[i] < 0, isSel = i === selI;
      g += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(isSel?5.5:3.2)+'" fill="'+(neg?COL.loss:COL.profit)+'" stroke="var(--surface, #fff)" stroke-width="'+(isSel?2:1.2)+'"/>';
    });
  }

  /* برچسب محور افقی (فاصلهٔ بین برچسب‌ها حداقل ~۴۸px) */
  const every = Math.max(1, Math.ceil(48 / band));
  list.forEach((b,i)=>{
    if(i % every !== 0 && i !== n-1) return;
    const bold = i === selI;
    g += '<text x="'+r1(X(i))+'" y="'+(H-9)+'" text-anchor="middle" font-size="10.5" fill="'+(bold?'var(--ink-900, #222)':COL.axis)+'"'+(bold?' font-weight="700"':'')+'>'+esc(b.label)+'</text>';
  });

  /* ناحیه‌های کلیک/لمس برای هر بازه */
  if(pickFn) list.forEach((b,i)=>{
    const t = esc(b.title)+': فروش '+fmtInt(sv[i])+' · سود '+fmtInt(pv[i]);
    g += '<rect class="trend-hit" x="'+r1(L+band*i)+'" y="0" width="'+band+'" height="'+H+'" fill="transparent" role="button" tabindex="0" aria-label="'+t+'" onclick="'+pickFn+'('+i+')" onkeydown="if(event.key===\'Enter\')'+pickFn+'('+i+')"><title>'+t+'</title></rect>';
  });

  const svg = '<svg viewBox="0 0 '+W+' '+H+'" width="'+(W>330?W+'px':'100%')+'" role="img" aria-label="نمودار روند فروش و سود" style="display:block;font-family:inherit;user-select:none;-webkit-user-select:none">'+g+'</svg>';

  /* ---- راهنمای تعاملی (دکمه‌ها) ---- */
  const chip = (key, label, color, on)=>
    '<button type="button" class="trend-chip" aria-pressed="'+(on?'true':'false')+'"'+(toggleFn?' onclick="'+toggleFn+'(\''+key+'\')"':'')+'>'
    +'<i style="background:'+color+'"></i>'+esc(label)+'</button>';
  const legend = '<div class="trend-chips">'+chip('sales','فروش خالص',COL.sales,showS)+chip('profit','سود خالص',COL.profit,showP)+'</div>';

  /* ---- جزئیات بازهٔ انتخاب‌شده ---- */
  let detail = '';
  if(n){
    const b = list[selI];
    const pr = pv[selI];
    detail = '<div class="trend-detail">'
      + '<div class="td-head"><b>'+esc(b.title)+'</b><span class="sub">'+(b.invoices||0)+' فاکتور</span></div>'
      + '<div class="td-grid">'
      +   '<div><span>فروش خالص</span><b class="num">'+fmtInt(sv[selI])+' '+esc(cur||'')+'</b></div>'
      +   '<div><span>سود خالص</span><b class="num '+(pr<0?'neg':'pos')+'">'+fmtInt(pr)+' '+esc(cur||'')+'</b></div>'
      +   '<div><span>مصارف</span><b class="num">'+fmtInt(b.expenses)+'</b></div>'
      +   '<div><span>سود ناخالص</span><b class="num">'+fmtInt(b.grossProfit)+'</b></div>'
      + '</div></div>';
  }

  /* ---- مجموع کل بازه ---- */
  const totS = sv.reduce((a,x)=>a+x,0), totP = pv.reduce((a,x)=>a+x,0);
  const totals = '<div class="trend-total"><span>مجموع بازه'+(rangeNote?' ('+esc(rangeNote)+')':'')+'</span><span class="num">فروش '+fmtInt(totS)+' · سود <b class="'+(totP<0?'neg':'pos')+'">'+fmtInt(totP)+'</b></span></div>';

  /* dir=rtl: نقطهٔ شروع اسکرول سمت راست است، یعنی جدیدترین بازه‌ها دیده می‌شوند */
  const scroll = '<div class="trend-scroll" dir="rtl">'+svg+'</div>';
  return legend + scroll + detail + totals;
}
