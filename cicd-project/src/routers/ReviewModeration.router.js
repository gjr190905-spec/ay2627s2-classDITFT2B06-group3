'use strict';
const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const review = require('../models/ReviewModeration.model');
const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(requireAuthentication);
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}
function vendorOnly(req, res, next) {
  if (req.user?.role !== 'vendor' || !req.user.stallId) {
    return res.status(403).json({ error: 'An assigned vendor account is required.' });
  }
  next();
}
router.get('/moderation', adminOnly, wrap(async (req, res) => res.json(await review.adminQueue(req.user))));
router.patch('/moderation/:id', adminOnly, requireSameOrigin, requireCsrf, wrap(async (req, res) => {
  if (!req.is('application/json') || !req.body || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 ||
      !['APPROVED','REJECTED'].includes(req.body.status)) {
    return res.status(400).json({ error: 'Supply JSON with status APPROVED or REJECTED only.' });
  }
  return res.json(await review.decide(req.user, req.params.id, req.body.status));
}));
router.get('/vendor', vendorOnly, wrap(async (req, res) => res.json(await review.vendorApproved(req.user))));
module.exports = router;
