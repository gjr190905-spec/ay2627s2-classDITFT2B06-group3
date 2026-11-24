// Execute versioned, non-destructive weekly statistics VIEW migration.
// Reads DATABASE_URL from .env.dev via `node --env-file=.env.dev`.
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/models/db');
const file = path.join(__dirname,'../src/database/migrations/20261124_vendor_weekly_order_facts.sql');
(async () => {
  const client=await pool.connect();
  try {
    // Keep view installation atomic. Any failure rolls back automatically.
    await client.query('BEGIN');
    await client.query(fs.readFileSync(file,'utf8'));
    const { rows: fields }=await client.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='vendor_weekly_order_facts'
      ORDER BY ordinal_position`);
    const cols=new Set(fields.map(x=>x.column_name));
    for(const name of ['stall_id','created_at','order_status','total_amount']) {
      if(!cols.has(name))throw new Error('Migrated view missing '+name);
    }
    const {rows:[stat]}=await client.query(`SELECT COUNT(*)::integer AS rows_count,
      COUNT(*) FILTER (WHERE total_amount < 0)::integer AS negative_totals
      FROM vendor_weekly_order_facts`);
    if(stat.negative_totals)throw new Error('Negative order totals detected; do not publish weekly statistics');
    await client.query('COMMIT');
    console.log('PASS: vendor_weekly_order_facts created/verified; '+stat.rows_count+' orders readable.');
    console.log('No existing order/customer rows or table columns were modified.');
  } catch (e) {
    try {await client.query('ROLLBACK');}catch (_){}
    console.error('Migration rolled back:',e.message);
    process.exitCode=1;
  } finally {client.release();}
})().catch(e=>{console.error('Migration failed:',e.message);process.exitCode=1;}).finally(()=>pool.end());
