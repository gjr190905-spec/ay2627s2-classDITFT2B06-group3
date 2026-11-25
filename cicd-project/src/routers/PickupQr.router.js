'use strict';
const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const model = require('../models/PickupQr.model');
const { qrSvg } = require('../models/PickupQr.svg');
const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(requireAuthentication);
const mutation = [requireSameOrigin, requireCsrf];
function asRole(role) { return (req, res, next) => req.user.role === role ? next() : res.status(403).json({ error: `${role} account required.` }); }
function jsonBody(req, res, next) {
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON request required.' });
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({ error: 'Invalid request body.' });
  return next();
}
function handled(fn) { return async (req, res, next) => { try { return await fn(req, res); } catch(e) { return next(e); } }; }
router.get('/ready-orders', asRole('customer'), handled(async (req, res) => res.json({ orders: await model.readyOrdersForCustomer(req.user.id) })));
router.post('/issue', ...mutation, asRole('customer'), jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'orderId')) return res.status(400).json({ error: 'Provide only orderId.' });
  const { code, orderNumber } = await model.issueForCustomer(req.user.id, req.body.orderId);
  const qrCode = 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(code), 'utf8').toString('base64');
  return res.json({ pickup: { qrCode, orderNumber }, message: 'Show this pickup QR to your vendor.' });
}));
router.post('/review', ...mutation, asRole('vendor'), jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).length !== 1 || typeof req.body.code !== 'string') return res.status(400).json({ error: 'Provide only the scanned QR code.' });
  const review = await model.inspectForVendor(req.user.stallId, req.body.code);
  return res.json({ ...review, reviewPending: true });
}));
router.post('/approve', ...mutation, asRole('vendor'), jsonBody, handled(async (req, res) => {
  if (Object.keys(req.body).some(x => !['code','handoverConfirmed','paymentConfirmed'].includes(x)) ||
      req.body.handoverConfirmed !== true || req.body.paymentConfirmed !== true) {
    return res.status(400).json({ error: 'Confirm the food handover and payment before collection.' });
  }
  const result = await model.inspectForVendor(req.user.stallId, req.body.code, true, req.user.id);
  return res.json(result);
}));
module.exports = router;
