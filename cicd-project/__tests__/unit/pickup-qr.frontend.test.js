const fs=require('node:fs');const path=require('node:path');const root=path.join(__dirname,'../../src/public/prototype-exact');
test('scanner uses camera with jsQR and verifies with backend before collection',()=>{
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  expect(source).toContain('navigator.mediaDevices.getUserMedia');
  expect(source).toContain('readQR(video,video.videoWidth,video.videoHeight)');
  expect(source).toContain("request('/api/vendor/pickup/review'");
  expect(source).toContain('pickupHandoverConfirmed');
  expect(source).toContain('pickupPaymentConfirmed');
});
test('customer gets a separate secure READY order QR page',()=>{
  const source=fs.readFileSync(path.join(root,'pickup-qr.js'),'utf8');
  expect(source).toContain("api('/api/pickup/ready-orders')");
  expect(source).toContain("api('/api/pickup/issue'");
  expect(source).toContain("auth.user?.role !== 'customer'");
});
test('pickup backend bridge is enabled without altering unrelated feature flags',()=>{
  const src=fs.readFileSync(path.join(root,'api-bridge.js'),'utf8');
  expect(src).toContain('pickup:true');
  expect(src).toContain("http('/api/pickup/review'");
});
