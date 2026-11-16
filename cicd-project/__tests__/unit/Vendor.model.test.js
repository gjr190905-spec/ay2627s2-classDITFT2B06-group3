const pool = require('../../src/models/db');
const {
  CLOSURE_REASONS,
  getVendorById,
  setVendorOpenStatus,
} = require('../../src/models/Vendor.model');

// ── Mocking ──────────────────────────────────────────────
// setVendorOpenStatus checks out a client for its transaction,
// so pool.connect() returns a fake client with its own query mock.
const client = { query: jest.fn(), release: jest.fn() };

jest.mock('../../src/models/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
}));

const openVendor = { id: 1, stallName: 'Ah Seng', logoUrl: null, isOpen: true };
const closedVendor = { ...openVendor, isOpen: false };

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(client);
});

/** Return the SQL strings sent through the transaction client, in order. */
function clientSql() {
  return client.query.mock.calls.map(([sql]) => sql);
}

// ── CLOSURE_REASONS ──────────────────────────────────────
describe('Vendor.model - CLOSURE_REASONS', () => {
  // Valid partition: list includes the free-text "Other" option the spec requires
  test('should include an OTHER option', () => {
    expect(CLOSURE_REASONS.map((r) => r.code)).toContain('OTHER');
  });

  // Error handling: list cannot be mutated by callers
  test('should be frozen', () => {
    expect(Object.isFrozen(CLOSURE_REASONS)).toBe(true);
  });
});

// ── getVendorById ────────────────────────────────────────
describe('Vendor.model - getVendorById', () => {
  // Valid partition: existing id returns the vendor row
  test('should return the vendor for an existing id', async () => {
    pool.query.mockResolvedValue({ rows: [openVendor] });

    const result = await getVendorById(1);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('FROM "Vendor" WHERE "id" = $1');
    expect(params).toEqual([1]);
    expect(result).toEqual(openVendor);
  });

  // Boundary: no matching row returns undefined
  test('should return undefined when the vendor does not exist', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await expect(getVendorById(999)).resolves.toBeUndefined();
  });

  // Error handling: DB errors propagate to the caller
  test('should propagate database errors', async () => {
    pool.query.mockRejectedValue(new Error('timeout'));

    await expect(getVendorById(1)).rejects.toThrow('timeout');
  });
});

// ── setVendorOpenStatus ──────────────────────────────────
describe('Vendor.model - setVendorOpenStatus', () => {
  // Valid partition: closing an open stall updates status AND records the reason
  test('should close the stall and insert a closure record in one transaction', async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [openVendor] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [closedVendor] }) // UPDATE
      .mockResolvedValueOnce({}) // INSERT
      .mockResolvedValueOnce({}); // COMMIT

    const result = await setVendorOpenStatus(1, false, { reason: 'BREAK', otherReason: null });

    expect(result).toEqual({ vendor: closedVendor, changed: true });
    const sql = clientSql();
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('FOR UPDATE');
    expect(sql[2]).toContain('UPDATE "Vendor" SET "isOpen" = $1');
    expect(sql[3]).toContain('INSERT INTO "StoreClosure"');
    expect(client.query.mock.calls[3][1]).toEqual([1, 'BREAK', null]);
    expect(sql[4]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // Valid partition: "Other" reason text is stored with the closure
  test('should store the typed text for an OTHER reason', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [openVendor] })
      .mockResolvedValueOnce({ rows: [closedVendor] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await setVendorOpenStatus(1, false, { reason: 'OTHER', otherReason: 'Gas ran out' });

    expect(client.query.mock.calls[3][1]).toEqual([1, 'OTHER', 'Gas ran out']);
  });

  // Valid partition: opening a closed stall does NOT insert a closure record
  test('should open the stall without recording a reason', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [closedVendor] })
      .mockResolvedValueOnce({ rows: [openVendor] })
      .mockResolvedValueOnce({});

    const result = await setVendorOpenStatus(1, true, null);

    expect(result).toEqual({ vendor: openVendor, changed: true });
    const sql = clientSql();
    expect(sql.some((s) => s.includes('StoreClosure'))).toBe(false);
    expect(sql[sql.length - 1]).toBe('COMMIT');
  });

  // Boundary: status already matches – nothing changes, transaction rolled back
  test('should return changed=false and roll back when status is unchanged', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [openVendor] })
      .mockResolvedValueOnce({});

    const result = await setVendorOpenStatus(1, true, null);

    expect(result).toEqual({ vendor: openVendor, changed: false });
    expect(clientSql()).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE'), 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // Boundary: vendor does not exist – undefined, rolled back
  test('should return undefined and roll back when the vendor does not exist', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    const result = await setVendorOpenStatus(999, false, { reason: 'BREAK', otherReason: null });

    expect(result).toBeUndefined();
    expect(clientSql()[2]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // Error handling: failure mid-transaction rolls back, releases client, rethrows
  test('should roll back, release the client and rethrow on error', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [openVendor] })
      .mockResolvedValueOnce({ rows: [closedVendor] })
      .mockRejectedValueOnce(new Error('check constraint violated'))
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      setVendorOpenStatus(1, false, { reason: 'BREAK', otherReason: null }),
    ).rejects.toThrow('check constraint violated');

    expect(clientSql()).toContain('ROLLBACK');
    expect(clientSql()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // Error handling: cannot get a connection from the pool
  test('should propagate pool connection errors', async () => {
    pool.connect.mockRejectedValue(new Error('connection refused'));

    await expect(setVendorOpenStatus(1, true, null)).rejects.toThrow('connection refused');
    expect(client.release).not.toHaveBeenCalled();
  });
});
