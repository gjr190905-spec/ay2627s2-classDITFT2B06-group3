'use strict';
jest.mock('../../src/models/db', () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require('../../src/models/db');
const { readyOrdersForCustomer, issueForCustomer, inspectForVendor, validCode } = require('../../src/models/PickupQr.model');
const cols = ['id', 'customer_id', 'status', 'stall_id', 'order_number'].map(column_name=>({column_name}));
const qr = 'MLP-' + 'a'.repeat(64);
const queryLog = [];
beforeEach(()=>{ jest.resetAllMocks(); queryLog.length=0;
  const db = { query: jest.fn(async (sql, p=[]) => {
    queryLog.push({sql,p});
    if(sql.includes('information_schema.columns')) return { rows: cols };
    if(sql.includes('SELECT UPPER') && sql.includes('FOR UPDATE')) return { rows: [{status:'READY',order_number:'ML-2'}] };
    if(sql.includes('FROM pickup_collection_passes p JOIN orders')) return { rows: [{id:'2',stall_id:'7',status:'READY',order_number:'ML-2',redeemed_at:null}] };
    if(sql.includes('SELECT o.id::text') && sql.includes('ORDER BY')) return { rows: [{id:'2',order_number:'ML-2'}] };
    if(sql.includes('UPDATE orders SET')) return { rowCount: 1 };
    return { rows:[],rowCount:1 };
  }), release: jest.fn() };
  pool.connect.mockResolvedValue(db);pool.query.mockImplementation(db.query);
});
test('only 256-bit MLP QR codes are valid',()=>{
  expect(validCode(qr)).toBe(true); expect(validCode('PICKUP-2-foo')).toBe(false);expect(validCode('MLP-2')).toBe(false);
});
test('lists only READY orders for the signed-in customer',async()=>{
  expect(await readyOrdersForCustomer(8)).toEqual([{id:2,orderNumber:'ML-2'}]);
  expect(queryLog.some(x=>x.sql.includes('UPPER(o.status::text)') && x.sql.includes('o.customer_id=$1') && x.p[0]===8)).toBe(true);
});
test('issues random QR for one owned ready order with no order mutation',async()=>{
  const p=await issueForCustomer(8,2);expect(validCode(p.code)).toBe(true);
  expect(queryLog.some(x=>x.sql.includes('o.customer_id=$2') && x.p[1]===8)).toBe(true);
  expect(queryLog.some(x=>x.sql.includes('INSERT INTO pickup_collection_passes'))).toBe(true);
  expect(queryLog.some(x=>x.sql.includes('UPDATE orders'))).toBe(false);
});
test('read-only vendor review does not mark collected',async()=>{
  const result=await inspectForVendor(7,qr,false);
  expect(result.orderStatus).toBe('READY');
  expect(queryLog.some(x=>x.sql.includes('UPDATE orders SET'))).toBe(false);
});
test('vendor approval marks only READY orders collected atomically',async()=>{
  const result=await inspectForVendor(7,qr,true,35);
  expect(result.orderStatus).toBe('COLLECTED');
  expect(queryLog.some(x=>x.sql.includes("SET status='COLLECTED'") && x.sql.includes("status::text)='READY'"))).toBe(true);
  expect(queryLog.some(x=>x.sql.includes('UPDATE pickup_collection_passes SET collected_at=NOW()')&&x.p[1]===35)).toBe(true);
});
test('wrong-stall scan is rejected and leaves order unchanged',async()=>{
  await expect(inspectForVendor(9,qr,true,35)).rejects.toMatchObject({status:403});
  expect(queryLog.some(x=>x.sql.includes('UPDATE orders'))).toBe(false);
});
