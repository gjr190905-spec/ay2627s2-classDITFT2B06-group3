'use strict';

const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const reviews = require('../models/CustomerReview.model');

const router = express.Router();
function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function customerOnly(req, res, next) {
  if (req.user?.role !== 'customer') {
    return res.status(403).json({ error: 'A customer account is required.' });
  }
  return next();
}

router.get('/:orderId/feedback', noStore, requireAuthentication, customerOnly, async (req, res, next) => {
  try {
    const result = await reviews.statusForOrder(req.user.id, req.params.orderId);
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/:orderId/feedback', noStore, requireAuthentication, customerOnly, requireSameOrigin, requireCsrf,
  async (req, res, next) => {
    try {
      if (!req.is('application/json')) {
        return res.status(415).json({ error: 'Use application/json.' });
      }
      const review = await reviews.submitForCollectedOrder(req.user.id, req.params.orderId, req.body);
      return res.status(201).json({
        review,
        message: 'Your review was saved and is pending moderation.',
      });
    } catch (error) { return next(error); }
  });

module.exports = router;
