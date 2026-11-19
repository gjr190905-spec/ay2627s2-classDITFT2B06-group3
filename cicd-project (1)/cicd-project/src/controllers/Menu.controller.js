const createError = require('http-errors');
const {
  getMenu,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  setMenuItemAvailability,
  deleteMenuItem,
  updateMenuItemImage,
  deleteMenuItemImage,
  getMenuItemImage,
  updateMenuBanner,
  deleteMenuBanner,
  getMenuBanner,
  checkCheckoutItems,
} = require('../models/Menu.model');
// Same image rules as the profile picture: a base64 data URL, PNG/JPEG/WebP, max 1 MB
const {
  parseVendorId: parseId,
  validateLogoPayload: validateImagePayload,
} = require('./Vendor.controller');

const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 200;
const PRICE_MAX_CENTS = 99999; // $999.99
const QUANTITY_MAX = 9999;
const CHECKOUT_MAX_LINES = 50;
const CHECKOUT_MAX_QUANTITY = 99;

// ── Field validators ─────────────────────────────────────
// Each returns { error } or { value }.

function validateName(raw) {
  if (typeof raw !== 'string') return { error: 'name must be text' };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length === 0) return { error: 'Item name is required' };
  if (value.length > NAME_MAX_LENGTH) {
    return { error: `Item name must be ${NAME_MAX_LENGTH} characters or fewer` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(value)) {
    return { error: 'Item name contains characters that are not allowed' };
  }
  return { value };
}

