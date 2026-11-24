#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const front=path.join(root,'src/public/prototype-exact');
const context={window:{localStorage:{getItem:()=>null,setItem:()=>{}},fetch:async()=>{throw Error('No network request expected');}},console,Date,Number,URLSearchParams,Map,Set};
vm.createContext(context);context.window.window=context.window;
for(const file of ['menu-reference-data.js','api-bridge.js']){
  vm.runInContext(fs.readFileSync(path.join(front,file),'utf8'),context,{filename:file});
}
const ref=context.window.MakanMenuReference,bridge=context.window.MakanLiveBridge;
assert.equal(ref.knownCount,121,'Expect all 121 original FC6 reference dishes');
const fixtures=JSON.parse(fs.readFileSync(path.join(front,'fixtures.json'),'utf8'));
for(const stall of fixtures.stalls){bridge.normalizeStall({...stall,foodCourtName:stall.court_name});}
let matched=0,optionDishes=0;
const actualPhotos=new Set();const nutritionCombos=new Set();
for(const dish of fixtures.menus){
  const item=bridge.normalizeMenuItem({...dish,image_path:null},dish.stall_id);
  const meta=ref.detailsFor(item,item.stall_name);
  if(dish.court_name!=='Food Court 6')continue;
  matched++;
  assert(item.image_path.startsWith('fc6/'),`missing per-item image for ${item.stall_name}: ${item.name}`);
  const image=path.join(front,'media',item.image_path);
  assert(fs.existsSync(image),`Missing image asset: ${item.image_path}`);
  actualPhotos.add(item.image_path);
  assert(meta.nutrition && meta.nutrition.calories>0,`Missing nutrition estimate: ${item.name}`);
  assert(meta.sizes.length===1 && meta.sizes[0].extraCents===0);
  nutritionCombos.add(JSON.stringify(meta.nutrition));
  if(meta.addons.length){
    optionDishes++;
    assert.equal(meta.addons.length,3,`${item.name}: expected three proposals`);
    assert(meta.addons.every(a=>a.isDemo && a.extraCents===0));
  }
}
assert.equal(matched,121);
assert.equal(actualPhotos.size,121);
assert.equal(nutritionCombos.size,121);
assert.equal(optionDishes,98);
for(const [stall,name,want] of [
  ['Canopy Greens','Add-On Side (Normal)','fc6/menu_092.webp'],
  ['Canopy Greens','Add-On Side (Premium)','fc6/menu_093.webp'],
  ['Canopy Greens','Beancurd Skin','fc6/menu_086.webp'],
  ['Canopy Greens','Corn','fc6/menu_091.webp']
]){
  const item=bridge.normalizeMenuItem({id:2000+matched++,stallId:17,name,category:'Sides',priceCents:100},17);
  assert.equal(item.image_path,want);
}
const html=fs.readFileSync(path.join(front,'index.html'),'utf8');
assert(html.indexOf('menu-reference-data.js')>=0 && html.indexOf('menu-reference-data.js')<html.indexOf('api-bridge.js'));
const app=fs.readFileSync(path.join(front,'app.js'),'utf8');
assert(app.includes('function openDish(')&&app.includes('dish-closing')&&app.includes('renderDish()'));
console.log('PASS: 121 distinct FC6 image references and files; 121 distinct illustrative nutrition sets; 98 sets of three zero-charge demo add-ons; four screenshot dishes mapped; detail modal source present.');
