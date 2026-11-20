
const express = require('express');

const {
  generatePickupQR,
  verifyPickup
} = require('../models/pickupModel');

const router = express.Router();

// Generate customer pickup QR code
router.get('/:orderId/qr', (req, res, next) => {
  const orderId = Number(req.params.orderId);
  const customerId = Number(req.query.customerId);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      error: 'Invalid order ID'
    });
  }

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({
      error: 'Invalid customer ID'
    });
  }

  generatePickupQR(orderId, customerId)
    .then((result) => {
      res.status(200).json({
        message: 'Pickup QR code generated successfully',
        pickup: result
      });
    })
    .catch(next);
});


// Verify pickup QR code
router.post('/verify', (req, res, next) => {
  const collectionReference = req.body.collectionReference;
  const vendorId = Number(req.body.vendorId);

  if (!collectionReference || typeof collectionReference !== 'string') {
    return res.status(400).json({
      error: 'Invalid collection reference'
    });
  }

  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return res.status(400).json({
      error: 'Invalid vendor ID'
    });
  }

  verifyPickup(collectionReference, vendorId)
    .then((result) => {
      res.status(200).json(result);
    })
    .catch(next);
});

module.exports = router;
