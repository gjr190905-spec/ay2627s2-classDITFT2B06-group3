'use strict';
jest.mock('../../src/models/db',()=>({query:jest.fn(),connect:jest.fn()}));
const pool=require('../../src/models/db');
const notes=require('../../src/models/RoleNotifications.model');
beforeEach(()=>jest.clearAllMocks());
describe('All-role notifications: ownership and dismissal',()=>{
 test('IDs must be positive safe integers',()=>{
  expect(notes.positiveId('4')).toBe(4);
  for(const v of [0,'0','abc',null,-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(notes.positiveId(v)).toBeNull();
 });
 test('inbox is blocked without authenticated owner',async()=>{
  await expect(notes.inbox(null)).rejects.toMatchObject({status:401});
  expect(pool.query).not.toHaveBeenCalled();
 });
 test('read action scoped to recipient, never caller-provided owner',async()=>{
  pool.query.mockResolvedValue({rows:[{id:6}]});
  await expect(notes.change(3,6,'read')).resolves.toEqual({ok:true,id:6,action:'read'});
  expect(pool.query.mock.calls[0][0]).toContain('recipient_user_id=$2');
  expect(pool.query.mock.calls[0][1]).toEqual([6,3]);
 });
 test('dismissal writes permanent soft-delete field',async()=>{
  pool.query.mockResolvedValue({rows:[{id:4}]});
  await notes.change(3,4,'dismiss');
  expect(pool.query.mock.calls[0][0]).toMatch(/dismissed_at=COALESCE/);
 });
 test('other users cannot read or dismiss notification',async()=>{
  pool.query.mockResolvedValue({rows:[]});
  await expect(notes.change(5,4,'dismiss')).rejects.toMatchObject({status:404});
 });
 test('inbox returns only owned, non-dismissed notifications',async()=>{
  pool.query.mockResolvedValueOnce({rows:[{id:'2',entity_id:'9',event_type:'ORDER_READY'}]})
   .mockResolvedValueOnce({rows:[{unread:1}]});
  const r=await notes.inbox(6);
  expect(r.notifications[0].entityId).toBe(9);
  expect(r.unreadCount).toBe(1);
  expect(pool.query.mock.calls[0][0]).toMatch(/dismissed_at IS NULL/);
  expect(pool.query.mock.calls[0][1]).toEqual([6]);
 });
 test('only assigned vendors can make order ready',async()=>{
  await expect(notes.changeOrderStatus({id:1,role:'customer'},2,'READY')).rejects.toMatchObject({status:403});
  expect(pool.connect).not.toHaveBeenCalled();
 });
 test('invalid vendor status rejected before DB operation',async()=>{
  await expect(notes.changeOrderStatus({id:1,role:'vendor',stallId:2},5,'COLLECTED')).rejects.toMatchObject({status:400});
 });
 test('vendor cannot change another stall order',async()=>{
  const query=jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:8,status:'PLACED',stall_id:4}]});
  pool.connect.mockResolvedValue({query,release:jest.fn()});
  await expect(notes.changeOrderStatus({id:9,role:'vendor',stallId:7},8,'PREPARING')).rejects.toMatchObject({status:404});
  expect(query.mock.calls.some(([sql])=>String(sql).includes('UPDATE orders'))).toBe(false);
 });
 test('valid preparing transition commits and emits database trigger',async()=>{
  const query=jest.fn().mockResolvedValueOnce({rows:[]})
   .mockResolvedValueOnce({rows:[{id:8,status:'PLACED',stall_id:7}]})
   .mockResolvedValueOnce({rows:[{id:8,status:'PREPARING',stall_id:7}]})
   .mockResolvedValueOnce({rows:[]});
  pool.connect.mockResolvedValue({query,release:jest.fn()});
  await expect(notes.changeOrderStatus({id:9,role:'vendor',stallId:7},8,'PREPARING'))
   .resolves.toEqual({order:{id:8,status:'PREPARING'}});
  expect(query.mock.calls.at(-1)[0]).toBe('COMMIT');
 });
 test('READY requires existing PREPARING status',async()=>{
  const query=jest.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:8,status:'PLACED',stall_id:7}]});
  pool.connect.mockResolvedValue({query,release:jest.fn()});
  await expect(notes.changeOrderStatus({id:9,role:'vendor',stallId:7},8,'READY')).rejects.toMatchObject({status:409});
 });
});
