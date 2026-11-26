'use strict';
// Read-only preflight. Prevents confusing an unrelated legacy Order/Person schema
// with the authenticated users/stalls/oders schema of this feature.
const pool = require('../src/models/db');
(async () => {
  try {
    const tables = await pool.query(`SELECT to_regclass('orders')::text AS orders,
           to_regclass('"Order"')::text AS legacy_orders,
           to_regclass('users')::text AS users,
           to_regclass('stalls')::text AS stalls`);
    const t = tables.rows[0];
    console.log('Available tables:', JSON.stringify(t));
    if (!t.orders) {
      if (t.legacy_orders) throw new Error(
        'The database has the team-owned "Order" table but no lowercase orders table. ' +
        'Its customerId relates to "Person", not automatically to authenticated users.id. ' +
        'Stop: identity/stall mapping must be verified before a QR collection update.');
      throw new Error('No lowercase orders table was found. The QR feature needs the actual order schema.');
    }
    if (!t.users || !t.stalls) throw new Error('Missing users or stalls table used by the signed-in application.');
    const cols = await pool.query(`SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN ('orders','users','stalls')`);
    const byTable = new Map();
    for (const c of cols.rows) {
      if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Set());
      byTable.get(c.table_name).add(c.column_name);
    }
    for (const [name, expected] of [['users',['id','role','stall_id']],['stalls',['id']],['orders',['stall_id']]]) {
      for (const col of expected) if (!byTable.get(name)?.has(col)) throw new Error(`${name}.${col} not present in the active database.`);
    }
    const {columns} = require('../src/models/PickupQr.model');
    const schema = await columns(pool);
    console.log('Resolved authenticated order schema:', schema);
    // Validate that orders reference the same auth user/stall tables rather than an unrelated data set.
    const refs = await pool.query(`SELECT con.confrelid::regclass::text AS target,
       con.conrelid::regclass::text AS source,
       ARRAY(SELECT att.attname FROM unnest(con.conkey) AS key(attnum)
       JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=key.attnum) AS source_columns
       FROM pg_constraint con WHERE con.contype='f' AND con.conrelid='orders'::regclass`);
    const linked = (col, table) => refs.rows.some(r => r.source_columns?.includes(col) &&
       (r.target === table || r.target.endsWith('.'+table)));
    if (!linked(schema.customer,'users') || !linked(schema.stall,'stalls')) {
      console.warn('WARNING: Expected foreign-key links orders → users and orders → stalls were not found.');
      throw new Error('The relationship between order ownership and signed-in accounts is unverified. Stopping instead of risking cross-account collection.');
    }
    console.log('PASS: order owners and vendors are linked to signed-in users/stalls.');
  } catch(e) {
    console.error('QR DATABASE PRECHECK STOPPED:',e.message);
    process.exitCode=1;
  } finally { await pool.end(); }
})();
