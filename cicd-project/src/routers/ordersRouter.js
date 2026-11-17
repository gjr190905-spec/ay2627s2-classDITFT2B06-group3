
const express = require('express');
const {
  createOrder,
  getCustomerOrders,
  getOrderById
} = require('../models/ordersModel');

const router = express.Router();

// Create an order
router.post('/', (req, res, next) => {
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

  createOrder(req.body)
    .then((order) => res.status(201).json(order))
    .catch(next);
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
