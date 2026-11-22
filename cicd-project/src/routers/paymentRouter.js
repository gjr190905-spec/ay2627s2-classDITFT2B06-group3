const express = require('express');

const {
  getPaymentByOrderId,
  processPayment
} = require('../models/paymentModel');

const router = express.Router();

// Get payment details
router.get('/:orderId', (req, res, next) => {
  const orderId = Number(req.params.orderId);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      error: 'Invalid order ID'
    });
  }

  getPaymentByOrderId(orderId)
    .then((payment) => {
      if (!payment) {
        return res.status(404).json({
          error: 'Payment not found'
        });
      }

      res.status(200).json(payment);
    })
    .catch(next);
});

// Simulate payment
router.post('/:orderId/simulate', (req, res, next) => {
  const orderId = Number(req.params.orderId);
  const paymentMethod = req.body.paymentMethod;
  const paymentStatus = req.body.paymentStatus;

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      error: 'Invalid order ID'
    });
  }

  if (!['CARD', 'PAYNOW', 'CASH'].includes(paymentMethod)) {
    return res.status(400).json({
      error: 'Invalid payment method'
    });
  }

  if (!['PAID', 'FAILED'].includes(paymentStatus)) {
    return res.status(400).json({
      error: 'Invalid payment status'
    });
  }

  processPayment(orderId, paymentMethod, paymentStatus)
    .then((payment) => {
      res.status(200).json({
        message: payment.payment_status === 'PAID'
          ? 'Payment successful'
          : 'Payment failed',
        payment: payment
      });
    })
    .catch(next);
});

module.exports = router;
