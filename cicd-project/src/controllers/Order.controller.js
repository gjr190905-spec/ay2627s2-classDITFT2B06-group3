const createError = require('http-errors');
const {
  listOrders,
  getOrder,
  getOrderByNumber,
  placeOrder,
  advanceOrder,
  collectOrder,
  getOrderStats,
} = require('../models/Vendor.order.model');
const { parseVendorId: parseId } = require('./Vendor.controller');
const { validateCheckoutPayload } = require('./Menu.controller');

const CUSTOMER_NAME_MAX_LENGTH = 60;
const WINDOW_MIN_MINUTES = 5;
const WINDOW_MAX_MINUTES = 120;
const MINUTE = 60 * 1000;
const BOOK_AHEAD_DAYS = 7;
const BOOK_BEHIND_HOURS = 12;
const NEXT_STATUSES = ['PREPARING', 'READY'];
const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COLLECTED: 'Collected',
  CANCELLED: 'Cancelled',
};

// ── Validators ───────────────────────────────────────────

/**
 * ?date=YYYY-MM-DD (a real calendar date), or nothing for today.
 * @returns {{error: string} | {value: string|null}}
 */
function validateDate(raw) {
  if (raw === undefined || raw === '') return { value: null };
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: 'date must look like 2026-11-20' };
  }
  const [y, m, d] = raw.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return { error: 'date is not a real calendar date' };
  }
  return { value: raw };
}

/**
 * An order number: a whole number from 1 to 999999 (given as a number or text).
 * @returns {number|null}
 */
function parseOrderNumber(raw) {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d{1,6}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= 1 ? value : null;
}

/**
 * The body of POST /vendors/:vendorId/orders (a student placing an order).
 * { customerName?, pickupWindowStart, pickupWindowEnd, items: [{ itemId, quantity }] }
 *
 * The window must be 5–120 minutes long and start between 12 hours ago and 7 days ahead.
 *
 * @param {object} body
 * @param {Date} now
 * @returns {{error: string} | {input: object}}
 */
function validateNewOrder(body, now = new Date()) {
  const input = body || {};

  let customerName = null;
  if (input.customerName !== undefined && input.customerName !== null) {
    if (typeof input.customerName !== 'string') return { error: 'customerName must be text' };
    customerName = input.customerName.replace(/\s+/g, ' ').trim() || null;
    if (customerName && customerName.length > CUSTOMER_NAME_MAX_LENGTH) {
      return { error: `customerName must be ${CUSTOMER_NAME_MAX_LENGTH} characters or fewer` };
    }
    // eslint-disable-next-line no-control-regex
    if (customerName && /[\u0000-\u001f\u007f<>]/.test(customerName)) {
      return { error: 'customerName contains characters that are not allowed' };
    }
  }

  const start = new Date(input.pickupWindowStart);
  const end = new Date(input.pickupWindowEnd);
  if (
    typeof input.pickupWindowStart !== 'string' ||
    typeof input.pickupWindowEnd !== 'string' ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return { error: 'pickupWindowStart and pickupWindowEnd must be dates and times' };
  }
  const minutes = (end.getTime() - start.getTime()) / MINUTE;
  if (minutes < WINDOW_MIN_MINUTES || minutes > WINDOW_MAX_MINUTES) {
    return {
      error: `The pickup window must be ${WINDOW_MIN_MINUTES} to ${WINDOW_MAX_MINUTES} minutes long`,
    };
  }
  const earliest = now.getTime() - BOOK_BEHIND_HOURS * 60 * MINUTE;
  const latest = now.getTime() + BOOK_AHEAD_DAYS * 24 * 60 * MINUTE;
  if (start.getTime() < earliest || start.getTime() > latest) {
    return { error: `The pickup window must start within the next ${BOOK_AHEAD_DAYS} days` };
  }

  const basket = validateCheckoutPayload(input);
  if (basket.error) return basket;

  return {
    input: { customerName, pickupWindowStart: start, pickupWindowEnd: end, lines: basket.lines },
  };
}

/**
 * The body of POST .../collect. The vendor confirms the three handover checks:
 * the order number the student showed, that payment was taken, and that the food
 * was handed over.
 *
 * @returns {{error: string} | {orderNumber: number}}
 */
function validateCollection(body) {
  const input = body || {};
  const orderNumber = parseOrderNumber(input.orderNumber);
  if (orderNumber === null) {
    return { error: "Enter the order number on the student's screen" };
  }
  if (input.paymentReceived !== true) {
    return { error: 'Confirm that payment was taken before marking it collected' };
  }
  if (input.foodHandedOver !== true) {
    return { error: 'Confirm that the food was handed over before marking it collected' };
  }
  return { orderNumber };
}

// ── Helpers ──────────────────────────────────────────────

