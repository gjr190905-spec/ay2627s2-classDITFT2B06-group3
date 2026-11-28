'use strict';

jest.mock('../../src/models/db', () => ({ query: jest.fn(), connect: jest.fn() }));
const db = require('../../src/models/db');
const reviews = require('../../src/models/CustomerReview.model');

beforeEach(() => jest.resetAllMocks());

describe('Day 12: customer review validation', () => {
  test('enforces five whole-number rating choices', () => {
    for (const rating of [0, 6, '5', 1.5, null, undefined]) {
      expect(() => reviews.checkReviewInput({ rating, comment: 'Really tasty lunch.' })).toThrow();
    }
    expect(reviews.checkReviewInput({ rating: 5, comment: '  Very tasty lunch.  ' }))
      .toEqual({ rating: 5, comment: 'Very tasty lunch.' });
  });
  test('rejects empty, overlong or malformed comments', () => {
    for (const comment of ['', 'a', 'a'.repeat(801), 123]) {
      expect(() => reviews.checkReviewInput({ rating: 4, comment })).toThrow();
    }
    expect(() => reviews.checkReviewInput({ rating: 4, comment: 'Valid comment', customerId: 7 }))
      .toThrow(/only a rating/i);
  });
  test('rejects unauthenticated or malformed IDs before database access', async () => {
    await expect(reviews.submitForCollectedOrder(null, 3, { rating: 5, comment: 'Tasty food indeed.' }))
      .rejects.toMatchObject({ status: 401 });
    await expect(reviews.submitForCollectedOrder(3, 'bad', { rating: 5, comment: 'Tasty food indeed.' }))
      .rejects.toMatchObject({ status: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('Day 12: PostgreSQL ownership and transaction boundaries', () => {
  function mockClient(orderRows, insertRows = []) {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockResolvedValueOnce({ rows: orderRows })     // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: insertRows })    // INSERT or ROLLBACK
        .mockResolvedValueOnce({ rows: [] }),           // COMMIT
      release: jest.fn(),
    };
    db.connect.mockResolvedValue(client);
    return client;
  }
  test('does not allow another customer to review an unowned order', async () => {
    const client = mockClient([]);
    await expect(reviews.submitForCollectedOrder(5, 42, { rating: 4, comment: 'Good food overall.' }))
      .rejects.toMatchObject({ status: 404 });
    expect(client.query.mock.calls[1][0]).toContain('customer_id = $2');
    expect(client.query.mock.calls[1][1]).toEqual([42, 5]);
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
  test('review must follow collection', async () => {
    const client = mockClient([{ id: 42, customer_id: 5, stall_id: 9, status: 'READY' }]);
    await expect(reviews.submitForCollectedOrder(5, 42, { rating: 4, comment: 'Good food overall.' }))
      .rejects.toMatchObject({ status: 409 });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });
  test('collected order saves a pending review with real stall ID', async () => {
    const now = new Date().toISOString();
    const client = mockClient(
      [{ id: 42, customer_id: 5, stall_id: 9, status: 'COLLECTED' }],
      [{ id: '77', order_id: '42', rating: 4, comment: 'Good food overall.', status: 'PENDING', created_at: now }],
    );
    const result = await reviews.submitForCollectedOrder(5, 42, { rating: 4, comment: 'Good food overall.' });
    expect(result).toEqual({ id: 77, orderId: 42, rating: 4, comment: 'Good food overall.', status: 'PENDING', createdAt: now });
    expect(client.query.mock.calls[2][1]).toEqual([42, 5, 9, 4, 'Good food overall.']);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
  test('unique-constraint violation returns a duplicate-review conflict', async () => {
    const client = mockClient([{ id: 42, customer_id: 5, stall_id: 9, status: 'COLLECTED' }]);
    client.query.mockReset(); // Clear queued once-only database mock responses.
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO')) throw Object.assign(new Error('duplicate'), { code: '23505' });
      return { rows: [{ id: 42, customer_id: 5, stall_id: 9, status: 'COLLECTED' }] };
    });
    await expect(reviews.submitForCollectedOrder(5, 42, { rating: 4, comment: 'Good food overall.' }))
      .rejects.toMatchObject({ status: 409 });
    expect(client.release).toHaveBeenCalled();
  });
  test('review status is visible only to the order owner', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(reviews.statusForOrder(5, 42)).rejects.toMatchObject({ status: 404 });
    expect(db.query.mock.calls[0][1]).toEqual([42, 5]);
    expect(db.query.mock.calls[0][0]).toContain('o.customer_id = $2');
  });
  test('brand-new collected order keeps the review form (LEFT JOIN no review row)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      matched_order_id: 42, order_status: 'COLLECTED',
      id: null, order_id: null, rating: null, comment: null,
      status: null, created_at: null,
    }] });
    const status = await reviews.statusForOrder(5, 42);
    expect(status).toMatchObject({ eligible: true, orderStatus: 'COLLECTED', review: null });
    expect(reviews.publicReview({ id: null, status: null })).toBeNull();
  });
  test('uncollected order with no review remains ineligible, not falsely reviewed', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      matched_order_id: 43, order_status: 'READY',
      id: null, order_id: null, rating: null, comment: null,
      status: null, created_at: null,
    }] });
    await expect(reviews.statusForOrder(5, 43)).resolves.toMatchObject({
      eligible: false, orderStatus: 'READY', review: null,
    });
  });
  test('already reviewed orders return saved status instead of another form', async () => {
    db.query.mockResolvedValueOnce({ rows: [{
      matched_order_id: 42, order_status: 'COLLECTED', id: 77, order_id: 42,
      rating: 4, comment: 'Good food overall.', status: 'PENDING', created_at: '2026-11-27',
    }] });
    const status = await reviews.statusForOrder(5, 42);
    expect(status.eligible).toBe(false);
    expect(status.review.status).toBe('PENDING');
    expect(status.review).not.toHaveProperty('customerId');
  });
});
