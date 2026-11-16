const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const persons = [
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
  { email: 'dave@example.com', name: 'Dave' },
  { email: 'eve@example.com', name: 'Eve' },
  { email: 'frank@example.com', name: 'Frank' },
  { email: 'grace@example.com', name: 'Grace' },
  { email: 'heidi@example.com', name: 'Heidi' },
  { email: 'ivan@example.com', name: 'Ivan' },
  { email: 'judy@example.com', name: 'Judy' },
  { email: 'mallory@example.com', name: 'Mallory' },
  { email: 'oscar@example.com', name: 'Oscar' },
  { email: 'peggy@example.com', name: 'Peggy' },
  { email: 'trent@example.com', name: 'Trent' },
  { email: 'victor@example.com', name: 'Victor' },
  { email: 'walter@example.com', name: 'Walter' },
  { email: 'xavier@example.com', name: 'Xavier' },
  { email: 'yvonne@example.com', name: 'Yvonne' },
  { email: 'zara@example.com', name: 'Zara' },
  { email: 'leo@example.com', name: 'Leo' },
];
// eslint-disable-next-line no-unused-vars
const somethings = [{ name: 'Seed 1' }, { name: 'Seed 2' }];

async function seed() {
  console.log('Seeding data...');

  // Insert persons (batch)
  if (persons.length > 0) {
    const personPlaceholders = persons.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`);
    const personValues = persons.flatMap((p) => [p.email, p.name]);
    await pool.query(
      `INSERT INTO "Person" ("email", "name") VALUES ${personPlaceholders.join(', ')}`,
      personValues,
    );
  }
  console.log(`Inserted ${persons.length} persons.`);

  // Insert somethings (batch)
  await pool.query(`
    INSERT INTO "Stall" ("name", "pickupLocation", "isActive") VALUES
      ('Chicken Rice Uncle', 'Stall A', true),
      ('Mala Station', 'Stall B', true),
      ('Western Grill', 'Stall C', true),
      ('Yong Tau Foo', 'Stall D', false)
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted stalls.');

  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      (1, 'Chicken Rice', 350, true),
      (1, 'Roast Pork Rice', 400, true),
      (1, 'Soup', 150, true),
      (2, 'Mala Xiang Guo', 800, true),
      (2, 'Mala Noodles', 600, true),
      (3, 'Chicken Chop', 700, true),
      (3, 'Fish and Chips', 650, false)
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted menu items.');

  console.log('Seed data inserted successfully.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seeding failed:', err);
    pool.end();
    process.exit(1);
  });
