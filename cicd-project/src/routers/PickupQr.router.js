'use strict';
const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const { authenticate } = require('../middleware/auth');
const model = require('../models/PickupQr.model');
const { qrSvg } = require('../models/PickupQr.svg');
const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Customer endpoints accept either a cookie session or a Bearer JWT.
function customerAuth(req, res, next) {
  if (req.user) return next();
  const header = req.headers && req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Please sign in to continue.' });
  authenticate(req, res, (err) => {
    if (err || !req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
    next();
  });
}
function customerCsrf(req, res, next) {
  if (req.authMethod === 'bearer') return next();
  return requireCsrf(req, res, next);
}
function asRole(role) { return (req, res, next) => req.user && req.user.role === role ? next() : res.status(403).json({ error: `${role} account required.` }); }
function jsonBody(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON request required.' });
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({ error: 'Invalid request body.' });
  return next();
}
function handled(fn) { return async (req, res, next) => { try { return await fn(req, res); } catch (e) { return next(e); } }; }

router.get('/ready-orders', customerAuth, asRole('customer'), handled(async (req, res) => {
  res.json({ orders: await model.readyOrdersForCustomer(req.user.id) });
}));
router.post('/issue', requireSameOrigin, customerAuth, asRole('customer'), customerCsrf, jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'orderId')) return res.status(400).json({ error: 'Provide only orderId.' });
  const result = await model.issueForCustomer(req.user.id, req.body.orderId);
  if (result.alreadyIssued) {
    return res.json({ pickup: { alreadyIssued: true, orderNumber: result.orderNumber }, message: 'Pickup QR already issued. Use your saved copy.' });
  }
  const qrCode = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(result.code), 'utf8').toString('base64');
  return res.json({ pickup: { qrCode, orderNumber: result.orderNumber }, message: 'Show this pickup QR to your vendor.' });
}));

// Vendor endpoints (unchanged)
router.use(requireAuthentication);
router.post('/review', requireSameOrigin, requireCsrf, (req, res, next) => req.user && req.user.role === 'vendor' ? next() : res.status(403).json({ error: 'vendor account required.' }), jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).length !== 1 || typeof req.body.code !== 'string') return res.status(400).json({ error: 'Provide only the scanned QR code.' });
  const review = await model.inspectForVendor(req.user.stallId, req.body.code);
  return res.json({ ...review, reviewPending: true });
}));
router.post('/approve', requireSameOrigin, requireCsrf, (req, res, next) => req.user && req.user.role === 'vendor' ? next() : res.status(403).json({ error: 'vendor account required.' }), jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).some(x => !['code','handoverConfirmed','paymentConfirmed'].includes(x)) ||
      req.body.handoverConfirmed !== true || req.body.paymentConfirmed !== true) {
    return res.status(400).json({ error: 'Confirm the food handover and payment before collection.' });
  }
  const result = await model.inspectForVendor(req.user.stallId, req.body.code, true, req.user.id);
  return res.json(result);
}));
module.exports = router;