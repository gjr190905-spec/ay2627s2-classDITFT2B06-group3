const pool = require('./db');

// Get payment details using order ID
module.exports.getPaymentByOrderId = async function getPaymentByOrderId(orderId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM payments
     WHERE order_id = $1`,
    [orderId]
  );

  return rows[0];
};

// Process payment
module.exports.processPayment = async function processPayment(
  orderId,
  paymentMethod,
  paymentStatus
) {
  // Validate payment method
  if (!['CARD', 'PAYNOW', 'CASH'].includes(paymentMethod)) {
    const error = new Error('Invalid payment method');
    error.statusCode = 400;
    throw error;
  }

  // Validate payment outcome
  if (!['PAID', 'FAILED'].includes(paymentStatus)) {
    const error = new Error('Invalid payment status');
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Retrieve payment and lock the record
    const { rows } = await client.query(
      `SELECT payment_id, payment_status
       FROM payments
       WHERE order_id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (rows.length === 0) {
      const error = new Error('Payment not found');
      error.statusCode = 404;
      throw error;
    }

    const payment = rows[0];

    // Prevent duplicate successful payments
    if (payment.payment_status === 'PAID') {
      const error = new Error('Payment has already been completed');
      error.statusCode = 400;
      throw error;
    }

    // Generate transaction reference
    const transactionReference =
      `SIM-${payment.payment_id}-${Date.now()}`;

    // Update payment details
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
