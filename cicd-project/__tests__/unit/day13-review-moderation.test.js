'use strict';
jest.mock('../../src/models/db', () => ({ query: jest.fn() }));
const db = require('../../src/models/db');
const moderation = require('../../src/models/ReviewModeration.model');
const admin = { id: 1, role: 'admin' };
const vendor = { id: 2, role: 'vendor', stallId: 17 };
const row = { id: '91', order_id: '52', stall_id: '17', rating: 5,
  comment: 'Great lunch, highly recommended.', status: 'APPROVED', created_at: '2026-11-27', updated_at: '2026-11-27' };
beforeEach(() => jest.resetAllMocks());
test('admin sees queue including pending review details', async () => {
  db.query.mockResolvedValue({rows:[{...row,status:'PENDING'}]});
  const result=await moderation.adminQueue(admin);
  expect(result.reviews[0]).toMatchObject({orderId:52,stallId:17,status:'PENDING',rating:5});
  expect(result.reviews[0]).not.toHaveProperty('customerId');
  expect(db.query.mock.calls[0][0]).toContain("CASE WHEN status='PENDING' THEN 0");
});
test('customer cannot read admin queue', async () => {
  await expect(moderation.adminQueue({id:3,role:'customer'})).rejects.toMatchObject({status:403});
  expect(db.query).not.toHaveBeenCalled();
});
test('admin approval transitions only pending review and timestamps the decision', async () => {
  db.query.mockResolvedValue({rows:[row]});
  const result=await moderation.decide(admin,91,'APPROVED');
  expect(result.review.status).toBe('APPROVED');
  expect(db.query.mock.calls[0][0]).toContain("WHERE id=$2 AND status='PENDING'");
  expect(db.query.mock.calls[0][1]).toEqual(['APPROVED',91]);
});
test('rejects repeated moderation or nonexistent review', async () => {
  db.query.mockResolvedValue({rows:[]});
  await expect(moderation.decide(admin,91,'REJECTED')).rejects.toMatchObject({status:409});
});
test('vendor sees only APPROVED reviews of their session stall and no order ID', async () => {
  db.query.mockResolvedValue({rows:[row]});
  const result=await moderation.vendorApproved(vendor);
  expect(result.reviews[0]).toMatchObject({stallId:17,status:'APPROVED',rating:5});
  expect(result.reviews[0]).not.toHaveProperty('orderId');
  expect(result.reviews[0]).not.toHaveProperty('customerId');
  expect(db.query.mock.calls[0][0]).toContain("stall_id=$1 AND status='APPROVED'");
  expect(db.query.mock.calls[0][1]).toEqual([17]);
});
test('rejects vendor without assigned stall', async () => {
  await expect(moderation.vendorApproved({id:3,role:'vendor',stallId:null})).rejects.toMatchObject({status:403});
  expect(db.query).not.toHaveBeenCalled();
});
