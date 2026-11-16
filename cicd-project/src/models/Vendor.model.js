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