function readIds(req, next) {
  const vendorId = parseId(req.params.vendorId);
  if (vendorId === null) {
    next(createError(400, 'Vendor id must be a positive integer'));
    return null;
  }
  if (req.params.orderId === undefined) return { vendorId };
  const orderId = parseId(req.params.orderId);
  if (orderId === null) {
    next(createError(400, 'Order id must be a positive integer'));
    return null;
  }
  return { vendorId, orderId };
}

function formatTimeSg(date) {
  return date.toLocaleTimeString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });
}

const ORDER_NOT_FOUND = 'Order not found';

// ── Handlers ─────────────────────────────────────────────

// GET /vendors/:vendorId/orders?date=YYYY-MM-DD
// The day's orders grouped by pickup window, earliest window first.
function getOrders(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const date = validateDate(req.query.date);
  if (date.error) return next(createError(400, date.error));

  return listOrders(ids.vendorId, date.value)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result);
    })
    .catch(next);
}

// GET /vendors/:vendorId/orders/stats?date=YYYY-MM-DD
function getStats(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const date = validateDate(req.query.date);
  if (date.error) return next(createError(400, date.error));

  return getOrderStats(ids.vendorId, date.value)
    .then((stats) => {
      if (!stats) return next(createError(404, 'Vendor not found'));
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(stats);
    })
    .catch(next);
}

// GET /vendors/:vendorId/orders/number/:orderNumber
// Find an order by the number the student shows at the stall.
function findOrderByNumber(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const orderNumber = parseOrderNumber(req.params.orderNumber);
  if (orderNumber === null) {
    return next(createError(400, 'Order number must be a whole number, e.g. 1042'));
  }

  return getOrderByNumber(ids.vendorId, orderNumber)
    .then((order) => {
      if (!order) return next(createError(404, `No order #${orderNumber} at your stall`));
      return res.status(200).json(order);
    })
    .catch(next);
}

// GET /vendors/:vendorId/orders/:orderId
function getOneOrder(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return getOrder(ids.vendorId, ids.orderId)
    .then((order) => {
      if (!order) return next(createError(404, ORDER_NOT_FOUND));
      return res.status(200).json(order);
    })
    .catch(next);
}

// POST /vendors/:vendorId/orders  (a student placing a pickup order)
// 201 with the order, or 409 { error, problems } like checkout validation.
function createOrder(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const payload = validateNewOrder(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return placeOrder(ids.vendorId, payload.input)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      if (result.problems) {
        return res.status(409).json({
          error: 'Some items in your basket cannot be ordered',
          problems: result.problems,
        });
      }
      return res.status(201).json(result.order);
    })
    .catch(next);
}

// PATCH /vendors/:vendorId/orders/:orderId/status   body: { status: 'PREPARING' | 'READY' }
function changeStatus(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const status = req.body && req.body.status;
  if (!NEXT_STATUSES.includes(status)) {
    return next(createError(400, 'status must be PREPARING or READY'));
  }

  return advanceOrder(ids.vendorId, ids.orderId, status)
    .then((result) => {
      if (!result) return next(createError(404, ORDER_NOT_FOUND));
      if (result.currentStatus) {
        return next(
          createError(
            409,
            `This order is ${STATUS_LABEL[result.currentStatus]}, so it can't be moved to ${STATUS_LABEL[status]}`,
          ),
        );
      }
      return res.status(200).json(result.order);
    })
    .catch(next);
}

// POST /vendors/:vendorId/orders/:orderId/collect
// body: { orderNumber, paymentReceived: true, foodHandedOver: true }
function collect(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;
  const payload = validateCollection(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return collectOrder(ids.vendorId, ids.orderId, payload.orderNumber)
    .then((result) => {
      if (!result) return next(createError(404, ORDER_NOT_FOUND));
      if (result.alreadyCollected) {
        const at = formatTimeSg(result.alreadyCollected.collectedAt);
        return next(createError(409, `This order was already collected at ${at}`));
      }
      if (result.notReady) {
        return next(
          createError(
            409,
            `This order is ${STATUS_LABEL[result.notReady]}. Only Ready orders can be collected.`,
          ),
        );
      }
      if (result.numberMismatch) {
        return next(
          createError(
            409,
            `#${payload.orderNumber} doesn't match this order (#${result.numberMismatch}). Check the student's screen again.`,
          ),
        );
      }
      return res.status(200).json(result.order);
    })
    .catch(next);
}

module.exports = {
  CUSTOMER_NAME_MAX_LENGTH,
  WINDOW_MIN_MINUTES,
  WINDOW_MAX_MINUTES,
  validateDate,
  parseOrderNumber,
  validateNewOrder,
  validateCollection,
  getOrders,
  getStats,
  findOrderByNumber,
  getOneOrder,
  createOrder,
  changeStatus,
  collect,
};
