const model = require('../../src/models/Vendor.model');
const {
  OTHER_REASON_MAX_LENGTH,
  parseVendorId,
  validateStatusPayload,
  getClosureReasons,
  getVendor,
  updateVendorStatus,
  LOGO_MAX_BYTES,
  detectImageType,
  validateLogoPayload,
  updateVendorLogoImage,
  getVendorLogoImage,
} = require('../../src/controllers/Vendor.controller');

// ── Mocking ──────────────────────────────────────────────
// Keep the real CLOSURE_REASONS; mock only the DB-touching functions.
jest.mock('../../src/models/Vendor.model', () => ({
  ...jest.requireActual('../../src/models/Vendor.model'),
  getVendorById: jest.fn(),
  setVendorOpenStatus: jest.fn(),
  updateVendorLogo: jest.fn(),
  getVendorLogo: jest.fn(),
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
}

/** Call a controller and wait for it to finish, returning res and next. */
async function run(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next };
}

const vendor = { id: 1, stallName: 'Ah Seng', logoUrl: null, isOpen: true };

beforeEach(() => jest.clearAllMocks());

// ── parseVendorId ────────────────────────────────────────
describe('Vendor.controller - parseVendorId', () => {
  // Valid partition: positive integer string
  test('should parse a positive integer', () => {
    expect(parseVendorId('7')).toBe(7);
  });

  // Boundary: 1 is the smallest valid id; 0 and negatives are not
  test.each([
    ['1', 1],
    ['0', null],
    ['-1', null],
  ])('parseVendorId(%p) should be %p (boundary)', (raw, expected) => {
    expect(parseVendorId(raw)).toBe(expected);
  });

  // Invalid partition: non-numeric and decimal input
  test.each(['abc', '1.5', '', undefined])('should reject %p', (raw) => {
    expect(parseVendorId(raw)).toBeNull();
  });
});

// ── validateStatusPayload ────────────────────────────────
describe('Vendor.controller - validateStatusPayload', () => {
  // Valid partition: opening needs no reason (spec: "no questions should be asked")
  test('should accept opening without a reason', () => {
    expect(validateStatusPayload({ isOpen: true })).toEqual({ isOpen: true, closure: null });
  });

  // Valid partition: opening ignores any reason fields that are sent
  test('should ignore reason fields when opening', () => {
    expect(validateStatusPayload({ isOpen: true, reason: 'OTHER' })).toEqual({
      isOpen: true,
      closure: null,
    });
  });

  // Valid partition: closing with a listed reason
  test('should accept closing with a listed reason and drop otherReason', () => {
    expect(validateStatusPayload({ isOpen: false, reason: 'SOLD_OUT', otherReason: 'x' })).toEqual({
      isOpen: false,
      closure: { reason: 'SOLD_OUT', otherReason: null },
    });
  });

  // Valid partition: closing with OTHER + typed text (trimmed)
  test('should accept OTHER with typed text and trim it', () => {
    expect(
      validateStatusPayload({ isOpen: false, reason: 'OTHER', otherReason: '  Gas ran out  ' }),
    ).toEqual({ isOpen: false, closure: { reason: 'OTHER', otherReason: 'Gas ran out' } });
  });

  // Invalid partition: isOpen missing / not a boolean
  test.each([undefined, null, {}, { isOpen: 'false' }, { isOpen: 0 }])(
    'should reject body %p without a boolean isOpen',
    (body) => {
      expect(validateStatusPayload(body).error).toMatch(/isOpen/);
    },
  );

  // Invalid partition: closing with no reason or an unknown reason
  test.each([undefined, '', 'HOLIDAY', 'other'])('should reject closing with reason %p', (r) => {
    expect(validateStatusPayload({ isOpen: false, reason: r }).error).toMatch(/reason must be/);
  });

  // Boundary: OTHER with empty / whitespace-only / non-string text
  test.each([undefined, '', '   ', 42])('should reject OTHER with otherReason %p', (text) => {
    expect(
      validateStatusPayload({ isOpen: false, reason: 'OTHER', otherReason: text }).error,
    ).toMatch(/type a reason/i);
  });

  // Boundary: exactly the max length passes, one over fails
  test('should accept otherReason at the max length (boundary)', () => {
    const text = 'a'.repeat(OTHER_REASON_MAX_LENGTH);
    expect(
      validateStatusPayload({ isOpen: false, reason: 'OTHER', otherReason: text }).closure
        .otherReason,
    ).toHaveLength(OTHER_REASON_MAX_LENGTH);
  });

  test('should reject otherReason one over the max length (boundary)', () => {
    const text = 'a'.repeat(OTHER_REASON_MAX_LENGTH + 1);
    expect(
      validateStatusPayload({ isOpen: false, reason: 'OTHER', otherReason: text }).error,
    ).toMatch(/characters or fewer/);
  });
});

// ── getClosureReasons ────────────────────────────────────
describe('Vendor.controller - getClosureReasons', () => {
  // Valid partition: returns the model's reason list
  test('should respond 200 with the reason list', async () => {
    const { res } = await run(getClosureReasons, {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(model.CLOSURE_REASONS);
  });
});

// ── getVendor ────────────────────────────────────────────
describe('Vendor.controller - getVendor', () => {
  // Valid partition: existing vendor
  test('should respond 200 with the vendor', async () => {
    model.getVendorById.mockResolvedValue(vendor);

    const { res, next } = await run(getVendor, { params: { id: '1' } });

    expect(model.getVendorById).toHaveBeenCalledWith(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(vendor);
    expect(next).not.toHaveBeenCalled();
  });

  // Invalid partition: bad id never reaches the model
  test('should pass a 400 error for an invalid id', async () => {
    const { next } = await run(getVendor, { params: { id: 'abc' } });

    expect(model.getVendorById).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].status).toBe(400);
  });

  // Boundary: unknown id
  test('should pass a 404 error when the vendor does not exist', async () => {
    model.getVendorById.mockResolvedValue(undefined);

    const { next } = await run(getVendor, { params: { id: '999' } });

    expect(next.mock.calls[0][0].status).toBe(404);
  });

  // Error handling: model errors go to the error handler
  test('should pass model errors to next', async () => {
    const err = new Error('db down');
    model.getVendorById.mockRejectedValue(err);

    const { next } = await run(getVendor, { params: { id: '1' } });

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── updateVendorStatus ───────────────────────────────────
describe('Vendor.controller - updateVendorStatus', () => {
  // Valid partition: closing with a reason
  test('should respond 200 with the updated vendor when closing', async () => {
    const closed = { ...vendor, isOpen: false };
    model.setVendorOpenStatus.mockResolvedValue({ vendor: closed, changed: true });

    const { res } = await run(updateVendorStatus, {
      params: { id: '1' },
      body: { isOpen: false, reason: 'BREAK' },
    });

    expect(model.setVendorOpenStatus).toHaveBeenCalledWith(1, false, {
      reason: 'BREAK',
      otherReason: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(closed);
  });

  // Valid partition: opening
  test('should respond 200 when opening', async () => {
    model.setVendorOpenStatus.mockResolvedValue({ vendor, changed: true });

    const { res } = await run(updateVendorStatus, { params: { id: '1' }, body: { isOpen: true } });

    expect(model.setVendorOpenStatus).toHaveBeenCalledWith(1, true, null);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Invalid partition: bad id
  test('should pass a 400 error for an invalid id', async () => {
    const { next } = await run(updateVendorStatus, {
      params: { id: '0' },
      body: { isOpen: true },
    });

    expect(next.mock.calls[0][0].status).toBe(400);
    expect(model.setVendorOpenStatus).not.toHaveBeenCalled();
  });

  // Invalid partition: bad body
  test('should pass a 400 error for an invalid body', async () => {
    const { next } = await run(updateVendorStatus, {
      params: { id: '1' },
      body: { isOpen: false },
    });

    expect(next.mock.calls[0][0].status).toBe(400);
    expect(model.setVendorOpenStatus).not.toHaveBeenCalled();
  });

  // Boundary: unknown vendor
  test('should pass a 404 error when the vendor does not exist', async () => {
    model.setVendorOpenStatus.mockResolvedValue(undefined);

    const { next } = await run(updateVendorStatus, {
      params: { id: '999' },
      body: { isOpen: true },
    });

    expect(next.mock.calls[0][0].status).toBe(404);
  });

  // Boundary: already in the requested state
  test.each([
    [true, 'open'],
    [false, 'closed'],
  ])('should pass a 409 error when isOpen=%p and stall is already %s', async (isOpen, word) => {
    model.setVendorOpenStatus.mockResolvedValue({ vendor, changed: false });

    const { next } = await run(updateVendorStatus, {
      params: { id: '1' },
      body: { isOpen, reason: 'BREAK' },
    });

    const err = next.mock.calls[0][0];
    expect(err.status).toBe(409);
    expect(err.message).toBe(`Stall is already ${word}`);
  });

  // Error handling: model errors go to the error handler
  test('should pass model errors to next', async () => {
    const err = new Error('db down');
    model.setVendorOpenStatus.mockRejectedValue(err);

    const { next } = await run(updateVendorStatus, {
      params: { id: '1' },
      body: { isOpen: true },
    });

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── Picture helpers ──────────────────────────────────────
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

function dataUrl(buffer, type = 'image/png') {
  return `data:${type};base64,${buffer.toString('base64')}`;
}

// ── detectImageType ──────────────────────────────────────
describe('Vendor.controller - detectImageType', () => {
  // Valid partitions: the three allowed formats are recognised from their bytes
  test.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ])('should recognise %s', (_name, buffer, type) => {
    expect(detectImageType(buffer)).toBe(type);
  });

  // Invalid partition: anything else, including too-short data
  test.each([
    ['text', Buffer.from('hello world!')],
    ['GIF', Buffer.from('GIF89a......')],
    ['2 bytes', Buffer.from([0xff, 0xd8])],
  ])('should reject %s', (_name, buffer) => {
    expect(detectImageType(buffer)).toBeNull();
  });
});

// ── validateLogoPayload ──────────────────────────────────
describe('Vendor.controller - validateLogoPayload', () => {
  // Valid partition: a real image data URL
  test('should accept a PNG data URL and report its real type', () => {
    const result = validateLogoPayload({ image: dataUrl(PNG) });

    expect(result.error).toBeUndefined();
    expect(result.mimeType).toBe('image/png');
    expect(result.buffer.equals(PNG)).toBe(true);
  });

  // Invalid partition: the declared type is ignored; the bytes decide
  test('should use the real type even if the data URL claims another', () => {
    expect(validateLogoPayload({ image: dataUrl(JPEG, 'image/png') }).mimeType).toBe('image/jpeg');
  });

  // Invalid partitions: missing, not a data URL, empty, or not an image
  test.each([
    ['no body', undefined],
    ['no image', {}],
    ['a plain URL', { image: 'https://example.com/a.png' }],
    ['an empty image', { image: 'data:image/png;base64,' }],
    ['padding that decodes to nothing', { image: 'data:image/png;base64,====' }],
    ['text pretending to be an image', { image: dataUrl(Buffer.from('hello there')) }],
  ])('should reject %s', (_name, body) => {
    expect(validateLogoPayload(body).error).toEqual(expect.any(String));
  });

  // Boundary: exactly the size limit is allowed
  test('should accept an image of exactly LOGO_MAX_BYTES', () => {
    const buffer = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES - PNG.length)]);

    expect(validateLogoPayload({ image: dataUrl(buffer) }).error).toBeUndefined();
  });

  // Boundary: one byte over the limit is refused
  test('should reject an image one byte over LOGO_MAX_BYTES', () => {
    const buffer = Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES - PNG.length + 1)]);

    expect(validateLogoPayload({ image: dataUrl(buffer) }).error).toMatch(/too large/);
  });
});

// ── updateVendorLogoImage ────────────────────────────────
describe('Vendor.controller - updateVendorLogoImage', () => {
  // Valid partition: picture goes to the model (database), not to a file
  test('should save the picture through the model and respond 200', async () => {
    const saved = { ...vendor, logoUrl: '/vendors/1/logo?v=1' };
    model.updateVendorLogo.mockResolvedValue(saved);

    const { res, next } = await run(updateVendorLogoImage, {
      params: { id: '1' },
      body: { image: dataUrl(PNG) },
    });

    expect(model.updateVendorLogo).toHaveBeenCalledWith(1, expect.any(Buffer), 'image/png');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(saved);
    expect(next).not.toHaveBeenCalled();
  });

  // Invalid partition: bad id never reaches the model
  test('should pass a 400 error for an invalid id', async () => {
    const { next } = await run(updateVendorLogoImage, {
      params: { id: '0' },
      body: { image: dataUrl(PNG) },
    });

    expect(model.updateVendorLogo).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].status).toBe(400);
  });

  // Invalid partition: not an image
  test('should pass a 400 error for a non-image upload', async () => {
    const { next } = await run(updateVendorLogoImage, {
      params: { id: '1' },
      body: { image: dataUrl(Buffer.from('not an image')) },
    });

    expect(model.updateVendorLogo).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].status).toBe(400);
  });

  // Boundary: unknown vendor
  test('should pass a 404 error when the vendor does not exist', async () => {
    model.updateVendorLogo.mockResolvedValue(undefined);

    const { next } = await run(updateVendorLogoImage, {
      params: { id: '999' },
      body: { image: dataUrl(PNG) },
    });

    expect(next.mock.calls[0][0].status).toBe(404);
  });

  // Error handling: model errors go to the error handler
  test('should pass model errors to next', async () => {
    const err = new Error('db down');
    model.updateVendorLogo.mockRejectedValue(err);

    const { next } = await run(updateVendorLogoImage, {
      params: { id: '1' },
      body: { image: dataUrl(PNG) },
    });

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── getVendorLogoImage ───────────────────────────────────
describe('Vendor.controller - getVendorLogoImage', () => {
  const logo = { data: JPEG, mimeType: 'image/jpeg', updatedAt: new Date('2026-11-18T08:00:00Z') };

  // Valid partition: versioned address sends the bytes and can be cached for good
  test('should send the stored picture with its type', async () => {
    model.getVendorLogo.mockResolvedValue(logo);

    const { res, next } = await run(getVendorLogoImage, { params: { id: '1' }, query: { v: '1' } });

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(JPEG);
    expect(next).not.toHaveBeenCalled();
  });

  // Valid partition: without a version the browser must always check for a newer picture
  test('should not let browsers cache an unversioned address', async () => {
    model.getVendorLogo.mockResolvedValue(logo);

    const { res } = await run(getVendorLogoImage, { params: { id: '1' }, query: {} });

    expect(res.set.mock.calls[0][0]['Cache-Control']).toBe('no-cache');
  });

  // Invalid partition: bad id never reaches the model
  test('should pass a 400 error for an invalid id', async () => {
    const { next } = await run(getVendorLogoImage, { params: { id: '-1' }, query: {} });

    expect(model.getVendorLogo).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].status).toBe(400);
  });

  // Boundary: vendor without a picture
  test('should pass a 404 error when there is no picture', async () => {
    model.getVendorLogo.mockResolvedValue(undefined);

    const { next } = await run(getVendorLogoImage, { params: { id: '2' }, query: {} });

    expect(next.mock.calls[0][0].status).toBe(404);
  });

  // Error handling: model errors go to the error handler
  test('should pass model errors to next', async () => {
    const err = new Error('db down');
    model.getVendorLogo.mockRejectedValue(err);

    const { next } = await run(getVendorLogoImage, { params: { id: '1' }, query: {} });

    expect(next).toHaveBeenCalledWith(err);
  });
});
