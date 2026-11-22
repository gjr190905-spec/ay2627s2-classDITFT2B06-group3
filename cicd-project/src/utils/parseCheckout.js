const parseId = require('./parseId');
const { mapError, ERROR_CODES } = require('./errors');

const MAX_QUANTITY = 20;
const MAX_LINES = 30;

const invalid = (message) => mapError(ERROR_CODES.INVALID_INPUT, message);

module.exports = function parseCheckoutBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Request body must be a JSON object.');
  }

  const stallId = parseId(body.stallId);
  if (stallId === null) throw invalid('stallId is missing or invalid.');

  const pickupWindowId = parseId(body.pickupWindowId);
  if (pickupWindowId === null) throw invalid('pickupWindowId is missing or invalid.');

  const { items: rawItems } = body;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_LINES) {
    throw invalid(`items must be an array of 1 to ${MAX_LINES} lines.`);
  }

  const quantities = new Map();
  rawItems.forEach((line, i) => {
    const menuItemId = parseId(line?.menuItemId);
    if (menuItemId === null) {
      throw invalid(`items[${i}].menuItemId is missing or invalid.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw invalid(`items[${i}].quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    quantities.set(menuItemId, (quantities.get(menuItemId) ?? 0) + line.quantity);
  });

  const items = [];
  for (const [menuItemId, quantity] of quantities) {
    if (quantity > MAX_QUANTITY) {
      throw invalid(`Total quantity for menu item ${menuItemId} cannot exceed ${MAX_QUANTITY}.`);
    }
    items.push({ menuItemId, quantity });
  }

  return { stallId, pickupWindowId, items };
};