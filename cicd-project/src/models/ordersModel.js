
const pool = require('./db');

// Create an order
module.exports.createOrder = async function createOrder(order) {

  // Validate item IDs and quantities
  const menuItemIds = [];

  for (const item of order.items) {
    if (
      !Number.isInteger(item.menuItemId) ||
      item.menuItemId <= 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      const error = new Error('Invalid menu item ID or quantity');
      error.statusCode = 400;
      throw error;
    }

    // Prevent duplicate menu items in the same order
    if (menuItemIds.includes(item.menuItemId)) {
      const error = new Error('Duplicate menu items are not allowed');
      error.statusCode = 400;
      throw error;
    }

    menuItemIds.push(item.menuItemId);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check whether the stall exists and is active
    const { rows: stallRows } = await client.query(
      'SELECT stall_id FROM stalls WHERE stall_id = $1 AND is_active = TRUE',
      [order.stallId]
    );

    if (stallRows.length === 0) {
      const error = new Error('Stall not found or inactive');
      error.statusCode = 400;
      throw error;
    }

    // Check menu items and calculate the order total
    let totalAmountInCents = 0;
    const validatedItems = [];

    for (const item of order.items) {
      const { rows } = await client.query(
        `SELECT menu_item_id, item_name, price
         FROM menu_items
         WHERE menu_item_id = $1
         AND stall_id = $2
         AND is_available = TRUE`,
        [item.menuItemId, order.stallId]
      );

      if (rows.length === 0) {
        const error = new Error(
          'Menu item not found or unavailable'
        );
        error.statusCode = 400;
        throw error;
      }

      const menuItem = rows[0];
      const unitPriceInCents = Math.round(Number(menuItem.price) * 100);
      const subtotalInCents = unitPriceInCents * item.quantity;

      totalAmountInCents += subtotalInCents;

      validatedItems.push({
        menuItemId: menuItem.menu_item_id,
        itemName: menuItem.item_name,
        unitPrice: (unitPriceInCents / 100).toFixed(2),
        quantity: item.quantity,
        subtotal: (subtotalInCents / 100).toFixed(2)
      });
    }

    const totalAmount = (totalAmountInCents / 100).toFixed(2);

    // Create the order
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders
        (customer_id, stall_id, total_amount, order_status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [order.customerId, order.stallId, totalAmount, 'CONFIRMED']
    );

    const newOrder = orderRows[0];

    // Insert order items
    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO order_items
          (order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newOrder.order_id,
          item.menuItemId,
          item.itemName,
          item.unitPrice,
          item.quantity,
          item.subtotal
        ]
      );
    }

    // Create payment record
    await client.query(
      `INSERT INTO payments
        (order_id, amount, payment_status)
       VALUES ($1, $2, $3)`,
      [newOrder.order_id, totalAmount, 'PENDING']
    );

    await client.query('COMMIT');

    return newOrder;

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;

  } finally {
    client.release();
  }
};

// Retrieve customer's orders
module.exports.getCustomerOrders = async function getCustomerOrders(customerId) {
  const { rows } = await pool.query(
    `SELECT * FROM orders
     WHERE customer_id = $1
     ORDER BY created_at DESC`,
    [customerId]
  );

  return rows;
};

// Retrieve individual customer order
module.exports.getOrderById = async function getOrderById(orderId, customerId) {
  const { rows } = await pool.query(
    `SELECT * FROM orders
     WHERE order_id = $1 AND customer_id = $2`,
    [orderId, customerId]
  );

  return rows[0];
};

// Retrieve orders for a vendor's stall
module.exports.getVendorOrders = async function getVendorOrders(stallId) {
  const { rows } = await pool.query(
    `SELECT * FROM orders
     WHERE stall_id = $1
     ORDER BY created_at DESC`,
    [stallId]
  );

  return rows;
};

// Update order status
module.exports.updateOrderStatus = async function updateOrderStatus(
  orderId,
  stallId,
  status
) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET order_status = $1
     WHERE order_id = $2
     AND stall_id = $3
     AND (
       (order_status = 'CONFIRMED' AND $1 = 'PREPARING')
       OR
       (order_status = 'PREPARING' AND $1 = 'READY')
     )
     RETURNING *`,
    [status, orderId, stallId]
  );

  return rows[0];
};
