const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/models/db');

// ── DB Setup / Teardown ──────────────────────────────────
// Tables are created via the Jest globalSetup (configs/jest-integration-setup.js).
// Each test starts with exactly one open vendor and no closure records.

let vendorId;

beforeEach(async () => {
  await pool.query('DELETE FROM "StoreClosure"');
  await pool.query('DELETE FROM "Vendor"');
  const { rows } = await pool.query(
    `INSERT INTO "Vendor" ("email", "stallName", "logoUrl", "isOpen")
     VALUES ('test@makanliao.sg', 'Test Stall', '/images/vendors/test.svg', TRUE)
     RETURNING "id"`,
  );
  vendorId = rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM "StoreClosure"');
  await pool.query('DELETE FROM "Vendor"');
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────
function patchStatus(id, body) {
  return request(app).patch(`/vendors/${id}/status`).send(body);
}

async function closures() {
  const { rows } = await pool.query('SELECT * FROM "StoreClosure" ORDER BY "id"');
  return rows;
}

// ─────────────────────────────────────────────────────────
// GET /vendors/closure-reasons
// ─────────────────────────────────────────────────────────
describe('GET /vendors/closure-reasons', () => {
  // Valid partition: returns code/label pairs including OTHER
  test('should return 200 and the list of reasons', async () => {
    const res = await request(app).get('/vendors/closure-reasons');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(1);
    expect(res.body[0]).toHaveProperty('code');
    expect(res.body[0]).toHaveProperty('label');
    expect(res.body.map((r) => r.code)).toContain('OTHER');
  });
});

// ─────────────────────────────────────────────────────────
// GET /vendors/:id
// ─────────────────────────────────────────────────────────
describe('GET /vendors/:id', () => {
  // Valid partition: existing vendor returns header + status fields
  test('should return 200 and the vendor', async () => {
    const res = await request(app).get(`/vendors/${vendorId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: vendorId,
      stallName: 'Test Stall',
      logoUrl: '/images/vendors/test.svg',
      isOpen: true,
    });
    expect(res.body).toHaveProperty('statusUpdatedAt');
    // Email is not needed on the home page, so it isn't exposed
    expect(res.body).not.toHaveProperty('email');
  });

  // Boundary: non-existent id
  test('should return 404 for a non-existing id (boundary)', async () => {
    const res = await request(app).get('/vendors/999999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Vendor not found');
  });

  // Invalid partition: non-numeric id
  test('should return 400 for a non-numeric id', async () => {
    const res = await request(app).get('/vendors/abc');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────
// PATCH /vendors/:id/status
// ─────────────────────────────────────────────────────────
describe('PATCH /vendors/:id/status', () => {
  // Valid partition: close with a listed reason → status persisted + closure logged
  test('should close the stall and record the reason', async () => {
    const res = await patchStatus(vendorId, { isOpen: false, reason: 'SOLD_OUT' });

    expect(res.status).toBe(200);
    expect(res.body.isOpen).toBe(false);

    const getRes = await request(app).get(`/vendors/${vendorId}`);
    expect(getRes.body.isOpen).toBe(false);

    const rows = await closures();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId, reason: 'SOLD_OUT', otherReason: null });
  });

  // Valid partition: close with OTHER + typed text (stored trimmed)
  test('should close with an OTHER reason and store the typed text', async () => {
    const res = await patchStatus(vendorId, {
      isOpen: false,
      reason: 'OTHER',
      otherReason: '  Uncle went to the wet market  ',
    });

    expect(res.status).toBe(200);
    const rows = await closures();
    expect(rows[0]).toMatchObject({ reason: 'OTHER', otherReason: 'Uncle went to the wet market' });
  });

  // Valid partition: open with no reason → no closure record added
  test('should open a closed stall without asking for a reason', async () => {
    await patchStatus(vendorId, { isOpen: false, reason: 'BREAK' });

    const res = await patchStatus(vendorId, { isOpen: true });

    expect(res.status).toBe(200);
    expect(res.body.isOpen).toBe(true);
    expect(await closures()).toHaveLength(1); // only the earlier close
  });

  // Valid partition: statusUpdatedAt moves forward on change
  test('should update statusUpdatedAt when the status changes', async () => {
    const before = (await request(app).get(`/vendors/${vendorId}`)).body.statusUpdatedAt;

    const res = await patchStatus(vendorId, { isOpen: false, reason: 'BREAK' });

    expect(new Date(res.body.statusUpdatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  // Boundary: closing an already-closed stall → 409, no duplicate record
  test('should return 409 when the stall is already closed', async () => {
    await patchStatus(vendorId, { isOpen: false, reason: 'BREAK' });

    const res = await patchStatus(vendorId, { isOpen: false, reason: 'BREAK' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Stall is already closed');
    expect(await closures()).toHaveLength(1);
  });

  // Boundary: opening an already-open stall → 409
  test('should return 409 when the stall is already open', async () => {
    const res = await patchStatus(vendorId, { isOpen: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Stall is already open');
  });

  // Invalid partition: closing without a reason
  test('should return 400 when closing without a reason', async () => {
    const res = await patchStatus(vendorId, { isOpen: false });

    expect(res.status).toBe(400);
    expect((await request(app).get(`/vendors/${vendorId}`)).body.isOpen).toBe(true);
  });

  // Invalid partition: unknown reason code
  test('should return 400 for an unknown reason code', async () => {
    const res = await patchStatus(vendorId, { isOpen: false, reason: 'HOLIDAY' });

    expect(res.status).toBe(400);
  });

  // Boundary: OTHER with blank text
  test('should return 400 when OTHER has only whitespace', async () => {
    const res = await patchStatus(vendorId, { isOpen: false, reason: 'OTHER', otherReason: '  ' });

    expect(res.status).toBe(400);
    expect(await closures()).toHaveLength(0);
  });

  // Boundary: OTHER text at 255 passes, 256 fails
  test('should accept 255 characters and reject 256 (boundary)', async () => {
    const tooLong = await patchStatus(vendorId, {
      isOpen: false,
      reason: 'OTHER',
      otherReason: 'a'.repeat(256),
    });
    expect(tooLong.status).toBe(400);

    const maxLen = await patchStatus(vendorId, {
      isOpen: false,
      reason: 'OTHER',
      otherReason: 'a'.repeat(255),
    });
    expect(maxLen.status).toBe(200);
  });

  // Invalid partition: isOpen sent as a string
  test('should return 400 when isOpen is not a boolean', async () => {
    const res = await patchStatus(vendorId, { isOpen: 'false', reason: 'BREAK' });

    expect(res.status).toBe(400);
  });

  // Boundary: non-existent vendor
  test('should return 404 for a non-existing vendor (boundary)', async () => {
    const res = await patchStatus(999999, { isOpen: false, reason: 'BREAK' });

    expect(res.status).toBe(404);
  });

  // Invalid partition: non-numeric id
  test('should return 400 for a non-numeric id', async () => {
    const res = await patchStatus('abc', { isOpen: true });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────
// Static page
// ─────────────────────────────────────────────────────────
describe('GET /vendor/home.html', () => {
  // Valid partition: the vendor home page is served as HTML
  test('should serve the vendor home page', async () => {
    const res = await request(app).get('/vendor/home.html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Where to next?');
  });
});
