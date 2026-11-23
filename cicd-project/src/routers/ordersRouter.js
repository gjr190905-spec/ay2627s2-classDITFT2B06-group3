
const express = require('express');
const {
  createOrder,
  getCustomerOrders,
  getOrderById
} = require('../models/ordersModel');

const {
  generatePickupQR
} = require('../models/pickupModel');

const router = express.Router();

// Create an order
router.post('/', async (req, res, next) => {
  const { customerId, stallId, items } = req.body;

  // Check required fields
  if (!customerId || !stallId || !items) {
    return res.status(400).json({
      error: 'Customer ID, stall ID and order items are required'
    });
  }

  // Check customer and stall IDs
  if (
    !Number.isInteger(customerId) ||
    customerId <= 0 ||
    !Number.isInteger(stallId) ||
    stallId <= 0
  ) {
    return res.status(400).json({
      error: 'Invalid customer ID or stall ID'
    });
  }

  // Check order items
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Order must contain at least one item'
    });
  }

  // Check item IDs and quantities
  for (const item of items) {
    if (
      !Number.isInteger(item.menuItemId) ||
      item.menuItemId <= 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return res.status(400).json({
        error: 'Invalid menu item ID or quantity'
      });
    }
  }

  try {
    const order = await createOrder(req.body);

    // Generate a QR code for the new order's collection reference
    let qrCode = null;
    let collectionReference = order.collection_reference;
    let qrCodeError = null;

    try {
      const pickup = await generatePickupQR(order.order_id, order.customer_id);
      qrCode = pickup.qrCode;
      collectionReference = pickup.collectionReference;
    } catch (qrError) {
      console.error('QR code generation failed:', qrError.message);
      qrCodeError = qrError.message;
    }

    res.status(201).json({
      ...order,
      collection_reference: collectionReference,
      qrCode: qrCode,
      qrCodeError: qrCodeError
    });
  } catch (error) {
    next(error);
  }
});

// Get customer's orders
router.get('/', (req, res, next) => {
  getCustomerOrders(req.query.customerId)
    .then((orders) => res.status(200).json(orders))
    .catch(next);
});

// Retrieve individual order details
router.get('/:orderId', (req, res, next) => {
  getOrderById(req.params.orderId, req.query.customerId)
    .then((order) => {
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      res.status(200).json(order);
    })
    .catch(next);
});

module.exports = router;
