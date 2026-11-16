const createError = require('http-errors');
const { CLOSURE_REASONS, getVendorById, setVendorOpenStatus } = require('../models/Vendor.model');

const OTHER_REASON_MAX_LENGTH = 255;
const VALID_REASON_CODES = CLOSURE_REASONS.map((r) => r.code);

/**
 * Parse a route id. Returns a positive integer, or null if the value is not one.
 */
function parseVendorId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Validate the body of PATCH /vendors/:id/status.
 * Opening needs no reason. Closing needs a valid reason, and 'OTHER' needs typed text.
 *
 * @returns {{error: string} | {isOpen: boolean, closure: object|null}}
 */
function validateStatusPayload(body) {
  const { isOpen, reason, otherReason } = body || {};

  if (typeof isOpen !== 'boolean') {
    return { error: 'isOpen must be true or false' };
  }

  // Opening the stall: no questions asked
  if (isOpen) {
    return { isOpen, closure: null };
  }

  if (!VALID_REASON_CODES.includes(reason)) {
    return { error: `reason must be one of: ${VALID_REASON_CODES.join(', ')}` };
  }

  if (reason !== 'OTHER') {
    return { isOpen, closure: { reason, otherReason: null } };
  }

  const text = typeof otherReason === 'string' ? otherReason.trim() : '';
  if (text.length === 0) {
    return { error: 'Please type a reason when choosing Other' };
  }
  if (text.length > OTHER_REASON_MAX_LENGTH) {
    return { error: `Reason must be ${OTHER_REASON_MAX_LENGTH} characters or fewer` };
  }

  return { isOpen, closure: { reason, otherReason: text } };
}

// GET /vendors/closure-reasons
function getClosureReasons(req, res) {
  res.status(200).json(CLOSURE_REASONS);
}

// GET /vendors/:id
function getVendor(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  return getVendorById(id)
    .then((vendor) => {
      if (!vendor) {
        return next(createError(404, 'Vendor not found'));
      }
      return res.status(200).json(vendor);
    })
    .catch(next);
}

// PATCH /vendors/:id/status
function updateVendorStatus(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  const payload = validateStatusPayload(req.body);
  if (payload.error) {
    return next(createError(400, payload.error));
  }

  return setVendorOpenStatus(id, payload.isOpen, payload.closure)
    .then((result) => {
      if (!result) {
        return next(createError(404, 'Vendor not found'));
      }
      if (!result.changed) {
        const state = payload.isOpen ? 'open' : 'closed';
        return next(createError(409, `Stall is already ${state}`));
      }
      return res.status(200).json(result.vendor);
    })
    .catch(next);
}

module.exports = {
  OTHER_REASON_MAX_LENGTH,
  parseVendorId,
  validateStatusPayload,
  getClosureReasons,
  getVendor,
  updateVendorStatus,
};
