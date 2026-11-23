const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/models/db');
const { deleteVendors } = require('../helpers/cleanup');

// ── DB Setup / Teardown ──────────────────────────────────
// Tables are created via the Jest globalSetup (configs/jest-integration-setup.js).
// Each test starts with exactly one open vendor and no closure records.

let vendorId;

beforeEach(async () => {
  await pool.query('DELETE FROM "StoreClosure"');
  await deleteVendors(pool, 'TRUE');
  const { rows } = await pool.query(
    `INSERT INTO "Vendor" ("email", "stallName", "logoUrl", "isOpen")
     VALUES ('test@makanliao.sg', 'Test Stall', '/images/vendors/test.svg', TRUE)
     RETURNING "id"`,
  );
  vendorId = rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM "StoreClosure"');
  await deleteVendors(pool, 'TRUE');
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

  // Valid partition: the shared-schema stall details customers see while browsing
  test('should include the food court, pickup location and active flag', async () => {
    const res = await request(app).get(`/vendors/${vendorId}`);

    expect(res.body).toMatchObject({
      isActive: true,
      pickupLocation: 'Stall counter',
      description: null,
      foodCourtId: expect.any(Number),
      // Stalls created without a food court go into the schema's placeholder one
      foodCourtName: 'Vendor Demo',
    });
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
  // Invalid partition: an admin has deactivated the stall, so it can't be opened
  test('should refuse to open a deactivated stall', async () => {
    await pool.query('UPDATE "Vendor" SET "isOpen" = FALSE, "isActive" = FALSE WHERE "id" = $1', [
      vendorId,
    ]);

    const res = await patchStatus(vendorId, { isOpen: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/deactivated/);
    const getRes = await request(app).get(`/vendors/${vendorId}`);
    expect(getRes.body.isOpen).toBe(false);
  });

  // Valid partition: a deactivated stall can still be closed
  test('should still close a deactivated stall', async () => {
    await pool.query('UPDATE "Vendor" SET "isActive" = FALSE WHERE "id" = $1', [vendorId]);
    const res = await patchStatus(vendorId, { isOpen: false, reason: 'END_OF_DAY' });
    expect(res.status).toBe(200);
  });

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

// ─────────────────────────────────────────────────────────
// Profile picture: PUT /vendors/:id/logo and GET /vendors/:id/logo
// Pictures are stored in the "VendorLogo" table, never as files in the project.
// ─────────────────────────────────────────────────────────
// A real 1x1 PNG and a tiny JPEG header
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'src', 'public', 'uploads');

function putLogo(id, buffer, type = 'image/png') {
  return request(app)
    .put(`/vendors/${id}/logo`)
    .send({ image: `data:${type};base64,${buffer.toString('base64')}` });
}

async function storedLogos() {
  const { rows } = await pool.query(
    'SELECT "vendorId", "mimeType", "data" FROM "VendorLogo" ORDER BY "vendorId"',
  );
  return rows;
}

describe('PUT /vendors/:id/logo', () => {
  // Valid partition: picture is saved in the database and logoUrl points at it
  test('should store the picture in the database', async () => {
    const res = await putLogo(vendorId, PNG_1PX);

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(new RegExp(`^/vendors/${vendorId}/logo\\?v=\\d+$`));
    const logos = await storedLogos();
    expect(logos).toHaveLength(1);
    expect(logos[0].vendorId).toBe(vendorId);
    expect(logos[0].mimeType).toBe('image/png');
    expect(logos[0].data.equals(PNG_1PX)).toBe(true);
  });

  // Valid partition: nothing is written into the project folder
  test('should not write any file into the project', async () => {
    await putLogo(vendorId, PNG_1PX);

    expect(fs.existsSync(UPLOAD_DIR)).toBe(false);
  });

  // Boundary: a second upload replaces the first (one picture per vendor)
  test('should replace the previous picture instead of adding another', async () => {
    const first = await putLogo(vendorId, PNG_1PX);
    const second = await putLogo(vendorId, JPEG_BYTES, 'image/jpeg');

    expect(second.status).toBe(200);
    expect(second.body.logoUrl).not.toBe(first.body.logoUrl);
    const logos = await storedLogos();
    expect(logos).toHaveLength(1);
    expect(logos[0].mimeType).toBe('image/jpeg');
  });

  // Invalid partition: text pretending to be an image is refused and nothing is saved
  test('should return 400 for a file that is not an image', async () => {
    const res = await putLogo(vendorId, Buffer.from('definitely not an image'));

    expect(res.status).toBe(400);
    expect(await storedLogos()).toHaveLength(0);
  });

  // Boundary: non-existent vendor
  test('should return 404 for a non-existing vendor (boundary)', async () => {
    const res = await putLogo(999999, PNG_1PX);

    expect(res.status).toBe(404);
    expect(await storedLogos()).toHaveLength(0);
  });

  // Invalid partition: non-numeric id
  test('should return 400 for a non-numeric id', async () => {
    const res = await putLogo('abc', PNG_1PX);

    expect(res.status).toBe(400);
  });
});

describe('GET /vendors/:id/logo', () => {
  // Valid partition: the stored bytes come back with the right type
  test('should return the stored picture', async () => {
    const saved = await putLogo(vendorId, PNG_1PX);

    const res = await request(app).get(saved.body.logoUrl);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body).equals(PNG_1PX)).toBe(true);
  });

  // Boundary: vendor exists but has no picture
  test('should return 404 when the vendor has no picture', async () => {
    const res = await request(app).get(`/vendors/${vendorId}/logo`);

    expect(res.status).toBe(404);
  });

  // Invalid partition: non-numeric id
  test('should return 400 for a non-numeric id', async () => {
    const res = await request(app).get('/vendors/abc/logo');

    expect(res.status).toBe(400);
  });

  // Valid partition: deleting a vendor deletes their picture
  test('should delete the picture when the vendor is deleted', async () => {
    await putLogo(vendorId, PNG_1PX);

    await deleteVendors(pool, 'v."id" = $1', [vendorId]);

    expect(await storedLogos()).toHaveLength(0);
  });
});
