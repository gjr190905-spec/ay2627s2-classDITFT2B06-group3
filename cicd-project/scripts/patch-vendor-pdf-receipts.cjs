'use strict';
// Apply only to the installed (uncommitted) full-stack QR integration.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const edits = [];
function edit(rel, transform) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const normalized = before.replace(/\r\n/g, '\n');
  const after = transform(normalized);
  if (after === normalized) throw new Error('No change to '+rel+'; an unexpected source version may be installed.');
  edits.push({file, rel, after:before.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after});
}
function replaceOnce(text, old, next, label){
  if (!text.includes(old)) throw new Error(label+' anchor not found. Stopping without writing files.');
  if (text.indexOf(old) !== text.lastIndexOf(old)) throw new Error(label+' anchor ambiguous.');
  return text.replace(old, next);
}
edit('src/app.js', source => {
  if (!source.includes("app.use('/api/pickup', pickupQrRouter);")) throw Error('Vendor QR integration not installed.');
  if (source.includes('pdfjs-dist/build')) throw Error('PDF module route already present.');
  return replaceOnce(source,
    "app.use(express.static(path.join(__dirname, 'public')));",
    `app.use(express.static(path.join(__dirname, 'public')));
// Serve only the two pinned PDF.js browser modules; parsing stays client-side.
app.get('/prototype-exact/pdfjs/:filename', (req, res, next) => {
  const allowed = new Set(['pdf.min.mjs', 'pdf.worker.min.mjs']);
  if (!allowed.has(req.params.filename)) return next();
  return res.type('text/javascript').sendFile(path.join(__dirname, '../node_modules/pdfjs-dist/build', req.params.filename));
});`, 'PDF.js static assets route');
});
edit('src/public/prototype-exact/api-bridge.js', source => {
  if (!source.includes("http('/api/pickup/review'")) throw Error('Existing vendor QR bridge is not installed.');
  return replaceOnce(source,
    "      if (response.status === 404) fail(`This backend route (${endpoint.split('?')[0]}) is not available on the current branch. No data was changed.`,503);",
    "      if (response.status === 404 && (endpoint === '/api/pickup/review' || endpoint === '/api/pickup/approve')) throw bodyError(data, 404);\n      if (response.status === 404) fail(`This backend route (${endpoint.split('?')[0]}) is not available on the current branch. No data was changed.`,503);",
    'preserve invalid/expired QR error on HTTP 404');
});
edit('src/public/prototype-exact/app.js', source => {
  if (!source.includes('async function scanPickupCamera()')) throw Error('QR scanner not installed.');
  source = replaceOnce(source,
    'upload a QR screenshot or use a USB scanner. Camera permission requires localhost or HTTPS.',
    'upload a pickup receipt PDF or QR screenshot, or use a USB scanner. Camera permission requires localhost or HTTPS.', 'scanner help text');
  source = replaceOnce(source,
    '<label for="pickupFile">Upload QR image or screenshot</label>',
    '<label for="pickupFile">Upload pickup receipt PDF or QR image</label>', 'PDF upload label');
  source = replaceOnce(source,
    'id="pickupFile" accept="image/png,image/jpeg,image/webp"',
    'id="pickupFile" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"', 'PDF file types');
  source = replaceOnce(source,
    `    let code;
    if(file.type==='application/pdf' || /\\.pdf$/i.test(file.name)){`,
    `    const isPdf=file.type==='application/pdf' || /\\.pdf$/i.test(file.name);
    if(file.size===0)throw Error('The selected receipt is empty.');
    if(file.size>10*1024*1024)throw Error('Receipt file is too large. Maximum 10 MB.');
    if(!isPdf && !/^image\\/(png|jpeg|webp)$/.test(file.type))throw Error('Use a PDF, PNG, JPEG or WebP file.');
    let code;
    if(isPdf){`, 'PDF type and upload size validation');
  source = replaceOnce(source,
    `const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,useSystemFonts:true}).promise;`,
    `const pdf=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false,enableScripting:false,useSystemFonts:true}).promise;`, 'safe PDF options');
  source = replaceOnce(source,
    `      try{
        for(let pageNumber=1;pageNumber<=pdf.numPages && !code && input.isConnected;pageNumber++){`,
    `      try{
        if(pdf.numPages>10)throw Error('Receipt PDF has too many pages. Maximum 10 pages.');
        for(let pageNumber=1;pageNumber<=pdf.numPages && !code && input.isConnected;pageNumber++){`, 'PDF page scan cap');
  source = replaceOnce(source,
    `    if(!code)throw Error('No QR found. Choose the customer receipt or a clear screenshot of its pickup QR.');`,
    `    if(!code)throw Error(isPdf?'No pickup QR found in this PDF. Ask the student to save their READY-order pickup QR as a PDF.':'No pickup QR found in the image. Upload a clear screenshot.');`, 'missing pickup QR feedback');
  return source;
});
edit('src/public/prototype-exact/pickup-qr.js', source => {
  if (!source.includes("api('/api/pickup/issue'")) throw Error('Student pickup QR page not installed.');
  return replaceOnce(source,
    `      box.append(img, caption); setStatus('QR generated for ' + order.orderNumber + '.');`,
    `      const pdfButton=document.createElement('button');
      pdfButton.type='button';
      pdfButton.className='btn btn-secondary print-pickup-receipt';
      pdfButton.textContent='Print / Save pickup PDF';
      pdfButton.addEventListener('click',()=>{
        document.querySelectorAll('.order-row.print-selected').forEach(el=>el.classList.remove('print-selected'));
        const selected=box.closest('.order-row');
        if(!selected)return;
        selected.classList.add('print-selected');
        const clear=()=>selected.classList.remove('print-selected');
        window.addEventListener('afterprint',clear,{once:true});
        window.print();
      });
      box.append(img, caption, pdfButton); setStatus('QR generated for ' + order.orderNumber + '.');`, 'PDF receipt print button');
});
edit('src/public/prototype-exact/pickup-qr.html', source => {
  const anchor = '  .pickup-own-page .hint{font-size:.93rem;color:#645a55}';
  const css = `  .pickup-own-page .print-pickup-receipt{display:block;margin:.25rem auto 1rem}
  @media print{
    .pickup-own-page{max-width:none;padding:0 12mm}
    .pickup-own-page > header,.pickup-own-page > p,.pickup-own-page > h1,#pickup-message{display:none!important}
    .pickup-own-page .panel{margin:0;padding:0;border:0;box-shadow:none}
    .pickup-own-page .order-row:not(.print-selected){display:none!important}
    .pickup-own-page .order-row.print-selected{display:block!important;padding:12mm;border:0;break-inside:avoid}
    .pickup-own-page button,.pickup-own-page .hint{display:none!important}
    .pickup-own-page .qr-photo{max-width:70mm;width:70mm;height:auto;print-color-adjust:exact;-webkit-print-color-adjust:exact}
  }`;
  source = replaceOnce(source, anchor, anchor + '\n'+css, 'print CSS');
  return replaceOnce(source,
    'Your QR codes are unique and can be replaced if needed. Only signed-in customers can generate codes for their own ready orders.',
    'Use Print / Save pickup PDF to give the vendor a PDF containing your secure pickup QR. A regular order receipt without a pickup QR is not sufficient. Only signed-in customers can generate codes for their own READY orders.', 'student PDF note');
});
for (const {file, after, rel} of edits) {fs.writeFileSync(file, after);console.log('Updated:',rel);}
console.log('PASS: PDF receipt upload, local PDF.js module paths, and student printable QR receipts added.');
