'use strict';
// Standalone front end for the Makan Liao reference application. All state-changing
// operations call the server; prices, roles and ownership are never trusted from HTML.
const state = {
  user:null,csrf:null,cartCount:0,page:'home',selectedCourt:0,query:'',cuisine:'All',
  stallId:null,orderId:null,vendorTab:'orders',adminTab:'overview',infoTab:'about',mobileOpen:false,focusStalls:false,
  courts:[],stalls:[],featured:[],loading:false,dish:null,forwardClaimId:null,forwardReceiptId:null,voucherStyle:'classic',seasonalTheme:{key:'classic',label:'Classic Makan Liao'},notificationOpen:false,notifications:[],
};
const $ = s=>document.querySelector(s);
const $all = s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=cents=>new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'}).format(Number(cents||0)/100);
const prettyTime=iso=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso));
const dateOnly=day=>new Intl.DateTimeFormat('en-SG',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Singapore'}).format(new Date(day+'T12:00:00+08:00'));
const prettyDate=iso=>new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso));
const titleCase=x=>String(x||'').replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
const paths={
  arrow:'<path d="M5 12h14M12 5l7 7-7 7"/>',chevron:'<path d="m9 18 6-6-6-6"/>',back:'<path d="M19 12H5m7-7-7 7 7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',
  basket:'<path d="m5 11 2 9h10l2-9H5ZM9 11l3-7 3 7M4 11h16M9 15v2m6-2v2"/>',
  bag:'<path d="M4 8h16l-1.3 13H5.3L4 8ZM9 9V6a3 3 0 0 1 6 0v3"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',close:'<path d="M18 6 6 18M6 6l12 12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',pin:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',shield:'<path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6l8-4Z"/><path d="m9 12 2 2 4-4"/>',
  check:'<path d="m4 12 5 5 11-11"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',trash:'<path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M2 20a7 7 0 0 1 14 0m2-15a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
  receipt:'<path d="M5 2h14v20l-4-2-3 2-3-2-4 2V2ZM8 7h8M8 11h8M8 15h5"/>',
  shop:'<path d="M3 10h18l-2-6H5l-2 6ZM5 10v11h14V10M9 21v-7h6v7"/>',
  bowl:'<path d="M3 12h18a9 9 0 0 1-18 0ZM8 21h8M7 4c-3 3 3 4 0 7m5-7c-3 3 3 4 0 7m5-7c-3 3 3 4 0 7"/>',
  chopsticks:'<path d="M4 2 9 21M11 2l5 19M3 21h17M18 6l4 2"/>',
  utensils:'<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M17 21V3c-4 3-4 9 0 10"/>',
  coffee:'<path d="M4 8h14v6a7 7 0 0 1-14 0V8Zm14 1h2a3 3 0 0 1 0 6h-2M4 21h16M9 2v3m5-3v3"/>',
  leaf:'<path d="M20 4C10 3 4 8 4 15a6 6 0 0 0 6 6c8 0 12-8 10-17ZM4 20c3-6 6-8 12-11"/>',
  sandwich:'<path d="m3 13 9-8 9 8-9 8-9-8ZM5 16l7-5 7 5M5 10l7 5 7-5"/>',
  pizza:'<path d="M3 21 12 3l9 18-18 0ZM8 16h.01M13 11h.01M16 17h.01"/>',
  pot:'<path d="M3 10h18v4a9 9 0 0 1-18 0v-4ZM2 10h20M9 6c-2-2 2-3 0-5m6 5c-2-2 2-3 0-5"/>',
  fish:'<path d="M3 12c4-5 10-7 15 0-5 7-11 5-15 0ZM18 12l4-5v10l-4-5ZM9 11h.01"/>',
  burger:'<path d="M4 11a8 8 0 0 1 16 0H4ZM3 15h18M4 19h16M5 21h14M7 8h.01M12 6h.01M17 8h.01"/>',
  drink:'<path d="M7 7h12l-2 14H9L7 7ZM4 4h17M13 7l3-5"/>',
  cupcake:'<path d="M5 12h14l-2 9H7l-2-9ZM4 12c-2-2 0-5 3-5 0-4 5-5 6-1 3-2 6 1 6 4v2M12 5V3"/>',
  cloche:'<path d="M3 17h18M5 17a7 7 0 0 1 14 0M12 8V6M2 20h20"/>',
  sparkle:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
  edit:'<path d="m4 16-1 5 5-1L20 8l-4-4L4 16ZM14 6l4 4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
  logout:'<path d="M9 4H5v16h4m5-4 4-4-4-4m-9 4h13"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10v.2"/>',
  phone:'<path d="M7 3H5C3 3 3 5 3 7c0 9 7 14 14 14 2 0 4 0 4-2v-2l-5-3-3 3a15 15 0 0 1-6-6l3-3-3-5Z"/>',
  sliders:'<path d="M4 7h16M4 17h16M9 4v6m6 4v6"/>',
  external:'<path d="M13 4h7v7m0-7-9 9M19 15v5H4V5h5"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4"/>',
  heart:'<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/>',
  gift:'<rect x="3" y="9" width="18" height="13" rx="2"/><path d="M12 9v13M3 13h18M12 9C7 9 6 6 8 4c2-2 4 1 4 5ZM12 9c5 0 6-3 4-5-2-2-4 1-4 5Z"/>',
  wave:'<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/>',
};
function ico(name,extra='') {return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths[name]||paths.utensils}</svg>`;}
function mealIcon(label='') {const s=String(label).toLowerCase();return /drink|tea|coffee|kopi|smoothie|latte|juice|milo|lassi|water|chocolate|brew/.test(s)?'coffee':/salad|vegetable|grain|fruit|tofu|harvest|yoghurt/.test(s)?'leaf':/sandwich|toast|bun|croissant|wrap|bakery|puff|panini/.test(s)?'sandwich':/chicken|rice|bowl|briyani|bento|don/.test(s)?'bowl':/soup|curry|pot/.test(s)?'pot':/pasta|pizza/.test(s)?'pizza':'chopsticks';}
const palette=['red','yellow','green','blue','pink','orange'];
const accent=x=>['red','yellow','mint','blue','pink','orange','green'].includes(String(x))?(x==='mint'?'green':x):'red';
function tagStatus(status){return `<span class="tag status-${esc(status)}">${esc(titleCase(status))}</span>`;}
let timer;
function toast(message,isError=false){const el=$('#toast');el.textContent=message;el.className=`toast show ${isError?'error':''}`;clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('show'),4200);}
function modal(title,content,actions=[]) {
  const root=$('#modal-root');
  root.innerHTML=`<div class="dialog-backdrop" data-action="dismissModal"><div class="dialog-box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="flex-between"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-action="dismissModal" aria-label="Close dialog">${ico('close')}</button></div>${content}<div class="dialog-actions">${actions.map(a=>`<button type="button" class="btn ${a.variant||'btn-secondary'}" data-action="${esc(a.action)}">${esc(a.text)}</button>`).join('')}</div></div></div>`;
  $('.dialog-box')?.focus?.();
}
function dismissModal(){ $('#modal-root').innerHTML=''; }
function ask(title,message,onConfirm,confirm='Continue'){
  modal(title,`<p>${esc(message)}</p>`,[{text:'Cancel',action:'dismissModal'}, {text:confirm,action:'confirmPending',variant:'btn-danger'}]);
  pendingConfirm=onConfirm;
}
let pendingConfirm=null;
async function request(endpoint, {method='GET', body}={}) {
  return window.MakanLiveBridge.request(endpoint, {method,body}, state.csrf);
}

