
const express = require('express');
const {
  createOrder,
  getCustomerOrders,
  getOrderById
} = require('../models/ordersModel');

const router = express.Router();

// Create an order
router.post('/', (req, res, next) => {
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
