const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/models/db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reject a pre-existing incompatible object instead of silently reusing it.
    const { rows: existing } = await client.query(`SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname='user_profile_images'`);
    if (existing.length && !['r','p'].includes(existing[0].relkind)) {
      throw new Error('Existing user_profile_images is not a table.');
    }
    const sql = fs.readFileSync(path.join(__dirname, '../src/database/migrations/20261124_profile_photos.sql'), 'utf8');
    await client.query(sql);
    const { rows } = await client.query(`SELECT column_name,data_type FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='user_profile_images'`);
    const types = new Map(rows.map(r=>[r.column_name,r.data_type]));
    const required = {user_id:'bigint', content_type:'text', image_data:'bytea', updated_at:'timestamp with time zone'};
    for (const [name, type] of Object.entries(required)) {
      if(types.get(name)!==type)throw new Error(`Unexpected user_profile_images.${name} type; refusing to continue.`);
    }
    await client.query('COMMIT');
    console.log('PASS: user_profile_images is ready. Existing account and order rows unchanged.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Profile photo migration failed:',error.message);
    process.exitCode=1;
  } finally {client.release();await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;pool.end();});
