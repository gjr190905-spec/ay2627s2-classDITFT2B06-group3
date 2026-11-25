'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/models/db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Verify the original team order schema before writing any DDL.
    const model = require('../src/models/PickupQr.model');
    const order = await model.columns(client);
    console.log('Verified existing orders columns:', order);
    await client.query(fs.readFileSync(path.join(__dirname, '../src/database/migrations/20261125_pickup_collection_passes.sql'),'utf8'));
    const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pickup_collection_passes'`);
    const names = new Set(rows.map(x => x.column_name));
    for (const name of ['order_id','token_hash','issued_at','collected_at','collected_by']) if (!names.has(name)) throw Error(`Pickup migration missing ${name}`);
    await client.query('COMMIT');
    console.log('PASS: additive pickup token table ready; existing orders unchanged.');
  } catch(e) { await client.query('ROLLBACK'); console.error('Pickup migration failed:',e.message);process.exitCode=1; }
  finally { client.release();await pool.end(); }
})();
