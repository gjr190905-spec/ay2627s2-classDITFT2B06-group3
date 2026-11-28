'use strict';
const crypto = require('node:crypto');
const pool = require('./db');

// Only these known, explicitly verified column names are ever interpolated into SQL.
const ALLOWED = Object.freeze({
  id: ['id', 'order_id'],
  customer: ['customer_id', 'user_id'],
  status: ['status', 'order_status'],
  stall: ['stall_id'],
  number: ['order_number', 'order_reference'],
});
function problem(status, message) { const e = new Error(message); e.status = status; return e; }
function positiveId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw problem(400, 'Invalid order or account ID.');
  return n;
}
function validCode(code) { return typeof code === 'string' && /^MLP-[a-f0-9]{64}$/.test(code); }
function digest(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
function choose(cols, candidates, required = true) {
  const result = candidates.find(x => cols.has(x));
  if (!result && required) throw problem(503, 'Pickup integration unavailable: incompatible order schema.');
  return result || null;
}
async function columns(db) {
  const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders'`);
  const names = new Set(rows.map(x => x.column_name));
  const result = Object.fromEntries(Object.entries(ALLOWED).map(([key, choices]) => [key, choose(names, choices, key !== 'number')]));
  return result;
}
function orderNumberExpr(schema) { return schema.number ? `o.${schema.number}::text` : `o.${schema.id}::text`; }
async function readyOrdersForCustomer(customerId) {
  const uid = positiveId(customerId);
  const s = await columns(pool);
  const result = await pool.query(`SELECT o.${s.id}::text AS id, ${orderNumberExpr(s)} AS order_number
    FROM orders o WHERE o.${s.customer}=$1 AND UPPER(o.${s.status}::text)='READY'
    ORDER BY o.${s.id} DESC LIMIT 50`, [uid]);
  return result.rows.map(r => ({ id: Number(r.id), orderNumber: r.order_number }));
}
async function issueForCustomer(customerId, orderId) {
  const uid = positiveId(customerId), oid = positiveId(orderId);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const s = await columns(db);
    const { rows } = await db.query(`SELECT UPPER(o.${s.status}::text) AS status, ${orderNumberExpr(s)} AS order_number
      FROM orders o WHERE o.${s.id}=$1 AND o.${s.customer}=$2 FOR UPDATE`, [oid, uid]);
    if (!rows.length) throw problem(404, 'Order not found in your account.');
    if (rows[0].status !== 'READY') throw problem(409, 'Pickup QR is available only when your order is READY.');

    const existing = await db.query(`SELECT collected_at FROM pickup_collection_passes WHERE order_id=$1 FOR UPDATE`, [oid]);
    if (existing.rows.length) {
      if (existing.rows[0].collected_at) throw problem(409, 'Order has already been collected.');
      await db.query('COMMIT');
      return { alreadyIssued: true, orderNumber: rows[0].order_number };
    }

    const code = `MLP-${crypto.randomBytes(32).toString('hex')}`;
    await db.query(`INSERT INTO pickup_collection_passes (order_id, token_hash, issued_at, collected_at, collected_by)
      VALUES ($1,$2,NOW(),NULL,NULL)`,
    [oid, digest(code)]);
    await db.query('COMMIT');
    return { code, orderNumber: rows[0].order_number };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function inspectForVendor(vendorStallId, code, confirm = false, vendorUserId = null) {
  const stallId = positiveId(vendorStallId);
  if (!validCode(code)) throw problem(400, 'Scan a valid Makan Liao pickup QR.');
  if (confirm) positiveId(vendorUserId);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const s = await columns(db);
    const { rows } = await db.query(`SELECT o.${s.id}::text AS id, o.${s.stall}::text AS stall_id,
         UPPER(o.${s.status}::text) AS status, ${orderNumberExpr(s)} AS order_number,
         p.collected_at AS redeemed_at
       FROM pickup_collection_passes p JOIN orders o ON o.${s.id}=p.order_id
      WHERE p.token_hash=$1 FOR UPDATE OF p, o`, [digest(code)]);
    if (!rows.length) throw problem(404, 'Pickup code not found or replaced.');
    const order = rows[0];
    if (Number(order.stall_id) !== stallId) throw problem(403, 'This order belongs to a different stall.');
    if (order.redeemed_at || order.status === 'COLLECTED') throw problem(409, 'Order has already been collected.');
    if (order.status !== 'READY') throw problem(409, 'Only READY orders can be collected.');
    if (confirm) {
      const { rowCount } = await db.query(`UPDATE orders SET ${s.status}='COLLECTED'
        WHERE ${s.id}=$1 AND UPPER(${s.status}::text)='READY'`, [order.id]);
      if (rowCount !== 1) throw problem(409, 'Order status changed; collection was not recorded.');
      await db.query(`UPDATE pickup_collection_passes SET collected_at=NOW(), collected_by=$2 WHERE order_id=$1`,
        [order.id, vendorUserId]);
    }
    await db.query('COMMIT');
    return { orderId: Number(order.id), orderNumber: order.order_number,
      orderStatus: confirm ? 'COLLECTED' : 'READY', message: confirm ? `${order.order_number} marked collected.` : 'Ready order verified. Confirm handover before collecting.' };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
module.exports = { readyOrdersForCustomer, issueForCustomer, inspectForVendor, validCode, digest, columns, problem };
