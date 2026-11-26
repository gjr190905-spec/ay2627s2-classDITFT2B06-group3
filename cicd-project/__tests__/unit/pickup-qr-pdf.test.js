'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('vendor scanner accepts PDF receipts and QR images',()=>{
  const app=read('src/public/prototype-exact/app.js');
  expect(app).toContain('application/pdf,.pdf,image/png,image/jpeg,image/webp');
  expect(app).toContain('Upload pickup receipt PDF or QR image');
  expect(app).toContain('pdfjs.getDocument');
  expect(app).toContain('await pdf.getPage(pageNumber)');
  expect(app).toContain('code=readQR(canvas,canvas.width,canvas.height)');
  expect(app).toContain('if(input.isConnected)await collectPickup(code)');
});
test('PDF input is capped and keeps PDF.js scripting and eval disabled',()=>{
  const app=read('src/public/prototype-exact/app.js');
  expect(app).toContain('file.size>10*1024*1024');
  expect(app).toContain('pdf.numPages>10');
  expect(app).toContain('isEvalSupported:false,enableScripting:false');
});
test('PDF.js browser modules are served from installed dependency, not third-party CDN',()=>{
  const app=read('src/app.js');
  expect(app).toContain("'/prototype-exact/pdfjs/:filename'");
  expect(app).toContain("'pdf.min.mjs', 'pdf.worker.min.mjs'");
  expect(app).toContain("../node_modules/pdfjs-dist/build");
  const pkg=JSON.parse(read('package.json'));
  expect(pkg.dependencies['pdfjs-dist']).toBe('6.5.438');
  for(const filename of ['pdf.min.mjs','pdf.worker.min.mjs']){
    expect(fs.statSync(path.join(root,'node_modules/pdfjs-dist/build',filename)).size).toBeGreaterThan(10000);
  }
});
test('student can save a dedicated PDF containing the issued secure QR',()=>{
  const page=read('src/public/prototype-exact/pickup-qr.js');
  const html=read('src/public/prototype-exact/pickup-qr.html');
  expect(page).toContain('Print / Save pickup PDF');
  expect(page).toContain('window.print()');
  expect(page).toContain('.order-row.print-selected');
  expect(html).toContain('@media print');
  expect(html).toContain('.order-row:not(.print-selected)');
  expect(html).toContain('A regular order receipt without a pickup QR is not sufficient.');
});

test('invalid or expired pickup QR preserves backend 404 rejection message',()=>{
  const bridge=read('src/public/prototype-exact/api-bridge.js');
  expect(bridge).toContain("endpoint === '/api/pickup/review' || endpoint === '/api/pickup/approve'");
  expect(bridge).toContain('throw bodyError(data, 404)');
});
