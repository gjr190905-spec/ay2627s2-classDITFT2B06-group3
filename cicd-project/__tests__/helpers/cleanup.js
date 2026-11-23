// Clean-up helpers for integration tests.
//
// The shared schema keeps order history: "Order" rows block deleting their vendor or
// customer (ON DELETE RESTRICT), and "payments", "collections" and "PickupWindow" rows
// block deleting their order or stall. These helpers delete in the right order so a test
// can remove only the rows it created.

/**
 * Delete vendors matching a condition on "Vendor" v, with their orders, payments,
 * collection records and pickup windows (everything else cascades).
 *
 * @param {import('pg').Pool} pool
 * @param {string} condition  SQL on "Vendor" v, e.g. 'v."email" = ANY($1)'
 * @param {any[]} [params]
 */
async function deleteVendors(pool, condition, params = []) {
  const orders = `SELECT o."id" FROM "Order" o JOIN "Vendor" v ON v."id" = o."vendorId" WHERE ${condition}`;
  await pool.query(`DELETE FROM collections WHERE order_id IN (${orders})`, params);
  await pool.query(`DELETE FROM payments WHERE order_id IN (${orders})`, params);
  await pool.query(
    `DELETE FROM "Order" o USING "Vendor" v WHERE v."id" = o."vendorId" AND ${condition}`,
    params,
  );
  await pool.query(
    `DELETE FROM "PickupWindow" w USING "Vendor" v WHERE v."id" = w."stallId" AND ${condition}`,
    params,
  );
  await pool.query(`DELETE FROM "Vendor" v WHERE ${condition}`, params);
}

/**
 * Delete every person. Checkout orders (which need their customer) go with them, vendors
 * lose their owner link, and collection records (which name a person) are removed.
 *
 * @param {import('pg').Pool} pool
 */
async function deleteAllPersons(pool) {
  await pool.query('DELETE FROM collections');
  await pool.query(
    'DELETE FROM payments WHERE order_id IN (SELECT "id" FROM "Order" WHERE "customerId" IS NOT NULL)',
  );
  await pool.query('DELETE FROM "Order" WHERE "customerId" IS NOT NULL');
  await pool.query('UPDATE "Vendor" SET "ownerUserId" = NULL WHERE "ownerUserId" IS NOT NULL');
  await pool.query('DELETE FROM "Person"');
}

module.exports = { deleteVendors, deleteAllPersons };
