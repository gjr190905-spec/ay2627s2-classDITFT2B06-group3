'use strict';

const pool = require('./db');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function checkReviewInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !['rating', 'comment'].includes(key))) {
    throw httpError(400, 'Provide only a rating and review comment.');
  }
  const rating = body.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw httpError(400, 'Rating must be a whole number from 1 to 5.');
  }
  if (typeof body.comment !== 'string') {
    throw httpError(400, 'Review comment must be text.');
  }
  const comment = body.comment.trim().replace(/\s+/gu, ' ');
  if (comment.length < 10 || comment.length > 800 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(comment)) {
    throw httpError(400, 'Review comment must contain 10–800 readable characters.');
  }
  return { rating, comment };
}

function publicReview(row) {
  if (!row || row.id == null) return null;
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    rating: Number(row.rating),
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Reads only the review of an order belonging to the session user. */
async function statusForOrder(customerId, orderId) {
  const customer = validId(customerId);
  const order = validId(orderId);
  if (!customer) throw httpError(401, 'Sign in to view your reviews.');
  if (!order) throw httpError(400, 'Invalid order ID.');

  const { rows } = await pool.query(
    `SELECT o.id AS matched_order_id, o.status AS order_status,
            r.id, r.order_id, r.rating, r.comment, r.status, r.created_at
       FROM orders o
       LEFT JOIN ml_customer_reviews r
         ON r.order_id = o.id AND r.customer_id = $2
      WHERE o.id = $1 AND o.customer_id = $2
      LIMIT 1`,
    [order, customer],
  );
  if (!rows.length) throw httpError(404, 'Order not found for this customer.');
  return {
    eligible: rows[0].order_status === 'COLLECTED' && rows[0].id == null,
    orderStatus: rows[0].order_status,
    review: rows[0].id == null ? null : publicReview(rows[0]),
  };
}

/** One review per verified collected order, with ownership enforced in PostgreSQL. */
async function submitForCollectedOrder(customerId, orderId, input) {
  const customer = validId(customerId);
  const order = validId(orderId);
  if (!customer) throw httpError(401, 'Sign in to submit your review.');
  if (!order) throw httpError(400, 'Invalid order ID.');
  const { rating, comment } = checkReviewInput(input);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, customer_id, stall_id, status
         FROM orders
        WHERE id = $1 AND customer_id = $2
        FOR UPDATE`,
      [order, customer],
    );
    if (!rows.length) throw httpError(404, 'Order not found for this customer.');
    if (rows[0].status !== 'COLLECTED') {
      throw httpError(409, 'You can review an order only after it has been collected.');
    }
    const result = await client.query(
      `INSERT INTO ml_customer_reviews
        (order_id, customer_id, stall_id, rating, comment, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       RETURNING id, order_id, rating, comment, status, created_at`,
      [order, customer, Number(rows[0].stall_id), rating, comment],
    );
    await client.query('COMMIT');
    return publicReview(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      console.error('Review transaction rollback failed:', rollbackError.message);
    }
    if (error.code === '23505') {
      throw httpError(409, 'This order already has a review.');
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  validId,
  checkReviewInput,
  publicReview,
  statusForOrder,
  submitForCollectedOrder,
};
