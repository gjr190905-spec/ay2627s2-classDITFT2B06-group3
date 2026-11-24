const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function reset() {
  // schema.sql is the shared branch schema from the Gitmaster, kept unchanged.
  // It is written for a fresh database (no DROP statements), so start from an empty
  // "public" schema every time.
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  console.log('Resetting database schema...');
  await pool.query('SET client_min_messages = warning');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query(schemaSql);
  console.log('Schema applied.');

  // Close pool before running seed script
  await pool.end();

  console.log('Running seed...');
  execSync('node scripts/seed.js', { stdio: 'inherit', env: process.env });

  console.log('Database reset completed successfully.');
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  pool.end();
  process.exit(1);
});
