/* ---------- نماهای برنامه (render ها) — از app.js جدا شد؛ رفتار بدون تغییر است ---------- */
import { todayISO, round2, fmtQty, previousRange, changePercent } from "./core.js";
import { WITHDRAWAL_CATEGORY, salesSummary, productProfitSummary, debtAging, AGING_BUCKETS } from "./ledger.js";
import { escapeHtml, fmt, fmt2, getDeviceLabel, ic, startOfMonth, startOfWeek, sum } from './helpers.js';
import { matchQ, listBar, noMatchHtml } from './listtools.js';

let App = null;
export function bindViews(a){ App = a; }

export const viewMethods = {
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
      <div class="skel u-height-132px"></div>
      <div class="skel u-height-62px"></div>
      <div class="skel u-height-190px"></div>
    </div>`;
  },

  renderNoAccess(what){
    return `<div class="empty"><span class="ic">${ic('lock',26)}</span><b>دسترسی ندارید</b>بخش «${escapeHtml(what||'')}» برای نقش «${escapeHtml(this.roleLabel())}» بسته است.</div>`;
  },

  renderLogin(){
    document.getElementById('bottomnav').innerHTML='';
    document.getElementById('biz-name').textContent='فروشگاه صانع';
    {const _bd=document.getElementById('biz-date'); if(_bd) _bd.textContent='';}
    document.getElementById('screen').innerHTML = `
    <div class="login-mark">
      <div class="ring">${ic('boxes',26)}</div>
      <b>فروشگاه صانع</b>
      <span>سیستم حساب‌داری و مدیریت انبار</span>
    </div>
    <div class="card">
      <h2 class="section-title u-margin-top-0">${ic('key',17)}ورود به سیستم</h2>
      <label>ایمیل</label>
      <input id="login-email" type="email" placeholder="ایمیل خود را بنویسید" autocomplete="username">
      <label>رمز عبور</label>
      <input id="login-pass" type="password" placeholder="رمز عبور" autocomplete="current-password" onkeydown="if(event.key==='Enter') App.doLogin()">
      <div id="login-err" class="err-line"></div>
      <button class="btn btn-primary" onclick="App.doLogin()">${ic('log-out',17)}ورود</button>
      <div class="field-note">اگر اینترنت ندارید ولی قبلاً یک‌بار وارد شده‌اید، برنامه به‌صورت آفلاین باز می‌شود.</div>
    </div>`;
  },

  renderNav(){
    const tabs=[
      {id:'dashboard',ic:'home',lb:'داشبورد'},
      {id:'sale',ic:'receipt',lb:'فروش'},
      {id:'purchase',ic:'package',lb:'خرید'},
      {id:'customers',ic:'users',lb:'بدهی‌ها'},
      {id:'more',ic:'menu',lb:'بیشتر'},
    ];
    if(!this.dataReady){ document.getElementById('bottomnav').innerHTML=''; this._syncFab(false); return; }
    const visibleTabs = tabs.filter(t=> t.id!=='purchase' || this.canSeeBooks());
    const active = this._navTab();
    document.getElementById('bottomnav').innerHTML = visibleTabs.map(t=>
      `<button class="${active===t.id?'active':''}" onclick="App.navigate('${t.id}')" aria-current="${active===t.id?'page':'false'}">
        <span class="ic">${ic(t.ic,21)}</span><span class="lb">${t.lb}</span>
      </button>`).join('');
    this._syncFab(active!=='sale');
  },

  render(){
    this._renderDeferred = false;
    if(!this.dataReady){ this._syncFab(false); this.renderLoading(); return; }
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
    if(this._restoreFocus){
      const f = this._restoreFocus; this._restoreFocus = null;
      const el = document.getElementById(f.id);
      if(el){ el.focus({preventScroll:true}); try{ el.setSelectionRange(f.pos, f.pos); }catch(e){} }
    }
  },

  renderImageViewer(){
    if(!this.imageViewerSrc) return '';
    return `<div class="img-viewer-overlay" onclick="App.closeImageViewer()">
      <img src="${this.imageViewerSrc}" onclick="event.stopPropagation()">
      <button class="img-viewer-close" onclick="App.closeImageViewer()">${ic('x',16)}بستن</button>
    </div>`;
  },

  renderModalRoot(){
    const root=document.getElementById('modal-root'); if(!root) return;
    if(!this.modal){ root.innerHTML=''; return; }
    const m=this.modal;
    if(m.kind==='confirm'){
      root.innerHTML = `
      <div class="modal-overlay confirm-sheet" onclick="if(event.target===this) App.closeModal()">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="modal-title">${escapeHtml(m.title||'تأیید')}</div>
          <div class="modal-sub">${escapeHtml(m.msg||'')}</div>
          <div class="modal-actions stack">
            <button class="btn ${m.danger?'btn-danger':'btn-primary'}" onclick="App.confirmModalYes()">${ic(m.danger?'alert-triangle':'check',16)}${escapeHtml(m.confirmLabel)}</button>
            <button class="btn btn-outline" onclick="App.closeModal()">انصراف</button>
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

  renderPinRoot(){
    const root=document.getElementById('pin-root'); if(!root) return;
    if(!this.pinLocked){ root.innerHTML=''; return; }
    const dots = [0,1,2,3].map(i=>`<span class="${i<this.pinEntry.length?'filled':''}"></span>`).join('');
    const pad = ['1','2','3','4','5','6','7','8','9','','0','del'];
    const msg = this.pinLockMsg ? this.pinLockMsg : this.pinCheckError
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

  renderDashboard(){
    const today = todayISO();
    const todaySales = this.salesInRange(today,today);
    const todayExpensesAll = this.expensesInRange(today,today);
    const todayExpenses = todayExpensesAll.filter(e=>e.category!==WITHDRAWAL_CATEGORY);
    const todayWithdrawals = todayExpensesAll.filter(e=>e.category===WITHDRAWAL_CATEGORY);
    const todaySm = salesSummary({ sales:this.state.sales, returns:this.state.returns, from:today, to:today });
    const todayProfit = todaySm.grossProfit - sum(todayExpenses,'amount');
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
        return `<div class="row-item clickable" onclick="App.viewInvoice('${x.id}')"><span class="avt">${ic('receipt',16)}</span><div class="r-left"><b>فروش ${this.invoiceNoLabel(x.id)} · ${escapeHtml(x.customerName)}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${whoHtml}</div><div class="r-right num u-color-var-green">+${fmt(x.paid)}</div></div>`;
      } else if(x._type==='purchase'){
        const tag = x.status==='cancelled' ? ' <span class="badge gold">باطل</span>' : (x.currency==='USD' ? ' <span class="badge gold">دالر</span>' : '');
        return `<div class="row-item clickable" onclick="App.viewPurchase('${x.id}')"><span class="avt out">${ic('package',16)}</span><div class="r-left"><b>خرید${x.supplierInvoiceNo?' (بل #'+escapeHtml(x.supplierInvoiceNo)+')':''} · ${escapeHtml(x.supplierName||'—')}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${whoHtml}</div><div class="r-right num u-color-var-red">-${x.currency==='USD'?fmt2(x.paid)+' $':fmt(x.paid)}</div></div>`;
      } else {
        const isW = x.category===WITHDRAWAL_CATEGORY;
        return `<div class="row-item"><span class="avt neu">${ic(isW?'hand-coins':'banknote',16)}</span><div class="r-left"><b>${isW?'برداشت · '+escapeHtml(x.withdrawnBy||''):'مصرف · '+escapeHtml(x.category)}</b><span class="sub">${x.date}${x.note?(' · '+escapeHtml(x.note)):''}</span>${whoHtml}</div><div class="r-right num u-color-var-red">-${fmt(x.amount)}</div></div>`;
      }
    }).join('') : `<div class="empty"><span class="ic">${ic('receipt',26)}</span><b>هنوز معامله‌ای ثبت نشده</b>از دکمه‌های «فروش جدید» یا «خرید جدید» شروع کنید</div>`;

    return `
    <div class="hero">
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic('wallet',15)}موجودی نقد</span><span class="val num">${fmt(this.cashBalance())} ${cur}</span></div>`:`<div class="row"><span class="label">${ic('receipt',15)}فروش امروز</span><span class="val num">${fmt(sum(todaySales,'total'))} ${cur}</span></div>`}
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic('boxes',15)}ارزش کالای انبار</span><span class="val num">${fmt(this.inventoryValue())} ${cur}</span></div>`:''}
      ${this.canSeeBooks()?`<div class="row"><span class="label">${ic(todayProfit>=0?'trending-up':'trending-down',15)}سود امروز</span><span class="val num ${todayProfit>=0?'green':'red'}">${fmt(todayProfit)} ${cur}</span></div>`:''}
    </div>
    <div class="ledger-strip">
      <div class="chip"><div class="t">فروش خالص امروز</div><div class="v num">${fmt(todaySm.net)}</div></div>
      ${this.canSeeBooks()?`<div class="chip"><div class="t">مصرف امروز</div><div class="v num">${fmt(sum(todayExpenses,'amount'))}</div></div>`:''}
      ${todayWithdrawals.length?`<div class="chip"><div class="t">${ic('hand-coins',12)}برداشت امروز</div><div class="v num">${fmt(sum(todayWithdrawals,'amount'))}</div></div>`:''}
      <div class="chip"><div class="t">طلب از مشتریان</div><div class="v num">${fmt(this.totalReceivable())}</div></div>
      ${this.canSeeBooks()?`<div class="chip"><div class="t">قرض از عمده‌فروش (${cur})</div><div class="v num">${fmt(this.totalPayable())}</div></div>`:''}
      ${this.totalPayableUSD()!==0?`<div class="chip"><div class="t">قرض از عمده‌فروش (دالر)</div><div class="v num">$${fmt2(this.totalPayableUSD())}</div></div>`:''}
      ${this.lowStockList().length?`<div class="chip warn u-cursor-pointer" onclick="App.navigate('more','lowstock')"><div class="t">${ic('alert-triangle',12)}کم‌موجودی</div><div class="v num">${this.lowStockList().length} کالا</div></div>`:''}
      ${this.totalPayableUSD()!==0 && this.usdRate()>0?`<div class="chip"><div class="t">مجموع کل قرض به ${cur}</div><div class="v num">${fmt(this.totalPayableCombinedAFN())}</div></div>`:''}
      <div class="chip set" ${this.isOwner()?`onclick="App.quickSetUsdRate()" style="cursor:pointer;"`:''}><div class="t">${this.isOwner()?ic('pencil',12):''}نرخ دالر</div><div class="v num">${this.usdRate()>0?fmt2(this.usdRate()):(this.isOwner()?'تنظیم کنید':'—')}</div></div>
    </div>
    <div class="quick-actions">
      <div class="qa-btn" onclick="App.navigate('sale')"><span class="ic">${ic('receipt',19)}</span>فروش جدید</div>
      ${this.canSeeBooks()?`<div class="qa-btn neutral" onclick="App.navigate('purchase')"><span class="ic">${ic('package',19)}</span>خرید جدید</div>`:''}
      ${this.canSeeBooks()?`<div class="qa-btn spend" onclick="App.navigate('more','expenses')"><span class="ic">${ic('banknote',19)}</span>ثبت مصرف</div>`:''}
    </div>
    <div class="eyebrow"><span>آخرین معاملات</span>${this.state.sales.length+this.state.purchases.length+this.state.expenses.length>8?`<span class="u-cursor-pointer u-color-var-gold-700" onclick="App.navigate('more','history')">تاریخچهٔ کامل</span>`:''}</div>
    <div class="card">${recentHtml}</div>
    `;
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
        <td>${escapeHtml(it.name)}${returned>0?`<div class="sub u-color-var-red">${escapeHtml(this.itemQtyLabel(it,returned))} مرجوعی</div>`:''}</td>
        <td class="num">${escapeHtml(this.itemQtyLabelForInvoice(it))}${this.itemBaseNote(it)?`<div class="sub">${escapeHtml(this.itemBaseNote(it))}</div>`:''}</td>
        <td class="num">${fmt(this.itemPricePerTxUnit(it))}<div class="sub">هر ${escapeHtml(this.itemUnitName(it))}</div></td>
        <td class="num">${fmt(it.qty*it.unitPrice)}</td>
        <td class="no-print">${(!cancelled && App.canWrite())?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"مرجوعی این قلم", icon:"rotate-ccw", onClick:()=>App.saleReturnItem("${sale.id}",${idx})},
          {label:"افزودن تعداد", icon:"plus", onClick:()=>App.saleIncreaseItemQty("${sale.id}",${idx})},
          {label:"کم کردن چند ${escapeHtml(it.unit||'عدد')} (کاستی)", icon:"minus", onClick:()=>App.saleShrinkItem("${sale.id}",${idx})}
        ])'>${ic('more-vertical',17)}</span>`:''}</td>
      </tr>`;
    }).join('');

    const returnsHtml = sale.returns && sale.returns.length ? `
      <h2 class="section-title">${ic('rotate-ccw',17)}کالاهای مرجوعی</h2>
      <div class="card no-print">${sale.returns.map(r=>`<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">${r.date} · ${escapeHtml(r.qtyLabel||(r.qty+' عدد'))}</span></div><div class="r-right num u-color-var-red">-${fmt(r.amount)}</div></div>`).join('')}</div>
    ` : '';

    return `
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.navigate('dashboard')">${ic('home',15)}داشبورد</button>
      <button class="btn btn-primary" onclick="App.printInvoice()">${ic('printer',15)}چاپ فاکتور</button>
      <button class="btn btn-wa" onclick="App.sendInvoiceWhatsApp('${sale.id}')">${ic('message-circle',15)}ارسال واتساپ</button>
    </div>
    ${(!cancelled && App.canWrite())?`
    <div class="inv-actions no-print">
      ${App.isAdmin()?`<button class="btn btn-outline" onclick="App.startEditInvoice('${sale.id}')">${ic('pencil',15)}ویرایش فاکتور</button>`:''}
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
        ${sale.discount>0.5?`<div class="row-item"><div class="r-left">تخفیف داده‌شده</div><div class="r-right num u-color-var-gold-d">-${fmt(sale.discount)} ${s.currency}</div></div>`:''}
        <div class="row-item"><div class="r-left">مجموع فعلی فاکتور</div><div class="r-right num">${fmt(sale.total)} ${s.currency}</div></div>
        <div class="row-item"><div class="r-left">مبلغ دریافت‌شده</div><div class="r-right num u-color-var-green">${fmt(sale.paid)} ${s.currency}</div></div>
        ${(Number(sale.settled)||0)>0.5?`<div class="row-item"><div class="r-left">پرداخت‌های بعدی (تخصیص‌یافته)</div><div class="r-right num u-color-var-green">${fmt(sale.settled)} ${s.currency}</div></div>`:''}
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

  renderInvoiceEditForm(sale){
    const itemsHtml = sale.items.map((it,idx)=>{
      const returned = it.returnedQty||0;
      const f=this.itemFactor(it);
      const un=this.itemUnitName(it);
      const minLbl = returned>0 ? this.itemQtyLabel(it,returned) : '';
      return `
      <div class="grid2 u-align-items-end u-margin-bottom-10px">
        <div>
          <label>${escapeHtml(it.name)} — تعداد (${escapeHtml(un)})${returned>0?` <span class="sub u-color-var-red">(حداقل ${escapeHtml(minLbl)}، به‌دلیل مرجوعی)</span>`:''}</label>
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
    <h2 class="section-title u-margin-top-0">${ic('pencil',17)}ویرایش فاکتور ${this.invoiceNoLabel(sale.id)}</h2>
    <div class="card">
      <b class="u-font-size-13-5px">اقلام فاکتور</b>
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
      ${(Number(sale.settled)||0)>0.001?`<div class="field-note">پرداخت‌های بعدیِ تخصیص‌یافته به این فاکتور (${fmt(sale.settled)}) جداگانه حفظ می‌شود و در عدد بالا نیست.</div>`:''}

      <label>دلیل اصلاح <span class="u-color-var-red">*</span></label>
      <input id="edit-sale-reason" placeholder="مثلاً مشتری ۲ قوطی خواسته بود، ۳ ثبت شده بود" value="">
      <label>یادداشت</label>
      <input id="edit-sale-note" value="${escapeHtml(sale.note||'')}">

      <div class="field-note">این «اصلاح فاکتور» است، نه حذف فاکتور. شماره فاکتور ثابت می‌ماند، تغییرات با کاربر/دستگاه/زمان و دلیل اصلاح در Audit ثبت می‌شود و موجودی و بدهی بر اساس مقدار جدید دوباره تنظیم می‌شوند.</div>

      <div class="inv-actions u-margin-top-12px">
        <button class="btn btn-primary" onclick="App.saveEditInvoice('${sale.id}')">${ic('save',17)}ذخیرهٔ ویرایش</button>
        <button class="btn btn-outline" onclick="App.cancelEditInvoice()">انصراف</button>
      </div>
    </div>
    `;
  },

  renderSale(){
    const items = this.saleDraft.items;
    const total = items.reduce((a,i)=>a+i.qty*i.unitPrice,0);
    const itemsHtml = items.length ? items.map((it,idx)=>
      `<div class="item-row"><span>${escapeHtml(it.name)} — ${escapeHtml(this.itemQtyLabel(it))} × <span class="num">${fmt(this.itemPricePerTxUnit(it))}</span>${this.itemBaseNote(it)?`<span class="sub" style="display:block;">${escapeHtml(this.itemBaseNote(it))}</span>`:''}</span>
      <span class="u-align-items-center u-gap-8px" style="display:flex"><b class="num">${fmt(it.qty*it.unitPrice)}</b><span class="x" onclick="App.removeSaleItem(${idx})" title="حذف قلم">${ic('trash',15)}</span></span></div>`
    ).join('') : `<div class="field-note">هنوز محصولی اضافه نشده.</div>`;

    return `
    <h2 class="section-title u-margin-top-0">${ic('receipt',17)}ثبت فروش جدید</h2>
    <div class="card">
      <label>محصول</label>
      <select id="sp-product" onchange="App.onSaleProductChange()">${this.productOptions()}</select>
      <div id="sp-new-fields" style="display:none;">
        <div class="grid2">
          <div><label>نام محصول جدید</label><input id="sp-newname" placeholder="مثلاً بطری موتر"></div>
        </div>
        <div class="grid2">
          <div><label>واحد بزرگ (اختیاری)</label><input id="sp-newpackunit" placeholder="کارتن" oninput="App.fillUnitSelect('sp',true)"></div>
          <div><label>هر کارتن حاوی چند؟</label><input id="sp-newpackper" type="number" inputmode="decimal" placeholder="6" oninput="App.fillUnitSelect('sp',true)"></div>
        </div>
        <div class="grid2">
          <div><label>واحد میانی (اختیاری)</label><input id="sp-newmidunit" placeholder="قوطی / بسته" oninput="App.fillUnitSelect('sp',true)"></div>
          <div><label>هر قوطی/بسته حاوی چند عدد؟ (اختیاری)</label><input id="sp-newmidper" type="number" inputmode="decimal" placeholder="24 — یا خالی" oninput="App.fillUnitSelect('sp',true)"></div>
        </div>
        <div class="field-note">اگر محصول عدد داخلی ندارد «چند عدد» را خالی بگذارید. فقط یک واحد (مثلاً کارتن)؟ فقط «واحد بزرگ» را بنویسید.</div>
        <label>قیمت خرید هر «واحد فروش» (اجباری)</label>
        <input id="sp-newcost" type="number" inputmode="decimal" placeholder="مثلاً قیمتی که این جنس را به آن خریده‌اید">
        <div class="field-note">بدون قیمت خرید، سود این فاکتور درست حساب نمی‌شود؛ پس نوشتن آن اجباری است. قیمت خرید برای همان واحدی است که در «واحد فروش» پایین انتخاب می‌کنید.</div>
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
      <div class="field-note" id="sp-price-hint">قیمت واحد فروش انتخاب‌شده خودکار می‌آید؛ اگر قیمت ویژه می‌دهید همین‌جا تغییرش دهید.</div>
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
    </div>
    <div class="sticky-submit">
      <div><span>مجموع فاکتور</span><b class="num">${fmt(total)} ${escapeHtml(this.state.settings.currency)}</b></div>
      <button class="btn btn-primary" onclick="App.submitSale()">${ic('check',17)}ثبت فروش</button>
    </div>
    `;
  },

  renderPurchase(){
    const items = this.purchaseDraft.items;
    const total = items.reduce((a,i)=>a+i.qty*i.unitCost,0);
    const cur = this.purchaseDraft.currency || 'AFN';
    const rate = this.usdRate();
    const itemsHtml = items.length ? items.map((it,idx)=>
      `<div class="item-row"><span>${escapeHtml(it.name)} — ${escapeHtml(this.itemQtyLabelForInvoice(it))} × <span class="num">${cur==='USD'?fmt2(this.itemCostPerTxUnit(it)):fmt(this.itemCostPerTxUnit(it))}</span>${this.itemBaseNote(it)?`<span class="sub" style="display:block;">${escapeHtml(this.itemBaseNote(it))} · قیمت تمام‌شدهٔ هر ${escapeHtml(it.unit||'عدد')}: <span class="num">${fmt2(round2(it.unitCost))}</span></span>`:''}</span>
      <span class="u-align-items-center u-gap-8px" style="display:flex"><b class="num">${cur==='USD'?fmt2(it.qty*it.unitCost):fmt(it.qty*it.unitCost)}</b><span class="x" onclick="App.removePurchaseItem(${idx})" title="حذف قلم">${ic('trash',15)}</span></span></div>`
    ).join('') : `<div class="field-note">هنوز محصولی اضافه نشده.</div>`;

    return `
    <h2 class="section-title u-margin-top-0">${ic('package',17)}ثبت خرید جدید</h2>
    <div class="card">
      <label>ارز این معامله</label>
      <select id="purchase-currency" onchange="App.purchaseDraft.currency=this.value; App.render();">
        <option value="AFN" ${cur==='AFN'?'selected':''}>${this.state.settings.currency} (افغانی)</option>
        <option value="USD" ${cur==='USD'?'selected':''}>دالر</option>
      </select>
      ${cur==='USD'?`
      <div class="row-item u-padding-10px-0">
        <div class="r-left"><b>نرخ فعلی دالر</b><span class="sub">${rate>0?('۱ دالر = '+fmt2(rate)+' '+this.state.settings.currency):'هنوز تنظیم نشده'}</span></div>
        ${this.isOwner()?`<div class="r-right"><button class="btn btn-outline btn-sm" onclick="App.quickSetUsdRate()">${ic('pencil',15)}نرخ دالر</button></div>`:''}
      </div>
      ${rate>0 && total>0?`<div class="field-note">معادل مجموع فاکتور به ${this.state.settings.currency} (به نرخ امروز): <b class="num">${fmt(total*rate)}</b></div>`:''}
      <div class="field-note">قیمت میانگین و فروش کالاها خودکار بر اساس همین نرخ به ${this.state.settings.currency} محاسبه و ذخیره می‌شود.</div>
      `:''}
      <label>محصول</label>
      <select id="pp-product" onchange="App.onPurchaseProductChange()">${this.productOptions()}</select>
      <div id="pp-new-fields" style="display:none;">
        <div class="grid2">
          <div><label>نام محصول جدید</label><input id="pp-newname" placeholder="مثلاً بسکیت شیری"></div>
        </div>
        <div class="field-note">واحد داخلی «عدد» فقط برای محاسبه است؛ در خرید و فروش عادی از کارتن، قوطی یا بسته استفاده کنید.</div>
        <div class="grid2">
          <div><label>نام واحد بزرگ (اختیاری)</label><input id="pp-newpackunit" placeholder="کارتن" oninput="App.fillUnitSelect('pp',true)"></div>
          <div><label>هر کارتن حاوی چند؟</label><input id="pp-newpackper" type="number" inputmode="decimal" placeholder="4" oninput="App.fillUnitSelect('pp',true)"></div>
        </div>
        <div class="grid2">
          <div><label>نام واحد میانی (اختیاری)</label><input id="pp-newmidunit" placeholder="قوطی / بسته" oninput="App.fillUnitSelect('pp',true)"></div>
          <div><label>هر قوطی/بسته حاوی چند عدد؟ (اختیاری)</label><input id="pp-newmidper" type="number" inputmode="decimal" placeholder="8 — یا خالی" oninput="App.fillUnitSelect('pp',true)"></div>
        </div>
        <div class="field-note">اگر محصول عدد داخلی ندارد «چند عدد» را خالی بگذارید. فقط یک واحد (مثلاً کارتن)؟ فقط «واحد بزرگ» را بنویسید.</div>
        <div class="field-note">نمونه: ۱ کارتن = ۶ قوطی و ۱ قوطی = ۲۴ عدد داخلی. عدد فقط برای محاسبه است و در فروش عادی انتخاب نمی‌شود.</div>
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
      <div class="field-note" id="pp-price-hint">قیمت واحد خرید انتخاب‌شده را وارد کنید؛ قیمت تمام‌شدهٔ سایر واحدهای بسته‌بندی به‌صورت خودکار محاسبه می‌شود.</div>
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
        <td>${escapeHtml(it.name)}${returned>0?`<div class="sub u-color-var-red">${escapeHtml(this.itemQtyLabel(it,returned))} واپس شده</div>`:''}</td>
        <td class="num">${escapeHtml(this.itemQtyLabelForInvoice(it))}${this.itemBaseNote(it)?`<div class="sub">${escapeHtml(this.itemBaseNote(it))}</div>`:''}</td>
        <td class="num">${pur.currency==='USD'?fmt2(this.itemCostPerTxUnit(it)):fmt(this.itemCostPerTxUnit(it))}<div class="sub">هر ${escapeHtml(this.itemUnitName(it))}${this.itemFactor(it)>1?` · هر ${escapeHtml(it.unit||'عدد')}: ${fmt2(round2(it.unitCost))}`:''}</div></td>
        <td class="num">${pur.currency==='USD'?fmt2(it.qty*it.unitCost):fmt(it.qty*it.unitCost)}</td>
        <td class="no-print">${(!cancelled && App.canWrite())?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"واپس به فروشنده", icon:"rotate-ccw", onClick:()=>App.purchaseReturnItem("${pur.id}",${idx})},
          {label:"افزودن تعداد", icon:"plus", onClick:()=>App.purchaseIncreaseItemQty("${pur.id}",${idx})},
          {label:"کم کردن چند ${escapeHtml(it.unit||'عدد')} (کاستی)", icon:"minus", onClick:()=>App.purchaseShrinkItem("${pur.id}",${idx})}
        ])'>${ic('more-vertical',17)}</span>`:''}</td>
      </tr>`;
    }).join('');

    const returnsHtml = pur.returns && pur.returns.length ? `
      <h2 class="section-title">${ic('rotate-ccw',17)}کالاهای واپس‌شده به فروشنده</h2>
      <div class="card no-print">${pur.returns.map(r=>`<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">${r.date} · ${escapeHtml(r.qtyLabel||(r.qty+' عدد'))}</span></div><div class="r-right num u-color-var-red">-${fmt(r.amount)}</div></div>`).join('')}</div>
    ` : '';

    return `
    <div class="inv-actions no-print">
      <button class="btn btn-outline" onclick="App.navigate('dashboard')">${ic('home',15)}داشبورد</button>
      <button class="btn btn-primary" onclick="App.printInvoice()">${ic('printer',15)}چاپ</button>
    </div>
    ${(!cancelled && App.canWrite())?`
    <div class="inv-actions no-print">
      ${App.isAdmin()?`<button class="btn btn-outline" onclick="App.editPurchaseInvoice('${pur.id}')">${ic('pencil',15)}ویرایش بل خرید</button>`:''}
      <button class="btn btn-outline" onclick="App.purchaseAddItem('${pur.id}')">${ic('plus',15)}افزودن قلم</button>
      ${pur.remaining>0.5?`<button class="btn btn-outline" onclick="App.forgiveRoundoff('${pur.id}')">${ic('coins',15)}نادیده‌گرفتن خرده‌پول</button>`:''}
      <button class="btn btn-danger" onclick="App.cancelPurchase('${pur.id}')">${ic('ban',15)}کنسل کامل بل خرید</button>
    </div>`:''}
    <div class="card no-print">
      <b class="u-align-items-center u-gap-6px" style="display:flex">${ic('camera',16)}عکس بل/فاکتور شرکت</b>
      ${pur.billImage
        ? `<img src="${escapeHtml(pur.billImage)}" class="bill-thumb u-margin-top-10px" onclick="App.viewPurchaseBillImage('${pur.id}')">`
        : `<div class="field-note">هنوز عکسی برای این خرید ثبت نشده.</div>`}
      ${App.canWrite()?`<button class="btn btn-outline" onclick="App.addPurchaseBillPhoto('${pur.id}')">${ic('camera',16)}${pur.billImage?'تغییر عکس بل':'افزودن عکس بل شرکت'}</button>`:''}
    </div>
    <div id="invoice-print" class="card">
      ${cancelled?`<div class="inv-void">${ic('ban',16)}این بل خرید باطل شده است</div>`:''}
      ${!cancelled && pur.currency==='USD'?`<div class="u-margin-bottom-10px"><span class="badge gold">${ic('banknote',12)}این بل به دالر ثبت شده</span></div>`:''}
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
        ${App.canWrite()?`<div class="l1 no-print u-margin-top-4px u-color-var-gold-d u-cursor-pointer u-align-items-center u-gap-5px" style="display:flex" onclick="App.editPurchaseInvoiceNo('${pur.id}')">${ic('pencil',14)}${pur.supplierInvoiceNo?'ویرایش شمارهٔ بل':'ثبت شمارهٔ بل عمده‌فروش'}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>#</th><th>شرح کالا</th><th>تعداد</th><th>فی واحد</th><th>مجموع</th><th class="no-print"></th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="inv-totals">
        ${pur.currency==='USD'?`<div class="row-item"><div class="r-left">نرخ دالر در روز خرید</div><div class="r-right num">${fmt2(pur.rateAtPurchase||this.usdRate()||0)} ${s.currency}</div></div>`:''}
        ${pur.originalTotal!==undefined && Math.abs(pur.originalTotal-pur.total)>0.5?`<div class="row-item"><div class="r-left">مجموع اولیهٔ بل</div><div class="r-right num">${pur.currency==='USD'?fmt2(pur.originalTotal):fmt(pur.originalTotal)} ${curLbl}</div></div>`:''}
        <div class="row-item"><div class="r-left">مجموع فعلی بل</div><div class="r-right num">${pur.currency==='USD'?fmt2(pur.total):fmt(pur.total)} ${curLbl}${pur.currency==='USD'?` (≈ ${fmt(pur.total*(pur.rateAtPurchase||this.usdRate()||0))} ${s.currency})`:''}</div></div>
        <div class="row-item"><div class="r-left">پرداخت‌شده</div><div class="r-right num u-color-var-green">${pur.currency==='USD'?fmt2(pur.paid):fmt(pur.paid)} ${curLbl}</div></div>
        <div class="row-item"><div class="r-left"><b>${pur.remaining>0.5?'باقیمانده (بدهی ما)':'وضعیت'}</b></div><div class="r-right num" style="color:${pur.remaining>0.5?'var(--red)':'var(--green)'}"><b>${cancelled?'باطل شده':(pur.remaining>0.5?(pur.currency==='USD'?fmt2(pur.remaining):fmt(pur.remaining))+' '+curLbl:`<span class="inv-stamp">${ic('check',12)}تسویه‌شده</span>`)}</b></div></div>
        ${!cancelled && pur.currency==='USD' && pur.remaining>0.5 && this.usdRate()>0?`<div class="row-item"><div class="r-left">معادل باقیمانده به نرخ امروز</div><div class="r-right num u-color-var-red">${fmt(pur.remaining*this.usdRate())} ${s.currency}</div></div>`:''}
      </div>
      ${pur.note?`<div class="inv-note">یادداشت: ${escapeHtml(pur.note)}</div>`:''}
    </div>
    ${returnsHtml}
    `;
  },

  renderCustomers(){
    const sub = this.sub || 'customers';
    if(this.detailId){
      return this.renderPartyDetail();
    }
    if(sub==='suppliers' && !this.canSeeBooks()) return this.renderNoAccess('شرکت‌ها / عمده‌فروشان');
    const listArr = sub==='customers' ? this.state.customers : this.state.suppliers;
    const ls = this.listState(sub);
    const sorted = [...listArr].sort((a,b)=>(b.balance||0)-(a.balance||0));
    const balOf = c => c.balance||0;
    const chips = [
      {k:'all', label:'همه', count:listArr.length},
      {k:'debt', label:'بدهکار', count:listArr.filter(c=>balOf(c)>0.5).length},
      {k:'credit', label:'طلب شما', count:listArr.filter(c=>balOf(c)<-0.5).length},
      {k:'settled', label:'تسویه', count:listArr.filter(c=>Math.abs(balOf(c))<=0.5).length},
    ];
    const byFilter = c => ls.f==='debt' ? balOf(c)>0.5 : ls.f==='credit' ? balOf(c)<-0.5 : ls.f==='settled' ? Math.abs(balOf(c))<=0.5 : true;
    const visible = sorted.filter(c => byFilter(c) && matchQ(ls.q, c.name, c.phone, c.address));
    const totalKey = sub==='customers' ? this.totalReceivable() : this.totalPayable();
    const rows = visible.length ? visible.map(c=>{
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
        <div class="r-left u-cursor-pointer" onclick="App.openParty('${sub}','${c.id}')">
          <b>${escapeHtml(c.name)}</b>${c.phone?`<span class="sub">${escapeHtml(c.phone)}</span>`:''}${c.address?`<span class="sub">${escapeHtml(c.address)}</span>`:''}
        </div>
        <div class="r-right u-align-items-center u-gap-10px" style="display:flex">
          ${badge}
          ${App.canWrite()?`<span class="icon-btn" onclick="event.stopPropagation(); App.editParty('${sub}','${c.id}')" title="ویرایش">${ic('pencil',16)}</span>`:''}
        </div>
      </div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic(sub==='customers'?'users':'factory',26)}</span><b>${sub==='customers'?'هنوز مشتری‌ای ثبت نشده':'هنوز عمده‌فروش/شرکتی ثبت نشده'}</b>با دکمهٔ بالا اضافه کنید، یا با ثبت اولین فروش/خرید خودکار ساخته می‌شود</div>`;

    return `
    <h2 class="section-title u-margin-top-0">${ic('users',17)}مشتریان و فروشندگان</h2>
    <div class="tabbar-sub">
      <button class="${sub==='customers'?'active':''}" onclick="App.navigate('customers','customers')">مشتریان</button>
      ${this.canSeeBooks()?`<button class="${sub==='suppliers'?'active':''}" onclick="App.navigate('customers','suppliers')">شرکت‌ها / عمده‌فروشان</button>`:''}
    </div>
    <button class="btn btn-outline" onclick="App.addPartyManual('${sub}')">${ic('user-plus',16)}افزودن ${sub==='customers'?'مشتری':'شرکت/عمده‌فروش'} جدید</button>
    <div class="card u-text-align-center u-margin-top-12px">
      <div class="field-note">مجموع ${sub==='customers'?'طلب از مشتریان':'بدهی به عمده‌فروشان ('+this.state.settings.currency+')'}</div>
      <div class="num" style="font-size:20px;font-weight:800;color:${sub==='customers'?'var(--green)':'var(--red)'}">${fmt(totalKey)} ${sub==='customers'?this.state.settings.currency:''}</div>
      ${sub==='suppliers'?`<div class="field-note u-margin-top-10px">مجموع بدهی به عمده‌فروشان (دالر)</div>
      <div class="num u-font-size-20px u-font-weight-800 u-color-var-red">$${fmt2(this.totalPayableUSD())}</div>
      ${this.totalPayableUSD()!==0?`<div class="field-note u-margin-top-10px">مجموع کل بدهی به ${this.state.settings.currency} (شامل تبدیل دالر به نرخ امروز)</div>
      <div class="num u-font-size-18px u-font-weight-800 u-color-var-gold-d">${this.usdRate()>0?fmt(this.totalPayableCombinedAFN())+' '+this.state.settings.currency:'نرخ دالر تنظیم نشده'}</div>`:''}
      <div class="field-note u-margin-top-10px">نرخ فعلی دالر: <b class="num">${this.usdRate()>0?fmt2(this.usdRate()):'—'}</b> <span class="u-cursor-pointer u-color-var-gold-d u-text-decoration-underline" onclick="App.quickSetUsdRate()">ویرایش نرخ</span></div>`:''}
    </div>
    ${listBar({key:sub, placeholder: sub==='customers'?'جستجوی نام یا شماره مشتری':'جستجوی نام شرکت یا عمده‌فروش', q:ls.q, chips, active:ls.f})}
    <div class="card">${visible.length || !listArr.length ? rows : noMatchHtml()}</div>
    `;
  },

  renderPartyDetail(){
    const type=this.sub;
    const arr = type==='customers' ? this.state.customers : this.state.suppliers;
    const p = arr.find(x=>x.id===this.detailId);
    if(!p){ this.detailId=null; return this.renderCustomers(); }
    let history=[];
    if(type==='customers'){
      history = this.state.sales.filter(s=>s.customerId===p.id).map(s=>({date:s.date,ts:s.ts,label:'فروش '+this.invoiceNoLabel(s.id),amount:s.total,paid:(Number(s.paid)||0)+(Number(s.settled)||0),saleId:s.id,status:s.status,currency:'AFN'}));
    } else {
      history = this.state.purchases.filter(s=>s.supplierId===p.id).map(s=>({date:s.date,ts:s.ts,label:'خرید'+(s.currency==='USD'?' (دالر)':''),amount:s.total,paid:s.paid,purchaseId:s.id,status:s.status,currency:s.currency||'AFN'}));
    }
    const pays = this.state.payments.filter(x=>x.partyId===p.id).map(x=>({date:x.date,ts:x.ts,label:(x.reversalOf?'↩ ابطال — ':'')+(x.type==='receive'?'دریافت پول':'پرداخت پول')+(x.currency==='USD'?' (دالر)':''),amount:x.amount,paid:null,isPayment:true,paymentId:x.id,voided:!!x.voided,reversalOf:x.reversalOf||'',receiptImage:x.receiptImage||null,who:this.whoLabel(x),currency:x.currency||'AFN'}));
    const openings = (this.state.openingEntries||[]).filter(x=>x.partyId===p.id).map(x=>({date:x.date,ts:x.ts,label:'بدهی افتتاحیه (قبل از سیستم)'+(x.currency==='USD'?' (دالر)':''),amount:x.amount,isOpening:true,currency:x.currency||'AFN'}));
    history = [...history,...pays,...openings].sort((a,b)=>(b.ts||0)-(a.ts||0));

    const rows = history.length ? history.map(h=>{
      const f = h.currency==='USD' ? fmt2 : fmt;
      if(h.isPayment){
        const color = (type==='customers') ? 'var(--green)' : 'var(--red)';
        const photoBtn = h.receiptImage
          ? `<span class="icon-btn" onclick="App.viewPaymentReceipt('${h.paymentId}')" title="مشاهده عکس رسید">${ic('image',15)}</span>`
          : `<span class="icon-btn" onclick="App.addPaymentReceiptPhoto('${h.paymentId}')" title="افزودن عکس رسید">${ic('camera',15)}</span>`;
        return `<div class="row-item"><div class="r-left"><b>${h.label}</b>${photoBtn}${h.voided?' <span class="badge gold">باطل شده</span>':''}${(!h.voided && !h.reversalOf && App.isOwner())?`<span class="icon-btn" onclick="App.voidPayment('${h.paymentId}')" title="ابطال پرداخت">${ic('trash',15)}</span>`:''}<span class="sub">${h.date}</span>${h.who?`<span class="sub u-opacity-75">${escapeHtml(h.who)}</span>`:''}</div><div class="r-right num" style="color:${color}">${f(h.amount)}</div></div>`;
      }
      if(h.isOpening){
        return `<div class="row-item"><div class="r-left"><b>${h.label}</b><span class="sub">${h.date}</span></div><div class="r-right num u-color-var-gold-d">${f(h.amount)}</div></div>`;
      }
      const clickAttr = h.saleId ? ` onclick="App.viewInvoice('${h.saleId}')" style="cursor:pointer;"` : (h.purchaseId ? ` onclick="App.viewPurchase('${h.purchaseId}')" style="cursor:pointer;"` : '');
      const cancelledTag = h.status==='cancelled' ? ' <span class="badge gold">باطل شده</span>' : '';
      return `<div class="row-item"${clickAttr}><div class="r-left"><b>${h.label} — مجموع ${f(h.amount)}</b>${cancelledTag}<span class="sub">${h.date} · پرداخت‌شده: ${f(h.paid)}</span></div><div class="r-right num u-color-var-red">${f(h.amount-h.paid)}</div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('history',24)}</span>هنوز معامله‌ای با این ${type==='customers'?'مشتری':'عمده‌فروش'} ثبت نشده</div>`;

    const actionLabel = type==='customers' ? 'دریافت پول از مشتری' : 'پرداخت پول به عمده‌فروش';

    return `
    <button class="back-btn" onclick="App.closeParty()">${ic('chevron-right',16)}بازگشت به فهرست</button>
    <div class="card">
      <div class="u-justify-content-space-between u-align-items-center" style="display:flex">
        <b class="u-font-size-16px">${escapeHtml(p.name)}</b>
        <span class="badge ${p.balance>0.5?'red':'green'} num">${fmt(Math.abs(p.balance||0))} ${p.balance>0.5?'بدهکار':((p.balance||0)<-0.5?'طلبکار':'تسویه')}</span>
      </div>
      ${type==='suppliers' && Math.abs(p.balanceUSD||0)>0.5 ? `<div class="u-margin-top-6px u-text-align-left"><span class="badge ${p.balanceUSD>0.5?'red':'green'} num">$${fmt2(Math.abs(p.balanceUSD))} ${p.balanceUSD>0.5?'بدهکار (دالر)':'طلبکار (دالر)'}</span>${this.usdRate()>0?`<div class="sub u-margin-top-2px">معادل امروز: ${fmt(Math.abs(p.balanceUSD)*this.usdRate())} ${this.state.settings.currency} (به نرخ ${fmt2(this.usdRate())})</div>`:`<div class="sub u-margin-top-2px u-color-var-red">نرخ دالر تنظیم نشده — <span class="u-cursor-pointer u-text-decoration-underline" onclick="App.quickSetUsdRate()">تنظیم کنید</span></div>`}</div>` : ''}
      ${p.phone?`<div class="sub u-margin-top-6px u-align-items-center u-gap-5px" style="display:flex">${ic('phone',13)}<span class="num">${escapeHtml(p.phone)}</span></div>`:''}
      ${p.address?`<div class="sub u-align-items-center u-gap-5px" style="display:flex">${ic('map-pin',13)}${escapeHtml(p.address)}</div>`:''}
      <button class="btn btn-green u-margin-top-12px" onclick="App.recordPartyPayment('${type}','${p.id}')">${ic(type==='customers'?'arrow-left':'arrow-right',16)}${actionLabel}</button>
      ${App.canWrite()?`<div class="grid2 u-margin-top-8px">
        <button class="btn btn-outline u-margin-top-0" onclick="App.editParty('${type}','${p.id}')">${ic('pencil',15)}ویرایش اطلاعات</button>
        <button class="btn btn-outline u-margin-top-0" onclick="App.setOpeningBalance('${type}','${p.id}')">${ic('clipboard',15)}بدهی افتتاحیه</button>
      </div>
      <div class="u-text-align-center u-margin-top-10px"><span class="u-cursor-pointer u-color-var-red u-font-size-12px" onclick="App.deleteParty('${type}','${p.id}')">${ic('trash',12)} حذف این طرف از فهرست</span></div>`:''}
      ${this.payFormOpen ? `
      <div class="subpanel">
        <div>
          ${type==='suppliers' ? `<label>ارز پرداخت</label>
          <select id="pay-currency">
            <option value="AFN">${this.state.settings.currency} (افغانی)</option>
            <option value="USD">دالر</option>
          </select>
          <div class="field-note">نرخ فعلی دالر: <b class="num">${this.usdRate()>0?fmt2(this.usdRate()):'تنظیم نشده'}</b> <span class="u-cursor-pointer u-color-var-gold-d" onclick="App.quickSetUsdRate()">ویرایش</span></div>` : ''}
          ${type==='suppliers' ? this.purchasePickHTML(p) : ''}
          <label>${type==='customers'?'مبلغ دریافتی از مشتری':'مبلغ پرداختی به شرکت/عمده‌فروش'}</label>
          <input id="pay-amount" type="number" inputmode="decimal" step="0.01" placeholder="0">
          ${type==='customers' ? (()=>{
            const open=this.state.sales.filter(s=>s.customerId===p.id && s.status!=='cancelled' && (Number(s.remaining)||0)>0.001);
            return open.length ? `<label>بابت کدام فاکتور؟</label>
          <select id="pay-sale"><option value="">بدون تخصیص (حساب عمومی مشتری)</option>${open.map(s=>`<option value="${s.id}">فاکتور ${escapeHtml(this.invoiceNoLabel(s.id))} — باقی ${fmt(s.remaining)}</option>`).join('')}</select>
          <div class="field-note">اگر فاکتور را انتخاب کنید، همان فاکتور تسویه می‌شود؛ مبلغ اضافه بدون تخصیص می‌ماند.</div>` : '';
          })() : ''}
          <label>تاریخ</label>
          <input id="pay-date" type="date" value="${todayISO()}">
          <label>عکس رسید ${type==='suppliers'?'(پیشنهاد می‌شود ضمیمه کنید)':'(اختیاری)'}</label>
          <input id="pay-photo" type="file" accept="image/*" capture="environment">
          <div class="grid2 u-margin-top-10px">
            <button class="btn btn-outline u-margin-top-0" onclick="App.cancelPartyPaymentForm()">انصراف</button>
            <button class="btn btn-primary u-margin-top-0" onclick="App.submitPartyPayment('${type}','${p.id}')">${ic('check',16)}ثبت</button>
          </div>
        </div>
      </div>` : ''}
    </div>
    <h2 class="section-title">سابقهٔ معاملات (${history.length})</h2>
    <div class="card">${rows}</div>
    `;
  },

  renderMore(){
    if(this.sub==='settings' && !this.isAdmin()){
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
    <h2 class="section-title u-margin-top-0">${ic('menu',17)}بیشتر</h2>
    ${this.canSeeBooks()||this.canSeeReports()?`<div class="eyebrow"><span>کار روزانه و گزارش</span></div>`:''}
    <div class="more-list">
      ${this.canSeeBooks()?`<button onclick="App.navigate('more','expenses')"><span class="ic">${ic('banknote',17)}</span><span class="lbl">مصارف و برداشت شخصی<span class="sub">ثبت هزینه‌های روزانه</span></span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      ${this.canSeeReports()?`<button onclick="App.navigate('more','reports')"><span class="ic">${ic('bar-chart',17)}</span><span class="lbl">گزارش سود و زیان<span class="sub">روزانه، هفتگی، ماهانه</span></span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      <button onclick="App.navigate('more','history')"><span class="ic">${ic('history',17)}</span><span class="lbl">تاریخچهٔ معاملات<span class="sub">همهٔ فروش، خرید و مصرف</span></span><span class="chev">${ic('chevron-left',17)}</span></button>
    </div>
    <div class="eyebrow"><span>کالا و انبار</span></div>
    <div class="more-list">
      <button onclick="App.navigate('more','lowstock')"><span class="ic warn">${ic('alert-triangle',17)}</span><span class="lbl">کالاهای کم‌موجود<span class="sub">${lowCount?lowCount+' کالا نیاز به خرید دارد':'موجودی همه کالاها خوب است'}</span></span>${lowCount?`<span class="stock-badge">${lowCount}</span>`:''}<span class="chev">${ic('chevron-left',17)}</span></button>
      <button onclick="App.navigate('more','products')"><span class="ic">${ic('archive',17)}</span><span class="lbl">${this.isOwner()?'محصولات و موجودی':'مشاهدهٔ محصولات و موجودی'}</span><span class="chev">${ic('chevron-left',17)}</span></button>
    </div>
    <div class="eyebrow"><span>حساب</span></div>
    <div class="more-list">
      ${this.isAdmin()?`<button onclick="App.navigate('more','settings')"><span class="ic">${ic('settings',17)}</span><span class="lbl">تنظیمات و پشتیبان‌گیری</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      ${this.user?`<button onclick="App.lockNow()"><span class="ic">${ic('lock',17)}</span><span class="lbl">قفل صفحه</span><span class="chev">${ic('chevron-left',17)}</span></button>`:''}
      <button class="danger" onclick="App.logout()"><span class="ic">${ic('log-out',17)}</span><span class="lbl">خروج از حساب<span class="sub">${escapeHtml(this.user?this.user.email:'')}</span></span><span class="chev">${ic('chevron-left',17)}</span></button>
    </div>
    `;
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
      <div class="r-right"><span class="num u-color-var-red">-${fmt(e.amount)}</span>${App.isOwner()?`<span class="icon-btn danger" onclick="App.deleteExpense('${e.id}')" title="حذف">${ic('trash',15)}</span>`:''}</div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('banknote',24)}</span>هنوز مصرفی ثبت نشده</div>`;

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title u-margin-top-0">${ic('banknote',17)}ثبت مصرف روزانه / برداشت شخصی</h2>
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
    <h2 class="section-title u-margin-top-0">${ic('alert-triangle',17)}کالاهای کم‌موجود/تمام‌شده</h2>
    <div class="field-note u-margin-bottom-10px">حد هشدار فعلی: ${threshold} واحد یا کمتر ${this.isAdmin()?'— از تنظیمات قابل تغییر است.':''}</div>
    <div class="card">${rows}</div>
    ${list.length?`<button class="btn btn-primary" onclick="App.navigate('purchase')">${ic('shopping-cart',17)}برو به ثبت خرید و همه را یک‌جا بخر</button>`:''}
    `;
  },

  renderProducts(){
    const owner=this.isOwner();
    const threshold = this.state.settings.lowStockThreshold!==undefined ? this.state.settings.lowStockThreshold : 1;
    const sorted=[...this.state.products].sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    const ls = this.listState('products');
    const chips = [
      {k:'all', label:'همه', count:sorted.length},
      {k:'low', label:'کم‌موجود', count:sorted.filter(p=>this.isLowStock(p,threshold)).length},
      {k:'out', label:'ناموجود', count:sorted.filter(p=>(p.stock||0)<=0).length},
      {k:'archived', label:'بایگانی', count:sorted.filter(p=>p.archived).length},
    ];
    const byFilter = p => ls.f==='low' ? this.isLowStock(p,threshold) : ls.f==='out' ? (p.stock||0)<=0 : ls.f==='archived' ? !!p.archived : true;
    const visible = sorted.filter(p => byFilter(p) && matchQ(ls.q, p.name, ...((this.productUnits(p)||[]).map(u=>u.name))));
    const rows = visible.length ? visible.map(p=>{
      const ladder=this.productUnits(p);
      const txUnits=this.transactionUnits(p);
      const defUnit=this.unitByName(p, p.defaultSaleUnit);
      const stockInDef=this.stockInUnit(p,defUnit);
      const priceLine = txUnits.map(u=>u.name+': '+fmt2(this.unitSellPrice(p,u))+(this.isUnitPriceManual(p,u)?'*':'')).join(' · ');
      const costLine  = txUnits.map(u=>u.name+': '+fmt2(this.unitCost(p,u))).join(' · ');
      return `<div class="row-item"><div class="r-left"><b>${escapeHtml(p.name)}</b>${p.archived?'<span class="sub">بایگانی‌شده — همچنان قابل انتخاب در خرید و فروش</span>':''}${ladder.length>1?`<span class="sub">${escapeHtml(this.unitLadderLabel(p))}</span>`:''}<span class="sub">فروش — ${escapeHtml(priceLine)}</span><span class="sub">تمام‌شده — ${escapeHtml(costLine)}</span></div>
      <div class="r-right u-align-items-center u-gap-10px" style="display:flex">
        <span class="badge ${this.isLowStock(p,threshold)?'red':'gold'} num" title="${escapeHtml(fmtQty(stockInDef)+' '+defUnit.name)}">${escapeHtml(this.qtyBreakdown(p,p.stock||0))}</span>
        ${owner&&!p.archived?`<span class="icon-btn" onclick="App.editProductUnits('${p.id}')" title="ویرایش واحدها و قیمت">${ic('sliders',16)}</span>`:''}
        ${owner&&!p.archived?`<span class="menu-dots" onclick='App.openActionMenu([
          {label:"ویرایش واحدها و قیمت‌ها", icon:"sliders", onClick:()=>App.editProductUnits("${p.id}")},
          {label:"اصلاح موجودی", icon:"package", onClick:()=>App.adjustProductStock("${p.id}")},
          {label:"ویرایش نام و قیمت پایه", icon:"pencil", onClick:()=>App.editProduct("${p.id}")},
          {label:"حذف محصول", icon:"trash", danger:true, onClick:()=>App.deleteProduct("${p.id}")}
        ])'>${ic('more-vertical',17)}</span>`:''}
      </div></div>`;
    }).join('') : `<div class="empty"><span class="ic">${ic('archive',26)}</span><b>هنوز محصولی اضافه نشده</b>با ثبت اولین خرید یا فروش، محصول خودکار ساخته می‌شود</div>`;

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title u-margin-top-0">${ic('archive',17)}محصولات و موجودی</h2>
    ${owner?`
    <div class="card">
      <label>افزودن محصول جدید</label>
      <input id="np-name" placeholder="نام محصول">
      <div class="field-note">واحدهایی را بنویسید که واقعاً خرید/فروش می‌کنید. اگر محصول «عدد داخلی» ندارد، خانهٔ «هر قوطی/بسته چند عدد» را <b>خالی</b> بگذارید.<br>
      ۱) فقط یک واحد (مثلاً ۱ کارتن ککو یا کارتن گلوکوز ۲۵ کیلویی): فقط «واحد بزرگ» را بنویسید و باقی را خالی بگذارید.<br>
      ۲) کارتن و قوطی هر دو معامله می‌شود ولی عدد داخلی ندارد: واحد بزرگ = کارتن، «هر واحد بزرگ چند واحد میانی» = تعداد قوطی، نام واحد میانی = قوطی، و «چند عدد» را خالی بگذارید.<br>
      ۳) کارتن ← قوطی ← عدد داخلی: همهٔ خانه‌ها را پر کنید.</div>
      <div class="grid2">
        <div><label>واحد بزرگ (اختیاری)</label><input id="np-packunit" placeholder="کارتن" oninput="App.previewNewProduct()"></div>
        <div><label>هر واحد بزرگ چند واحد میانی/عدد داخلی دارد؟</label><input id="np-packper" type="number" inputmode="decimal" placeholder="6" oninput="App.previewNewProduct()"></div>
      </div>
      <div class="grid2">
        <div><label>نام واحد میانی (اختیاری)</label><input id="np-midunit" placeholder="قوطی / بسته" oninput="App.previewNewProduct()"></div>
        <div><label>هر قوطی/بسته حاوی چند عدد؟ (اختیاری)</label><input id="np-midper" type="number" inputmode="decimal" placeholder="24 — یا خالی" oninput="App.previewNewProduct()"></div>
      </div>
      <div class="field-note u-font-weight-600" id="np-summary"></div>
      <div class="grid2">
        <div><label id="np-stock-label">موجودی آغازین (به عدد داخلی)</label><input id="np-stock" type="number" inputmode="decimal" placeholder="0"></div>
        <div><label id="np-cost-label">قیمت تمام‌شده واحد داخلی (اختیاری)</label><input id="np-cost" type="number" inputmode="decimal" placeholder="0"></div>
      </div>
      <div class="field-note">قیمت فروش را بعداً از «ویرایش واحدها و قیمت‌ها» برای کارتن، قوطی یا بسته تنظیم کنید.</div>
      <button class="btn btn-primary" onclick="App.submitNewProductForm()">${ic('plus',17)}افزودن محصول</button>
    </div>`:''}
    <div class="eyebrow"><span>فهرست محصولات</span><span>${sorted.length} قلم</span></div>
    ${owner&&sorted.length?`<div class="field-note u-margin-bottom-8px">با دکمهٔ ${ic('sliders',13)} روی هر محصول، واحدهای واقعی معامله (کارتن ← قوطی/بسته) و قیمت‌هایشان را ویرایش کنید. «عدد» فقط واحد داخلی محاسبات است.</div>`:''}
    ${listBar({key:'products', placeholder:'جستجوی نام کالا یا واحد', q:ls.q, chips, active:ls.f})}
    <div class="card">${visible.length || !sorted.length ? rows : noMatchHtml()}</div>
    `;
  },

  renderFullHistory(){
    const today=todayISO();
    let start,end=today,label='امروز';
    if(this.historyPeriod==='week'){ start=startOfWeek(today); label='این هفته'; }
    else if(this.historyPeriod==='month'){ start=startOfMonth(today); label='این ماه'; }
    else if(this.historyPeriod==='all'){ start='0000-01-01'; label='همهٔ زمان‌ها'; }
    else if(this.historyPeriod==='custom'){ start=this.historyStart||today; end=this.historyEnd||today; label='بازهٔ دلخواه'; }
    else { start=today; label='امروز'; this.historyPeriod='today'; }

    const type=this.historyType||'all';
    const hq = this.listState('history');
    let rows=[];
    if(type==='all'||type==='sales'){
      this.salesInRange(start,end).forEach(x=>{
        const tag=x.status==='cancelled'?' <span class="badge gold">باطل</span>':'';
        rows.push({ts:x.ts, q:[x.customerName, ...(x.items||[]).map(i=>i.name)].join(' '), html:`<div class="row-item clickable" onclick="App.viewInvoice('${x.id}')"><span class="avt">${ic('receipt',16)}</span><div class="r-left"><b>فروش ${this.invoiceNoLabel(x.id)} · ${escapeHtml(x.customerName)}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم${x.remaining>0.5?' · باقی‌مانده '+fmt(x.remaining):''}</span>${this.whoLabel(x)?`<span class="sub u-opacity-75">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num u-color-var-green">+${fmt(x.paid)}</div></div>`});
      });
    }
    if(type==='all'||type==='purchases'){
      this.purchasesInRange(start,end).forEach(x=>{
        const tag=x.status==='cancelled'?' <span class="badge gold">باطل</span>':(x.currency==='USD'?' <span class="badge gold">دالر</span>':'');
        rows.push({ts:x.ts, q:[x.supplierName, x.supplierInvoiceNo, ...(x.items||[]).map(i=>i.name)].join(' '), html:`<div class="row-item clickable" onclick="App.viewPurchase('${x.id}')"><span class="avt out">${ic('package',16)}</span><div class="r-left"><b>خرید${x.supplierInvoiceNo?' (بل #'+escapeHtml(x.supplierInvoiceNo)+')':''} · ${escapeHtml(x.supplierName||'—')}</b>${tag}<span class="sub">${x.date} · ${x.items.length} قلم</span>${this.whoLabel(x)?`<span class="sub u-opacity-75">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num u-color-var-red">-${x.currency==='USD'?fmt2(x.paid)+' $':fmt(x.paid)}</div></div>`});
      });
    }
    if(type==='all'||type==='expenses'){
      this.expensesInRange(start,end).forEach(x=>{
        const isW=x.category===WITHDRAWAL_CATEGORY;
        rows.push({ts:x.ts, q:[x.category, x.withdrawnBy, x.note].join(' '), html:`<div class="row-item"><span class="avt neu">${ic(isW?'hand-coins':'banknote',16)}</span><div class="r-left"><b>${isW?'برداشت · '+escapeHtml(x.withdrawnBy||''):'مصرف · '+escapeHtml(x.category)}</b><span class="sub">${x.date}${x.note?(' · '+escapeHtml(x.note)):''}</span>${this.whoLabel(x)?`<span class="sub u-opacity-75">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num u-color-var-red">-${fmt(x.amount)}</div></div>`});
      });
    }
    if(type==='all'||type==='payments'){
      this.state.payments.filter(x=>x.date>=start && x.date<=end).forEach(x=>{
        const color=x.type==='receive'?'var(--green)':'var(--red)';
        const photoBtn = x.receiptImage ? `<span class="icon-btn" onclick="App.viewPaymentReceipt('${x.id}')" title="مشاهده عکس رسید">${ic('image',15)}</span>` : '';
        rows.push({ts:x.ts, q:x.partyName, html:`<div class="row-item"><span class="avt ${x.type==='receive'?'':'out'}">${ic(x.type==='receive'?'arrow-left':'arrow-right',16)}</span><div class="r-left"><b>${x.type==='receive'?'دریافت از':'پرداخت به'} ${escapeHtml(x.partyName||'')}</b>${photoBtn}<span class="sub">${x.date}${x.currency==='USD'?' · دالری':''}</span>${this.whoLabel(x)?`<span class="sub u-opacity-75">${escapeHtml(this.whoLabel(x))}</span>`:''}</div><div class="r-right num" style="color:${color}">${x.currency==='USD'?fmt2(x.amount)+' $':fmt(x.amount)}</div></div>`});
      });
    }
    rows.sort((a,b)=>(b.ts||0)-(a.ts||0));
    rows = rows.filter(r => matchQ(hq.q, r.q));

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title u-margin-top-0">${ic('history',17)}تاریخچهٔ کامل معاملات</h2>
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
    ${listBar({key:'history', placeholder:'جستجوی نام مشتری، تأمین‌کننده، کالا یا بل', q:hq.q})}
    <div class="field-note">بازه: ${label} (${start==='0000-01-01'?'ابتدا':start} تا ${end}) — ${rows.length} مورد</div>
    <div class="card">${rows.length?rows.map(r=>r.html).join(''):(hq.q?noMatchHtml():`<div class="empty"><span class="ic">${ic('history',24)}</span>در این بازه معامله‌ای نیست</div>`)}</div>
    `;
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
    const sm=salesSummary({ sales:this.state.sales, returns:this.state.returns, from:start, to:end });
    const revenue=sm.net;
    const cogs=sm.cogs;
    const grossProfit=sm.grossProfit;
    const expTotal=sum(expenses,'amount');
    const netProfit=grossProfit-expTotal;
    const withdrawalTotal=sum(withdrawals,'amount');
    const purchTotal = purchases.reduce((a,p)=> a + (p.currency==='USD' ? (Number(p.total)||0)*(Number(p.rateAtPurchase)||this.usdRate()||0) : (Number(p.total)||0)), 0);

    /* ----- مقایسه با دورهٔ قبل ----- */
    const prevR = previousRange({ period:this.reportPeriod, start, end });
    const prevSm = salesSummary({ sales:this.state.sales, returns:this.state.returns, from:prevR.start, to:prevR.end });
    const prevExp = sum(this.expensesInRange(prevR.start,prevR.end).filter(e=>e.category!==WITHDRAWAL_CATEGORY),'amount');
    const prevNet = prevSm.grossProfit - prevExp;
    const cmpRow = (label, cur, prev)=>{
      const pct = changePercent(cur, prev);
      const up = cur >= prev;
      const txt = pct===null ? (Math.abs(cur-prev)<0.005 ? 'بدون تغییر' : 'دورهٔ قبل صفر بود') : ((pct>0?'+':'')+pct+'٪');
      return `<div class="row-item"><div class="r-left">${label}<span class="sub">دورهٔ قبل: ${fmt(prev)} (${prevR.start===prevR.end?prevR.start:prevR.start+' تا '+prevR.end})</span></div><div class="r-right num" style="color:${up?'var(--green)':'var(--red)'}">${ic(up?'trending-up':'trending-down',15)} ${txt}</div></div>`;
    };
    const compareCard = `<div class="eyebrow"><span>مقایسه با دورهٔ قبل</span></div><div class="card">${cmpRow('فروش خالص', revenue, prevSm.net)}${cmpRow('سود خالص', netProfit, prevNet)}</div>`;

    /* ----- سود به تفکیک محصول ----- */
    const prodProfit = productProfitSummary({ sales:this.state.sales, from:start, to:end });
    const prodRows = prodProfit.slice(0,10).map(r=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">فروش ${fmt(r.revenue)} · بهای تمام‌شده ${fmt(r.cost)}</span></div><div class="r-right num" style="color:${r.profit>=0?'var(--green)':'var(--red)'}">${fmt(r.profit)}</div></div>`).join('');
    const prodCard = `<div class="eyebrow"><span>سود به تفکیک محصول (۱۰ محصولِ برتر)</span></div><div class="card">${prodRows || '<div class="empty">در این بازه فروشی نیست.</div>'}${prodProfit.length?'<div class="field-note">بر اساس تاریخ فاکتور و پس از کسر مرجوعی؛ ممکن است با «سود ناخالص» بالا کمی فرق کند.</div>':''}</div>`;

    /* ----- سن بدهی مشتریان (وضعیت امروز، مستقل از بازهٔ انتخاب‌شده) ----- */
    const aging = debtAging({ customers:this.state.customers, sales:this.state.sales, today });
    const agingRows = AGING_BUCKETS.map(b=>`<div class="row-item"><div class="r-left">${b.label}</div><div class="r-right num" style="${b.key==='d90p'&&aging.totals[b.key]>0?'color:var(--red)':''}">${fmt(aging.totals[b.key])}</div></div>`).join('')
      + (aging.totals.noInvoice>0.001 ? `<div class="row-item"><div class="r-left">بدون فاکتور <span class="sub">(مانده افتتاحیه/قدیمی)</span></div><div class="r-right num">${fmt(aging.totals.noInvoice)}</div></div>` : '');
    const topDebtors = aging.rows.slice(0,5).map(r=>`<div class="row-item"><div class="r-left"><b>${escapeHtml(r.name)}</b><span class="sub">قدیمی‌ترین بدهی: ${r.oldestDays} روز پیش</span></div><div class="r-right num u-color-var-red">${fmt(r.balance)}</div></div>`).join('');
    const agingCard = `<div class="eyebrow"><span>سن بدهی مشتریان (تا امروز)</span></div><div class="card">${aging.rows.length?agingRows+'<div class="total-line"><span>مجموع بدهی مشتریان</span><span class="num">'+fmt(aging.totals.total)+'</span></div>':'<div class="empty">مشتری بدهکاری نیست.</div>'}</div>${topDebtors?`<div class="card"><div class="field-note">بدهکارترین‌ها</div>${topDebtors}</div>`:''}`;

    const catMap={};
    expenses.forEach(e=>{ catMap[e.category]=(catMap[e.category]||0)+e.amount; });
    const catTotal = Object.values(catMap).reduce((a,x)=>a+x,0);
    const catRows = Object.keys(catMap).length ? Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
      const pct = catTotal>0 ? Math.round(v*1000/catTotal)/10 : 0;
      return `<div class="cat-row"><div class="cat-top"><b>${escapeHtml(k)}</b><span class="num">${fmt(v)} <i class="cat-pct">${pct}٪</i></span></div><div class="cat-track"><div class="cat-fill" style="width:${Math.max(2,Math.min(100,pct))}%"></div></div></div>`;
    }).join('') + `<div class="total-line"><span>مجموع مصارف</span><span class="num">${fmt(catTotal)}</span></div>` : `<div class="empty">مصرفی در این بازه ثبت نشده.</div>`;
    const pctOf = (x)=> revenue>0.001 ? (Math.round(x*1000/revenue)/10)+'٪' : '—';
    const kpiCards = `<div class="kpi-grid">
      <div class="kpi"><span>فروش خالص</span><b class="num">${fmt(revenue)}</b></div>
      <div class="kpi"><span>سود ناخالص</span><b class="num">${fmt(grossProfit)}</b><em>${pctOf(grossProfit)} از فروش</em></div>
      <div class="kpi ${netProfit>=0?'good':'bad'}"><span>سود خالص</span><b class="num">${fmt(netProfit)}</b><em>پس از کم شدن مصارف</em></div>
      <div class="kpi ${netProfit>=0?'good':'bad'}"><span>درصد سود خالص</span><b class="num">${pctOf(netProfit)}</b><em>سود ناخالص: ${pctOf(grossProfit)}</em></div>
    </div>`;

    const wdByPerson={};
    withdrawals.forEach(w=>{ const name=w.withdrawnBy||'نامشخص'; wdByPerson[name]=(wdByPerson[name]||0)+w.amount; });
    const wdSummaryRows = Object.keys(wdByPerson).length ? Object.entries(wdByPerson).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(k)}</b></div><div class="r-right num u-color-var-red">${fmt(v)}</div></div>`
    ).join('') : '';
    const wdListRows = [...withdrawals].sort((a,b)=>(b.ts||0)-(a.ts||0)).map(w=>
      `<div class="row-item"><div class="r-left"><b>${escapeHtml(w.withdrawnBy||'نامشخص')}</b><span class="sub">${w.date}${w.note?(' · '+escapeHtml(w.note)):''}</span><span class="sub u-opacity-8">${escapeHtml(this.whoLabel(w))}</span></div><div class="r-right num u-color-var-red">-${fmt(w.amount)}</div></div>`
    ).join('');

    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title u-margin-top-0">${ic('bar-chart',17)}گزارش سود و زیان</h2>
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
    ${kpiCards}
    <div class="card">
      <div class="eyebrow u-margin-top-0"><span>روند فروش و سود</span></div>
      ${this.trendChartHtml(start,end)}
    </div>
    <button class="btn btn-outline" onclick="App.exportReportExcel('${start}','${end}','${escapeHtml(label)}')">${ic('sheet',16)}خروجی اکسل از همین گزارش</button>
    <div class="card">
      <div class="field-note">بازه: ${label} (${start} تا ${end})</div>
      <div class="field-note">تمام ارقام این گزارش به ${this.state.settings.currency} است؛ خریدهای دالری نیز به نرخ روز خودشان به ${this.state.settings.currency} تبدیل شده‌اند.</div>
      <div class="row-item"><div class="r-left">فروش ناخالص <span class="sub">(پیش از تخفیف و مرجوعی)</span></div><div class="r-right num">${fmt(sm.gross)}</div></div>
      ${sm.discounts>0.001?`<div class="row-item"><div class="r-left">تخفیف‌ها</div><div class="r-right num u-color-var-red">- ${fmt(sm.discounts)}</div></div>`:''}
      <div class="row-item"><div class="r-left">مرجوعی، ابطال و کاستی <span class="sub">(${sm.returnEvents} مورد در این بازه)</span></div><div class="r-right num u-color-var-red">- ${fmt(sm.returns)}</div></div>
      <div class="row-item"><div class="r-left"><b>فروش خالص</b></div><div class="r-right num"><b>${fmt(revenue)}</b></div></div>
      <div class="row-item"><div class="r-left">قیمت تمام‌شدهٔ کالای فروخته‌شده</div><div class="r-right num">${fmt(cogs)}</div></div>
      <div class="row-item"><div class="r-left"><b>سود ناخالص</b></div><div class="r-right num u-color-var-green"><b>${fmt(grossProfit)}</b></div></div>
      <div class="row-item"><div class="r-left">مجموع مصارف کسب‌وکار (بدون برداشت شخصی)</div><div class="r-right num u-color-var-red">-${fmt(expTotal)}</div></div>
      <div class="total-line"><span>سود خالص</span><span class="num ${netProfit>=0?'':'red'}" style="color:${netProfit>=0?'var(--green)':'var(--red)'}">${fmt(netProfit)}</span></div>
    </div>
    <div class="card">
      <div class="row-item"><div class="r-left">مجموع خرید در این بازه (${this.state.settings.currency}، شامل تبدیل خریدهای دالری)</div><div class="r-right num">${fmt(purchTotal)}</div></div>
      <div class="row-item"><div class="r-left">تعداد فاکتور فروش (فعال)</div><div class="r-right num">${sales.filter(s=>s.status!=='cancelled').length}</div></div>
      ${sales.some(s=>s.status==='cancelled')?`<div class="row-item"><div class="r-left">فاکتورهای باطل‌شده در این بازه</div><div class="r-right num u-color-var-red">${sales.filter(s=>s.status==='cancelled').length}</div></div>`:''}
    </div>
    ${compareCard}
    ${prodCard}
    ${agingCard}
    <div class="eyebrow"><span>مصارف بر اساس نوع</span></div>
    <div class="card">${catRows}</div>
    <h2 class="section-title">${ic('hand-coins',17)}برداشت‌های شخصی (جدا از سود/زیان)</h2>
    <div class="card">
      <div class="field-note">برداشت شخصی، سود/زیان کسب‌وکار را تغییر نمی‌دهد؛ فقط از موجودی نقد کم می‌شود. این بخش فقط برای این است که بدانید هرکس چقدر برداشت کرده.</div>
      <div class="row-item"><div class="r-left"><b>مجموع برداشت در این بازه</b></div><div class="r-right num u-color-var-red"><b>${fmt(withdrawalTotal)}</b></div></div>
      ${wdSummaryRows}
    </div>
    ${withdrawals.length?`<div class="card">${wdListRows}</div>`:''}
    `;
  },

  renderSettings(){
    const s=this.state.settings;
    return `
    <button class="back-btn" onclick="App.navigate('more')">${ic('chevron-right',16)}بازگشت</button>
    <h2 class="section-title u-margin-top-0">${ic('settings',17)}تنظیمات</h2>
    <div class="card">
      <label>نام این گوشی/دستگاه (برای شناسایی ثبت‌کننده در فاکتورها)</label>
      <input id="set-device-label" value="${escapeHtml(getDeviceLabel())}" placeholder="مثلاً گوشی احمد، دفتر مرکزی">
      <div class="field-note">این نام فقط روی همین گوشی ذخیره می‌شود و کنار هر فروش/خرید/مصرفی که از این گوشی ثبت کنید نشان داده می‌شود. حساب ورودی فعلی: <b>${escapeHtml(this.user?this.user.email:'')}</b></div>
      <button class="btn btn-outline" onclick="App.saveDeviceLabelFromInput()">${ic('save',16)}ذخیرهٔ نام دستگاه</button>
    </div>
    ${this.isAdmin()?`<div class="card">
      <b>ابزار تطبیق حساب‌ها (فقط مالک)</b>
      <div class="field-note">مانده‌ها و موجودی را دوباره از تاریخچهٔ معاملات حساب می‌کند و اختلاف را گزارش می‌دهد. هیچ‌چیز بدون تأیید شما اصلاح نمی‌شود.</div>
      <button class="btn btn-outline" onclick="App.runReconcile('customers')">${ic('clipboard',16)}تطبیق مانده مشتریان</button>
      <button class="btn btn-outline" onclick="App.runReconcile('suppliers')">${ic('clipboard',16)}تطبیق مانده عمده‌فروشان</button>
      <button class="btn btn-outline" onclick="App.runReconcile('stock')">${ic('clipboard',16)}تطبیق موجودی انبار</button>
      <button class="btn btn-outline" onclick="App.runReconcile('invoices')">${ic('clipboard',16)}تطبیق مجموع فاکتورها</button>
      <button class="btn btn-outline" onclick="App.runReconcile('returns')">${ic('clipboard',16)}تطبیق مرجوعی‌ها</button>
    </div>`:''}
    <div class="card">
      <label>نام کسب‌وکار</label>
      <input id="set-name" value="${escapeHtml(s.businessName)}">
      <label>واحد پول</label>
      <select id="set-currency">
        <option value="افغانی" ${s.currency==='افغانی'?'selected':''}>افغانی</option>
        <option value="دالر" ${s.currency==='دالر'?'selected':''}>دالر</option>
        <option value="کلدار" ${s.currency==='کلدار'?'selected':''}>کلدار پاکستانی</option>
      </select>
      <label>منطقهٔ زمانی کسب‌وکار (برای «امروز» و گزارش‌ها)</label>
      <select id="set-timezone">${[['Asia/Kabul','افغانستان (کابل)'],['Asia/Karachi','پاکستان (کراچی)'],['Asia/Tehran','ایران (تهران)'],['Asia/Dubai','امارات (دبی)'],['UTC','UTC']].map(z=>'<option value="'+z[0]+'"'+((s.timezone||'Asia/Kabul')===z[0]?' selected':'')+'>'+z[1]+'</option>').join('')}</select>
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
      ${this.isAdmin()?`
      <label class="u-margin-top-14px">بازیابی از فایل پشتیبان</label>
      <div class="hint u-color-var-red-700 u-background-var-red-050 u-border-color-oklch-89-04-27">${ic('alert-triangle',13)}این کار دیتابیس مشترک همهٔ کاربران را جایگزین می‌کند، نه فقط اطلاعات همین گوشی را.</div>
      <input type="file" accept="application/json" onchange="App.importBackup(this)">
      `:`<div class="field-note">بازیابی از فایل پشتیبان فقط برای مالک/مدیر در دسترس است.</div>`}
    </div>
    ${this.isAdmin()?`
    <h2 class="section-title">${ic('alert-triangle',17)}منطقهٔ خطر</h2>
    <div class="card">
      <div class="hint u-color-var-red-700 u-background-var-red-050 u-border-color-oklch-89-04-27">${ic('alert-triangle',13)}این کار همهٔ اطلاعات را برای همهٔ کاربران پاک می‌کند. قبل از پاک کردن، یک نسخهٔ پشتیبان خودکار دانلود می‌شود.</div>
      <button class="btn btn-danger" onclick="App.wipeAll()">${ic('trash',17)}پاک کردن همهٔ اطلاعات</button>
    </div>`:''}
    `;
  },
};