function errorReport(error){toast(error?.message||'Something went wrong. Please try again.',true);}
async function refreshMe(){const d=await request('/api/auth/me');state.user=d.user;state.csrf=d.csrfToken;}
async function refreshCount(){if(state.user?.role==='customer'){try{state.cartCount=(await request('/api/cart')).count;}catch{state.cartCount=0;}}else state.cartCount=0;}
function navTo(page,opts={}){
  pendingPickup=null;
  if(state.dish)closeDish();
  if(['pools','forward','loyalty'].includes(page))page='explore';
  state.page=page;
  if(opts.stallId!==undefined)state.stallId=opts.stallId;
  if(opts.orderId!==undefined)state.orderId=opts.orderId;
  if(opts.selectedCourt!==undefined)state.selectedCourt=opts.selectedCourt;
  if(opts.focusStalls!==undefined)state.focusStalls=opts.focusStalls;
  state.mobileOpen=false;
  window.history.replaceState(null,'',`#${page}${page==='stall'&&state.stallId?'/'+state.stallId:''}${page==='order'&&state.orderId?'/'+state.orderId:''}`);
  if(!opts.focusStalls)window.scrollTo({top:0,behavior:'instant'});
  render();
}
function navItem(page,label){return `<button class="nav-link ${state.page===page?'active':''}" data-page="${page}">${label}</button>`;}
function shell(content){
  const user=state.user,role=user?.role;
  const mainNav=`${navItem('home','Home')}${navItem('explore','Food Stalls')}${navItem('how','How It Works')}${navItem('orders','Orders')}${role==='vendor'?navItem('vendor','Vendor Desk'):''}${role==='admin'?navItem('admin','Admin'):''}${!user?`<button class="nav-link nav-auth" data-page="login">Sign In</button><button class="nav-link nav-auth" data-page="signup">Sign Up</button>`:''}`;
  return `<div class="topbar">MADE FOR SP STUDENTS & STAFF <span>|</span> ORDER TOGETHER, SAVE MORE <span>|</span> COLLECT AT YOUR CAMPUS CANTEEN</div>
  <header class="site-header"><div class="container header-inner">
    <button class="brand" data-page="home" aria-label="Makan Liao homepage"><img src="/prototype-exact/makan-liao-logo.png" alt="Makan Liao?" /></button>
    <nav class="nav-links ${state.mobileOpen?'open':''}" aria-label="Main navigation">${mainNav}</nav>
    <div class="header-actions"><button class="icon-btn header-search" data-action="focusSearch" title="Search stalls" aria-label="Search stalls">${ico('search')}</button>
${role==='customer'?`<button type="button" class="icon-btn pickup-bell" aria-label="Pickup notifications" aria-expanded="false" aria-controls="pickup-list"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20a2 2 0 0 0 4 0"/></svg><span class="pickup-count"></span></button><section id="pickup-list" aria-label="Pickup notifications" hidden></section><button class="icon-btn" data-page="cart" aria-label="Shopping cart">${ico('basket')}${state.cartCount?`<span class="cart-count">${state.cartCount}</span>`:''}</button>`:''}
    ${user?`<button class="avatar-btn" data-page="profile" title="My profile"><span class="avatar">${esc(user.displayName.charAt(0).toUpperCase())}</span><span class="username">${esc(user.displayName.split(' ')[0])}</span></button>`:`<button class="btn btn-outline btn-sm" data-page="login">Sign In</button><button class="btn btn-sm signup-nav" data-page="signup">Sign Up</button>`}
    <button class="icon-btn mobile-menu" data-action="toggleMenu" aria-label="Toggle menu">${ico('menu')}</button></div>
  </div></header><main class="main" id="content">${content}</main>
  <footer class="site-footer"><div class="container footer-inner"><button class="footer-brand" data-page="home"><img src="/prototype-exact/makan-liao-logo.png" alt="Makan Liao?"/></button><span class="footer-brief">A campus food ordering platform for Singapore Polytechnic students and staff.</span><div class="footer-links"><button data-info="about">About</button><button data-info="help">Help & Support</button><button data-info="terms">Terms</button><button data-info="privacy">Privacy</button></div></div><div class="container footer-disclaimer">Independent class-project reference prototype. FC6 items reflect photographed menu boards. Other courts and accounts are samples. Pay at pickup only; no online payment.</div></footer>`;
}
const introCards=[['shop','Campus Stalls','Your favourite food, all in one place.'],['clock','Order Ahead','Pick a collection time that suits you.'],['receipt','Order Tracking','Follow your order until it is ready for pickup.']];
const featuredStallPhotos=['stalls/stall_19.webp','stalls/stall_17.webp','stalls/stall_21.webp'];
function foodImageFor(label=''){const text=String(label).toLowerCase();return /burger|western|sandwich|bun|toast|bake|pizza|pastry/.test(text)?'burger.webp':/noodle|mee|laksa|pasta|udon|wok|ramen|soup/.test(text)?'prawn-noodles.webp':'chicken-rice.webp';}
function imageForItem(item){return item?.image_path?`/prototype-exact/media/${encodeURI(item.image_path)}`:`/prototype-exact/media/${foodImageFor(item?.name||'food')}`;}
function homeHero(){return `<div class="campaign-section"><section class="campaign-hero"><div class="campaign-content"><div class="eyebrow campaign-eyebrow"><span></span> GOOD FOOD, RIGHT ON CAMPUS</div><h1>CRAVING FOR <strong>SMTH?</strong></h1><div class="hero-brush" aria-hidden="true"></div><p>Browse FC6 stalls, order ahead and collect at your preferred pickup time.</p><div class="hero-actions"><button data-page="explore" class="btn">Explore Food Stalls ${ico('arrow')}</button><button class="btn btn-outline" data-page="how">How It Works</button></div></div><div class="campaign-photo" role="img" aria-label="Chicken rice, noodles and iced milk tea" ><img src="/prototype-exact/media/hero-food.webp" alt="Chicken rice, noodles and iced tea"/></div></section>
  <form class="home-search" id="homeSearchForm"><div class="home-court-select">${ico('pin')}<select name="courtId" aria-label="Choose food court"><option value="0">SP Food Courts</option>${state.courts.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>${ico('down')}</div><div class="home-search-divider"></div><div class="home-search-input">${ico('search')}<input type="search" name="search" placeholder="Search for stalls, dishes or cuisines..." aria-label="Search stalls dishes or cuisines"/></div><button class="btn btn-sm" type="submit">Search</button></form>
  <div class="info-benefits">${introCards.map(([i,title,detail])=>`<div class="benefit"><span class="benefit-icon">${ico(i)}</span><div><strong>${title}</strong><small>${detail}</small></div></div>`).join('')}</div></div>`;}
function homePage(){
  const heroStalls=['Japanese Food','Canopy Greens','Hello Handmade Noodles'].map(name=>state.stalls.find(s=>s.name===name)).filter(Boolean);
  const tileCats=[['Local','bowl'],['Asian','cloche'],['Western','burger'],['Vegetarian','leaf'],['Beverages','drink'],['Snacks & Desserts','cupcake']];
  return `${homeHero()}<div class="container home-sections"><section class="home-featured"><div class="section-top"><div><h2 class="section-title">Featured Stalls</h2><p class="section-sub">Popular picks from SP canteens.</p></div><button class="text-action" data-page="explore">View All Stalls ${ico('arrow')}</button></div><div class="home-stall-grid">${heroStalls.map((stall,i)=>`<button data-stall="${stall.id}" class="home-stall-card"><div class="home-stall-photo"><img src="/prototype-exact/media/${featuredStallPhotos[i]}" alt="${esc(stall.name)} speciality"/><span class="photo-label">Food Court 6</span></div><div class="home-stall-info"><div><h3>${esc(stall.name)}</h3><p>${esc(stall.cuisine)} <span>·</span> ${esc(stall.court_name)}</p></div><span class="round-arrow">${ico('arrow')}</span></div></button>`).join('')}</div></section>
  <section class="home-cuisines"><div class="section-top"><div><h2 class="section-title">Browse by Cuisine</h2><p class="section-sub">Find something you love, faster.</p></div></div><div class="home-cuisine-grid">${tileCats.map(([name,ic])=>`<button class="cuisine-tile" data-homecuisine="${esc(name)}">${ico(ic)}<strong>${name}</strong></button>`).join('')}</div></section>
  <section class="pool-banner"><div class="pool-banner-image"><img src="/prototype-exact/media/food-pool-pack.webp" alt="Meals packed for pickup"/></div><div class="pool-banner-copy"><h2>Order Ahead. Collect On Time.</h2><p>Choose a FC6 stall, add your meal and select a pickup window. Pay at pickup.</p><button class="btn btn-sm" data-page="explore">Explore FC6 ${ico('arrow')}</button></div></section>
  </div>`;
}
function infoPage(){
  const pages={
    about:['About Makan Liao?','Makan Liao? is a demonstration of campus food ordering for Singapore Polytechnic students and staff. The project lets users discover food stalls, schedule pickup and track orders. FC6 menus are based on photographed menu boards; other food courts use sample data.'],
    help:['Help & Support','To place an order, sign in as a customer, browse a stall and add your meal to the cart. Pick an available collection slot, confirm, then check My Orders for updates. This is a demo: assistance and real stall support are not connected.'],
    terms:['Terms of Demonstration','This application is an educational reference prototype. All participating stalls, menu details, prices and accounts are simulated. Do not use real SP credentials or personal information. No real transactions, bookings or payments are conducted at actual Singapore Polytechnic canteens.'],
    privacy:['Privacy for This Prototype','Customer demo data, account records, sessions, sample orders and profile updates are stored in the configured PostgreSQL database. No institution Single Sign-On, analytics, advertising or external payment services are connected. Delete the local database file to reset the demo. Do not enter real personal or financial information.'],
  };
  const [title,body]=pages[state.infoTab]||pages.about;
  return `<div class="container"><div class="page-head"><span class="overline">MAKAN LIAO?</span><h1>${esc(title)}</h1><p>${esc(body)}</p></div><div class="panel" style="max-width:720px"><h2 style="font-size:23px">Explore the platform</h2><p>Food discovery, scheduled pickup, account management and vendor order operations are part of this CA2 demonstration.</p><div class="flex-wrap"><button class="btn" data-page="explore">Explore Food Stalls ${ico('arrow')}</button><button class="btn btn-outline" data-page="how">How It Works</button></div></div></div>`;
}
function howPage(){return `<div class="container"><div class="page-head"><span class="overline">SIMPLE, FAST, CAMPUS-FRIENDLY</span><h1>Good food, right on time.</h1><p>Ordering from your favourite stalls at Singapore Polytechnic shouldn't take up your entire break.</p></div><div class="how-page-grid">${[['01','Explore the campus','Browse the available food courts, filter by cuisine and view real stall menus.'],['02','Choose your meal','Add dishes to your cart, then choose an available collection slot.'],['03','Confirm & collect','Receive an order reference, track preparation and pay at the stall.'],['04','Track your order','Check your order status and collect it when the stall marks it ready.']].map(([n,title,desc])=>`<article class="how-page-card"><span>${n}</span><h2>${title}</h2><p>${desc}</p></article>`).join('')}</div><div class="pool-banner compact"><div class="pool-banner-image"><img src="/prototype-exact/media/food-pool-pack.webp" alt="Takeaway meals"/></div><div class="pool-banner-copy"><h2>Ready for your next break?</h2><p>Find a stall that looks good and pick your meal.</p><button class="btn" data-page="explore">Explore Food Stalls ${ico('arrow')}</button></div></div></div>`;}
function courtCard(c,i){return `<button class="court-card" data-court="${c.id}" aria-label="Browse ${esc(c.name)}"><div class="court-art court-photo"><img src="/prototype-exact/media/${esc(c.image_path||`courts/fc${c.id}.webp`)}" alt="${esc(c.name)} dining area" loading="lazy"/></div><div><h3>${esc(c.name)}</h3><span>${c.stall_count} stalls ${ico('chevron','class="chevron"')}</span></div></button>`;}
function stallCard(s){return `<article class="stall-card"><button data-stall="${s.id}" class="stall-cover branded-stall-cover" aria-label="Open ${esc(s.name)} menu"><img src="/prototype-exact/media/${esc(s.image_path||`stalls/stall_${String(s.id).padStart(2,'0')}.webp`)}" alt="Food speciality at ${esc(s.name)}" loading="lazy"/><span class="stall-photo-logo">${esc(s.name)}</span></button><div class="stall-body"><div class="stall-topline"><span class="tag">${esc(s.cuisine)}</span>${s.is_open===null?'<span class="tag tag-grey">Hours not confirmed</span>':s.is_open?'<span class="tag tag-green">Accepting orders</span>':'<span class="tag tag-grey">Temporarily closed</span>'}</div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="stall-foot"><span>${esc(s.court_name)} · ${s.item_count} items</span><button class="mini-arrow" data-stall="${s.id}">View menu ${ico('arrow')}</button></div></div></article>`;}
function featuredCard(item){return `<article class="featured-card"><div class="featured-art tone-${accent(item.accent)}">${ico(mealIcon(item.name))}</div><div style="display:flex;flex-direction:column;flex:1"><h3>${esc(item.name)}</h3><p>${esc(item.stall_name)}</p><div class="featured-foot"><strong>${money(item.price_cents)}</strong><button class="btn btn-sm btn-secondary" data-stall="${item.stall_id}">View menu ${ico('chevron')}</button></div></div></article>`;}
function filterCards(){
  let stalls=state.stalls;
  if(state.selectedCourt)stalls=stalls.filter(s=>s.food_court_id===state.selectedCourt);
  if(state.query)stalls=stalls.filter(s=>`${s.name} ${s.cuisine} ${s.court_name} ${s.description} ${s.menu_search||''}`.toLowerCase().includes(state.query.toLowerCase()));
  if(state.cuisine!=='All') {
    const bucket={Local:/local|rice|chinese|laksa/i,Asian:/asian|noodle|wok|japanese|indian|korean|chinese|laksa/i,Western:/western|sandwich|italian|breakfast/i,Vegetarian:/vegetarian|healthy|bowls|salad/i,Beverages:/drink|beverage|coffee|juice/i,'Snacks & Desserts':/bakery|snack|dessert|breakfast|drink/i};
    stalls=stalls.filter(s=>bucket[state.cuisine]?bucket[state.cuisine].test(s.cuisine+' '+s.description+' '+s.name):s.cuisine===state.cuisine);
  }
  return stalls;
}
function explorePage(){
  const cuisines=['All',...new Set(state.stalls.filter(s=>!state.selectedCourt||s.food_court_id===state.selectedCourt).map(s=>s.cuisine))];
  if(state.cuisine!=='All'&&!cuisines.includes(state.cuisine))cuisines.splice(1,0,state.cuisine);
  const filtered=filterCards();const court=state.courts.find(c=>c.id===state.selectedCourt);
  return `<div class="container"><div class="page-head"><div class="overline">FIND YOUR NEXT FAVOURITE</div><h1>${court?esc(court.name):'Explore Food Stalls'}</h1><p>Browse our six fictional SP food courts, discover different cuisines and order for pickup.</p></div>
  <section class="section"><div class="section-top"><div><h2 class="section-title">Explore All Food Courts</h2><p class="section-sub">Find the participating stalls in each location.</p></div>${state.selectedCourt?`<button class="text-action" data-action="clearCourt">View all food courts ${ico('arrow')}</button>`:''}</div><div class="court-grid">${state.courts.map(courtCard).join('')}</div></section>
  <section id="stall-list" class="section"><div class="section-top"><div><h2 class="section-title">${court?esc(court.name)+' Stalls':'All Food Stalls'}</h2><p class="section-sub">Menus, prices, availability and ordering in one place.</p></div><span class="result-count">${filtered.length} stalls found</span></div>
  <form id="searchForm" class="search-panel"><span class="search-icon">${ico('search')}</span><input id="searchInput" type="search" name="search" aria-label="Search stalls" placeholder="Search for a stall or cuisine" value="${esc(state.query)}" /><button type="submit" class="btn btn-sm">Search ${ico('arrow')}</button></form>
  <div class="filter-row">${cuisines.map(c=>`<button class="chip ${state.cuisine===c?'active':''}" data-cuisine="${esc(c)}">${esc(c)}</button>`).join('')}</div>
  ${filtered.length?`<div class="stall-grid">${filtered.map(stallCard).join('')}</div>`:empty('No matching stalls','Try another search or choose a different food court.','explore','See all stalls')}</section></div>`;
}
function empty(title,message,page='explore',action='Explore stalls'){return `<div class="empty-state">${ico('basket')}<h3>${esc(title)}</h3><p>${esc(message)}</p><button class="btn btn-sm" data-page="${page}">${esc(action)} ${ico('arrow')}</button></div>`;}
function crumbs(items,courtId){return `<div class="breadcrumbs"><button type="button" class="back-nav" data-court-back="${Number(courtId)||0}" aria-label="Go back to food court stalls">${ico('back')} Back to stalls</button><button data-page="explore">Explore</button>${items.map(i=>`<span>/</span><span>${esc(i)}</span>`).join('')}</div>`;}
function menuCard(item){return `<article class="menu-card ${!item.is_available?'menu-unavailable':''}"><div class="menu-food-photo"><img src="${imageForItem(item)}" alt="${esc(item.name)}"/><span class="tag">${esc(item.category)}</span></div><div class="menu-card-inner">${item.is_featured?`<span class="tag tag-red">Popular choice</span>`:''}<h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><div class="menu-bottom"><strong>${money(item.price_cents)}</strong><div class="dish-card-actions"><button class="btn btn-sm btn-secondary dish-preview-trigger" ${item.is_available?'':'disabled'} data-dish="${item.id}" aria-label="See details and customise ${esc(item.name)}">${ico('utensils')} Details</button><button class="btn btn-sm" ${item.is_available?'':'disabled'} data-add="${item.id}">${item.is_available?`${ico('plus')} Add`:'Sold Out'}</button></div></div></div></article>`;}
function stallPage(detail){const s=detail.stall,menu=detail.menu;
  const groups=[...new Set(menu.map(i=>i.category))];
  return `<div class="container">${crumbs([s.court_name,s.name],s.food_court_id)}<div class="stall-hero"><div class="stall-hero-content"><div class="flex-wrap"><span class="tag">${esc(s.cuisine)}</span>${s.is_open===null?'<span class="tag tag-grey">Hours not confirmed</span>':s.is_open?'<span class="tag tag-green">Accepting orders</span>':'<span class="tag tag-grey">Currently closed</span>'}</div><h1>${esc(s.name)}</h1><p>${esc(s.description)}</p><div class="flex-wrap"><span class="tag">${ico('pin')} ${esc(s.court_name)}</span><span class="tag">${ico('clock')} Pre-order & collect</span><span class="tag">Pay at pickup</span></div></div><div class="stall-hero-art stall-hero-photo"><img src="/prototype-exact/media/${esc(s.image_path||`stalls/stall_${String(s.id).padStart(2,'0')}.webp`)}" alt="${esc(s.name)} food photography" loading="eager" /></div></div>
  <div class="menu-layout"><div><div class="section-top"><div><p class="section-kicker">Made for your break</p><h2 class="section-title">The menu</h2><p class="section-sub">Prices shown in SGD. Availability can change.</p></div></div>${groups.map(g=>`<section class="section" style="margin-bottom:30px"><h3 style="font-size:16px;font-weight:900">${esc(g)}</h3><div class="menu-grid">${menu.filter(i=>i.category===g).map(menuCard).join('')}</div></section>`).join('')}</div>
  <aside class="sidebar-card"><h3>How pickup works</h3><p>Choose your meal now and select an available collection time at checkout.</p><div class="info-line">${ico('calendar')} Choose an available slot</div><div class="info-line">${ico('pin')} ${esc(s.court_name)}</div><div class="info-line">${ico('bag')} Pay directly at the stall</div><div style="height:19px"></div><button class="btn btn-wide" data-page="${state.user?.role==='customer'?'cart':'login'}">${state.user?.role==='customer'?'View your basket':'Sign in to order'} ${ico('arrow')}</button><p class="help-note">One stall per order. For multiple stalls, place separate orders.</p></aside></div></div>`;
}
function formatSelections(sel){
  if(!sel||!sel.size)return 'Regular portion';
  return `${esc(titleCase(sel.size))}${sel.addons?.length?' · '+(sel.addonLabels||sel.addons).map(x=>esc(titleCase(x))).join(', '):''}`;
}
let dishRequestId=0;
async function openDish(id,trigger){
  const turn=++dishRequestId;
  trigger?.classList.add('dish-launching');
  try{
    const details=await request(`/api/menu/${id}/details`);
    if(turn!==dishRequestId)return;
    state.dish={...details,selection:{size:'regular',addons:[]},quantity:1};
    renderDish();
    const dialog=$('#dish-dialog');dialog?.focus({preventScroll:true});
  }finally{trigger?.classList.remove('dish-launching');}
}
function renderDish(){
  if(!state.dish)return;
  const previous=$('.dish-panel-scroll');const prevScroll=previous?.scrollTop||0;const updating=!!previous;
  const {item,details:meta,recommendations,selection,quantity}=state.dish;
  const size=meta.sizes.find(x=>x.id===selection.size)||meta.sizes[0];
  const selectedExtras=meta.addons.filter(x=>selection.addons.includes(x.id));
  const unit=item.price_cents+size.extraCents+selectedExtras.reduce((sum,x)=>sum+x.extraCents,0);
  const calories=Math.round(meta.nutrition.calories*size.scale+selectedExtras.reduce((sum,x)=>sum+x.calories,0));
  const allergenList=[...new Set([...meta.allergens,...selectedExtras.flatMap(x=>x.allergens)])];
  const content=`<div class="dish-panel" id="dish-dialog" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="dish-title">
  <div class="dish-panel-head"><span class="eyebrow">GOOD FOOD, MADE YOUR WAY</span><button type="button" class="dish-close" data-action="closeDish" aria-label="Close dish details">${ico('close')}</button></div>
  <div class="dish-panel-scroll"><div class="dish-intro"><div class="dish-photo-wrap"><img src="${imageForItem(item)}" alt="${esc(item.name)}" /><div class="dish-photo-sticker">${ico('utensils')} Pick your perfect plate</div></div><div class="dish-about"><span class="tag tag-red">${esc(item.category)}</span><div class="dish-time">${ico('clock')} About ${meta.prepMinutes} min to prepare</div><h2 id="dish-title">${esc(item.name)}</h2><p>${esc(item.description)}</p><strong class="dish-from">From ${money(item.price_cents)}</strong><div class="nutrition-title">Nutrition at a glance <span>estimated per regular serving</span></div><div class="nutrition-grid">${[['Calories',meta.nutrition.calories,'kcal'],['Protein',meta.nutrition.proteinG,'g'],['Carbs',meta.nutrition.carbsG,'g'],['Fat',meta.nutrition.fatG,'g']].map(([label,value,unit])=>`<div><strong>${value}<small>${unit}</small></strong><span>${label}</span></div>`).join('')}</div><p class="dish-disclaimer">Nutrition is not supplied by the current stall API; the numeric examples here are not verified. Ask the vendor about ingredients and allergies.</p></div></div>
  <div class="dish-options"><section class="dish-section"><div class="dish-section-heading"><h3>Choose your size</h3><span>01</span></div><div class="dish-size-grid">${meta.sizes.map(v=>`<button type="button" class="dish-size ${selection.size===v.id?'selected':''}" data-dishsize="${v.id}" aria-pressed="${selection.size===v.id}"><strong>${esc(v.label)}</strong><span>${v.extraCents?`+${money(v.extraCents)}`:'Included'}</span></button>`).join('')}</div></section>
  ${meta.addons.length?`<section class="dish-section"><div class="dish-section-heading"><h3>Make it yours</h3><span>02 · choose up to 3</span></div><div class="dish-addon-grid">${meta.addons.map(v=>`<label class="dish-addon ${selection.addons.includes(v.id)?'selected':''}"><input type="checkbox" data-dishaddon="${v.id}" ${selection.addons.includes(v.id)?'checked':''}/><span class="addon-symbol">${ico(v.id==='greens'?'leaf':v.id==='cheese'?'sandwich':v.id==='egg'?'bowl':v.id==='pearls'?'drink':'plus')}</span><span class="addon-label"><strong>${esc(v.label)}</strong><small>${v.isDemo?'Demo suggestion · no extra charge':`+${money(v.extraCents)}`}</small></span></label>`).join('')}</div>${meta.addons.some(v=>v.isDemo)?'<p class="dish-disclaimer">Suggested customisations are demonstration options, not confirmed stall offerings. No surcharge is applied until verified.</p>':''}</section>`:''}
  <section class="dish-section"><div class="dish-section-heading"><h3>Good to know</h3><span>03</span></div><div class="dish-facts"><div>${ico('clock')} <span>Preparation: approx. ${meta.prepMinutes} min<br><small>Pickup slot selected at checkout</small></span></div><div>${ico('info')} <span>Estimated with your choices: <b>${calories} kcal</b><br><small>Possible allergens: ${esc(allergenList.join(', ')||'Not specified')}</small></span></div><div>${ico('receipt')} <span>Pickup orders<br><small>Add your chosen meal to your basket, then select a collection time.</small></span></div></div></section></div>
  <section class="dish-recos"><div class="dish-section-heading"><h3>You might also like</h3><span>From the same stall</span></div><div class="dish-reco-grid">${recommendations.map(r=>`<button type="button" class="dish-reco" data-dish="${r.id}"><img src="${imageForItem(r)}" alt=""/><span><b>${esc(r.name)}</b><small>${money(r.price_cents)}</small></span>${ico('chevron')}</button>`).join('')}</div></section>
  </div><div class="dish-panel-footer"><div class="dish-qty"><button data-action="dishMinus" type="button" aria-label="Decrease quantity">${ico('minus')}</button><strong>${quantity}</strong><button data-action="dishPlus" type="button" aria-label="Increase quantity">${ico('plus')}</button></div><div class="dish-total"><span>${esc(size.label)}${selection.addons.length?' + '+selection.addons.length+' extra'+(selection.addons.length>1?'s':''):''}</span><b>${money(unit*quantity)}</b></div><button type="button" class="btn dish-cart-cta" data-action="dishAdd">Add to basket ${ico('arrow')}</button></div></div>`;
  $('#modal-root').innerHTML=`<div class="dish-scrim ${updating?'dish-steady':''}" data-action="closeDish">${content}</div>`;
  const next=$('.dish-panel-scroll');if(next)next.scrollTop=prevScroll;
  document.body.classList.add('dish-open');
}
function closeDish(){++dishRequestId;state.dish=null;$('#modal-root').innerHTML='';document.body.classList.remove('dish-open');}
async function addCustomDish(){
  const d=state.dish;if(!d)return;
  if(state.user?.role!=='customer'){closeDish();toast('Sign in as a customer to order.');navTo('login');return;}
  const body={itemId:d.item.id,quantity:d.quantity,selections:d.selection};
  await request('/api/cart/items',{method:'POST',body});
  closeDish();await showAdded(d.item.id);
}
function loginPage(){return `<div class="container"><section class="auth-wrap"><div class="auth-art"><div><img class="auth-logo" src="/prototype-exact/makan-liao-logo.png" alt="Makan Liao?"/><div class="overline">CAMPUS FOOD, SORTED.</div><h1>Your next break <span>starts here.</span></h1><p>Sign in to pre-order your favourites, manage pickup times or run your participating food stall.</p></div><div class="quote">Designed for Singapore Polytechnic students, staff and participating vendors.</div></div><div class="auth-form"><div class="overline">Welcome back</div><h2>Sign in to Makan Liao.</h2><p>Sign in with your registered Makan Liao? account.</p><form id="loginForm"><div class="form-field"><label for="login-email">Email address</label><input id="login-email" type="email" name="email" autocomplete="username" placeholder="you@example.com" required maxlength="254" /></div><div class="form-field"><label for="login-password">Password</label><input id="login-password" type="password" name="password" autocomplete="current-password" placeholder="Enter your password" required /><span class="form-help">Use your own account password.</span></div><button class="btn btn-wide" type="submit">Sign in ${ico('arrow')}</button></form><p class="auth-switch">New to Makan Liao? <button data-page="signup">Create a customer account ${ico('arrow')}</button></p><p class="help-note">Customer accounts may sign up here. Vendor and administrator access is assigned by the team.</p></div></section></div>`;}
function signupPage(){return `<div class="container"><section class="auth-wrap"><div class="auth-art"><div><img class="auth-logo" src="/prototype-exact/makan-liao-logo.png" alt="Makan Liao?"/><div class="overline">YOUR NEXT BREAK STARTS HERE</div><h1>Good food, <span>on your time.</span></h1><p>Create a customer account to browse FC6 stalls, order ahead and track your meals.</p></div><div class="quote">For Singapore Polytechnic students and staff.</div></div><div class="auth-form"><div class="overline">JOIN MAKAN LIAO</div><h2>Create an Account</h2><p>Use your registered email and a secure password. This is not connected to SP Single Sign-On.</p><form id="signupForm"><div class="form-field"><label for="signup-name">Full name</label><input id="signup-name" name="displayName" autocomplete="name" required minlength="2" maxlength="70" placeholder="Your full name"/></div><div class="form-field"><label for="signup-email">Email address</label><input id="signup-email" type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"/></div><div class="form-field"><label for="signup-password">Password</label><input id="signup-password" type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="10+ characters with letters and numbers"/></div><div class="form-field"><label for="signup-confirm">Confirm password</label><input id="signup-confirm" type="password" name="confirm" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="Repeat your password"/></div><button type="submit" class="btn btn-wide">Create Account ${ico('arrow')}</button></form><p class="auth-switch">Already registered? <button data-page="login">Sign in instead ${ico('arrow')}</button></p><p class="help-note">Vendor and administrator accounts are managed by the platform.</p></div></section></div>`;}
function profilePage(){const u=state.user;
  return `<div class="container"><div class="dashboard-head"><div><div class="overline">Account settings</div><h1>Your profile.</h1><p>Keep your contact information up to date.</p></div><span class="role-chip">${esc(titleCase(u.role))} account</span></div><div class="dashboard-grid"><aside class="side-nav"><button class="active">${ico('user')} My details</button><button data-page="${u.role==='customer'?'orders':u.role==='vendor'?'vendor':'admin'}">${ico('receipt')} ${u.role==='customer'?'My orders':u.role==='vendor'?'Vendor dashboard':'Admin dashboard'}</button><button data-action="logout">${ico('logout')} Sign out</button></aside><div><section class="panel"><div class="profile-avatar">${esc(u.displayName.charAt(0).toUpperCase())}</div><h2 style="font-size:22px;letter-spacing:-.04em;margin:0">${esc(u.displayName)}</h2><p class="muted tiny">${esc(u.email)}</p><div class="profile-info"><div><div class="detail-label">Account role</div><div class="detail-value">${esc(titleCase(u.role))}</div></div><div><div class="detail-label">${u.role==='vendor'?'Assigned stall':'Access'}</div><div class="detail-value">${u.role==='vendor'?esc(u.stallName||'Not assigned'):u.role==='admin'?'Platform administrator':'SP student / staff customer'}</div></div></div></section>
  ${u.role==='customer' ? '<section class="panel"><h2>Pickup alerts</h2><p>Get a phone notification when your meal is ready.</p><button class="btn" id="pickup-enable">Enable device alerts</button> <button class="btn" id="pickup-disable">Turn off device alerts</button><p role="status" id="pickup-help"></p></section>' : ''}
  <section class="panel"><div class="panel-header"><div><h2>Edit personal details</h2><p>Changes are saved to the database.</p></div></div><form id="profileForm"><div class="form-field"><label for="profile-name">Display name</label><input id="profile-name" name="displayName" value="${esc(u.displayName)}" required minlength="2" maxlength="70" /></div><div class="form-field"><label for="profile-email">Email address</label><input id="profile-email" value="${esc(u.email)}" disabled /><span class="form-help">Email address is managed by the account administrator in this demo.</span></div><div class="form-field"><label for="profile-phone">Phone number (optional)</label><input id="profile-phone" name="phone" value="${esc(u.phone||'')}" maxlength="20" placeholder="e.g. +65 8123 4567" /></div><button class="btn" type="submit">Save changes ${ico('check')}</button></form></section><div class="note-box">${ico('shield')} Account roles and vendor stall assignments are controlled by the server. Customers and vendors cannot change their own permissions.</div></div></div></div>`;
}
function cartPage(d,slots){
  if(!d.items.length)return `<div class="container"><div class="page-head"><div class="overline">Your basket</div><h1>Almost lunch time.</h1><p>Add something delicious and we'll take care of the rest.</p></div>${empty('Your basket is empty','Choose a food court and add your favourites to get started.')}</div>`;
  const firstAvailable=slots.find(s=>s.available>0);
  return `<div class="container"><div class="page-head"><div class="overline">Your basket</div><h1>Ready when you are.</h1><p>Review your items and pick a collection slot. Payment happens at the stall.</p></div><div class="checkout-steps"><span class="step-pill active">01 · Review order</span><span class="step-pill active">02 · Pickup time</span><span class="step-pill">03 · Confirmation</span></div><div class="cart-layout"><div><section class="panel"><div class="panel-header"><div><h2>${esc(d.stallName)}</h2><p>${d.count} ${d.count===1?'item':'items'} in your basket</p></div><button class="btn btn-sm btn-quiet" data-action="clearCart">Clear basket</button></div>${d.items.map(i=>`<article class="cart-item"><img class="cart-art" src="${esc(imageForItem(i))}" alt="" /><div style="flex:1"><h3>${esc(i.name)}</h3><p>${money(i.price_cents)} each ${i.is_available?'':' · Unavailable'}</p><p class="cart-customisation">${formatSelections(i.selections)}</p><div class="qty"><button data-cartqty="${i.id}" data-quantity="${i.quantity-1}" aria-label="Decrease ${esc(i.name)}">${ico('minus')}</button><span>${i.quantity}</span><button data-cartqty="${i.id}" data-quantity="${i.quantity+1}" aria-label="Increase ${esc(i.name)}">${ico('plus')}</button><button class="remove-link" data-cartremove="${i.id}">Remove</button></div></div><strong class="cart-price">${money(i.quantity*i.price_cents)}</strong></article>`).join('')}</section>
  <section class="panel"><div class="panel-header"><div><h2>Pickup details</h2><p>Available time slots for ${esc(d.stallName)}.</p></div></div>${slots.length?`<div class="slot-group" role="radiogroup" aria-label="Choose pickup time">${slots.map(s=>`<label class="slot-option"><span><input type="radio" name="pickupAt" value="${esc(s.at)}" ${s===firstAvailable?'checked':''} ${s.available<=0?'disabled':''} /> ${esc(prettyTime(s.at))}</span><small>${s.available>0?`${s.available} slots left`:'Full'}</small></label>`).join('')}</div>`:`<p class="muted">No collection slots are available while this stall is closed.</p>`}<div class="form-field" style="margin-top:19px;margin-bottom:0"><label for="pickup-notes">Order notes (optional)</label><textarea id="pickup-notes" maxlength="250" placeholder="For example, less spicy if available"></textarea><span class="form-help">Stalls may not be able to accommodate every request.</span></div></section></div>
  <aside class="sidebar-card"><h3>Order summary</h3><div class="summary-row"><span>Items (${d.count})</span><strong>${money(d.totalCents)}</strong></div><div class="summary-row"><span>Service fee</span><strong>${money(0)}</strong></div><div class="summary-row summary-total"><span>Total</span><strong>${money(d.totalCents)}</strong></div><div class="note-box" style="margin:18px 0">${ico('info')} <strong>Pay at pickup.</strong><br>No online payment is required. Confirm your order and collect it at the selected stall.</div><button class="btn btn-wide" data-action="checkout" ${!firstAvailable?'disabled':''}>Place order ${ico('arrow')}</button><p class="help-note">Pickup times are reserved when your order is successfully placed.</p></aside></div></div>`;
}
function ordersPage(orders){return `<div class="container"><div class="dashboard-head"><div><div class="overline">Your orders</div><h1>Keep tabs on your makan.</h1><p>All your pickup orders, in one place.</p></div><button class="btn btn-secondary" data-page="explore">Explore stalls ${ico('arrow')}</button></div>${orders.length?orders.map(o=>`<div class="order-row"><div><div class="flex-wrap"><strong>${esc(o.order_number)}</strong>${tagStatus(o.status)}</div><h3>${esc(o.stall_name)}</h3><p>${esc(o.court_name)} · Pickup ${esc(prettyTime(o.pickup_at))}</p></div><div class="order-actions"><strong>${money(o.total_cents)}</strong><button class="btn btn-sm btn-secondary" data-order="${o.id}">View order ${ico('chevron')}</button></div></div>`).join(''):empty('No orders yet','When you place your first order, you can track it right here.')}</div>`;}
let displayedOrderStatus;
function customerFeedback(o) {
  if (state.user.role !== 'customer' || o.status !== 'COLLECTED') return '';
  if (o.feedback) return `<section class="panel no-print"><h2>Your feedback</h2><p>Review status · ${esc(o.feedback.status)}</p></section>`;
  return `<section class="panel no-print"><h2>How was your meal?</h2><p>Your review will appear as <strong>Anonymous Customer</strong> after approval. Leave out names and contact details.</p>
    <form id="feedbackForm" data-order-id="${o.id}"><div class="form-field"><label for="meal-rating">Star rating</label>
    <select name="rating" id="meal-rating" required><option value="">Choose a rating</option>${[5,4,3,2,1].map(n=>`<option value="${n}">${'★'.repeat(n)} · ${n} of 5</option>`).join('')}</select></div>
    <div class="form-field"><label for="meal-review">Your review</label><textarea id="meal-review" name="comment" rows="3" maxlength="800" required></textarea></div>
    <button class="btn" type="submit">Submit anonymous review</button></form></section>`;
}

function feedbackPanel(reviews, admin) {
  return `<section class="panel"><h2>${admin?'Review moderation':'Customer reviews'}</h2><p>${admin?'Check pending reviews for abusive language and identifying details before approving. Flagged reviews appear first.':'Approved feedback from customers who collected a meal at your stall.'}</p>
    ${reviews.length ? reviews.map(r=>`<article class="note-box" style="margin-block:1rem;overflow-wrap:anywhere"><strong>${admin?esc(r.stall):esc(r.reviewer)}</strong>
    <div aria-label="${r.rating} out of 5 stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
    ${admin && r.flagged?'<span class="tag">Flagged language</span>':''}<p>${esc(r.comment)}</p>
    ${admin?`<div class="row-actions"><button class="btn btn-sm" data-feedback-id="${r.id}" data-decision="Approved">Approve</button><button class="btn btn-secondary btn-sm" data-feedback-id="${r.id}" data-decision="Rejected">Reject</button></div>`:''}</article>`).join('') : `<p class="muted">${admin?'No reviews await moderation.':'No approved reviews yet.'}</p>`}</section>`;
}

async function dashboardWithFeedback(role, tab) {
  const data = await request(`/api/${role}/dashboard`);
  if (tab === 'feedback') data.reviews = (await request(`/api/${role}/feedback`)).reviews;
  return data;
}

function orderPage(o){
  const backPage=state.user.role==='vendor'?'vendor':state.user.role==='admin'?'admin':'orders';
  const backLabel=backPage==='vendor'?'Vendor Desk':backPage==='admin'?'Admin overview':'My orders';
  displayedOrderStatus=o.status;const stages=['PLACED','ACCEPTED','PREPARING','READY','COLLECTED'];const idx=stages.indexOf(o.status);
  return `<div class="container"><div class="breadcrumbs"><button data-page="${backPage}">${backLabel}</button><span>/</span><span>${esc(o.order_number)}</span></div><div class="panel" style="max-width:820px;margin:25px auto"><div class="receipt-heading"><div><div class="overline">Order confirmed</div><h1>${esc(o.order_number)}</h1><p class="muted tiny">Placed ${esc(prettyDate(o.created_at))}</p></div>${tagStatus(o.status)}</div><div class="receipt-grid"><div><div class="detail-label">Collect from</div><div class="detail-value">${esc(o.stall_name)} · ${esc(o.court_name)}</div></div><div><div class="detail-label">Pickup time</div><div class="detail-value">${esc(prettyTime(o.pickup_at))}</div></div><div><div class="detail-label">Customer</div><div class="detail-value">${esc(o.customer_name)}</div></div><div><div class="detail-label">Payment</div><div class="detail-value">Pay at pickup</div></div></div><h3 style="font-size:15px">Your items</h3><table class="receipt-items"><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>${o.items.map(i=>`<tr><td>${esc(i.name_snapshot)}<div class="muted tiny">${formatSelections(i.selections)}</div></td><td>${i.quantity}</td><td>${money(i.price_cents*i.quantity)}</td></tr>`).join('')}</tbody></table>${o.loyalty_discount_cents?`<div class="summary-row"><span>Loyalty reward saved</span><strong>-${money(o.loyalty_discount_cents)}</strong></div>`:''}${o.promotional_discount_cents?`<div class="summary-row"><span>Seasonal voucher saved</span><strong>-${money(o.promotional_discount_cents)}</strong></div>`:''}<div class="summary-row summary-total"><span>Total</span><strong>${money(o.total_cents)}</strong></div>${o.notes?`<p class="muted tiny">Notes: ${esc(o.notes)}</p>`:''}<hr class="subtle-divider"/><h3 style="font-size:15px">Order progress</h3>${o.status==='CANCELLED'?'<div class="note-box">This order has been cancelled and will not be prepared.</div>':`<div class="timeline">${stages.map((s,i)=>`<div class="timeline-node ${i<=idx?'done':''}">${esc(titleCase(s))}</div>`).join('')}</div>`}<div class="flex-wrap no-print"><button class="btn btn-secondary" data-page="${backPage}">${ico('chevron')} ${backLabel}</button><button class="btn btn-secondary" data-action="printOrder">${ico('receipt')} Print receipt</button>${o.status==='PLACED'&&state.user.role==='customer'?`<button class="btn btn-quiet" data-cancelorder="${o.id}">Cancel order</button>`:''}</div>${customerFeedback(o)}${state.user?.role==='customer' && o.status==='READY'?`<section class="receipt-pickup"><h2>Pickup QR code</h2><p>Show this code to the vendor when you receive your food.</p><img width="200" height="200" src="/prototype-exact/pickup-unavailable.svg" data-live-qr="${o.id}" alt="Pickup code loading"></section>`:''}</div></div>`;
}
let lastVendorOrders='';
function vendorPage(d){
  lastVendorOrders=JSON.stringify(d.orders);
  const orders=d.orders, open=orders.filter(o=>!['COLLECTED','CANCELLED'].includes(o.status));
  const counts={new:orders.filter(o=>o.status==='PLACED').length,active:open.length,ready:orders.filter(o=>o.status==='READY').length,completed:orders.filter(o=>o.status==='COLLECTED').length};
  const integrationBanner=d._integrationPending?'<div class="note-box" role="status">Order dashboard backend is not integrated yet. These counts are not live.</div>':'';
  const section=state.vendorTab==='feedback'?feedbackPanel(d.reviews||[],false):state.vendorTab==='orders'?`<section class="panel"><div class="panel-header"><div><h2>Incoming orders</h2><p>Process each order as it moves through preparation.</p></div><button class="btn btn-sm btn-secondary" data-action="refreshVendor">Refresh ${ico('arrow')}</button></div>${orders.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Order / Customer</th><th>Pickup</th><th>Amount</th><th>Status</th><th>Next action</th></tr></thead><tbody>${orders.map(o=>{
  const next={PLACED:['ACCEPTED','Accept order'],ACCEPTED:['PREPARING','Start preparing'],PREPARING:['READY','Mark ready']}[o.status];
  return `<tr><td><strong>${esc(o.order_number)}</strong><div class="muted tiny">${esc(o.customer_name)}</div></td><td>${esc(prettyTime(o.pickup_at))}</td><td><strong>${money(o.total_cents)}</strong></td><td>${tagStatus(o.status)}</td><td><div class="row-actions">${next?`<button class="btn btn-sm ${next[0]==='READY'?'btn-green':''}" data-vendorstatus="${o.id}" data-status="${next[0]}">${esc(next[1])}</button>`:''}<button class="btn btn-sm btn-secondary" data-order="${o.id}">Details</button>${['PLACED','ACCEPTED','PREPARING'].includes(o.status)?`<button class="btn btn-sm btn-quiet" data-vendorstatus="${o.id}" data-status="CANCELLED">Cancel</button>`:''}</div></td></tr>`;}).join('')}</tbody></table></div>`:empty('No orders yet','New orders from customers will appear here.','vendor','Refresh dashboard')}</section>`:
  state.vendorTab==='menu'?`<section class="panel"><div class="panel-header"><div><h2>Menu management</h2><p>Edit prices, availability and descriptions.</p></div><button class="btn btn-sm" data-action="addMenu">${ico('plus')} Add item</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Available</th><th>Manage</th></tr></thead><tbody>${d.menu.map(i=>`<tr><td><strong>${esc(i.name)}</strong><div class="tiny muted" style="max-width:250px">${esc(i.description)}</div></td><td>${esc(i.category)}</td><td>${money(i.price_cents)}</td><td>${i.is_available?'<span class="tag tag-green">Available</span>':'<span class="tag tag-grey">Paused</span>'}</td><td><div class="row-actions"><button class="btn btn-sm btn-secondary" data-editmenu="${i.id}">${ico('edit')} Edit</button><button class="btn btn-sm btn-quiet" data-togglemenu="${i.id}" data-available="${i.is_available?'false':'true'}">${i.is_available?'Pause':'Enable'}</button></div></td></tr>`).join('')}</tbody></table></div></section>`:
  `<section class="panel"><div class="panel-header"><div><h2>Stall operations</h2><p>Control availability and per-slot pickup capacity.</p></div></div><form id="vendorSettingsForm"><div class="form-field"><label for="vendor-open">Accepting orders</label><select id="vendor-open" name="isOpen"><option value="true" ${d.stall.is_open?'selected':''}>Open for orders</option><option value="false" ${!d.stall.is_open?'selected':''}>Temporarily closed</option></select></div><div class="form-field"><label for="vendor-capacity">Maximum orders per pickup slot</label><input id="vendor-capacity" name="capacityPerSlot" type="number" min="1" max="60" value="${d.stall.capacity_per_slot}" required/><span class="form-help">This controls how many orders customers can reserve in each 30-minute pickup slot.</span></div><button class="btn" type="submit">Save stall settings ${ico('check')}</button></form></section>`;
  return `<div class="container desk desk-vendor"><div class="dashboard-head"><div><div class="overline">Vendor desk · ${esc(d.stall.court_name)}</div><h1>${esc(d.stall.name)}</h1><p>${counts.new===1?'1 order awaits acceptance.':counts.new+' orders await acceptance.'}</p></div><div class="flex-wrap">${d.stall.is_open?'<span class="tag tag-green">Accepting orders</span>':'<span class="tag tag-grey">Orders paused</span>'}<button class="btn btn-secondary btn-sm" data-stall="${d.stall.id}">View storefront ${ico('external')}</button></div></div><div class="stat-grid"><div class="stat"><span class="desk-metric-label">${ico('receipt')} New orders</span><strong>${counts.new}</strong></div><div class="stat"><span class="desk-metric-label">${ico('clock')} Active orders</span><strong>${counts.active}</strong></div><div class="stat"><span class="desk-metric-label">${ico('cloche')} Ready for pickup</span><strong>${counts.ready}</strong></div><div class="stat"><span class="desk-metric-label">${ico('check')} Collected</span><strong>${counts.completed}</strong></div></div><div class="tab-row">${[['orders','Orders'],['scanner','Collection Scanner'],['menu','Menu & availability'],['settings','Stall settings'],['feedback','Reviews']].map(([id,label])=>`<button class="tab-btn ${state.vendorTab===id?'active':''}" aria-pressed="${state.vendorTab===id}" data-vendortab="${id}">${ico(({orders:'receipt',scanner:'phone',menu:'bowl',settings:'sliders',overview:'shop',accounts:'user',stalls:'shop',feedback:'receipt'})[id])} ${label}</button>`).join('')}</div>${integrationBanner}${state.vendorTab==='scanner'?scannerPage():section}</div>`;
}
function adminPage(d){const integrationBanner=d._integrationPending?'<div class="note-box" role="status">Admin APIs are not integrated yet. Account and order metrics are unavailable, not zero.</div>':'';const section=state.adminTab==='feedback'?feedbackPanel(d.reviews||[],true):state.adminTab==='overview'?`<section class="panel"><div class="panel-header"><div><h2>Platform overview</h2><p>Metrics loaded from the connected backend where available.</p></div></div><div class="stat-grid" style="margin-bottom:0"><div class="stat"><span class="desk-metric-label">${ico('user')} Accounts</span><strong>${d.counts.users}</strong></div><div class="stat"><span class="desk-metric-label">${ico('shop')} Stalls</span><strong>${d.counts.stalls}</strong></div><div class="stat"><span class="desk-metric-label">${ico('receipt')} All orders</span><strong>${d.counts.orders}</strong></div><div class="stat"><span class="desk-metric-label">${ico('clock')} Active orders</span><strong>${d.counts.active_orders}</strong></div></div><div class="note-box" style="margin-top:20px">Only connected endpoints provide live figures. Unavailable features remain pending until their backend is merged.</div></section>`:
  state.adminTab==='accounts'?`<section class="panel"><div class="panel-header"><div><h2>Account permissions</h2><p>Manage roles and vendor stall assignments.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th>Role</th><th>Assigned stall</th><th>Enabled</th><th>Action</th></tr></thead><tbody>${d.users.map(u=>`<tr data-userrow="${u.id}"><td><strong>${esc(u.displayName)}</strong><div class="muted tiny">${esc(u.email)}</div></td><td><select class="role-select" aria-label="Role for ${esc(u.displayName)}">${['customer','vendor','admin'].map(role=>`<option value="${role}" ${u.role===role?'selected':''}>${titleCase(role)}</option>`).join('')}</select></td><td><select class="stall-select" aria-label="Assigned stall for ${esc(u.displayName)}"><option value="">None</option>${d.stalls.map(s=>`<option value="${s.id}" ${u.stallId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></td><td><select class="active-select" aria-label="Account status for ${esc(u.displayName)}"><option value="true" ${u.active?'selected':''}>Enabled</option><option value="false" ${!u.active?'selected':''}>Disabled</option></select></td><td><button class="btn btn-sm btn-secondary" data-saveuser="${u.id}" ${u.id===state.user.id?'disabled':''}>Save</button></td></tr>`).join('')}</tbody></table></div><p class="help-note">Your own admin account cannot be modified through this form. Inactive accounts cannot sign in.</p></section>`:
  `<section class="panel"><div class="panel-header"><div><h2>Participating stalls</h2><p>Manage stall names, status and operating capacity.</p></div><button class="btn btn-sm" data-action="adminAddStall">${ico('plus')} Add stall</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Stall</th><th>Food court</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead><tbody>${d.stalls.map(s=>`<tr><td><strong>${esc(s.name)}</strong><div class="muted tiny">${esc(s.cuisine)}</div></td><td>${esc(s.court_name)}</td><td>${s.capacity_per_slot} / slot</td><td>${s.is_open?'<span class="tag tag-green">Open</span>':'<span class="tag tag-grey">Closed</span>'}</td><td><button class="btn btn-sm btn-secondary" data-adminstall="${s.id}">${ico('edit')} Edit</button></td></tr>`).join('')}</tbody></table></div></section>`;
  return `<div class="container desk desk-admin"><div class="dashboard-head"><div><div class="overline">Platform management</div><h1>Admin dashboard</h1><p>${d.stalls.filter(s=>s.is_open).length} of ${d.stalls.length} stalls open for orders.</p></div><span class="tag tag-blue">Administrator</span></div><div class="tab-row">${[['overview','Overview'],['accounts','Accounts & roles'],['stalls','Stall management'],['feedback','Review moderation']].map(([id,label])=>`<button class="tab-btn ${state.adminTab===id?'active':''}" aria-pressed="${state.adminTab===id}" data-admintab="${id}">${ico(({orders:'receipt',scanner:'phone',menu:'bowl',settings:'sliders',overview:'shop',accounts:'user',stalls:'shop',feedback:'receipt'})[id])} ${label}</button>`).join('')}</div>${integrationBanner}${section}</div>`;
}
let renderId=0;
let pendingPickup=null;
let closePickupCamera=null;
function scannerPage(){
  if(pendingPickup){
    return `<section class="panel"><h2>Confirm collection?</h2><p>The QR format was read successfully, but the order has <strong>not yet been verified</strong>. Confirm the food and payment with the customer first.</p><p>The backend will check the QR, stall ownership, payment and Ready status when you approve.</p><button class="btn" data-action="approvePickup">Verify &amp; collect</button> <button class="btn btn-secondary" data-action="declinePickup">Cancel</button></section>`;
  }
  return `<section class="panel"><h2>Collection Scanner</h2><p>Scan the pickup QR on the customer’s receipt or upload a clear image of it.</p><button class="btn" data-action="pickupCamera">Scan with camera</button><video id="pickupVideo" muted playsinline hidden width="240"></video><div class="form-field"><label for="pickupFile">Upload QR image or receipt PDF</label><input type="file" id="pickupFile" accept="image/*,application/pdf,.pdf"></div><form id="pickupForm" class="form-field"><label for="pickupCode">USB QR scanner</label><input id="pickupCode" name="code" required autocomplete="off"><button class="btn btn-secondary">Review scan</button></form></section>`;
}
async function collectPickup(code){
  const turn=renderId;
  const info=await request('/api/vendor/pickup/review',{method:'POST',body:{code}});
  if(turn!==renderId)return;
  pendingPickup={...info,code};await render();
}
function readQR(source,width,height){
  const ratio=Math.min(1,1600/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  return jsQR(pixels.data,pixels.width,pixels.height)?.data;
}
document.addEventListener('change',event=>{
  if(event.target.id!=='pickupFile')return;
  const input=event.target,file=input.files[0];if(!file)return;
  closePickupCamera?.();input.value='';
  run(async()=>{
    let code;
    if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)){
      const pdfjs=await import('/prototype-exact/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc='/prototype-exact/pdfjs/pdf.worker.min.mjs';
      const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,useSystemFonts:true}).promise;
      try{
        for(let pageNumber=1;pageNumber<=pdf.numPages && !code && input.isConnected;pageNumber++){
          const page=await pdf.getPage(pageNumber);
          const size=page.getViewport({scale:1});
          const view=page.getViewport({scale:Math.min(3,2000/Math.max(size.width,size.height))});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
          await page.render({canvas,viewport:view}).promise;
          code=readQR(canvas,canvas.width,canvas.height);
          page.cleanup();
        }
      }finally{await pdf.destroy();}
    }else{
      const reader=new FileReader();
      const dataUrl=await new Promise((resolve,reject)=>{
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
      });
      const img=new Image();
      img.src=dataUrl;
      try{await img.decode();}catch{throw Error('This image format could not be opened. Choose a PNG, JPEG, or receipt PDF.');}
      code=readQR(img,img.naturalWidth,img.naturalHeight);
    }
    if(!code)throw Error('No QR found. Choose the customer receipt or a clear screenshot of its pickup QR.');
    if(input.isConnected)await collectPickup(code);
  });
});
async function scanPickupCamera(){
  if(closePickupCamera){closePickupCamera();return;}
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable. Upload a QR image or use localhost or HTTPS.');
  const video=document.querySelector('#pickupVideo'),button=document.querySelector('[data-action="pickupCamera"]');
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
  function stop(){
    stream.getTracks().forEach(track=>track.stop());
    if(closePickupCamera===stop){closePickupCamera=null;video.hidden=true;video.srcObject=null;button.textContent='Scan with camera';}
  }
  if(!video.isConnected || closePickupCamera){stop();return;}
  closePickupCamera=stop;
  try{
    video.hidden=false;button.textContent='Stop camera';video.srcObject=stream;await video.play();
    while(closePickupCamera===stop){
      if(video.readyState>=2){
        const code=readQR(video,video.videoWidth,video.videoHeight);
        if(code){stop();await collectPickup(code);return;}
      }
      await new Promise(resolve=>setTimeout(resolve,180));
    }
  }finally{stop();}
}
async function render() {
  if(closePickupCamera)closePickupCamera();
  const turn=++renderId;
  const root=$('#app');
  if(state.page==='orders' && state.user?.role==='vendor'){
    state.page='vendor';state.vendorTab='orders';
  }
  if(['cart','orders'].includes(state.page)&&state.user?.role!=='customer'){state.page='login';}
  if(state.page==='order' && !state.user){state.page='login';}
  if(state.page==='profile'&&!state.user)state.page='login';
  if(state.page==='vendor'&&state.user?.role!=='vendor')state.page=state.user?'profile':'login';
  if(state.page==='admin'&&state.user?.role!=='admin')state.page=state.user?'profile':'login';
  root.innerHTML=shell('<div class="loading">Preparing the page…</div>');
  try {
    let html='';
    if(state.page==='home')html=homePage();
    else if(state.page==='explore')html=explorePage();
    else if(state.page==='how')html=howPage();
    else if(state.page==='info')html=infoPage();
    else if(state.page==='signup')html=signupPage();
    else if(state.page==='login')html=loginPage();
    else if(state.page==='profile')html=profilePage();
    else if(state.page==='stall'){html=stallPage(await request(`/api/stalls/${state.stallId}`));}
    else if(state.page==='cart'){
      const cart=await request('/api/cart');
      const slots=cart.stallId?(await request(`/api/slots?stallId=${cart.stallId}`)).slots:[];
      html=cartPage(cart,slots);
    }
    else if(state.page==='orders'){const resp=await request('/api/orders');html=(resp._integrationPending?'<div class="container note-box" role="status">Order history awaits the customer order backend. No sample order is displayed as real.</div>':'')+ordersPage(resp.orders);}
    else if(state.page==='order')html=orderPage((await request(`/api/orders/${state.orderId}`)).order);
    else if(state.page==='vendor')html=vendorPage(await dashboardWithFeedback('vendor',state.vendorTab));
    else if(state.page==='admin')html=adminPage(await dashboardWithFeedback('admin',state.adminTab));
    else {state.page='home';html=homePage();}
    if(turn===renderId) {
      root.innerHTML=shell(html);
      window.MakanLiveBridge.decorate?.(root);
      if(state.focusStalls&&state.page==='explore'){state.focusStalls=false;$('#stall-list')?.scrollIntoView({behavior:'smooth'});}
    }
  }catch(error){if(turn===renderId){root.innerHTML=shell(`<div class="container"><div class="page-head"><h1>We couldn't load that page.</h1><p>${esc(error.message)}</p><button class="btn" data-page="explore">Back to Explore</button></div></div>`);errorReport(error);}}
}
async function loadCatalog(){const [c,s,f]=await Promise.all([request('/api/food-courts'),request('/api/stalls'),request('/api/featured')]);state.courts=c.courts;state.stalls=s.stalls;state.featured=f.items;}

function getFormData(form){return Object.fromEntries(new FormData(form).entries());}
async function run(action){try{await action();}catch(error){errorReport(error);}}
async function showAdded(id){
  await refreshCount();
  const cart=document.querySelector('button[aria-label="Shopping cart"]');
  if(cart){
    let badge=cart.querySelector('.cart-count');
    if(!badge){badge=document.createElement('span');badge.className='cart-count';cart.append(badge);}
    badge.textContent=state.cartCount;
  }
  const button=document.querySelector(`[data-dish="${id}"],[data-add="${id}"]`);
  if(!button)return;
  button.querySelector('.added-flash')?.remove();
  const feedback=document.createElement('span');
  feedback.className='added-flash';feedback.setAttribute('role','status');
  feedback.innerHTML='<i aria-hidden="true">🥄</i>✓ Added<i aria-hidden="true">🍴</i>';
  button.append(feedback);setTimeout(()=>feedback.remove(),1400);
}
async function addItem(itemId){if(state.user?.role!=='customer'){toast('Sign in as a customer to add items.');navTo('login');return;}
  try {
    await request('/api/cart/items',{method:'POST',body:{itemId,quantity:1}});await showAdded(itemId);
  }catch(error){
    if(error.code==='CART_STALL_CONFLICT')ask('Start a new basket?',error.message,async()=>{await request('/api/cart',{method:'DELETE'});await request('/api/cart/items',{method:'POST',body:{itemId,quantity:1}});await showAdded(itemId);},'Replace basket');
    else errorReport(error);
  }
}
function menuDialog(item){const edit=!!item;
  modal(edit?'Edit menu item':'Add menu item',`<form id="menuEditForm"><div class="form-field"><label>Item name</label><input name="name" maxlength="80" minlength="2" value="${esc(item?.name||'')}" required/></div><div class="form-field"><label>Description</label><textarea name="description" maxlength="220" required>${esc(item?.description||'')}</textarea></div><div class="form-grid"><div class="form-field"><label>Category</label><input name="category" maxlength="35" minlength="2" value="${esc(item?.category||'Mains')}" required/></div><div class="form-field"><label>Price (SGD)</label><input name="price" type="number" min="0.50" max="100" step="0.01" value="${item?(item.price_cents/100).toFixed(2):''}" required/></div></div>${edit?`<div class="form-field"><label>Availability</label><select name="isAvailable"><option value="true" ${item.is_available?'selected':''}>Available</option><option value="false" ${!item.is_available?'selected':''}>Unavailable</option></select></div>`:''}<input type="hidden" name="itemId" value="${item?.id||''}"/><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="dismissModal">Cancel</button><button type="submit" class="btn">${edit?'Save item':'Add item'}</button></div></form>`);
  // Hide auto footer because form contains the real actions.
}
function editStallDialog(s){modal('Edit stall details',`<form id="adminStallForm"><div class="form-field"><label>Stall name</label><input name="name" value="${esc(s.name)}" minlength="2" maxlength="80" required /></div><div class="form-field"><label>Description</label><textarea name="description" maxlength="180" required>${esc(s.description)}</textarea></div><div class="form-grid"><div class="form-field"><label>Orders per slot</label><input type="number" name="capacityPerSlot" value="${s.capacity_per_slot}" min="1" max="60" required /></div><div class="form-field"><label>Operating status</label><select name="isOpen"><option value="true" ${s.is_open?'selected':''}>Open</option><option value="false" ${!s.is_open?'selected':''}>Closed</option></select></div></div><input type="hidden" name="stallId" value="${s.id}" /><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="dismissModal">Cancel</button><button class="btn" type="submit">Save stall</button></div></form>`);}
function addStallDialog(){modal('Add a participating stall',`<form id="adminAddStallForm"><div class="form-field"><label>Food court</label><select name="foodCourtId">${state.courts.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="form-field"><label>Stall name</label><input name="name" minlength="2" maxlength="80" required /></div><div class="form-field"><label>Cuisine</label><input name="cuisine" minlength="2" maxlength="50" required /></div><div class="form-field"><label>Description</label><textarea name="description" maxlength="180" required></textarea></div><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-action="dismissModal">Cancel</button><button class="btn" type="submit">Add stall</button></div></form>`);}
// Declarative interaction handling avoids dynamic inline JavaScript and keeps CSP strict.
document.addEventListener('click',event=>{
  const e=event.target.closest('button,[data-court],[data-stall],[data-add],[data-order]');
  if(!e)return;
  if(e.matches('button')&&e.type!=='submit')event.preventDefault();
  const d=e.dataset;
  if(d.info){state.infoTab=d.info;navTo('info');return;}
  if(d.page){if(d.page==='forward'){state.forwardReceiptId=null;state.forwardClaimId=null;}if(d.page==='explore'&&state.page!=='explore'){state.query='';state.selectedCourt=0;state.cuisine='All';}navTo(d.page);return;}
  if(d.courtBack!==undefined){state.cuisine='All';state.query='';navTo('explore',{selectedCourt:Number(d.courtBack)||0,focusStalls:true});return;}
  if(d.court){state.selectedCourt=Number(d.court);state.cuisine='All';state.query='';navTo('explore',{focusStalls:true});return;}
  if(d.stall){navTo('stall',{stallId:Number(d.stall)});return;}
  if(d.order){navTo('order',{orderId:Number(d.order)});return;}
  if(d.dish){run(()=>openDish(Number(d.dish),e));return;}
  if(d.dishsize&&state.dish){state.dish.selection.size=d.dishsize;renderDish();return;}
  if(d.action==='closeDish'){if(e.classList.contains('dish-scrim')||e.closest('.dish-close'))closeDish();return;}
  if(d.action==='dishPlus'&&state.dish){state.dish.quantity=Math.min(20,state.dish.quantity+1);renderDish();return;}
  if(d.action==='dishMinus'&&state.dish){state.dish.quantity=Math.max(1,state.dish.quantity-1);renderDish();return;}
  if(d.action==='dishAdd'){run(addCustomDish);return;}
  if(d.action==='dishPools'){closeDish();navTo('pools');return;}
  if(d.add){run(()=>addItem(Number(d.add)));return;}
  if(d.cuisine){state.cuisine=d.cuisine;state.focusStalls=true;render();return;}
  if(d.homecuisine){state.cuisine=d.homecuisine;state.selectedCourt=0;state.query='';navTo('explore',{focusStalls:true});return;}
  if(d.demo){toast('Use your registered account to sign in.',true);return;}
  if(d.cartqty){const id=Number(d.cartqty),qty=Number(d.quantity);run(async()=>{if(qty<=0){await request(`/api/cart/items/${id}`,{method:'DELETE'});}else if(qty<=20){await request(`/api/cart/items/${id}`,{method:'PATCH',body:{quantity:qty}});}else{toast('Maximum 20 of each item.');return;}await refreshCount();render();});return;}
  if(d.cartremove){run(async()=>{await request(`/api/cart/items/${d.cartremove}`,{method:'DELETE'});await refreshCount();toast('Item removed.');render();});return;}
  if(d.cancelorder){ask('Cancel this order?','You can cancel a newly placed order before the stall accepts it.',async()=>{await request(`/api/orders/${d.cancelorder}/cancel`,{method:'POST'});toast('Order cancelled.');render();},'Cancel order');return;}
  if(d.vendortab){pendingPickup=null;state.vendorTab=d.vendortab;render();return;}
  if(d.feedbackId){run(async()=>{await request('/api/admin/feedback/'+d.feedbackId,{method:'PATCH',body:{status:d.decision}});toast('Review '+d.decision.toLowerCase()+'.');await render();});return;}
  if(d.admintab){state.adminTab=d.admintab;render();return;}
  if(d.vendorstatus){const id=d.vendorstatus,status=d.status;const work=async()=>{await request(`/api/vendor/orders/${id}/status`,{method:'PATCH',body:{status}});toast(`Order marked ${titleCase(status)}.`);render();};if(status==='CANCELLED')ask('Cancel this order?','The customer will see that the stall has cancelled their order.',work,'Cancel order');else run(work);return;}
  if(d.editmenu){run(async()=>{const result=await request('/api/vendor/dashboard');const item=result.menu.find(i=>i.id===Number(d.editmenu));if(item)menuDialog(item);});return;}
  if(d.togglemenu){run(async()=>{await request(`/api/vendor/menu/${d.togglemenu}`,{method:'PATCH',body:{isAvailable:d.available==='true'}});toast('Availability updated.');render();});return;}
  if(d.saveuser){const tr=e.closest('tr'),role=tr.querySelector('.role-select').value,stallId=tr.querySelector('.stall-select').value,isActive=tr.querySelector('.active-select').value==='true';run(async()=>{await request(`/api/admin/users/${d.saveuser}`,{method:'PATCH',body:{role,stallId:stallId?Number(stallId):null,isActive}});toast('Account updated.');render();});return;}
  if(d.adminstall){run(async()=>{const data=await request('/api/admin/dashboard');const s=data.stalls.find(x=>x.id===Number(d.adminstall));if(s)editStallDialog(s);});return;}
  switch(d.action){
    case 'toggleMenu':state.mobileOpen=!state.mobileOpen;render();break;
    case 'clearCourt':state.selectedCourt=0;state.cuisine='All';state.query='';navTo('explore',{focusStalls:true});break;
    case 'browseStalls':navTo('explore',{focusStalls:true});break;
    case 'focusSearch':if(state.page!=='home')navTo('home');else $('#homeSearchForm input[name=search]')?.focus();break;
    case 'howItWorks':navTo('how');break;
    case 'dismissModal':if(e.classList.contains('dialog-backdrop')||e.closest('.dialog-box'))dismissModal();break;
    case 'confirmPending':{const action=pendingConfirm;pendingConfirm=null;dismissModal();if(action)run(action);break;}
    case 'logout':run(async()=>{await request('/api/auth/logout',{method:'POST'});state.user=null;clearPickupBanner();state.csrf=null;state.cartCount=0;toast('Signed out successfully.');navTo('home');});break;
    case 'clearCart':ask('Clear your basket?','All items will be removed from your basket.',async()=>{await request('/api/cart',{method:'DELETE'});await refreshCount();toast('Your basket is now empty.');render();},'Clear basket');break;
    case 'checkout':run(async()=>{const radio=$('input[name="pickupAt"]:checked');if(!radio){toast('Please choose a pickup time.',true);return;}const response=await request('/api/orders',{method:'POST',body:{pickupAt:radio.value,notes:$('#pickup-notes')?.value||'',loyaltyRewardId:$('#loyalty-use')?.value?Number($('#loyalty-use').value):null,promoVoucherId:$('#promo-use')?.value?Number($('#promo-use').value):null}});state.cartCount=0;toast('Order placed successfully.');navTo('order',{orderId:response.order.id});});break;
    case 'printOrder':window.print();break;
    case 'declinePickup':pendingPickup=null;render();break;
    case 'approvePickup':run(async()=>{
      if(!pendingPickup)return;
      e.disabled=true;
      try{
        const result=await request('/api/vendor/pickup/approve',{method:'POST',body:{code:pendingPickup.code}});
        pendingPickup=null;state.vendorTab='orders';toast(result.message);await render();
      }finally{e.disabled=false;}
    });break;
    case 'pickupCamera':run(scanPickupCamera);break;
    case 'refreshVendor':render();break;
    case 'addMenu':menuDialog(null);break;
    case 'adminAddStall':addStallDialog();break;
    case 'reload':location.reload();break;
  }
});

document.addEventListener('change',event=>{
  const el=event.target;if(!el.matches('[data-dishaddon]')||!state.dish)return;
  const id=el.dataset.dishaddon;
  if(el.checked){if(state.dish.selection.addons.length>=3){el.checked=false;toast('Select no more than three add-ons.',true);return;}state.dish.selection.addons.push(id);}
  else state.dish.selection.addons=state.dish.selection.addons.filter(x=>x!==id);
  renderDish();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.dish)closeDish();});
document.addEventListener('submit',event=>{
  const form=event.target;event.preventDefault();
  const data=getFormData(form);
  switch(form.id){
    case 'homeSearchForm':state.selectedCourt=Number(data.courtId)||0;state.query=String(data.search||'').trim();state.cuisine='All';navTo('explore',{focusStalls:true});break;
    case 'searchForm':state.query=String(data.search||'').trim();state.cuisine='All';state.focusStalls=true;render();break;
    case 'loginForm':run(async()=>{const result=await request('/api/auth/login',{method:'POST',body:{email:data.email,password:data.password}});state.user=result.user;state.csrf=result.csrfToken;await refreshCount();toast(`Welcome back, ${result.user.displayName.split(' ')[0]}.`);navTo(result.user.role==='vendor'?'vendor':result.user.role==='admin'?'admin':'home');});break;
    case 'signupForm':run(async()=>{if(data.password!==data.confirm){toast('Your passwords do not match.',true);return;}const result=await request('/api/auth/signup',{method:'POST',body:{displayName:data.displayName,email:data.email,password:data.password}});state.user=result.user;state.csrf=result.csrfToken;await refreshCount();toast('Account created successfully.');navTo('home');});break;
    case 'feedbackForm':run(async()=>{await request('/api/orders/'+form.dataset.orderId+'/feedback',{method:'POST',body:{rating:Number(data.rating),comment:data.comment}});toast('Your review is pending approval.');await render();});break;
    case 'pickupForm':run(()=>collectPickup(data.code.trim()));break;
    case 'profileForm':run(async()=>{const result=await request('/api/profile',{method:'PATCH',body:{displayName:data.displayName,phone:data.phone}});state.user=result.user;toast(result.message);render();});break;
    case 'vendorSettingsForm':run(async()=>{await request('/api/vendor/stall',{method:'PATCH',body:{isOpen:data.isOpen==='true',capacityPerSlot:Number(data.capacityPerSlot)}});toast('Stall settings saved.');render();});break;
    case 'menuEditForm':run(async()=>{const payload={name:data.name,description:data.description,category:data.category,priceCents:Math.round(Number(data.price)*100)};if(data.itemId)payload.isAvailable=data.isAvailable==='true';await request(data.itemId?`/api/vendor/menu/${data.itemId}`:'/api/vendor/menu',{method:data.itemId?'PATCH':'POST',body:payload});dismissModal();toast('Menu saved.');render();});break;
    case 'adminStallForm':run(async()=>{await request(`/api/admin/stalls/${data.stallId}`,{method:'PATCH',body:{name:data.name,description:data.description,capacityPerSlot:Number(data.capacityPerSlot),isOpen:data.isOpen==='true'}});dismissModal();await loadCatalog();toast('Stall updated.');render();});break;
    case 'adminAddStallForm':run(async()=>{await request('/api/admin/stalls',{method:'POST',body:{foodCourtId:Number(data.foodCourtId),name:data.name,cuisine:data.cuisine,description:data.description}});dismissModal();await loadCatalog();toast('New stall added.');render();});break;
  }
});

document.addEventListener('change',event=>{
  const target=event.target;
  if(target?.id==='loyalty-use'&&target.value&&$('#promo-use'))$('#promo-use').value='';
  if(target?.id==='promo-use'&&target.value&&$('#loyalty-use'))$('#loyalty-use').value='';
});
async function init(){try{await refreshMe();await loadCatalog();await refreshCount();const hash=location.hash.replace('#','').split('/');if(['home','explore','how','info','login','signup','profile','cart','orders','stall','order','vendor','admin'].includes(hash[0])){state.page=hash[0];if(state.page==='stall')state.stallId=Number(hash[1])||1;if(state.page==='order')state.orderId=Number(hash[1])||1;if(state.page==='forward'&&hash[1]==='claim')state.forwardClaimId=Number(hash[2])||null;}await render();}catch(error){errorReport(error);$('#app').innerHTML=`<main class="container"><div class="page-head"><h1>Unable to start the app.</h1><p>${esc(error.message)}</p><button class="btn" data-action="reload">Reload</button></div></main>`;}}
init();

// Refresh the vendor-sponsored-meal queue while it is on screen.
document.addEventListener('change',event=>{

});
let checkingOrders=false;
async function refreshIncomingOrders(){
  if(checkingOrders || document.hidden || state.page!=='vendor' || state.vendorTab!=='orders' || $('#modal-root').firstChild)return;
  const turn=renderId;
  checkingOrders=true;
  try{
    const data=await request('/api/vendor/dashboard');
    if(turn===renderId && !$('#modal-root').firstChild && JSON.stringify(data.orders)!==lastVendorOrders){
      const content=$('#content');
      if(content?.querySelector('.dashboard-head'))content.innerHTML=vendorPage(data);
    }
  }catch{/* Retry at the next interval. Manual Refresh also reports connection errors. */}
  finally{checkingOrders=false;}
}
setInterval(refreshIncomingOrders,5000);
document.addEventListener('visibilitychange',refreshIncomingOrders);

setInterval(async()=>{
  if(state.page!=='order' || document.hidden || ['COLLECTED','CANCELLED'].includes(displayedOrderStatus))return;
  const id=state.orderId;
  try{
    const {order}=await request(`/api/orders/${id}`);
    if(state.page==='order' && state.orderId===id && order.status!==displayedOrderStatus)render();
  }catch{/* A later poll retries after a temporary connection failure. */}
},10000);

let pickupOrders = [];
let pickupOwner = null;
let checkingPickup = false;
let popupTimer;
const memoryFlags = new Set();
function flag(order,kind,write=false) {
  const key = 'pickup:'+pickupOwner+':'+order.id+':'+kind;
  if(write) memoryFlags.add(key);
  try { if(write) localStorage.setItem(key,'1'); return memoryFlags.has(key)||localStorage.getItem(key)==='1'; }
  catch { return memoryFlags.has(key); }
}
function visibleAlerts() { return pickupOwner===state.user?.id ? pickupOrders.filter(o=>!flag(o,'dismissed')) : []; }
function hidePopup(){clearTimeout(popupTimer); $('#pickup-pop').hidden=true;}
function clearPickupBanner(){pickupOwner=null;pickupOrders=[];hidePopup();paintAlerts();}
function pickupArt(kind) {
  const paths = {
    meal:'<path d="M3 16h18M5 16a7 7 0 0 1 14 0M12 6V4M3 20h18"/>',
    arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>'
  };
  return '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths[kind]+'</svg>';
}
function paintAlerts(){
  const bell=$('.pickup-bell'),list=$('#pickup-list');
  if(!bell||!list)return;
  const orders=visibleAlerts();
  bell.querySelector('.pickup-count').textContent=orders.length||'';
  bell.setAttribute('aria-label','Pickup notifications, '+orders.length+' active');
  const markup='<strong class="pickup-heading">'+pickupArt('meal')+' Pickup notifications</strong>'+ (orders.length ? orders.map(o=>
    '<article><p>Order '+esc(o.order_number)+' is ready at '+esc(o.stall)+'.</p><button data-pick-open="'+Number(o.id)+'">View order '+pickupArt('arrow')+'</button> <button data-pick-dismiss="'+Number(o.id)+'">'+pickupArt('check')+' Dismiss</button></article>').join('') : '<p>No pickup alerts.</p>');
  if(list.innerHTML!==markup && !list.hidden)list.innerHTML=markup;
}
function closeList(){
  const list=$('#pickup-list'); if(list)list.hidden=true;
  $('.pickup-bell')?.setAttribute('aria-expanded','false');
}
document.addEventListener('click',e=>{
  const bell=e.target.closest('.pickup-bell');
  if(bell){const list=$('#pickup-list');list.hidden=!list.hidden;bell.setAttribute('aria-expanded',String(!list.hidden));hidePopup();paintAlerts();return;}
  const item=e.target.closest('[data-pick-dismiss],[data-pick-open]');
  if(item){
    const order=visibleAlerts().find(o=>o.id===Number(item.dataset.pickDismiss||item.dataset.pickOpen));
    if(!order)return;
    if(item.hasAttribute('data-pick-dismiss')){flag(order,'dismissed',true);hidePopup();paintAlerts();$('.pickup-bell')?.focus();}
    else{hidePopup();closeList();navTo('order',{orderId:order.id});}
    return;
  }
  if(e.target.closest('[data-hide-pickup]'))hidePopup();
  if(!e.target.closest('#pickup-list'))closeList();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if($('#pickup-list')&&!$('#pickup-list').hidden)$('.pickup-bell')?.focus();closeList();hidePopup();}
});
async function refreshPickup(){
  const user=state.user;
  if(user?.role!=='customer'){clearPickupBanner();return;}
  if(checkingPickup||document.hidden)return;
  if(pickupOwner!==user.id){clearPickupBanner();pickupOwner=user.id;}
  checkingPickup=true;
  try{
    const {orders}=await request('/api/pickup/ready');
    if(state.user?.id!==user.id||pickupOwner!==user.id)return;
    pickupOrders=orders;paintAlerts();
    const fresh=visibleAlerts().filter(o=>!flag(o,'shown'));
    if(fresh.length){
      fresh.forEach(o=>flag(o,'shown',true));
      const popup=$('#pickup-pop'),o=fresh[0];
      popup.innerHTML='<span class="pickup-meal">'+pickupArt('meal')+'</span><strong>Ready for collection</strong><button data-hide-pickup aria-label="Close notification">'+pickupArt('close')+'</button><p>'+
        (fresh.length===1?'Order '+esc(o.order_number)+' is ready at '+esc(o.stall)+'.':fresh.length+' orders are ready. Open the bell for details.')+'</p>';
      if(fresh.length===1) popup.innerHTML += '<button class="pickup-view" data-pick-open="'+Number(o.id)+'">View order '+pickupArt('arrow')+'</button>';
      popup.hidden=false;clearTimeout(popupTimer);popupTimer=setTimeout(hidePopup,9000);
    }
  }catch(err){if(err.status===401)clearPickupBanner();}
  finally{checkingPickup=false;}
}
new MutationObserver(()=>paintAlerts()).observe($('#app'),{childList:true});
setInterval(refreshPickup, 5000);
document.addEventListener('visibilitychange',refreshPickup);
const pickupRegistration = window.isSecureContext && 'serviceWorker' in navigator ?
  navigator.serviceWorker.register('/prototype-exact/pickup-sw.js').then(()=>navigator.serviceWorker.ready).catch(()=>null) : null;
