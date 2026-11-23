
const express = require('express');
const {
  getVendorOrders,
  updateOrderStatus
} = require('../models/ordersModel');

const router = express.Router();

// Retrieve orders for the vendor's stall
router.get('/', (req, res, next) => {
  const { stallId } = req.query;

  if (!stallId) {
    return res.status(400).json({
      error: 'Stall ID is required'
    });
  }

  getVendorOrders(stallId)
    .then((orders) => res.status(200).json(orders))
    .catch(next);
});

// Update order status
router.patch('/:orderId/status', (req, res, next) => {
  const { stallId, status } = req.body;
  const { orderId } = req.params;

  if (!stallId || !status) {
    return res.status(400).json({
      error: 'Stall ID and order status are required'
    });
  }

  if (!['PREPARING', 'READY'].includes(status)) {
    return res.status(400).json({
      error: 'Invalid order status'
    });
  }

  updateOrderStatus(orderId, stallId, status)
    .then((order) => {
      if (!order) {
        return res.status(400).json({
          error: 'Order not found or invalid status transition'
        });
      }

      res.status(200).json(order);
    })
    .catch(next);
});

module.exports = router;
