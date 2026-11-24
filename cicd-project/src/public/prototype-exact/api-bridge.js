/* Makan Liao? API bridge for the actual GitHub Classroom backend.
 * No fake database writes. Cart is browser-local until an order endpoint accepts checkout.
 * Never store JWTs or CSRF secrets in localStorage.
 */
(function (root) {
  'use strict';
  // Only features available in the active Express app should be treated as live.
  // Independent teammate branches are not automatically merged into this branch.
  const FEATURES = Object.freeze({auth:true,stallReads:true,cartBrowserOnly:true,checkout:false,vendorWrites:false,adminWrites:false,pickup:false,reviews:false,profiles:false});
  const FIXTURES = root.__ML_EXACT_FIXTURES__ || null;
  const MENU_REFERENCE = root.MakanMenuReference || null;
  let previewCatalog = false;
  let catalogIssue = '';
  const cookieKey = 'makan-live-cart-v1:';
  const stallsCache = new Map();
  const menuCache = new Map();
  const windowsCache = new Map();
  let courts = [];
  let me = null;
  let token = null;
  let tokenExpiry = 0;
  let csrfToken = null;
  let catalogPromise = null;
  const API_PENDING = 'The backend for this feature is not integrated yet. The screen is ready; no changes have been saved.';
  const clean = (v, fallback = '') => typeof v === 'string' && v.trim() ? v.trim() : fallback;
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const asArray = data => Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.orders) ? data.orders : [];
  const id = x => Number.isInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
  function fail(message, status = 503, code = 'INTEGRATION_PENDING') {
    const e = new Error(message);
    e.status = status;
    e.code = code;
    throw e;
  }
  function unsupported(feature) { fail(`${feature}: ${API_PENDING}`, 503); }
  function bodyError(data, status) {
    const errors = data?.errors;
    let message = clean(data?.error) || clean(data?.message);
    if (!message && errors && typeof errors === 'object') message = Object.values(errors).filter(x => typeof x === 'string').join(' ');
    return Object.assign(new Error(message || `The server rejected this request (HTTP ${status}).`), { status, code: data?.code });
  }
  async function http(endpoint, {method = 'GET', body, auth = false} = {}) {
    const headers = {Accept:'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!['GET','HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (auth) {
      const bearer = await obtainToken();
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
    }
    let response;
    try { response = await root.fetch(endpoint, {method,headers,credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body)}); }
    catch { fail('Cannot reach the Makan Liao? server. Check that npm start is running.',503,'NETWORK_ERROR'); }
    let data = null;
    const kind = response.headers?.get?.('content-type') || '';
    if (kind.includes('application/json')) {
      try { data = await response.json(); } catch { /* invalid JSON handled below */ }
    }
    if (!response.ok) {
      if (response.status === 404) fail(`This backend route (${endpoint.split('?')[0]}) is not available on the current branch. No data was changed.`,503);
      throw bodyError(data, response.status);
    }
    if (data === null) fail(`The route ${endpoint} returned no JSON; backend/API integration is still required.`,503);
    return data;
  }
  async function optional(endpoint, options = {}) {
    try { return await http(endpoint,options); }
    catch (e) { if (e.status === 503 && e.code === 'INTEGRATION_PENDING') return null; throw e; }
  }
  function publicUser(u) { return u ? {
    id:num(u.id), email:clean(u.email), displayName:clean(u.displayName || u.name, 'Customer'),
    role:clean(u.role,'customer').toLowerCase(), phone:clean(u.phone),
    stallId:id(u.stallId || u.vendorId), stallName:clean(u.stallName), active:u.active!==false,
  } : null; }
  async function obtainToken() {
    if (token && Date.now() + 12000 < tokenExpiry) return token;
    if (!me || !csrfToken) return null;
    const result = await optional('/api/auth/token',{method:'POST',body:{}});
    if (!result) return null; // Existing session-cookie authentication remains supported.
    token = result.accessToken || result.token || null;
    tokenExpiry = Date.now() + Math.min(9 * 60 * 1000, Math.max(1000, num(result.expiresIn,600)*1000));
    return token;
  }
  function cartKey() { return cookieKey + (me?.id || 'guest'); }
  function readCart() {
    try {
      const v = JSON.parse(root.localStorage.getItem(cartKey()) || 'null');
      if (v && id(v.stallId) && Array.isArray(v.items)) return {stallId:id(v.stallId),items:v.items.filter(x=>id(x.id)&&Number.isInteger(x.quantity)&&x.quantity>0&&x.quantity<=20).slice(0,30)};
    } catch { /* corrupted or disabled storage */ }
    return {stallId:null,items:[]};
  }
  function writeCart(cart) { try {root.localStorage.setItem(cartKey(),JSON.stringify(cart));} catch {fail('Browser storage is unavailable. Enable it to use the basket.',400,'CART_STORAGE');} }
  function normalizeStall(x) {
    const court = clean(x.foodCourtName || x.court_name || x.foodCourt || x.food_court_name,'Food court not specified');
    let courtItem = courts.find(c=>c.name===court);
    if (!courtItem) {courtItem={id:courts.length+1,name:court}; courts.push(courtItem);}
    const stall = {
      id:id(x.id), name:clean(x.name || x.stallName,'Unnamed stall'),
      court_name:court, food_court_id:courtItem.id, cuisine:clean(x.cuisine,'Food & drinks'),
      description:clean(x.description,'Browse the menu and choose a collection time.'),
      is_open:x.isOpen ?? x.is_open ?? null,
      image_path:clean(x.image_path,`stalls/stall_${String(x.id||1).padStart(2,'0')}.webp`),
      pickup_location:clean(x.pickupLocation || x.pickup_location), item_count:'—',
    };
    stallsCache.set(stall.id,stall);return stall;
  }
  function normalizeMenuItem(m,stallId) {
    const matchedStall=stallsCache.get(id(m.stallId || m.stall_id || m.vendorId || stallId));
    const stallName=clean(m.stallName || m.stall_name, matchedStall?.name || '');
    const originalPath=clean(m.imagePath || m.image_path || m.image_url);
    const item={
      id:id(m.id), stall_id:id(m.stallId||m.stall_id||m.vendorId||stallId), name:clean(m.name,'Unnamed item'),
      description:clean(m.description),category:clean(m.category,'Menu'),
      price_cents:num(m.priceCents ?? m.price_cents), is_available:m.isAvailable !== false && m.is_available !== false,
      image_path:MENU_REFERENCE?.imageFor({...m,image_path:originalPath},stallName) || originalPath,
      stall_name:stallName,
      is_featured:!!(m.isFeatured ?? m.is_featured),
    };
    menuCache.set(item.id,item);return item;
  }
  async function catalog(force=false) {
    if (catalogPromise && !force) return catalogPromise;
    catalogPromise = (async()=>{
      let rows;
      try { rows = asArray(await http('/stalls')); previewCatalog = false; catalogIssue = ''; }
      catch(error) {
        if(!FIXTURES || !Array.isArray(FIXTURES.stalls)) throw error;
        previewCatalog = true;
        catalogIssue = error.message;
        courts = FIXTURES.courts.map(c => ({...c}));
        stallsCache.clear(); menuCache.clear();
        for(const x of FIXTURES.stalls) stallsCache.set(Number(x.id), {...x});
        return FIXTURES.stalls.map(s => ({...s}));
      }
      courts=[];stallsCache.clear();
      const result=rows.map(normalizeStall);
      for(const court of courts) court.stall_count=result.filter(s=>s.food_court_id===court.id).length;
      return result;
    })();
    try { return await catalogPromise; }
    catch (error) { catalogPromise=null; throw error; }
  }
  async function detail(stallId) {
    if(!id(stallId)) fail('Please choose a valid stall.',400);
    if (previewCatalog) {
      const stall = FIXTURES?.stalls?.find(s=>Number(s.id)===Number(stallId));
      if (!stall) fail('Prototype stall not found.',404);
      const menu = (FIXTURES.menus||[]).filter(m=>Number(m.stall_id)===Number(stallId)).map(m=>normalizeMenuItem(m,stallId));
      return {stall:{...stall},menu};
    }
    const [stallRow, menuRows]=await Promise.all([http(`/stalls/${stallId}`), http(`/stalls/${stallId}/menu`)]);
    const cached=stallsCache.get(Number(stallId)) || (await catalog(),stallsCache.get(Number(stallId)));
    const stall=normalizeStall({...cached,...stallRow,foodCourtName:cached?.court_name});
    const menu=asArray(menuRows).map(x=>normalizeMenuItem(x,stall.id));
    return {stall,menu};
  }
  async function itemDetails(itemId) {
    let item=menuCache.get(Number(itemId));
    if (!item) {
      const stalls=await catalog();
      for (const stall of stalls) {
        const d=await detail(stall.id);
        item=d.menu.find(x=>x.id===Number(itemId));if(item) break;
      }
    }
    if (!item) fail('This menu item is not available.',404,'NOT_FOUND');
    // The reference data is visual/demo-only. Base menu prices still come from the API.
    // No unverified extra charges are sent to the server.
    const details=MENU_REFERENCE?.detailsFor(item,item.stall_name) || {
      sizes:[{id:'regular',label:'Regular',extraCents:0,scale:1}],addons:[],nutrition:null,
      allergens:['Ask the vendor about ingredients and allergens'],prepMinutes:0,nutritionIsEstimate:false,
    };
    const recommendations=[...menuCache.values()]
      .filter(other=>other.stall_id===item.stall_id && other.id!==item.id && other.is_available)
      .sort((a,b)=>Number(b.is_featured)-Number(a.is_featured))
      .slice(0,3);
    return {item,details,recommendations};
  }
  async function cartView() {
    const cart=readCart();
    if (!cart.stallId || !cart.items.length) return {stallId:null,stallName:'',count:0,totalCents:0,items:[]};
    const data=await detail(cart.stallId);
    const map=new Map(data.menu.map(x=>[x.id,x]));
    const lines=cart.items.map(saved=>{
      const latest=map.get(saved.id);
      return latest? {...latest,quantity:saved.quantity,selections:saved.selections||null} : {id:saved.id,stall_id:cart.stallId,name:'Item no longer sold',description:'',category:'Menu',price_cents:0,is_available:false,quantity:saved.quantity};
    });
    return {stallId:cart.stallId,stallName:data.stall.name, count:lines.reduce((n,x)=>n+x.quantity,0),
      totalCents:lines.reduce((n,x)=>n+x.price_cents*x.quantity,0),items:lines};
  }
  async function addCartItem(itemId, quantity=1, selections=null) {
    if(!me || me.role!=='customer') fail('Sign in as a customer to add meals.',401,'UNAUTHENTICATED');
    let item=menuCache.get(Number(itemId));
    if(!item) {await itemDetails(itemId);item=menuCache.get(Number(itemId));}
    if (!item || !item.is_available) fail('This item is unavailable. Refresh the menu.',409,'UNAVAILABLE');
    const qty=num(quantity),cart=readCart();
    if(!Number.isInteger(qty)||qty<1||qty>20)fail('Choose 1–20 of each item.',400);
    if(cart.stallId && cart.stallId!==item.stall_id) fail('Your basket contains items from another stall. Clear it first to switch stalls.',409,'CART_STALL_CONFLICT');
    cart.stallId=item.stall_id;
    const existing=cart.items.find(x=>x.id===item.id);
    if(existing){
      if(existing.quantity+qty>20) fail('Maximum 20 of an item per order.',400);
      existing.quantity+=qty;
      // The browser cart has one line per menu item; the most recent preferences
      // become that line's preferences. These are not billed as verified add-ons.
      if(selections)existing.selections=selections;
    }
    else cart.items.push({id:item.id,quantity:qty,selections});
    writeCart(cart);return cartView();
  }
  async function pickupSlots(stallId) {
    if (previewCatalog) return {slots:[]}; // No fabricated pickup availability.
    const windows=asArray(await http(`/stalls/${stallId}/windows`));
    const slots=windows.map(w=>({id:id(w.id),at:w.startTime||w.at||w.start_time,
      available:w.isFull||w.is_full?0:Math.max(0,num(w.spacesLeft??w.available,0))}));
    windowsCache.set(Number(stallId),slots);
    return {slots};
  }
  function statusOf(s) {const v=clean(s,'CONFIRMED').toUpperCase();return v==='CONFIRMED'?'ACCEPTED':v;}
  function orderOf(o) {
    const stall=stallsCache.get(num(o.stallId ?? o.vendorId));
    const pickup=o.pickupStart||o.pickupWindowStart||o.pickupAt||o.pickup_at||o.createdAt||new Date().toISOString();
    return {
      id:num(o.id),order_number:String(o.orderNumber||o.order_number||o.id),status:statusOf(o.status),
      stall_name:clean(o.stallName||o.stall_name,stall?.name||'Participating stall'),
      court_name:clean(o.courtName||o.court_name,stall?.court_name||''),
      pickup_at:pickup,created_at:o.createdAt||o.created_at||pickup,
      total_cents:num(o.totalCents??o.total_cents),customer_name:clean(o.customerName||o.customer_name,me?.displayName||''),
      items:asArray(o.items).map(i=>({name_snapshot:clean(i.name||i.name_snapshot),quantity:num(i.quantity,1),price_cents:num(i.priceCents??i.unitPriceCents??i.price_cents),selections:i.selections||null})),
      feedback:o.feedback||null,notes:clean(o.notes),
    };
  }
  async function ordersList() {
    if (!FEATURES.checkout) return {orders:[],_integrationPending:true};
    const result=await optional('/orders',{auth:true});
    return result===null ? {orders:[],_integrationPending:true} : {orders:asArray(result).map(orderOf)};
  }
  async function orderDetail(orderId) { if(!FEATURES.checkout) unsupported('Customer order history');return {order:orderOf(await http(`/orders/${orderId}`,{auth:true}))}; }
  async function checkout(body) {
    if(!FEATURES.checkout || previewCatalog) unsupported('Placing orders');
    const cart=await cartView();
    if(!cart.stallId||!cart.items.length) fail('Your basket is empty.',400);
    if(cart.items.some(item=>!item.is_available)) fail('Your basket contains unavailable items; remove them before ordering.',409);
    const available=(await pickupSlots(cart.stallId)).slots;
    const chosen=available.find(x=>x.at===body.pickupAt && x.available>0);
    if(!chosen)fail('Pickup time unavailable or full. Select another.',409);
    const payload={stallId:cart.stallId,pickupWindowId:chosen.id,
      items:cart.items.map(x=>({menuItemId:x.id,quantity:x.quantity}))};
    // IMPORTANT: Server must calculate prices and enforce capacity atomically.
    const response=await http('/orders',{method:'POST',body:payload,auth:true});
    writeCart({stallId:null,items:[]});
    return {order:orderOf(response)};
  }
  async function vendorDashboard() {
    if(!me||me.role!=='vendor')fail('Vendor account required.',403);
    const sid=me.stallId;
    let list=null, menuData=null, stallData=null;
    if (FEATURES.vendorWrites) {
      list=await optional('/vendor/orders',{auth:true});
      if(list===null && sid)list=await optional(`/vendors/${sid}/orders`,{auth:true});
      menuData=sid?await optional(`/vendors/${sid}/menu`,{auth:true}):null;
      stallData=sid?await optional(`/vendors/${sid}`,{auth:true}):null;
    }
    const cached=sid?stallsCache.get(sid):null;
    const items=Array.isArray(menuData)?menuData:asArray(menuData?.items||menuData?.menu);
    const orders=asArray(list).map(orderOf);
    return {stall:{id:sid||0,name:clean(stallData?.stallName||stallData?.name,me.stallName||cached?.name||'Assigned stall'),
      court_name:clean(cached?.court_name,'Your food court'),is_open:stallData?.isOpen??false,capacity_per_slot:num(stallData?.capacityPerSlot,0)},
      menu:items.map(x=>normalizeMenuItem(x,sid)),orders,_integrationPending:list===null};
  }
  async function vendorStatus(orderId,body) {
    if (!FEATURES.vendorWrites) unsupported('Vendor order updates');
    const next=body.status==='ACCEPTED'?'PREPARING':body.status;
    if(!['PREPARING','READY'].includes(next))unsupported('Vendor order cancellation and this transition');
    let result=await optional(`/vendor/orders/${orderId}/status`,{method:'PATCH',body:{status:next},auth:true});
    if(result===null && me?.stallId)result=await optional(`/vendors/${me.stallId}/orders/${orderId}/status`,{method:'PATCH',body:{status:next},auth:true});
    if(result===null)unsupported('Vendor order status');
    return result;
  }
  async function adminDashboard() {
    if(!me||me.role!=='admin')fail('Administrator account required.',403);
    const live=FEATURES.adminWrites?await optional('/api/admin/dashboard',{auth:true}):null;
    if(live) return live;
    return {counts:{users:'—',stalls:'—',orders:'—',active_orders:'—'},
      stalls:[],users:[],reviews:[],_integrationPending:true};
  }
  async function pickupReady() {
    if(!me||me.role!=='customer'||!FEATURES.pickup)return {orders:[]};
    const list=await optional('/orders',{auth:true});
    if(!list)return {orders:[]};
    return {orders:asArray(list).map(orderOf).filter(x=>x.status==='READY').map(x=>({id:x.id,order_number:x.order_number,stall:x.stall_name}))};
  }
  async function request(endpoint,options={},requestCsrf) {
    const method=String(options.method||'GET').toUpperCase(), body=options.body;
    if(requestCsrf !== undefined && requestCsrf !== null)csrfToken=requestCsrf;
    const path=endpoint.split('?')[0];
    if(path==='/api/auth/me'&&method==='GET'){
      const result=await http(path);me=publicUser(result.user);csrfToken=result.csrfToken||null;
      return {...result,user:me};
    }
    if(path==='/api/auth/signup'&&method==='POST'){
      const payload={...body,confirmPassword:body.confirmPassword??body.confirm};
      const result=await http(path,{method,body:payload});me=publicUser(result.user);csrfToken=result.csrfToken;
      return {...result,user:me};
    }
    if(path==='/api/auth/login'&&method==='POST'){
      const result=await http(path,{method,body});me=publicUser(result.user);csrfToken=result.csrfToken;
      return {...result,user:me};
    }
    if(path==='/api/auth/logout'&&method==='POST'){
      const result=await http(path,{method,body:{}});
      try{root.localStorage.removeItem(cartKey());}catch{/* no-op */}
      token=null;tokenExpiry=0;me=null;csrfToken=null;return result;
    }
    if(path==='/api/food-courts') {await catalog();return {courts};}
    if(path==='/api/stalls')return {stalls:await catalog()};
    if(path==='/api/featured'){await catalog();return {items:previewCatalog?(FIXTURES.menus||[]).filter(i=>i.is_featured).slice(0,9):[]};} // Preview items are labelled by preview banner.
    const stallMatch=path.match(/^\/api\/stalls\/(\d+)$/);
    if(stallMatch)return detail(Number(stallMatch[1]));
    const dishMatch=path.match(/^\/api\/menu\/(\d+)\/details$/);
    if(dishMatch)return itemDetails(Number(dishMatch[1]));
    if(path==='/api/cart'&&method==='GET')return cartView();
    if(path==='/api/cart'&&method==='DELETE'){writeCart({stallId:null,items:[]});return {ok:true};}
    if(path==='/api/cart/items'&&method==='POST')return addCartItem(body.itemId,body.quantity,body.selections||null);
    const cartItemMatch=path.match(/^\/api\/cart\/items\/(\d+)$/);
    if(cartItemMatch){
      const itemId=Number(cartItemMatch[1]),cart=readCart(),item=cart.items.find(x=>x.id===itemId);
      if(!item) fail('Item is not in your basket.',404,'NOT_FOUND');
      if(method==='DELETE')cart.items=cart.items.filter(x=>x.id!==itemId);
      else if(method==='PATCH'){
        const qty=num(body.quantity);if(!Number.isInteger(qty)||qty<1||qty>20)fail('Quantity must be 1–20.',400);
        item.quantity=qty;
      }else unsupported('Cart action');
      if(!cart.items.length)cart.stallId=null;writeCart(cart);return cartView();
    }
    if(path==='/api/slots'){const sid=id(new URLSearchParams(endpoint.split('?')[1]||'').get('stallId'));
      if(!sid)fail('A stall must be selected.',400);return pickupSlots(sid);}
    if(path==='/api/orders'&&method==='GET')return ordersList();
    if(path==='/api/orders'&&method==='POST')return checkout(body);
    const orderMatch=path.match(/^\/api\/orders\/(\d+)$/);
    if(orderMatch&&method==='GET')return orderDetail(Number(orderMatch[1]));
    if(path==='/api/vendor/dashboard'&&method==='GET')return vendorDashboard();
    if(path==='/api/admin/dashboard'&&method==='GET')return adminDashboard();
    if(path==='/api/pickup/ready'&&method==='GET')return pickupReady();
    if(path==='/api/vendor/feedback'||path==='/api/admin/feedback'){
      if(!FEATURES.reviews)return {reviews:[],_integrationPending:true};
      const raw=await optional(path,{method,auth:true});return raw || {reviews:[],_integrationPending:true};
    }
    const vendorUpdate=path.match(/^\/api\/vendor\/orders\/(\d+)\/status$/);
    if(vendorUpdate&&method==='PATCH')return vendorStatus(vendorUpdate[1],body);
    if(path==='/api/profile'&&method==='PATCH'){if(!FEATURES.profiles)unsupported('Profile editing');return http('/api/profile',{method,body,auth:true});}
    if(path==='/api/vendor/stall'&&method==='PATCH'){
      if(!FEATURES.vendorWrites)unsupported('Vendor stall settings');
      if(!me?.stallId)unsupported('Vendor stall settings');
      const r=await optional(`/vendors/${me.stallId}/settings`,{method:'PUT',body,auth:true});
      if(!r)unsupported('Vendor stall settings');return r;
    }
    const vendorMenu=path.match(/^\/api\/vendor\/menu(?:\/(\d+))?$/);
    if(vendorMenu && ['PATCH','POST'].includes(method)){
      if(!FEATURES.vendorWrites)unsupported('Vendor menu management');
      const sid=me?.stallId;
      if(!sid)unsupported('Vendor menu editing (assigned stall missing)');
      const itemId=vendorMenu[1];
      const target=itemId?`/vendors/${sid}/menu/items/${itemId}${Object.keys(body||{}).length===1&&typeof body.isAvailable==='boolean'?'/availability':''}`:`/vendors/${sid}/menu/items`;
      const result=await optional(target,{method,body,auth:true});
      if(result===null)unsupported('Vendor menu editing');
      return result;
    }
    if(path==='/api/vendor/pickup/review'&&method==='POST'){
      if(!FEATURES.pickup)unsupported('Pickup verification');
      const code=clean(body?.code);
      if(!/^PICKUP-[1-9]\d*-[a-f0-9]{36}$/.test(code))fail('Invalid pickup QR reference.',400);
      // Confirmation screen is not a backend authorization or a payment confirmation.
      return {code,reviewPending:true};
    }
    if(path==='/api/vendor/pickup/approve'&&method==='POST'){
      if(!FEATURES.pickup)unsupported('Pickup collection');
      const code=clean(body?.code);
      const result=await http('/pickup/verify',{method:'POST',body:{collectionReference:code},auth:true});
      return {ok:true,orderStatus:result.orderStatus,orderId:result.orderId};
    }
    // Unknown feature actions are UI placeholders, never unverified database writes.
    if(method!=='GET') unsupported('This feature');
    return http(endpoint,{method,body,auth:false});
  }
  async function decorate(el) {
    if (previewCatalog) {
      let banner=el?.querySelector?.('[data-preview-banner]');
      if (!banner && el?.prepend) {
        banner=root.document.createElement('div');
        banner.dataset.previewBanner='true';
        banner.setAttribute('role','status');
        banner.className='note-box';
        banner.style.cssText='max-width:1120px;margin:12px auto;padding:12px 18px;border:1px solid #e9b85c;';
        banner.textContent='PREVIEW DATA — stall/menu listings are local design samples because the current /stalls API is not compatible with PostgreSQL. No sample checkout or database updates are enabled.';
        el.prepend(banner);
      }
    }
    const image=el?.querySelector?.('[data-live-qr]');
    if(!image || !FEATURES.pickup)return;
    try {
      const data=await http(`/pickup/${image.dataset.liveQr}/qr`,{auth:true});
      const uri=data?.pickup?.qrCode;
      if(!uri||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri))fail('The pickup QR service returned an invalid image.',502);
      if(image.isConnected){image.src=uri;image.alt='Verified pickup code for this order';}
    } catch(e) {
      if(image.isConnected){
        image.removeAttribute('src');image.alt='Pickup QR unavailable';
        const msg=document.createElement('p');msg.className='muted';msg.textContent=e.message;
        image.insertAdjacentElement('afterend',msg);
      }
    }
  }
  root.MakanLiveBridge={request,decorate,API_PENDING,normalizeStall,normalizeMenuItem,orderOf,
    diagnostics:()=>({activeUser:me?{id:me.id,role:me.role}:null,previewCatalog,catalogIssue,features:FEATURES,cartStorage:'browser-local',
      checkoutContract:'POST /orders',stallsContract:'GET /stalls',authContract:'/api/auth/*'})};
})(window);