function validateDescription(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: 'description must be text' };
  const value = raw.trim();
  if (value.length > DESCRIPTION_MAX_LENGTH) {
    return { error: `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f<>]/.test(value)) {
    return { error: 'Description contains characters that are not allowed' };
  }
  return { value: value === '' ? null : value };
}

/**
 * Price in dollars, as a number (4.5) or text ("4.50"), with at most 2 decimal places.
 * Returned in cents so no rounding errors creep in.
 */
function validatePrice(raw) {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) {
    return { error: 'Price must be a number between 0.01 and 999.99, with up to 2 decimal places' };
  }
  const [dollars, cents = ''] = text.trim().split('.');
  const value = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  if (value < 1 || value > PRICE_MAX_CENTS) {
    return { error: 'Price must be between 0.01 and 999.99' };
  }
  return { value };
}

/**
 * How many are left: a whole number 0–9999, or null for "not counting".
 */
function validateQuantity(raw) {
  if (raw === null) return { value: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > QUANTITY_MAX) {
    return { error: `Quantity left must be a whole number from 0 to ${QUANTITY_MAX}, or empty` };
  }
  return { value: raw };
}

/**
 * Validate the body of POST /vendors/:vendorId/menu/items.
 * name and price are required; description and quantityLeft are optional.
 *
 * @returns {{error: string} | {fields: object}}
 */
function validateNewItem(body) {
  const input = body || {};
  const name = validateName(input.name);
  if (name.error) return name;
  const description = validateDescription(input.description);
  if (description.error) return description;
  const price = validatePrice(input.price);
  if (price.error) return price;
  const quantity = validateQuantity(input.quantityLeft === undefined ? null : input.quantityLeft);
  if (quantity.error) return quantity;

  return {
    fields: {
      name: name.value,
      description: description.value,
      priceCents: price.value,
      quantityLeft: quantity.value,
    },
  };
}

/**
 * Validate the body of PATCH /vendors/:vendorId/menu/items/:itemId.
 * Any of name, description, price, quantityLeft; at least one is needed.
 *
 * @returns {{error: string} | {fields: object}}
 */
function validateItemChanges(body) {
  const input = body || {};
  const fields = {};

  const checks = [
    ['name', 'name', validateName],
    ['description', 'description', validateDescription],
    ['price', 'priceCents', validatePrice],
    ['quantityLeft', 'quantityLeft', validateQuantity],
  ];
  for (const [key, column, validate] of checks) {
    if (input[key] !== undefined) {
      const result = validate(input[key]);
      if (result.error) return result;
      fields[column] = result.value;
    }
  }

  if (Object.keys(fields).length === 0) {
    return { error: 'Send at least one of: name, description, price, quantityLeft' };
  }
  return { fields };
}

/**
 * Validate the body of POST /vendors/:vendorId/menu/checkout-check.
 * { items: [{ itemId, quantity }, ...] } – the same item twice is added together.
 *
 * @returns {{error: string} | {lines: {itemId: number, quantity: number}[]}}
 */
function validateCheckoutPayload(body) {
  const items = body && body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'items must be a list with at least one item' };
  }
  if (items.length > CHECKOUT_MAX_LINES) {
    return { error: `A basket can have at most ${CHECKOUT_MAX_LINES} lines` };
  }

  const totals = new Map();
  for (const line of items) {
    const itemId = parseId(line && line.itemId);
    const quantity = line && line.quantity;
    if (itemId === null) return { error: 'Each itemId must be a positive integer' };
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: 'Each quantity must be a whole number of at least 1' };
    }
    totals.set(itemId, (totals.get(itemId) || 0) + quantity);
  }

  const lines = [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
  if (lines.some((line) => line.quantity > CHECKOUT_MAX_QUANTITY)) {
    return { error: `You can order at most ${CHECKOUT_MAX_QUANTITY} of one item` };
  }
  return { lines };
}

// ── Helpers for handlers ─────────────────────────────────

/**
 * Read :vendorId (and :itemId when the route has one). Calls next(400) and returns null
 * if either is not a positive integer.
 */
function readIds(req, next) {
  const vendorId = parseId(req.params.vendorId);
  if (vendorId === null) {
    next(createError(400, 'Vendor id must be a positive integer'));
    return null;
  }
  if (req.params.itemId === undefined) return { vendorId };

  const itemId = parseId(req.params.itemId);
  if (itemId === null) {
    next(createError(400, 'Item id must be a positive integer'));
    return null;
  }
  return { vendorId, itemId };
}

// Send a stored picture so it can be used directly as an <img> src
function sendImage(req, res, image) {
  res.set({
    'Content-Type': image.mimeType,
    'Content-Length': image.data.length,
    'Last-Modified': image.updatedAt.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    // Pages link to ...?v=<upload time>, which changes on every upload, so a versioned
    // address can be cached for good. Without ?v=, always check for a newer one.
    'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  return res.status(200).send(image.data);
}

const ITEM_NOT_FOUND = 'Menu item not found';
const DUPLICATE_NAME = 'You already have an item with that name. Please choose another.';

// ── Handlers ─────────────────────────────────────────────

// GET /vendors/:vendorId/menu
// The stall, its banner and every item with its availability. Used by the vendor's menu
// page and the customer-facing stall page, so both always show the same thing.
function getVendorMenu(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return getMenu(ids.vendorId)
    .then((menu) => {
      if (!menu) return next(createError(404, 'Vendor not found'));
      res.set('Cache-Control', 'no-store'); // availability must always be fresh
      return res.status(200).json(menu);
    })
    .catch(next);
}

// GET /vendors/:vendorId/menu/items/:itemId
function getVendorMenuItem(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return getMenuItem(ids.vendorId, ids.itemId)
    .then((item) => {
      if (!item) return next(createError(404, ITEM_NOT_FOUND));
      return res.status(200).json(item);
    })
    .catch(next);
}

// POST /vendors/:vendorId/menu/items
function addMenuItem(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const payload = validateNewItem(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return createMenuItem(ids.vendorId, payload.fields)
    .then((item) => {
      if (item === undefined) return next(createError(404, 'Vendor not found'));
      if (item === null) return next(createError(409, DUPLICATE_NAME));
      return res.status(201).json(item);
    })
    .catch(next);
}

// PATCH /vendors/:vendorId/menu/items/:itemId
function editMenuItem(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const payload = validateItemChanges(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return updateMenuItem(ids.vendorId, ids.itemId, payload.fields)
    .then((item) => {
      if (item === undefined) return next(createError(404, ITEM_NOT_FOUND));
      if (item === null) return next(createError(409, DUPLICATE_NAME));
      return res.status(200).json(item);
    })
    .catch(next);
}

// PATCH /vendors/:vendorId/menu/items/:itemId/availability   body: { isAvailable: boolean }
// Switching to the state the item is already in is fine (200), so a double click is harmless.
function changeAvailability(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const isAvailable = req.body && req.body.isAvailable;
  if (typeof isAvailable !== 'boolean') {
    return next(createError(400, 'isAvailable must be true or false'));
  }

  return setMenuItemAvailability(ids.vendorId, ids.itemId, isAvailable)
    .then((result) => {
      if (!result) return next(createError(404, ITEM_NOT_FOUND));
      if (result.noneLeft) {
        return next(
          createError(409, 'There are 0 left. Set how many are left to make it available.'),
        );
      }
      return res.status(200).json(result.item);
    })
    .catch(next);
}

// DELETE /vendors/:vendorId/menu/items/:itemId
function removeMenuItem(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return deleteMenuItem(ids.vendorId, ids.itemId)
    .then((deleted) => {
      if (!deleted) return next(createError(404, ITEM_NOT_FOUND));
      return res.status(204).end();
    })
    .catch(next);
}

// PUT /vendors/:vendorId/menu/items/:itemId/image   body: { image: "data:image/...;base64,..." }
function putMenuItemImage(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const payload = validateImagePayload(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return updateMenuItemImage(ids.vendorId, ids.itemId, payload.buffer, payload.mimeType)
    .then((item) => {
      if (!item) return next(createError(404, ITEM_NOT_FOUND));
      return res.status(200).json(item);
    })
    .catch(next);
}

// DELETE /vendors/:vendorId/menu/items/:itemId/image
function removeMenuItemImage(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return deleteMenuItemImage(ids.vendorId, ids.itemId)
    .then((item) => {
      if (!item) return next(createError(404, ITEM_NOT_FOUND));
      return res.status(200).json(item);
    })
    .catch(next);
}

// GET /vendors/:vendorId/menu/items/:itemId/image
function sendMenuItemImage(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return getMenuItemImage(ids.vendorId, ids.itemId)
    .then((image) => {
      if (!image) return next(createError(404, 'This item has no photo'));
      return sendImage(req, res, image);
    })
    .catch(next);
}

// PUT /vendors/:vendorId/menu/banner   body: { image: "data:image/...;base64,..." }
function putMenuBanner(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const payload = validateImagePayload(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return updateMenuBanner(ids.vendorId, payload.buffer, payload.mimeType)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      return res.status(200).json(result);
    })
    .catch(next);
}

// DELETE /vendors/:vendorId/menu/banner
function removeMenuBanner(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return deleteMenuBanner(ids.vendorId)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      return res.status(200).json(result);
    })
    .catch(next);
}

// GET /vendors/:vendorId/menu/banner
function sendMenuBanner(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  return getMenuBanner(ids.vendorId)
    .then((image) => {
      if (!image) return next(createError(404, 'This stall has no menu banner'));
      return sendImage(req, res, image);
    })
    .catch(next);
}

// POST /vendors/:vendorId/menu/checkout-check   body: { items: [{ itemId, quantity }] }
// 200 { ok: true, items, totalCents } when the basket can be ordered,
// 409 { error, problems } when something is sold out, short, gone, or the stall is closed.
function checkCheckout(req, res, next) {
  const ids = readIds(req, next);
  if (!ids) return undefined;

  const payload = validateCheckoutPayload(req.body);
  if (payload.error) return next(createError(400, payload.error));

  return checkCheckoutItems(ids.vendorId, payload.lines)
    .then((result) => {
      if (!result) return next(createError(404, 'Vendor not found'));
      if (!result.ok) {
        return res.status(409).json({
          error: 'Some items in your basket cannot be ordered',
          problems: result.problems,
        });
      }
      return res.status(200).json({ ok: true, items: result.items, totalCents: result.totalCents });
    })
    .catch(next);
}

module.exports = {
  NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PRICE_MAX_CENTS,
  QUANTITY_MAX,
  CHECKOUT_MAX_LINES,
  CHECKOUT_MAX_QUANTITY,
  validateName,
  validateDescription,
  validatePrice,
  validateQuantity,
  validateNewItem,
  validateItemChanges,
  validateCheckoutPayload,
  getVendorMenu,
  getVendorMenuItem,
  addMenuItem,
  editMenuItem,
  changeAvailability,
  removeMenuItem,
  putMenuItemImage,
  removeMenuItemImage,
  sendMenuItemImage,
  putMenuBanner,
  removeMenuBanner,
  sendMenuBanner,
  checkCheckout,
};
