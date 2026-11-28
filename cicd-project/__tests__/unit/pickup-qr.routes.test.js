'use strict';
process.env.JWT_SECRET = 'a'.repeat(32);
class mockJsonWebTokenError extends Error {}
jest.mock('jsonwebtoken', () => ({ verify: jest.fn(), sign: jest.fn(), JsonWebTokenError: mockJsonWebTokenError }));
jest.mock('../../src/models/Session.model',()=>({createSession:jest.fn(),findActiveSession:jest.fn(),revokeSession:jest.fn()}));
jest.mock('../../src/models/PickupQr.model',()=>({
  readyOrdersForCustomer:jest.fn(),issueForCustomer:jest.fn(),inspectForVendor:jest.fn(),
}));
const request=require('supertest');
const app=require('../../src/app');
const {findActiveSession}=require('../../src/models/Session.model');
const model=require('../../src/models/PickupQr.model');
const csrf='d'.repeat(64),cookie=`ml_session=${'c'.repeat(64)}`;
const signIn=(role='vendor',stallId=7)=>findActiveSession.mockResolvedValue({id:19,name:'User',email:'test@example.com',role,stallId,csrfToken:csrf});
beforeEach(()=>{jest.resetAllMocks();signIn();model.readyOrdersForCustomer.mockResolvedValue([{id:2,orderNumber:'ML-2'}]);
  model.issueForCustomer.mockResolvedValue({code:'MLP-'+'a'.repeat(64),orderNumber:'ML-2'});
  model.inspectForVendor.mockResolvedValue({orderId:2,orderNumber:'ML-2',orderStatus:'READY',message:'Verified'});
});
test('anonymous visitors cannot see ready order IDs',async()=>{
  findActiveSession.mockResolvedValue(null);
  expect((await request(app).get('/api/pickup/ready-orders')).status).toBe(401);
  expect(model.readyOrdersForCustomer).not.toHaveBeenCalled();
});
test('customers see only their own ready orders',async()=>{
  signIn('customer',null);
  const r=await request(app).get('/api/pickup/ready-orders').set('Cookie',cookie);
  expect(r.status).toBe(200);expect(model.readyOrdersForCustomer).toHaveBeenCalledWith(19);
});
test('customers cannot scan or approve vendor collection',async()=>{
  signIn('customer',null);
  const r=await request(app).post('/api/pickup/approve').set('Cookie',cookie).set('X-CSRF-Token',csrf)
    .send({code:'MLP-'+'a'.repeat(64),handoverConfirmed:true,paymentConfirmed:true});
  expect(r.status).toBe(403);expect(model.inspectForVendor).not.toHaveBeenCalled();
});
test('vendors cannot issue customer pickup codes',async()=>{
  const r=await request(app).post('/api/pickup/issue').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({orderId:2});
  expect(r.status).toBe(403);expect(model.issueForCustomer).not.toHaveBeenCalled();
});
test('CSRF required before any collection update',async()=>{
  const r=await request(app).post('/api/pickup/approve').set('Cookie',cookie).send({code:'MLP-'+'a'.repeat(64)});
  expect(r.status).toBe(403);expect(model.inspectForVendor).not.toHaveBeenCalled();
});
test('same-origin protection rejects forged request',async()=>{
  const r=await request(app).post('/api/pickup/review').set('Cookie',cookie).set('X-CSRF-Token',csrf)
    .set('Origin','https://evil.example').send({code:'MLP-'+'a'.repeat(64)});
  expect(r.status).toBe(403);expect(model.inspectForVendor).not.toHaveBeenCalled();
});
test('vendor review is read-only; approval requires explicit confirmations',async()=>{
  const review=await request(app).post('/api/pickup/review').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({code:'MLP-'+'a'.repeat(64)});
  expect(review.status).toBe(200);expect(model.inspectForVendor).toHaveBeenCalledWith(7,'MLP-'+'a'.repeat(64));
  model.inspectForVendor.mockClear();
  const bad=await request(app).post('/api/pickup/approve').set('Cookie',cookie).set('X-CSRF-Token',csrf)
    .send({code:'MLP-'+'a'.repeat(64),handoverConfirmed:true,paymentConfirmed:false});
  expect(bad.status).toBe(400);expect(model.inspectForVendor).not.toHaveBeenCalled();
  const good=await request(app).post('/api/pickup/approve').set('Cookie',cookie).set('X-CSRF-Token',csrf)
    .send({code:'MLP-'+'a'.repeat(64),handoverConfirmed:true,paymentConfirmed:true});
  expect(good.status).toBe(200);expect(model.inspectForVendor).toHaveBeenCalledWith(7,'MLP-'+'a'.repeat(64),true,19);
});
test('customer QR issuance returns real encoded SVG',async()=>{
  signIn('customer',null);
  const r=await request(app).post('/api/pickup/issue').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({orderId:2});
  expect(r.status).toBe(200);expect(r.body.pickup.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(model.issueForCustomer).toHaveBeenCalledWith(19,2);
});
test('JWT customer can issue a QR without CSRF',async()=>{
  const jwt=require('jsonwebtoken');
  const {findActiveSession}=require('../../src/models/Session.model');
  findActiveSession.mockResolvedValue({id:19,name:'User',email:'test@example.com',role:'customer',stallId:null,csrfToken:csrf});
  jwt.verify.mockReturnValue({sub:'19',role:'customer',sid:'c'.repeat(64),typ:'access',iss:'makan-liao',aud:'makan-liao-api'});
  model.issueForCustomer.mockResolvedValue({code:'MLP-'+'a'.repeat(64),orderNumber:'ML-2'});
  const r=await request(app).post('/api/pickup/issue').set('Authorization','Bearer fake.jwt.token').send({orderId:2});
  expect(r.status).toBe(200);expect(r.body.pickup.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(model.issueForCustomer).toHaveBeenCalledWith(19,2);
});
test('invalid JWT is rejected',async()=>{
  const jwt=require('jsonwebtoken');
  jwt.verify.mockImplementation(()=>{const e=new Error('bad token');e.name='JsonWebTokenError';throw e;});
  const r=await request(app).post('/api/pickup/issue').set('Authorization','Bearer bad.token').send({orderId:2});
  expect(r.status).toBe(401);
  expect(model.issueForCustomer).not.toHaveBeenCalled();
});
test('JWT customer cannot issue QR for another customer order',async()=>{
  const jwt=require('jsonwebtoken');
  const {findActiveSession}=require('../../src/models/Session.model');
  findActiveSession.mockResolvedValue({id:19,name:'User',email:'test@example.com',role:'customer',stallId:null,csrfToken:csrf});
  jwt.verify.mockReturnValue({sub:'19',role:'customer',sid:'c'.repeat(64),typ:'access',iss:'makan-liao',aud:'makan-liao-api'});
  model.issueForCustomer.mockRejectedValue(Object.assign(new Error('Order not found in your account.'),{status:404}));
  const r=await request(app).post('/api/pickup/issue').set('Authorization','Bearer fake.jwt.token').send({orderId:999});
  expect(r.status).toBe(404);
});
test('non-READY order cannot receive a QR',async()=>{
  signIn('customer',null);
  model.issueForCustomer.mockRejectedValue(Object.assign(new Error('Pickup QR is available only when your order is READY.'),{status:409}));
  const r=await request(app).post('/api/pickup/issue').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({orderId:2});
  expect(r.status).toBe(409);
});
test('repeated issuance returns alreadyIssued without a new QR',async()=>{
  signIn('customer',null);
  model.issueForCustomer.mockResolvedValue({alreadyIssued:true,orderNumber:'ML-2'});
  const r=await request(app).post('/api/pickup/issue').set('Cookie',cookie).set('X-CSRF-Token',csrf).send({orderId:2});
  expect(r.status).toBe(200);
  expect(r.body.pickup.alreadyIssued).toBe(true);
  expect(r.body.pickup.qrCode).toBeUndefined();
});
