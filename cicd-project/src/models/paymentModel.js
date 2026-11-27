const pool = require('./db');

// Get payment details using order ID (only for the order's owner)
module.exports.getPaymentByOrderId = async function getPaymentByOrderId(orderId, customerId) {
  const { rows } = await pool.query(
    `SELECT p.*
     FROM payments p
     JOIN "Order" o ON o."id" = p.order_id
     WHERE p.order_id = $1
       AND o."customerId" = $2`,
    [orderId, customerId]
  );

  return rows[0];
};

// Process payment
module.exports.processPayment = async function processPayment(
  orderId,
  paymentMethod,
  paymentStatus,
  customerId
) {
  if (!['CARD', 'PAYNOW', 'CASH'].includes(paymentMethod)) {
    const error = new Error('Invalid payment method');
    error.statusCode = 400;
    throw error;
  }

  if (!['PAID', 'FAILED'].includes(paymentStatus)) {
    const error = new Error('Invalid payment status');
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT p.payment_id, p.payment_status
       FROM payments p
       JOIN "Order" o ON o."id" = p.order_id
       WHERE p.order_id = $1
         AND o."customerId" = $2
       FOR UPDATE`,
      [orderId, customerId]
    );

    if (rows.length === 0) {
      const error = new Error('Payment not found');
      error.statusCode = 404;
      throw error;
    }

    const payment = rows[0];

    if (payment.payment_status === 'PAID') {
      const error = new Error('Payment has already been completed');
      error.statusCode = 400;
      throw error;
    }

    const transactionReference =
      `SIM-${payment.payment_id}-${Date.now()}`;

    const { rows: updatedRows } = await client.query(
      `UPDATE payments
       SET payment_status = $1,
           payment_method = $2,
           transaction_reference = $3,
           paid_at = CASE
             WHEN $1 = 'PAID' THEN CURRENT_TIMESTAMP
             ELSE NULL
           END
       WHERE payment_id = $4
         AND payment_status = 'PENDING'
       RETURNING *`,
      [paymentStatus, paymentMethod, transactionReference, payment.payment_id]
    );

    await client.query('COMMIT');

    return updatedRows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
};