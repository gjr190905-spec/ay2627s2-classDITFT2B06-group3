'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const sqlPath = path.resolve(__dirname, '../src/database/migrations/20261127_customer_review_submission.sql');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing: use node --env-file=.env.dev. Database unchanged.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  try {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    const check = await pool.query(`SELECT count(*)::integer AS n
      FROM information_schema.tables WHERE table_schema='public' AND table_name='ml_customer_reviews'`);
    if (check.rows[0]?.n !== 1) throw Error('Expected review table was not created.');
    console.log('Day 12 PostgreSQL review table migrated (idempotent). Existing orders unchanged.');
  } catch (error) {
    console.error('REVIEW MIGRATION FAILED:', error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
