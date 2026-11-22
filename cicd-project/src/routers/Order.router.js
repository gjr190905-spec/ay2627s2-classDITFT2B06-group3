const express = require('express');
const Order = require('../models/Order.model');
const parseCheckout = require('../utils/parseCheckout');
const parseId = require('../utils/parseId');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();

router.use(authenticate, requireRole('customer'));
router.post('/', async (req, res, next) => {
  try {
    const checkout = parseCheckout(req.body);
    const order = await Order.createOrder({ customerId: req.user.id, ...checkout });
    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.json(await Order.listOrdersForCustomer(req.user.id));
  } catch (error) {
    next(error);
  }
});


router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'That order id is not valid.' });
    }
    const order = await Order.getOrderForCustomer(req.user.id, id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    return res.json(order);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;