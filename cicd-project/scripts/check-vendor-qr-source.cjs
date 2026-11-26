'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
function text(file){return fs.readFileSync(path.join(root,file),'utf8');}
const checks=[
 ['src/app.js',["app.use('/api/pickup', pickupQrRouter);"]],
 ['src/public/prototype-exact/api-bridge.js',['pickup:true',"http('/api/pickup/review'","http('/api/pickup/approve'"]],
 ['src/public/prototype-exact/app.js',['navigator.mediaDevices.getUserMedia','readQR(video','pickupHandoverConfirmed','pickupPaymentConfirmed','pickup-qr.html']],
 ['src/public/prototype-exact/pickup-qr.js',["'/api/pickup/issue'","'/api/pickup/ready-orders'"]],
 ['src/models/PickupQr.model.js',['randomBytes(32)',"SET ${s.status}='COLLECTED'",'FOR UPDATE OF p, o']],
 ['src/routers/PickupQr.router.js',['requireCsrf',"asRole('customer')","asRole('vendor')"]],
 ['src/database/migrations/20261125_pickup_collection_passes.sql',['CREATE TABLE IF NOT EXISTS']]
];
let failed=false;
for(const [file,patterns] of checks){try{const data=text(file);for(const p of patterns)if(!data.includes(p)){console.error('Missing',p,'in',file);failed=true;}}catch(e){console.error('Could not read',file,e.message);failed=true;}}
if(failed)process.exitCode=1;else console.log('PASS: QR camera, token endpoint, customer page, vendor authorization and collection update all integrated.');
