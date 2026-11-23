const createError = require('http-errors');
const {
  CLOSURE_REASONS,
  getVendorById,
  setVendorOpenStatus,
  updateVendorStallName,
  updateVendorLogo,
  getVendorLogo,
} = require('../models/Vendor.model');

const OTHER_REASON_MAX_LENGTH = 255;
const VALID_REASON_CODES = CLOSURE_REASONS.map((r) => r.code);

const STALL_NAME_MIN_LENGTH = 2;
const STALL_NAME_MAX_LENGTH = 40;
const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB after decoding (the page shrinks images first)

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

/**
 * Validate the body of PATCH /vendors/:id/profile.
 * Trims and collapses repeated spaces so "Chicken  Rice " and "Chicken Rice" are the same name.
 *
 * @returns {{error: string} | {stallName: string}}
 */
function validateProfilePayload(body) {
  const raw = body && body.stallName;
  if (typeof raw !== 'string') {
    return { error: 'stallName must be text' };
  }

  const stallName = raw.replace(/\s+/g, ' ').trim();
  if (stallName.length < STALL_NAME_MIN_LENGTH) {
    return { error: `Shop name must be at least ${STALL_NAME_MIN_LENGTH} characters` };
  }
  if (stallName.length > STALL_NAME_MAX_LENGTH) {
    return { error: `Shop name must be ${STALL_NAME_MAX_LENGTH} characters or fewer` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(stallName)) {
    return { error: 'Shop name contains characters that are not allowed' };
  }
  return { stallName };
}

/**
 * Work out the real image type from the first bytes of the file (the browser-supplied
 * type can be faked). Returns the MIME type, or null if it is not PNG/JPEG/WebP.
 */
function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Validate the body of PUT /vendors/:id/logo. Expects { image: "data:image/...;base64,...." }.
 *
 * @returns {{error: string} | {buffer: Buffer, mimeType: string}}
 */
function validateLogoPayload(body) {
  const image = body && body.image;
  const match =
    typeof image === 'string'
      ? /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(image)
      : null;
  if (!match) {
    return { error: 'image must be a base64 image data URL' };
  }

  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length === 0) {
    return { error: 'Image is empty' };
  }
  if (buffer.length > LOGO_MAX_BYTES) {
    return { error: 'Image is too large (max 1 MB)' };
  }

  const mimeType = detectImageType(buffer);
  if (!mimeType) {
    return { error: 'Image must be a PNG, JPEG or WebP file' };
  }
  return { buffer, mimeType };
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
      if (result.inactive) {
        return next(
          createError(409, 'This stall has been deactivated by an admin, so it cannot be opened'),
        );
      }
      if (!result.changed) {
        const state = payload.isOpen ? 'open' : 'closed';
        return next(createError(409, `Stall is already ${state}`));
      }
      return res.status(200).json(result.vendor);
    })
    .catch(next);
}

// PATCH /vendors/:id/profile
function updateVendorProfile(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  const payload = validateProfilePayload(req.body);
  if (payload.error) {
    return next(createError(400, payload.error));
  }

  return updateVendorStallName(id, payload.stallName)
    .then((vendor) => {
      if (vendor === undefined) {
        return next(createError(404, 'Vendor not found'));
      }
      if (vendor === null) {
        return next(createError(409, 'That shop name is already taken. Please choose another.'));
      }
      return res.status(200).json(vendor);
    })
    .catch(next);
}

// PUT /vendors/:id/logo
// The picture is saved in the database ("VendorLogo"), not as a file in the project.
function updateVendorLogoImage(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  const payload = validateLogoPayload(req.body);
  if (payload.error) {
    return next(createError(400, payload.error));
  }

  return updateVendorLogo(id, payload.buffer, payload.mimeType)
    .then((vendor) => {
      if (!vendor) {
        return next(createError(404, 'Vendor not found'));
      }
      return res.status(200).json(vendor);
    })
    .catch(next);
}

// GET /vendors/:id/logo
// Sends the stored picture itself, so it can be used directly as an <img> src.
function getVendorLogoImage(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  return getVendorLogo(id)
    .then((logo) => {
      if (!logo) {
        return next(createError(404, 'This vendor has no profile picture'));
      }
      res.set({
        'Content-Type': logo.mimeType,
        'Content-Length': logo.data.length,
        'Last-Modified': logo.updatedAt.toUTCString(),
        'X-Content-Type-Options': 'nosniff',
        // The page links to /logo?v=<upload time>, which changes on every upload, so a
        // versioned address can be cached for good. Without ?v=, always check for a newer one.
        'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      return res.status(200).send(logo.data);
    })
    .catch(next);
}

module.exports = {
  OTHER_REASON_MAX_LENGTH,
  STALL_NAME_MIN_LENGTH,
  STALL_NAME_MAX_LENGTH,
  LOGO_MAX_BYTES,
  parseVendorId,
  validateStatusPayload,
  validateProfilePayload,
  validateLogoPayload,
  detectImageType,
  getClosureReasons,
  getVendor,
  updateVendorStatus,
  updateVendorProfile,
  updateVendorLogoImage,
  getVendorLogoImage,
};
