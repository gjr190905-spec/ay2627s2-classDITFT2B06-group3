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

  if (persons.length > 0) {
    const personPlaceholders = persons.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`);
    const personValues = persons.flatMap((p) => [p.email, p.name]);
    await pool.query(
      `INSERT INTO "Person" ("email", "name") VALUES ${personPlaceholders.join(', ')}`,
      personValues,
    );
  }
  console.log(`Inserted ${persons.length} persons.`);

  await pool.query(`
    INSERT INTO "FoodCourt" ("name", "location") VALUES
      ('Food Court 6', 'Block F, Level 1')
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted food courts.');

  await pool.query(`
    INSERT INTO "Stall" ("foodCourtId", "name", "pickupLocation", "isActive") VALUES
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Chicken Rice Uncle', 'Counter A', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Mala Station', 'Counter B', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Western Grill', 'Counter C', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Yong Tau Foo', 'Counter D', false)
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted stalls.');

  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Chicken Rice Uncle'), 'Chicken Rice', 350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Chicken Rice Uncle'), 'Roast Pork Rice', 400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Chicken Rice Uncle'), 'Soup', 150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Mala Station'), 'Mala Xiang Guo', 800, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Mala Station'), 'Mala Noodles', 600, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Grill'), 'Chicken Chop', 700, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Grill'), 'Fish and Chips', 650, false)
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted menu items.');

  await pool.query(`
    INSERT INTO "PickupWindow" ("stallId", "startTime", "endTime", "maxOrders", "bookedCount")
    SELECT s."id", slot, slot + interval '5 minutes', 5, 0
      FROM "Stall" s
     CROSS JOIN generate_series(
            date_trunc('hour', NOW()) + interval '1 hour',
            date_trunc('hour', NOW()) + interval '3 hours',
            interval '5 minutes') AS slot
     WHERE s."isActive" = true;
  `);

  await pool.query(`
    UPDATE "PickupWindow" SET "bookedCount" = "maxOrders"
     WHERE "id" = (SELECT MIN("id") FROM "PickupWindow" WHERE "stallId" = 1);
  `);
  console.log('Inserted pickup windows.');

  console.log('Seed data inserted successfully.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seeding failed:', err);
    pool.end();
    process.exit(1);
  });