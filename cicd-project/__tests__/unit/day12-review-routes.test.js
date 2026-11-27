'use strict';

jest.mock('../../src/models/CustomerReview.model', () => ({
  statusForOrder: jest.fn(),
  submitForCollectedOrder: jest.fn(),
}));
jest.mock('../../src/models/Session.model', () => ({
  createSession: jest.fn(),
  findActiveSession: jest.fn(),
  revokeSession: jest.fn(),
}));

const request = require('supertest');
const app = require('../../src/app');
const { findActiveSession } = require('../../src/models/Session.model');
const reviews = require('../../src/models/CustomerReview.model');

const csrf = 'c'.repeat(64);
const cookie = `ml_session=${'a'.repeat(64)}`;
const saved = { id: 12, orderId: 91, rating: 5, comment: 'Tasty chicken rice.', status: 'PENDING' };

beforeEach(() => {
  jest.resetAllMocks();
  findActiveSession.mockResolvedValue({
    id: 4, name: 'Sample Customer', email: 'sample@example.com',
    role: 'customer', stallId: null, csrfToken: csrf,
  });
  reviews.statusForOrder.mockResolvedValue({ eligible: false, orderStatus: 'COLLECTED', review: saved });
  reviews.submitForCollectedOrder.mockResolvedValue(saved);
});

test('unauthenticated user cannot submit a review', async () => {
  findActiveSession.mockResolvedValue(null);
  const response = await request(app).post('/api/orders/91/feedback')
    .send({ rating: 5, comment: 'Tasty chicken rice.' });
  expect(response.status).toBe(401);
  expect(reviews.submitForCollectedOrder).not.toHaveBeenCalled();
});

test('vendor cannot submit a customer review', async () => {
  findActiveSession.mockResolvedValue({ id: 7, role: 'vendor', stallId: 2, csrfToken: csrf });
  const response = await request(app).post('/api/orders/91/feedback')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf)
    .send({ rating: 5, comment: 'Tasty chicken rice.' });
  expect(response.status).toBe(403);
  expect(reviews.submitForCollectedOrder).not.toHaveBeenCalled();
});

test('CSRF token is required before the write reaches the model', async () => {
  const response = await request(app).post('/api/orders/91/feedback')
    .set('Cookie', cookie).send({ rating: 5, comment: 'Tasty chicken rice.' });
  expect(response.status).toBe(403);
  expect(reviews.submitForCollectedOrder).not.toHaveBeenCalled();
});

test('authenticated customer review is persisted by the model and returns 201', async () => {
  const response = await request(app).post('/api/orders/91/feedback')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf)
    .send({ rating: 5, comment: 'Tasty chicken rice.' });
  expect(response.status).toBe(201);
  expect(response.body.review.status).toBe('PENDING');
  expect(reviews.submitForCollectedOrder).toHaveBeenCalledWith(4, '91', {
    rating: 5, comment: 'Tasty chicken rice.',
  });
});

test('signed-in customer can fetch their saved status', async () => {
  const response = await request(app).get('/api/orders/91/feedback').set('Cookie', cookie);
  expect(response.status).toBe(200);
  expect(response.body.review.status).toBe('PENDING');
  expect(reviews.statusForOrder).toHaveBeenCalledWith(4, '91');
});
