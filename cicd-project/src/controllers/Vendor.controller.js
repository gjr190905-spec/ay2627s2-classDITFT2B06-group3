const fs = require('fs/promises');
const path = require('path');
const createError = require('http-errors');
const {
  CLOSURE_REASONS,
  getVendorById,
  setVendorOpenStatus,
  updateVendorStallName,
  updateVendorLogo,
} = require('../models/Vendor.model');

const OTHER_REASON_MAX_LENGTH = 255;
const VALID_REASON_CODES = CLOSURE_REASONS.map((r) => r.code);

const STALL_NAME_MIN_LENGTH = 2;
const STALL_NAME_MAX_LENGTH = 40;
const LOGO_MAX_BYTES = 1024 * 1024; // 1 MB after decoding (the page shrinks images first)
const UPLOAD_URL_PREFIX = '/uploads/vendors/';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'vendors');

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
 * type can be faked). Returns the file extension, or null if it is not PNG/JPEG/WebP.
 */
function detectImageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Validate the body of PUT /vendors/:id/logo. Expects { image: "data:image/...;base64,...." }.
 *
 * @returns {{error: string} | {buffer: Buffer, extension: string}}
 */
function validateLogoPayload(body) {
  const image = body && body.image;
  const match = typeof image === 'string' ? /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
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

  const extension = detectImageExtension(buffer);
  if (!extension) {
    return { error: 'Image must be a PNG, JPEG or WebP file' };
  }
  return { buffer, extension };
}

// Delete an old picture file we saved earlier. Never touches anything outside the upload folder.
async function removeStoredLogo(logoUrl) {
  if (typeof logoUrl !== 'string' || !logoUrl.startsWith(UPLOAD_URL_PREFIX)) return;
  const fileName = path.basename(logoUrl);
  try {
    await fs.unlink(path.join(UPLOAD_DIR, fileName));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not remove old logo:', error.message);
  }
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
async function updateVendorLogoImage(req, res, next) {
  const id = parseVendorId(req.params.id);
  if (id === null) {
    return next(createError(400, 'Vendor id must be a positive integer'));
  }

  const payload = validateLogoPayload(req.body);
  if (payload.error) {
    return next(createError(400, payload.error));
  }

  // A new file name each time means browsers never show a cached old picture
  const fileName = `vendor-${id}-${Date.now()}.${payload.extension}`;
  const logoUrl = `${UPLOAD_URL_PREFIX}${fileName}`;

  try {
    const existing = await getVendorById(id);
    if (!existing) {
      return next(createError(404, 'Vendor not found'));
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOAD_DIR, fileName), payload.buffer);

    let result;
    try {
      result = await updateVendorLogo(id, logoUrl);
    } catch (dbError) {
      await removeStoredLogo(logoUrl); // don't leave an orphan file behind
      throw dbError;
    }
    if (!result) {
      await removeStoredLogo(logoUrl);
      return next(createError(404, 'Vendor not found'));
    }

    // Only one picture may exist: remove the previous one now the new one is saved
    await removeStoredLogo(result.previousLogoUrl);
    return res.status(200).json(result.vendor);
  } catch (error) {
    return next(error);
  }
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
  getClosureReasons,
  getVendor,
  updateVendorStatus,
  updateVendorProfile,
  updateVendorLogoImage,
};
