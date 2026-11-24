/* eslint-disable -- Isolated original prototype/static UI preview. Syntax checked separately. */
'use strict';
/* Frontend-only adapter for the original Makan Liao? prototype.
 * API calls made from this isolated preview are answered from in-browser sample
 * state. NO real API is called, NO database records are changed. */
(() => {
  const FIX = window.__ML_EXACT_FIXTURES__;
  if (!FIX) throw new Error('Missing exact-prototype fixtures.');
  const KEY = 'makan-liao-exact-ui-preview-v1';
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const init = () => ({user: null,cart:[],orders:[],users: demoUsers(),menus: clone(FIX.menus),stalls:clone(FIX.stalls),nextCart:1,nextOrder:201});
  let store;
  try {store = JSON.parse(sessionStorage.getItem(KEY) || 'null');} catch {store=null;}
  if (!store || !Array.isArray(store.menus) || !Array.isArray(store.users)) store = init();
  const persist = () => sessionStorage.setItem(KEY,JSON.stringify(store));
  const now = () => new Date().toISOString();
  const sampleDate = (minutes=30)=>new Date(Date.now()+minutes*60000).toISOString();
  const stall = (id) => store.stalls.find(s => s.id===Number(id));
  const menu = (id) => store.menus.find(i => i.id===Number(id));
  const current = () => store.user && store.users.find(u => u.id===store.user.id) || null;
  function makeUser(id,email,displayName,role,stallId=null) { return {id,email,displayName,phone:'',role,stallId,stallName:stallId?FIX.stalls.find(s=>s.id===stallId)?.name:null,active:true}; }
  function demoUsers() {
    const arr=[makeUser(1,'student@demo.makanliao.test','Alex Tan','customer'),makeUser(2,'staff@demo.makanliao.test','Jamie Lim','customer'),makeUser(3,'admin@demo.makanliao.test','Platform Admin','admin'),makeUser(4,'vendor1@demo.makanliao.test','Nadia · Noodle House','vendor',1)];
    for(let i=1;i<=21;i++) if(i!==1) arr.push(makeUser(20+i,`stall${i}@demo.makanliao.test`,FIX.stalls[i-1].name,'vendor',i));
    arr.push(makeUser(50,'vendor6@demo.makanliao.test','Alicia · Our Sweet Toast','vendor',16));
    return arr;
  }
  if(!store.orders.length) {
    const a=menu(1),b=menu(2);
    store.orders.push({id:101,order_number:'ML-PREVIEW01',customer_id:1,customer_name:'Alex Tan',stall_id:1,stall_name:stall(1).name,court_name:stall(1).court_name,pickup_at:sampleDate(40),status:'PLACED',created_at:now(),total_cents:a.price_cents*2,notes:'',items:[{name_snapshot:a.name,quantity:2,price_cents:a.price_cents,selections:{}}]});
    store.orders.push({id:102,order_number:'ML-PREVIEW02',customer_id:2,customer_name:'Jamie Lim',stall_id:1,stall_name:stall(1).name,court_name:stall(1).court_name,pickup_at:sampleDate(55),status:'READY',created_at:now(),total_cents:b.price_cents,notes:'',items:[{name_snapshot:b.name,quantity:1,price_cents:b.price_cents,selections:{}}]});
  }
  function cart() {
    const items=store.cart.filter(i=>i.user_id===current()?.id).map(i=>({...i,is_available:menu(i.menu_id)?.is_available ?? true,stall_open:stall(i.stall_id)?.is_open ?? true}));
    return {items,totalCents:items.reduce((n,i)=>n+i.price_cents*i.quantity,0),count:items.reduce((n,i)=>n+i.quantity,0),stallId:items[0]?.stall_id??null,stallName:items.length?stall(items[0].stall_id).name:null};
  }
  function ok(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
  function fail(message,status=400,code='PREVIEW_ERROR'){return ok({error:message,code},status);}
  function auth(roles){const u=current();if(!u)return fail('Sign in to continue (preview only).',401);if(roles && !roles.includes(u.role))return fail('This account cannot access that page.',403);return null;}
  function orderDetails(id){return store.orders.find(o=>o.id===Number(id));}
  function matchingOrder(id){const o=orderDetails(id),u=current();if(!o)return null;return u&&(u.role==='admin'||u.role==='customer'&&o.customer_id===u.id||u.role==='vendor'&&o.stall_id===u.stallId)?o:null;}
  function api(path,method,body,search){
    if(path==='/api/auth/me'&&method==='GET')return ok({user:current(),csrfToken:current()?'preview-only':null});
    if(path==='/api/auth/login'&&method==='POST'){
      const email=String(body.email||'').toLowerCase();const u=store.users.find(v=>v.email===email && v.active);
      if(!u || body.password!=='DemoPass!2026')return fail('Use a listed demonstration account with the prototype password.',401);
      store.user={id:u.id};persist();return ok({user:u,csrfToken:'preview-only'});
    }
    if(path==='/api/auth/signup'&&method==='POST'){
      if(store.users.some(u=>u.email===body.email))return fail('Email already used in this preview.',409);
      const u=makeUser(1000+store.users.length,String(body.email||''),String(body.displayName||'Customer'),'customer');store.users.push(u);store.user={id:u.id};persist();return ok({user:u,csrfToken:'preview-only',message:'Preview account created.'},201);
    }
    if(path==='/api/auth/logout'&&method==='POST'){store.user=null;persist();return ok({ok:true});}
    if(path==='/api/profile'&&method==='GET'){const denied=auth();return denied||ok({user:current()});}
    if(path==='/api/profile'&&method==='PATCH'){const denied=auth();if(denied)return denied;const u=current();u.displayName=String(body.displayName||u.displayName).trim();u.phone=String(body.phone||'');persist();return ok({user:u,message:'Preview profile changed locally (not saved to PostgreSQL).'});}
    if(path==='/api/food-courts')return ok({courts:FIX.courts});
    if(path==='/api/stalls'&&method==='GET')return ok({stalls:store.stalls});
    if(path==='/api/featured')return ok({items:store.menus.filter(i=>i.is_featured && i.is_available).slice(0,12)});
    let m;
    if((m=path.match(/^\/api\/stalls\/(\d+)$/))&&method==='GET'){
      const s=stall(m[1]);return s?ok({stall:s,menu:store.menus.filter(i=>i.stall_id===s.id)}):fail('Stall not found',404);
    }
    if((m=path.match(/^\/api\/menu\/(\d+)\/details$/))&&method==='GET'){
      const item=menu(m[1]);if(!item)return fail('Dish not found',404);
      return ok({item,details:{sizes:[{id:'regular',label:'Regular',extraCents:0,scale:1},{id:'large',label:'Large',extraCents:100,scale:1.4}],addons:[{id:'egg',label:'Add egg (preview)',extraCents:50,calories:70,allergens:['Egg'],isDemo:true}],prepMinutes:12,nutrition:{calories:450,proteinG:21,carbsG:45,fatG:12},allergens:['Please check with vendor']},recommendations:store.menus.filter(i=>i.stall_id===item.stall_id&&i.id!==item.id).slice(0,3)});
    }
    if(path==='/api/cart'&&method==='GET'){const denied=auth(['customer']);return denied||ok(cart());}
    if(path==='/api/cart'&&method==='DELETE'){const denied=auth(['customer']);if(denied)return denied;store.cart=store.cart.filter(i=>i.user_id!==current().id);persist();return ok({cart:cart()});}
    if(path==='/api/cart/items'&&method==='POST'){
      const denied=auth(['customer']);if(denied)return denied;
      const i=menu(body.itemId);if(!i||!i.is_available)return fail('Item not available',409);
      const c=cart();if(c.stallId&&c.stallId!==i.stall_id)return fail('Your basket contains items from another stall.',409,'CART_STALL_CONFLICT');
      const qty=Math.min(20,Math.max(1,Number(body.quantity)||1));
      store.cart.push({id:store.nextCart++,user_id:current().id,menu_id:i.id,name:i.name,stall_id:i.stall_id,price_cents:i.price_cents,quantity:qty,selections:body.selections||{}});persist();return ok({cart:cart(),message:'Added in preview.'});
    }
    if((m=path.match(/^\/api\/cart\/items\/(\d+)$/)) && ['PATCH','DELETE'].includes(method)){
      const denied=auth(['customer']);if(denied)return denied;const item=store.cart.find(c=>c.id===Number(m[1])&&c.user_id===current().id);if(!item)return fail('Basket item not found',404);
      if(method==='DELETE')store.cart=store.cart.filter(c=>c!==item);else item.quantity=Math.min(20,Math.max(1,Number(body.quantity)||1));persist();return ok({cart:cart()});
    }
    if(path==='/api/slots'&&method==='GET'){
      const s=stall(search.get('stallId'));if(!s)return fail('Unknown stall',404);
      return ok({slots:Array.from({length:6},(_,i)=>({at:sampleDate(30+i*30),available:i===3?0:s.capacity_per_slot,capacity:s.capacity_per_slot}))});
    }
    if(path==='/api/orders'&&method==='GET'){const denied=auth(['customer']);return denied||ok({orders:store.orders.filter(o=>o.customer_id===current().id).reverse()});}
    if(path==='/api/orders'&&method==='POST'){
      const denied=auth(['customer']);if(denied)return denied;const c=cart();if(!c.count)return fail('Empty basket',400);
      const s=stall(c.stallId);const o={id:store.nextOrder++,order_number:'ML-PREVIEW'+store.nextOrder,customer_id:current().id,customer_name:current().displayName,stall_id:s.id,stall_name:s.name,court_name:s.court_name,pickup_at:body.pickupAt||sampleDate(30),status:'PLACED',created_at:now(),total_cents:c.totalCents,notes:body.notes||'',items:c.items.map(i=>({name_snapshot:i.name,price_cents:i.price_cents,quantity:i.quantity,selections:i.selections||{}}))};
      store.orders.unshift(o);store.cart=store.cart.filter(i=>i.user_id!==current().id);persist();return ok({order:o,message:'Preview order created only in browser.'},201);
    }
    if((m=path.match(/^\/api\/orders\/(\d+)$/))&&method==='GET'){const o=matchingOrder(m[1]);return o?ok({order:o}):fail('Order unavailable to this account.',403);}
    if((m=path.match(/^\/api\/orders\/(\d+)\/cancel$/))&&method==='POST'){
      const o=matchingOrder(m[1]);if(!o||o.customer_id!==current()?.id)return fail('Cannot cancel order.',403);o.status='CANCELLED';persist();return ok({order:o});
    }
    if(path==='/api/vendor/dashboard'&&method==='GET'){
      const denied=auth(['vendor']);if(denied)return denied;const s=stall(current().stallId);if(!s)return fail('No assigned stall',409);
      return ok({stall:s,orders:store.orders.filter(o=>o.stall_id===s.id),menu:store.menus.filter(i=>i.stall_id===s.id)});
    }
    if((m=path.match(/^\/api\/vendor\/orders\/(\d+)\/status$/))&&method==='PATCH'){
      const denied=auth(['vendor']);if(denied)return denied;const o=matchingOrder(m[1]);if(!o)return fail('This order is not assigned to your stall.',403);o.status=body.status;persist();return ok({order:o});
    }
    if(path==='/api/vendor/stall'&&method==='PATCH'){
      const denied=auth(['vendor']);if(denied)return denied;const s=stall(current().stallId);s.is_open=!!body.isOpen;s.capacity_per_slot=Number(body.capacityPerSlot)||s.capacity_per_slot;persist();return ok({stall:s});
    }
    if(path==='/api/vendor/menu'&&method==='POST'){
      const denied=auth(['vendor']);if(denied)return denied;const i={...body,id:Math.max(...store.menus.map(m=>m.id))+1,stall_id:current().stallId,is_available:true,is_featured:false,price_cents:body.priceCents||300};store.menus.push(i);persist();return ok({item:i});
    }
    if((m=path.match(/^\/api\/vendor\/menu\/(\d+)$/))&&method==='PATCH'){
      const denied=auth(['vendor']);if(denied)return denied;const i=menu(m[1]);if(!i||i.stall_id!==current().stallId)return fail('Menu item unavailable.',403);
      if(body.isAvailable!==undefined)i.is_available=!!body.isAvailable;
      if(body.name)i.name=body.name;if(body.description)i.description=body.description;if(body.category)i.category=body.category;
      if(body.priceCents)i.price_cents=Number(body.priceCents);persist();return ok({item:i});
    }
    if(path==='/api/admin/dashboard'&&method==='GET'){
      const denied=auth(['admin']);if(denied)return denied;
      const active=store.orders.filter(o=>!['COLLECTED','CANCELLED'].includes(o.status)).length;
      return ok({counts:{users:store.users.length,stalls:store.stalls.length,orders:store.orders.length,active_orders:active},users:store.users,stalls:store.stalls});
    }
    if((m=path.match(/^\/api\/admin\/users\/(\d+)$/))&&method==='PATCH'){
      const denied=auth(['admin']);if(denied)return denied;const u=store.users.find(u=>u.id===Number(m[1]));if(!u)return fail('User not found',404);
      if(u.id===current().id)return fail('Cannot change own admin profile',409);
      if(body.role)u.role=body.role;if(body.stallId!==undefined)u.stallId=body.stallId;if(body.isActive!==undefined)u.active=body.isActive;persist();return ok({user:u});
    }
    if((m=path.match(/^\/api\/admin\/stalls\/(\d+)$/))&&method==='PATCH'){
      const denied=auth(['admin']);if(denied)return denied;const s=stall(m[1]);if(!s)return fail('Stall not found',404);
      s.name=body.name||s.name;s.description=body.description||s.description;if(body.capacityPerSlot)s.capacity_per_slot=Number(body.capacityPerSlot);
      if(body.isOpen!==undefined)s.is_open=!!body.isOpen;persist();return ok({stall:s});
    }
    if(path==='/api/admin/stalls'&&method==='POST'){
      const denied=auth(['admin']);if(denied)return denied;
      const fc=FIX.courts.find(c=>c.id===Number(body.foodCourtId));if(!fc)return fail('Food court not found',400);
      const s={id:store.stalls.length+1,food_court_id:fc.id,court_name:fc.name,name:body.name,cuisine:body.cuisine,description:body.description,capacity_per_slot:8,is_open:true,item_count:0,image_path:'burger.webp',accent:'red'};store.stalls.push(s);persist();return ok({stall:s},201);
    }
    if(path==='/api/vendor/pickup/review'&&method==='POST'){const denied=auth(['vendor']);return denied||fail('Scanner preview only; no real QR code was submitted.',400);}
    if(path==='/api/vendor/pickup/approve'&&method==='POST'){const denied=auth(['vendor']);return denied||fail('Scanner preview cannot confirm real collections.',400);}
    if(path==='/api/pickup/ready'&&method==='GET'){const denied=auth(['customer']);return denied||ok({orders:store.orders.filter(o=>o.customer_id===current().id && o.status==='READY').map(o=>({id:o.id,order_number:o.order_number,stall:o.stall_name}))});}
    if(path==='/api/pickup/device'&&method==='GET')return ok({key:null});
    if(path==='/api/pickup/device'&&method!=='GET')return fail('Push alerts are unavailable in the UI preview.',400);
    return fail('Frontend preview has no sample response for '+path,404);
  }
  const fetchOriginal=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const offline=window.location.protocol==='about:' || window.location.protocol==='file:';
    const url=new URL(typeof input==='string'?input:input.url,offline?'https://offline.preview/':window.location.href);
    if((!offline && url.origin!==window.location.origin) || !url.pathname.startsWith('/api/'))return fetchOriginal(input,init);
    const method=String(init.method||'GET').toUpperCase();
    let body={};try{body=JSON.parse(init.body||'{}');}catch{return Promise.resolve(fail('Invalid preview request data.',400));}
    try{return Promise.resolve(api(url.pathname,method,body,url.searchParams));}catch(error){return Promise.resolve(fail('Preview error: '+error.message,500));}
  };
  window.__ML_UI_PREVIEW_ONLY__=true;
})();
