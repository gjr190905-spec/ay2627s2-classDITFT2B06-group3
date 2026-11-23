
const crypto = require('crypto');
const pool = require('./db');
const { generateQrCode } = require('../utils/qrGenerator');

// Generate collection reference for an order
module.exports.generatePickupQR = async function generatePickupQR(orderId, customerId) {
  const { rows } = await pool.query(
    `SELECT order_id, collection_reference, order_status
     FROM orders
     WHERE order_id = $1
     AND customer_id = $2`,
    [orderId, customerId]
  );

  if (rows.length === 0) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }

  const order = rows[0];

  if (order.order_status === 'CANCELLED') {
    const error = new Error('Cancelled orders cannot be collected');
    error.statusCode = 400;
    throw error;
  }

  let collectionReference = order.collection_reference;

  // Generate reference if one does not exist
  if (!collectionReference) {
    collectionReference = `PICKUP-${crypto.randomBytes(16).toString('hex')}`;

    await pool.query(
      `UPDATE orders
       SET collection_reference = $1
       WHERE order_id = $2
       AND collection_reference IS NULL`,
      [collectionReference, orderId]
    );

    // Retrieve the saved reference
    const { rows: updatedRows } = await pool.query(
      `SELECT collection_reference
       FROM orders
       WHERE order_id = $1`,
      [orderId]
    );

    collectionReference = updatedRows[0].collection_reference;
  }

  // Generate QR code using the reusable QR generator
  const qrCode = await generateQrCode(collectionReference);

  return {
    orderId: order.order_id,
    orderStatus: order.order_status,
    collectionReference: collectionReference,
    qrCode: qrCode
  };
};


// Verify QR code and record collection
module.exports.verifyPickup = async function verifyPickup(collectionReference, vendorId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find order using collection reference
    const { rows } = await client.query(
      `SELECT o.order_id, o.stall_id, o.order_status
       FROM orders o
       WHERE o.collection_reference = $1
       FOR UPDATE`,
      [collectionReference]
    );

    if (rows.length === 0) {
      const error = new Error('Invalid pickup QR code');
      error.statusCode = 404;
      throw error;
    }

    const order = rows[0];

    // Check whether vendor owns the stall
    const { rows: vendorRows } = await client.query(
      `SELECT stall_id
       FROM stalls
       WHERE stall_id = $1
       AND vendor_id = $2`,
      [order.stall_id, vendorId]
    );

    if (vendorRows.length === 0) {
      const error = new Error('You are not authorised to collect this order');
      error.statusCode = 403;
      throw error;
    }

    // Check whether food is ready
    if (order.order_status !== 'READY') {
      const error = new Error('Order is not ready for collection');
      error.statusCode = 400;
      throw error;
    }

    // Record collection
    await client.query(
      `INSERT INTO collections (order_id, collected_by)
       VALUES ($1, $2)`,
      [order.order_id, vendorId]
    );

    // Update order status
    await client.query(
      `UPDATE orders
       SET order_status = 'COMPLETED'
       WHERE order_id = $1`,
      [order.order_id]
    );

    await client.query('COMMIT');

    return {
      message: 'Order collected successfully',
      orderId: order.order_id,
      orderStatus: 'COMPLETED'
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
};
