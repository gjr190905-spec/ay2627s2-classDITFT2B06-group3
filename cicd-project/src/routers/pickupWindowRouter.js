const express = require('express');

const {
  getAvailablePickupWindows
} = require('../models/pickupWindowModel');

const router = express.Router();

// Get available pickup windows for a stall
router.get('/', (req, res, next) => {
  const stallId = Number(req.query.stallId);

  if (!Number.isInteger(stallId) || stallId <= 0) {
    return res.status(400).json({
      error: 'Invalid stall ID'
    });
  }

  getAvailablePickupWindows(stallId)
    .then((windows) => {
      res.status(200).json(windows);
    })
    .catch(next);
});

module.exports = router;