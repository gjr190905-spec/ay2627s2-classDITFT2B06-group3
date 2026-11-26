'use strict';
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const notifications = require('../models/CustomerNotifications.model');
const router = express.Router();
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { next(e); }
};
router.use(authenticate, requireRole('customer'));
router.get('/', wrap(async (req, res) => res.json(await notifications.list(req.user.id))));
router.post('/:id/read', requireSameOrigin, requireCsrf, wrap(async (req, res) =>
  res.json(await notifications.markRead(req.user.id, req.params.id))));
router.post('/:id/dismiss', requireSameOrigin, requireCsrf, wrap(async (req, res) =>
  res.json(await notifications.dismiss(req.user.id, req.params.id))));
module.exports = router;
