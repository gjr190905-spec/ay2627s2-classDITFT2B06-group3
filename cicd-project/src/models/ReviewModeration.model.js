'use strict';
// Persistent review moderation for Makan Liao; never exposes customer identity to vendors.
const pool = require('./db');
const { validId } = require('./CustomerReview.model');

function error(status, message) { const e = new Error(message); e.status = status; return e; }
function toRecord(row, includeOrder = false) {
  const record = {
    id: Number(row.id), stallId: Number(row.stall_id),
    rating: Number(row.rating), comment: row.comment,
    status: row.status, createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeOrder) record.orderId = Number(row.order_id);
  return record;
}

async function adminQueue(user) {
  if (user?.role !== 'admin' || !validId(user.id)) throw error(403, 'Administrator access required.');
  const { rows } = await pool.query(
    `SELECT id, order_id, stall_id, rating, comment, status, created_at, updated_at
       FROM ml_customer_reviews
      ORDER BY CASE WHEN status='PENDING' THEN 0 ELSE 1 END,
               created_at DESC, id DESC LIMIT 100`,
  );
  return { reviews: rows.map(row => toRecord(row, true)) };
}

async function decide(user, reviewId, action) {
  if (user?.role !== 'admin' || !validId(user.id)) throw error(403, 'Administrator access required.');
  const id = validId(reviewId);
  if (!id) throw error(400, 'Invalid review ID.');
  if (!['APPROVED', 'REJECTED'].includes(action)) throw error(400, 'Choose APPROVED or REJECTED.');
  const { rows } = await pool.query(
    `UPDATE ml_customer_reviews
        SET status=$1, updated_at=NOW()
      WHERE id=$2 AND status='PENDING'
      RETURNING id, order_id, stall_id, rating, comment, status, created_at, updated_at`,
    [action, id],
  );
  if (!rows.length) throw error(409, 'Review not found or already moderated. Refresh the queue.');
  return { review: toRecord(rows[0], true) };
}

async function vendorApproved(user) {
  const stallId = validId(user?.stallId);
  if (user?.role !== 'vendor' || !validId(user.id) || !stallId) {
    throw error(403, 'An assigned vendor account is required.');
  }
  // stallId is taken exclusively from the verified server-side session.
  const { rows } = await pool.query(
    `SELECT id, stall_id, rating, comment, status, created_at, updated_at
       FROM ml_customer_reviews
      WHERE stall_id=$1 AND status='APPROVED'
      ORDER BY created_at DESC, id DESC LIMIT 100`, [stallId],
  );
  // Never include customer ID, customer name, email, or order ID in vendor responses.
  return { reviews: rows.map(row => toRecord(row, false)) };
}

module.exports = { adminQueue, decide, vendorApproved, toRecord };
