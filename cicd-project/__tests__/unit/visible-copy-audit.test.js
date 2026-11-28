'use strict';
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'../../src/public');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');

test('legacy customer page footers are concise and consistent',()=>{
  for(const page of ['cart.html','menu.html','orders.html','stall-menu.html']){
    const src=read('customer/'+page);
    expect(src).not.toContain('Independent class project prototype');
    expect(src).toContain('Student-built campus ordering experience.');
    expect(src).toContain('no online payments are processed');
  }
});
test('catalog fallback is transparently labelled and checkout is still blocked',()=>{
  const bridge=read('prototype-exact/api-bridge.js');
  expect(bridge).toContain('Displayed stall and menu information is illustrative');
  expect(bridge).toContain('previewCatalog');
  expect(bridge).toContain('if(!FEATURES.checkout || previewCatalog)');
  expect(bridge).not.toContain('PREVIEW DATA —');
});
test('backend-unavailable messages do not use internal development jargon',()=>{
  const app=read('prototype-exact/app.js');
  const bridge=read('prototype-exact/api-bridge.js');
  expect(bridge).not.toContain('The backend for this feature is not integrated yet.');
  expect(app).not.toContain('Order dashboard backend is not integrated yet.');
  expect(app).not.toContain('Admin APIs are not integrated yet.');
});
test('illustrative fallback descriptions are readable and preserve menu entries',()=>{
  const source=read('prototype-exact/fixture-data.js');
  const key='window.__ML_EXACT_FIXTURES__ = ';
  const parsed=JSON.parse(source.slice(source.indexOf(key)+key.length).trim().replace(/;\s*$/,''));
  expect(parsed.courts.length).toBeGreaterThan(0);
  expect(parsed.menus.length).toBeGreaterThan(100);
  for(const row of [...parsed.courts,...parsed.stalls])
    expect(row.description||'').not.toMatch(/^Sample\b/i);
});
