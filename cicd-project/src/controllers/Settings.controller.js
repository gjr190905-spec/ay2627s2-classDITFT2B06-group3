const createError = require('http-errors');
const { getSettings, saveSettings } = require('../models/Settings.model');
const {
  listNotifications,
  markAllRead,
  clearNotifications,
} = require('../models/Notification.model');
const { parseVendorId } = require('./Vendor.controller');

const MAX_ACTIVE_ORDERS = 200;
const LOW_STOCK_MAX = 50;
const NOTIFICATION_SWITCHES = ['newOrder', 'soldOut', 'lowStock'];

/**
 * Validate the body of PUT /vendors/:vendorId/settings. Every field is required, so the
 * page always saves the whole form:
 * {
 *   maxActiveOrders: null | 1–200,
 *   notifications: { newOrder: bool, soldOut: bool, lowStock: bool, lowStockThreshold: 1–50 }
 * }
 *
 * @returns {{error: string} | {settings: object}}
 */
function validateSettings(body) {
  const input = body || {};

  const max = input.maxActiveOrders;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > MAX_ACTIVE_ORDERS)) {
    return {
      error: `maxActiveOrders must be a whole number from 1 to ${MAX_ACTIVE_ORDERS}, or null for no limit`,
    };
  }

  const n = input.notifications;
  if (!n || typeof n !== 'object' || Array.isArray(n)) {
    return { error: 'notifications must be an object' };
  }
  for (const key of NOTIFICATION_SWITCHES) {
    if (typeof n[key] !== 'boolean') return { error: `notifications.${key} must be true or false` };
  }
  const threshold = n.lowStockThreshold;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > LOW_STOCK_MAX) {
    return {
      error: `notifications.lowStockThreshold must be a whole number from 1 to ${LOW_STOCK_MAX}`,
    };
  }

  return {
    settings: {
      maxActiveOrders: max,
      notifications: {
        newOrder: n.newOrder,
        soldOut: n.soldOut,
        lowStock: n.lowStock,
        lowStockThreshold: threshold,
      },
    },
  };
}

function readVendorId(req, next) {
  const vendorId = parseVendorId(req.params.vendorId);
  if (vendorId === null) {
    next(createError(400, 'Vendor id must be a positive integer'));
    return null;
  }
  return vendorId;
}

/** Run a model call for this vendor: 404 when it returns undefined, else 200 + JSON. */
function respond(req, res, next, call) {
  const vendorId = readVendorId(req, next);
  if (vendorId === null) return undefined;
  return call(vendorId)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result);
    })
    .catch(next);
}

// GET /vendors/:vendorId/settings
function getVendorSettings(req, res, next) {
  return respond(req, res, next, getSettings);
}

// PUT /vendors/:vendorId/settings
function putVendorSettings(req, res, next) {
  const payload = validateSettings(req.body);
  if (payload.error) {
    if (readVendorId(req, next) === null) return undefined;
    return next(createError(400, payload.error));
  }
  return respond(req, res, next, (vendorId) => saveSettings(vendorId, payload.settings));
}

// GET /vendors/:vendorId/notifications
function getNotifications(req, res, next) {
  return respond(req, res, next, listNotifications);
}

// POST /vendors/:vendorId/notifications/read-all
function readAllNotifications(req, res, next) {
  return respond(req, res, next, markAllRead);
}

// DELETE /vendors/:vendorId/notifications
function clearAllNotifications(req, res, next) {
  return respond(req, res, next, clearNotifications);
}

module.exports = {
  MAX_ACTIVE_ORDERS,
  LOW_STOCK_MAX,
  validateSettings,
  getVendorSettings,
  putVendorSettings,
  getNotifications,
  readAllNotifications,
  clearAllNotifications,
};
