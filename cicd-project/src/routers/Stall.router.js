const express = require('express');
const { getAllStalls, getStallById } = require('../models/Stall.model');
const { getMenuItemsByStallId } = require('../models/MenuItem.model');
const { getUpcomingWindowsByStallId } = require('../models/PickupWindow.model');
const { ERROR_CODES, mapError } = require('../utils/errors');
const parseId = require('../utils/parseId');

const router = express.Router();
router.get('/:id/menu', async (req, res, next) => {
  try {
    const stallId = parseId(req.params.id);
    if (stallId === null) {
      return next(mapError(ERROR_CODES.INVALID_INPUT, 'Invalid stall ID'));
    }
    const stall = await getStallById(stallId);
    if (!stall) {
      return next(mapError(ERROR_CODES.NOT_FOUND, 'Stall not found'));
    }
    const items = await getMenuItemsByStallId(stall.id);
    return res.status(200).json(items);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/windows', async (req, res, next) => {
  try {
    const stallId = parseId(req.params.id);
    if (stallId === null) {
      return next(mapError(ERROR_CODES.INVALID_INPUT, 'Invalid stall ID'));
    }
    const stall = await getStallById(stallId);
    if (!stall) {
      return next(mapError(ERROR_CODES.NOT_FOUND, 'Stall not found'));
    }
    const windows = await getUpcomingWindowsByStallId(stall.id);
    return res.status(200).json(windows);
  } catch (err) {
    return next(err);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    const stallId = parseId(req.params.id);
    if (stallId === null) {
      return next(mapError(ERROR_CODES.INVALID_INPUT, 'Invalid stall ID'));
    }
    const stall = await getStallById(stallId);
    if (!stall) {
      return next(mapError(ERROR_CODES.NOT_FOUND, 'Stall not found'));
    }
    return res.status(200).json(stall);
  } catch (err) {
    return next(err);
  }
});
router.get('/', async (req, res, next) => {
  try {
    const stalls = await getAllStalls();
    return res.status(200).json(stalls);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;