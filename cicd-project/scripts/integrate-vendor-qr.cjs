'use strict';
// Idempotent, fail-closed integration into the existing team app without replacing files.
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const writes = [];
function edit(rel, fn) {
  const file = path.join(base, rel);
  const old = fs.readFileSync(file, 'utf8');
  const next = fn(old);
  if (next === old) throw Error(`Expected a safe integration change in ${rel}, but none was made.`);
  writes.push({ file, next, rel });
}
function ensure(text, needle, where) { if (!text.includes(needle)) throw Error(`${where}: missing expected anchor ${needle.slice(0, 85)}`); }
function replaceExact(text, needle, value, where) { ensure(text, needle, where); return text.replace(needle, value); }
edit('src/app.js', app => {
  if (app.includes("const pickupQrRouter = require('./routers/PickupQr.router');")) throw Error('QR router already installed; not running twice.');
  app = replaceExact(app, "const { loadSession } = require('./middleware/auth-session');",
    "const { loadSession } = require('./middleware/auth-session');\nconst pickupQrRouter = require('./routers/PickupQr.router');", 'app.js imports');
  app = replaceExact(app, "app.use('/api/auth', authRouter);",
    "app.use('/api/auth', authRouter);\napp.use('/api/pickup', pickupQrRouter);", 'app.js route');
  return app;
});
edit('src/public/prototype-exact/api-bridge.js', api => {
  if (api.includes("'/api/pickup/ready-orders'")) throw Error('Pickup bridge already installed.');
  ensure(api, 'pickup:false', 'frontend feature flags');
  api = api.replace('pickup:false','pickup:true');
  api = replaceExact(api,"    if(path==='/api/food-courts')", `    if(path==='/api/pickup/ready-orders'&&method==='GET')return http(path,{auth:true});
    if(path==='/api/pickup/issue'&&method==='POST')return http(path,{method,body,auth:true});
    if(path==='/api/food-courts')`, 'bridge request');
  api = replaceExact(api, "if(!/^PICKUP-[1-9]\\d*-[a-f0-9]{36}$/.test(code))", "if(!/^MLP-[a-f0-9]{64}$/.test(code))", 'pickup QR code format');
  api = replaceExact(api, 'return {code,reviewPending:true};',
    "return http('/api/pickup/review',{method:'POST',body:{code},auth:true});", 'pickup review bridge');
  api = replaceExact(api, "const result=await http('/pickup/verify',{method:'POST',body:{collectionReference:code},auth:true});",
    "const result=await http('/api/pickup/approve',{method:'POST',body,auth:true});", 'pickup approval bridge');
  api = replaceExact(api, 'return {ok:true,orderStatus:result.orderStatus,orderId:result.orderId};',
    'return {...result,ok:true};', 'pickup approval result');
  api = replaceExact(api, 'const data=await http(`/pickup/${image.dataset.liveQr}/qr`,{auth:true});',
    "const data=await http('/api/pickup/issue',{method:'POST',body:{orderId:Number(image.dataset.liveQr)},auth:true});", 'customer QR issuance');
  api = replaceExact(api, "!/^data:image\\/png;base64,[A-Za-z0-9+/=]+$/.test(uri)",
    "!/^data:image\\/svg\\+xml;base64,[A-Za-z0-9+/=]+$/.test(uri)", 'QR SVG image support');
  return api;
});
edit('src/public/prototype-exact/app.js', app => {
  const begin = app.indexOf('function profilePage(){');
  const end = app.indexOf('function cartPage(', begin);
  if (begin < 0 || end < 0) throw Error('Cannot safely locate profile page.');
  let profile = app.slice(begin,end);
  ensure(profile, 'const u=state.user;', 'profile section');
  profile = profile.replace('const u=state.user;',
    `const u=state.user;\n  const qrCard=u.role==='customer'?'<section class="panel"><h2>Pickup QR codes</h2><p>When your order is ready, show its pickup QR to the vendor for secure collection.</p><a class="btn btn-secondary" href="/prototype-exact/pickup-qr.html">View ready orders &amp; QR codes</a></section>':'';`);
  const formEnd = /(<form id="profileForm"[\s\S]*?<\/form><\/section>)/;
  if (!formEnd.test(profile)) throw Error('Profile form endpoint not found: refusing to rewrite profile.');
  profile = profile.replace(formEnd, '$1${qrCard}');
  app = app.slice(0,begin)+profile+app.slice(end);
  app = replaceExact(app,
    "const integrationBanner=d._integrationPending?'<div class=\"note-box\" role=\"status\">Order dashboard backend is not integrated yet. These counts are not live.</div>':'';",
    "const integrationBanner=d._integrationPending && state.vendorTab!=='scanner'?'<div class=\"note-box\" role=\"status\">Order dashboard backend is not integrated yet. These counts are not live.</div>':'';",
    'vendor scanner integration banner');
  const scanStart=app.indexOf('function scannerPage(){');
  const scanEnd=app.indexOf('async function collectPickup(',scanStart);
  if (scanStart<0||scanEnd<0) throw Error('Cannot safely locate existing scanner UI.');
  let scan=app.slice(scanStart,scanEnd);
  const previous = /  if\(pendingPickup\)\{[\s\S]*?\n  \}/;
  if (!previous.test(scan)) throw Error('Unexpected scanner confirmation UI.');
  scan = scan.replace(previous, `  if(pendingPickup){
    return \`<section class="panel"><h2>Confirm collection</h2><p><strong>\${esc(pendingPickup.orderNumber||'Order')}</strong> has been verified by the server as READY for your assigned stall.</p><p>Check the customer's food before completing collection.</p><label class="pickup-verify-check"><input type="checkbox" id="pickupHandoverConfirmed"/> Food handed to the customer</label><label class="pickup-verify-check"><input type="checkbox" id="pickupPaymentConfirmed"/> Payment confirmed at pickup</label><div class="row-actions"><button class="btn" data-action="approvePickup">Verify &amp; collect</button> <button class="btn btn-secondary" data-action="declinePickup">Cancel</button></div></section>\`;
  }`);
  scan=scan.replace('Upload QR image or receipt PDF','Upload QR image or screenshot');
  scan=scan.replace('accept="image/*,application/pdf,.pdf"','accept="image/png,image/jpeg,image/webp"');
  scan=scan.replace('Scan the pickup QR on the customer’s receipt or upload a clear image of it.',
    'Use your phone camera, upload a QR screenshot or use a USB scanner. Camera permission requires localhost or HTTPS.');
  app=app.slice(0,scanStart)+scan+app.slice(scanEnd);
  const approveStart=app.indexOf("    case 'approvePickup':run(async()=>{");
  const approveEnd=app.indexOf("    case 'pickupCamera':",approveStart);
  if (approveStart<0 || approveEnd<0) throw Error('Cannot safely locate approval handler.');
  let approval=app.slice(approveStart,approveEnd);
  approval=replaceExact(approval,'      e.disabled=true;', `      const handoverConfirmed=!!document.querySelector('#pickupHandoverConfirmed')?.checked;
      const paymentConfirmed=!!document.querySelector('#pickupPaymentConfirmed')?.checked;
      if(!handoverConfirmed||!paymentConfirmed)throw Error('Confirm both handover and payment first.');
      e.disabled=true;`, 'confirm checkboxes');
  approval=replaceExact(approval, 'body:{code:pendingPickup.code}',
    'body:{code:pendingPickup.code,handoverConfirmed,paymentConfirmed}', 'approval request');
  app=app.slice(0,approveStart)+approval+app.slice(approveEnd);
  return app;
});
edit('src/public/prototype-exact/styles.css', css => css + `\n/* SCRUM QR: responsive vendor scanner and explicit collection confirmation. */\n#pickupVideo:not([hidden]){width:100%;height:auto;max-height:60dvh;aspect-ratio:4/3;object-fit:cover;background:#171717;border-radius:14px;}\n.pickup-verify-check{display:flex;align-items:center;gap:.7rem;padding:.65rem .25rem;min-height:44px;font-weight:600;}\n.pickup-verify-check input{width:19px;height:19px;accent-color:#a11628;}\n@media(max-width:600px){.pickup-verify-check{align-items:flex-start}.pickup-verify-check input{flex:none}}\n`);
for (const {file, next, rel} of writes) { fs.writeFileSync(file, next); console.log('Integrated:',rel); }
console.log('PASS: installed real vendor scanner, secure QR routes, customer pickup link, and mobile UI.');
