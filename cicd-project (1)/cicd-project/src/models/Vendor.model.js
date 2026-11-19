const pool = require('./db');

// Reasons a vendor can pick when closing their stall.
// Codes must match the CHECK constraint on "StoreClosure"."reason" in schema.sql.
const CLOSURE_REASONS = Object.freeze([
  { code: 'SOLD_OUT', label: 'Sold out for the day' },
  { code: 'BREAK', label: 'Taking a short break' },
  { code: 'END_OF_DAY', label: 'Closing for the day' },
  { code: 'EQUIPMENT', label: 'Equipment problem' },
  { code: 'STAFF', label: 'Not enough staff' },
  { code: 'OTHER', label: 'Other' },
]);

const VENDOR_COLUMNS = '"id", "stallName", "logoUrl", "isOpen", "statusUpdatedAt"';

module.exports.CLOSURE_REASONS = CLOSURE_REASONS;

// Postgres error code for "unique_violation"
const UNIQUE_VIOLATION = '23505';

module.exports.getVendorById = async function getVendorById(id) {
  const { rows } = await pool.query(`SELECT ${VENDOR_COLUMNS} FROM "Vendor" WHERE "id" = $1`, [id]);
  return rows[0];
};

/**
 * Open or close a vendor's stall.
 *
 * Runs in a transaction so the status change and the closure record are saved together.
 * The vendor row is locked (FOR UPDATE) so two rapid requests can't both "close" the stall.
 *
 * @param {number} id                 Vendor id
 * @param {boolean} isOpen            Desired status
 * @param {{reason: string, otherReason: string|null}|null} closure  Required when closing
 * @returns {Promise<{vendor: object, changed: boolean}|undefined>}
 *          undefined if the vendor does not exist; changed=false if it was already in that state
 */
module.exports.setVendorOpenStatus = async function setVendorOpenStatus(id, isOpen, closure) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT ${VENDOR_COLUMNS} FROM "Vendor" WHERE "id" = $1 FOR UPDATE`,
      [id],
    );
    const vendor = current.rows[0];

    if (!vendor) {
      await client.query('ROLLBACK');
      return undefined;
    }

    if (vendor.isOpen === isOpen) {
      await client.query('ROLLBACK');
      return { vendor, changed: false };
    }

    const updated = await client.query(
      `UPDATE "Vendor" SET "isOpen" = $1, "statusUpdatedAt" = NOW() WHERE "id" = $2 RETURNING ${VENDOR_COLUMNS}`,
      [isOpen, id],
    );

    if (!isOpen) {
      await client.query(
        'INSERT INTO "StoreClosure" ("vendorId", "reason", "otherReason") VALUES ($1, $2, $3)',
        [id, closure.reason, closure.otherReason],
      );
    }

    await client.query('COMMIT');
    return { vendor: updated.rows[0], changed: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Change a vendor's shop name.
 * Uniqueness is enforced by the database (case-insensitive unique index on "stallName"),
 * so two vendors saving the same name at the same moment can't both succeed.
 *
 * @returns {Promise<object|undefined|null>}
 *          the updated vendor, undefined if the vendor does not exist,
 *          or null if another vendor already uses that name
 */
module.exports.updateVendorStallName = async function updateVendorStallName(id, stallName) {
  try {
    const { rows } = await pool.query(
      `UPDATE "Vendor" SET "stallName" = $1 WHERE "id" = $2 RETURNING ${VENDOR_COLUMNS}`,
      [stallName, id],
    );
    return rows[0];
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
};

// Address the page uses to show a stored picture. The ?v= part changes with every upload,
// so browsers never show a cached old picture.
function logoUrlFor(id, version) {
  return `/vendors/${id}/logo?v=${version}`;
}

module.exports.logoUrlFor = logoUrlFor;

/**
 * Replace a vendor's profile picture. The image itself is stored in the database
 * ("VendorLogo"), one row per vendor, so a vendor can never have more than one picture.
 * "Vendor"."logoUrl" is pointed at GET /vendors/:id/logo in the same transaction.
 *
 * @param {number} id         Vendor id
 * @param {Buffer} data       Image bytes (already checked to be PNG, JPEG or WebP)
 * @param {string} mimeType   'image/png', 'image/jpeg' or 'image/webp'
 * @returns {Promise<object|undefined>} the updated vendor, or undefined if it does not exist
 */
module.exports.updateVendorLogo = async function updateVendorLogo(id, data, mimeType) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT "id" FROM "Vendor" WHERE "id" = $1 FOR UPDATE', [
      id,
    ]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const saved = await client.query(
      `INSERT INTO "VendorLogo" ("vendorId", "data", "mimeType", "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("vendorId")
       DO UPDATE SET "data" = EXCLUDED."data", "mimeType" = EXCLUDED."mimeType", "updatedAt" = NOW()
       RETURNING "updatedAt"`,
      [id, data, mimeType],
    );
    const version = saved.rows[0].updatedAt.getTime();

    const updated = await client.query(
      `UPDATE "Vendor" SET "logoUrl" = $1 WHERE "id" = $2 RETURNING ${VENDOR_COLUMNS}`,
      [logoUrlFor(id, version), id],
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Read a vendor's stored profile picture.
 *
 * @returns {Promise<{data: Buffer, mimeType: string, updatedAt: Date}|undefined>}
 *          undefined if the vendor has no stored picture
 */
module.exports.getVendorLogo = async function getVendorLogo(id) {
  const { rows } = await pool.query(
    'SELECT "data", "mimeType", "updatedAt" FROM "VendorLogo" WHERE "vendorId" = $1',
    [id],
  );
  return rows[0];
};
