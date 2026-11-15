const pool = require('./db');

module.exports.createOrder = async function createOrder(order) {
  const { rows } = await pool.query(
    `INSERT INTO orders
      (customer_id, stall_id, pickup_window_id, items, total_amount, order_status, payment_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      order.customerId,
      order.stallId,
      order.pickupWindowId,
      JSON.stringify(order.items),
      order.totalAmount,
      'CONFIRMED',
      'PENDING'
    ]
  );

  return rows[0];
};

module.exports.getCustomerOrders = async function getCustomerOrders(customerId) {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId]
  );

  return rows;
};

module.exports.getOrderById = async function getOrderById(orderId, customerId) {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE order_id = $1 AND customer_id = $2',
    [orderId, customerId]
  );

  return rows[0];
};