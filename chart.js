/* =====================================================================
   chart.js — نمودار روند فروش و سود (SVG خالص، بدون هیچ کتابخانهٔ بیرونی)
   قبلاً نمودار با Chart.js از cdnjs لود می‌شد؛ اگر اینترنت کند/قطع یا cdnjs
   فیلتر بود، بعد از ۳ ثانیه نمودار حذف می‌شد. این نسخه همیشه و آفلاین کار می‌کند.
   منطق خالص است (رشته برمی‌گرداند) تا جدا تست شود.
   ===================================================================== */

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

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* series: [{ name, color, values:[...] }] — طول values با labels برابر است */
export function buildTrendChartSvg({ labels, series, width, height, ariaLabel }){
  const W = width || 640, H = height || 240;
  const L = 46, R = 22, T = 12, B = 26;           // حاشیه‌ها
  const pw = W - L - R, ph = H - T - B;
  const n = (labels || []).length;
  const list = (series || []).map(s=>({ ...s, values: (s.values || []).map(num) }));
  const all = list.reduce((a,s)=>a.concat(s.values), []);
  let lo = Math.min(0, ...all, 0), hi = Math.max(0, ...all, 0);
  if(hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if(hi === lo) hi = lo + step;

  const X = (i)=> L + (n <= 1 ? pw/2 : (pw * i) / (n - 1));
  const Y = (v)=> T + ph - ((v - lo) / (hi - lo)) * ph;
  const f1 = (x)=> (Math.round(x*10)/10);

  let g = '';
  // خطوط شبکه و برچسب‌های محور عمودی
  for(let v = lo; v <= hi + step/1000; v += step){
    const y = f1(Y(v));
    const zero = Math.abs(v) < step/1000;
    g += '<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="'+(zero?'var(--line-strong, #c9c9c9)':'var(--line, #e6e6e6)')+'" stroke-width="'+(zero?1.2:1)+'"'+(zero?'':' stroke-dasharray="3 4"')+'/>';
    g += '<text x="'+(L-6)+'" y="'+(y+3.5)+'" text-anchor="end" font-size="10" fill="var(--ink-500, #777)">'+esc(shortNum(v))+'</text>';
  }
  // برچسب‌های محور افقی (کم‌شمار تا روی هم نیفتند)
  const every = Math.max(1, Math.ceil(n / 7));
  for(let i = 0; i < n; i++){
    if(i % every !== 0 && i !== n - 1) continue;
    if(i !== n - 1 && (n - 1 - i) < every / 2) continue; // نزدیکِ آخرین برچسب نباشد
    g += '<text x="'+f1(X(i))+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="var(--ink-500, #777)">'+esc(labels[i])+'</text>';
  }
  // ناحیهٔ زیر خط + خط + نقطه‌ها
  list.forEach(s=>{
    if(!s.values.length) return;
    const pts = s.values.map((v,i)=>[f1(X(i)), f1(Y(v))]);
    const color = s.color || '#227A57';
    if(pts.length > 1){
      const base = f1(Y(Math.max(lo, Math.min(0, hi))));
      g += '<path d="M'+pts[0][0]+' '+base+' L'+pts.map(p=>p[0]+' '+p[1]).join(' L')+' L'+pts[pts.length-1][0]+' '+base+' Z" fill="'+color+'" fill-opacity="0.10" stroke="none"/>';
      g += '<polyline points="'+pts.map(p=>p[0]+','+p[1]).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    if(pts.length <= 14){
      pts.forEach((p,i)=>{ g += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="var(--surface, #fff)" stroke="'+color+'" stroke-width="2"><title>'+esc(s.name)+' '+esc(labels[i])+': '+esc(Math.round(s.values[i]).toLocaleString('en-US'))+'</title></circle>'; });
    }
  });

  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="'+esc(ariaLabel || 'نمودار روند فروش و سود')+'" '
    + 'style="display:block;max-width:100%;height:auto;font-family:inherit">'+g+'</svg>';
}

/* راهنمای رنگ‌ها (HTML) */
export function buildChartLegend(series){
  return '<div class="chart-legend">'+(series||[]).map(s=>
    '<span><i style="background:'+esc(s.color)+'"></i>'+esc(s.name)+'</span>').join('')+'</div>';
}
