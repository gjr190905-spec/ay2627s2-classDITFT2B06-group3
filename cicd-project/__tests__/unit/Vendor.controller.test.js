const model = require('../../src/models/Vendor.model');
const {
  OTHER_REASON_MAX_LENGTH,
  parseVendorId,
  validateStatusPayload,
  getClosureReasons,
  getVendor,
  updateVendorStatus,
} = require('../../src/controllers/Vendor.controller');

// ── Mocking ──────────────────────────────────────────────
// Keep the real CLOSURE_REASONS; mock only the DB-touching functions.
jest.mock('../../src/models/Vendor.model', () => ({
  ...jest.requireActual('../../src/models/Vendor.model'),
  getVendorById: jest.fn(),
  setVendorOpenStatus: jest.fn(),
}));

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
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
