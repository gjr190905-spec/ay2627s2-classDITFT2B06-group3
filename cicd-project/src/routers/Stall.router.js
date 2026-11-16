const express = require('express');
const { getAllStalls, getStallById } = require('../models/Stall.model');
const { getMenuItemsByStallId } = require('../models/MenuItem.model.js');
const { getUpcomingWindowsByStallId } = require('../models/PickupWindow.model');

const router = express.Router();

router.get('/:id/menu', (req, res, next) => {
  getStallById(req.params.id)
    .then((stall) => {
      if (!stall) return res.status(404).json({ error: 'Stall not found' });
      return getMenuItemsByStallId(req.params.id);
    })
    .then((items) => res.status(200).json(items))
    .catch(next);
});

router.get('/:id/windows', async (req, res, next) => {
  try {
    const stall = await getStallById(req.params.id);
    if (!stall) {
      return res.status(404).json({ error: 'Stall not found' });
    }
    const windows = await getUpcomingWindowsByStallId(stall.id);
    return res.status(200).json(windows);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', (req, res, next) => {
  getStallById(req.params.id)
    .then((stall) => {
      if (!stall) return res.status(404).json({ error: 'Stall not found' });
      res.status(200).json(stall);
    })
    .catch(next);
});

router.get('/', (req, res, next) => {
  getAllStalls()
    .then((stalls) => res.status(200).json(stalls))
    .catch(next);
});

module.exports = router;
