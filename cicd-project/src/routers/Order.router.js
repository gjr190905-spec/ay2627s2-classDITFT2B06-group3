const express = require('express');
const {
  getOrders,
  getStats,
  findOrderByNumber,
  getOneOrder,
  createOrder,
  changeStatus,
  collect,
} = require('../controllers/Order.controller');

// Mounted at /vendors/:vendorId/orders (mergeParams lets the handlers read :vendorId)
const router = express.Router({ mergeParams: true });

// The day's orders, grouped by pickup window (preparation dashboard)
router.get('/', getOrders);
// A student places a pickup order
router.post('/', createOrder);

// Figures for the dashboard charts
router.get('/stats', getStats);

// Find an order by the number the student shows
router.get('/number/:orderNumber', findOrderByNumber);

router.get('/:orderId', getOneOrder);
// Confirmed → Preparing → Ready
router.patch('/:orderId/status', changeStatus);
// Ready → Collected (after checking the number, taking payment and handing over)
router.post('/:orderId/collect', collect);

module.exports = router;