document.addEventListener('click', async event => {
  const enable = event.target.closest('#pickup-enable');
  if (!enable && !event.target.closest('#pickup-disable')) return;
  const help = document.querySelector('#pickup-help');
  try {
    if (!pickupRegistration || !('PushManager' in window) || !('Notification' in window)) {
      throw Error('Use HTTPS and a browser with Web Push. On iPhone or iPad, add this app to the Home Screen and open it there.');
    }
    if (enable && await Notification.requestPermission() !== 'granted') throw Error('Allow notifications in your device settings to see pickup previews.');
    const reg = await pickupRegistration;
    if (!reg) throw Error('Device alerts could not start. Reload and try again.');
    let sub = await reg.pushManager.getSubscription();
    if (enable) {
      const {key} = await request('/api/pickup/device');
      if (!key) throw Error('The server needs its push key configured before device alerts can be enabled.');
      if (!sub) {
        const raw = atob(key.replace(/-/g,'+').replace(/_/g,'/'));
        sub = await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
      }
      await request('/api/pickup/device',{method:'POST',body:{endpoint:sub.endpoint}});
      help.textContent = 'Pickup previews are enabled on this device for this sign-in.';
    } else {
      if (sub) {
        await request('/api/pickup/device',{method:'DELETE',body:{endpoint:sub.endpoint}});
        await sub.unsubscribe();
      }
      help.textContent = 'Device alerts are off. Ready orders still appear in the app.';
    }
  } catch(error) { help.textContent = error.message; }
});
