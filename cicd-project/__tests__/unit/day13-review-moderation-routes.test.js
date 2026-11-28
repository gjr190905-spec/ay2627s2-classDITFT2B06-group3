'use strict';
jest.mock('../../src/models/ReviewModeration.model', () => ({
  adminQueue: jest.fn(), decide: jest.fn(), vendorApproved: jest.fn(),
}));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(), findActiveSession: jest.fn(), revokeSession: jest.fn(),
}));
const request = require('supertest');
const app = require('../../src/app');
const {findActiveSession} = require('../../src/models/Session.model');
const reviews = require('../../src/models/ReviewModeration.model');
const csrf = 'c'.repeat(64);
const cookie = `ml_session=${'a'.repeat(64)}`;
beforeEach(() => {
  jest.resetAllMocks();
  findActiveSession.mockResolvedValue({id:1,role:'admin',stallId:null,csrfToken:csrf});
  reviews.adminQueue.mockResolvedValue({reviews:[{id:1,status:'PENDING',rating:4,comment:'Great food'}]});
  reviews.vendorApproved.mockResolvedValue({reviews:[{id:1,status:'APPROVED',rating:4,comment:'Great food'}]});
  reviews.decide.mockResolvedValue({review:{id:1,status:'APPROVED'}});
});
test('admin gets review queue', async () => {
  const res = await request(app).get('/api/reviews/moderation').set('Cookie',cookie);
  expect(res.status).toBe(200);
  expect(res.body.reviews[0].status).toBe('PENDING');
});
test('customer cannot view moderation queue', async () => {
  findActiveSession.mockResolvedValue({id:2,role:'customer',stallId:null,csrfToken:csrf});
  const res = await request(app).get('/api/reviews/moderation').set('Cookie',cookie);
  expect(res.status).toBe(403);
  expect(reviews.adminQueue).not.toHaveBeenCalled();
});
test('moderation write requires CSRF', async () => {
  const res = await request(app).patch('/api/reviews/moderation/1').set('Cookie',cookie)
    .send({status:'APPROVED'});
  expect(res.status).toBe(403);
  expect(reviews.decide).not.toHaveBeenCalled();
});
test('admin can approve using CSRF and authenticated session', async () => {
  const res = await request(app).patch('/api/reviews/moderation/1').set('Cookie',cookie)
    .set('X-CSRF-Token',csrf).send({status:'APPROVED'});
  expect(res.status).toBe(200);
  expect(reviews.decide).toHaveBeenCalledWith(expect.objectContaining({id:1,role:'admin'}),'1','APPROVED');
});
test('vendor sees own approved reviews but cannot moderate', async () => {
  findActiveSession.mockResolvedValue({id:2,role:'vendor',stallId:17,csrfToken:csrf});
  const r1 = await request(app).get('/api/reviews/vendor').set('Cookie',cookie);
  const r2 = await request(app).patch('/api/reviews/moderation/1').set('Cookie',cookie)
    .set('X-CSRF-Token',csrf).send({status:'APPROVED'});
  expect(r1.status).toBe(200);
  expect(r2.status).toBe(403);
  expect(reviews.vendorApproved).toHaveBeenCalledWith(expect.objectContaining({stallId:17}));
});
