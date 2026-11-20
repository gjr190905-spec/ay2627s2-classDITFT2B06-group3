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
// ─────────────────────────────────────────────────────────
//  Food Court 6 seed data
// ─────────────────────────────────────────────────────────

  await pool.query(`
    INSERT INTO "FoodCourt" ("name", "location") VALUES
      ('Food Court 6', 'Block F, Level 1')
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted food courts.');

  await pool.query(`
    INSERT INTO "Stall" ("foodCourtId", "name", "pickupLocation", "isActive") VALUES
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Our Sweet Toast',        'Counter A', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Canopy Greens',          'Counter B', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Foodgonomy',             'Counter C', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Japanese Food',          'Counter D', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Western Food',           'Counter E', true),
      ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Hello Handmade Noodles', 'Counter F', true)
    ON CONFLICT DO NOTHING;
  `);
  console.log('Inserted stalls.');

  // ── Our Sweet Toast ────────────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Kaya Toast',                    100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Butter Toast',                  100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Peanut Toast',                  100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Blueberry Toast',               100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Strawberry Toast',              100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Chocolate Toast',               100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'French Toast',                   60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Toasted Bread',                  40, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Toasted Wholemeal Bread',        50, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Apollo Bread',                   80, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Cream Crackers (2 pcs)',         50, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Half Boiled Egg (Omega)',        60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Tuna Sandwich (Wholemeal)',     160, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Egg Sandwich (Wholemeal)',      160, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Ham & Cheese Sandwich (Wholemeal)', 160, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Breakfast Set',                200, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Coffee',                        60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Tea',                           60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Coffee with Milk',              70, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Tea with Milk',                 70, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Cocoa',                         70, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Horlicks',                      80, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Chrysanthemum Tea',             60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Ginger Tea',                    60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Chinese Tea',                   60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Iced Coffee',                  100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Iced Tea',                     100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Iced Milk Tea',                110, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Our Sweet Toast'), 'Iced Cocoa',                   150, true)
    ON CONFLICT DO NOTHING;
  `);

  // ── Canopy Greens ──────────────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Low Calorie Bowl',         250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Signature Bowl',           280, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Fill-Me-Up Bowl',          300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Egg',                      100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Olive Rice',               150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Beancurd Skin',            100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Potato Salad',             150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Tomatoes',                 100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Pasta',                    150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Veg Meat Ball',            150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Corn',                     100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Add-On Side (Normal)',      50, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Add-On Side (Premium)',     80, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Canopy Greens'), 'Dressing',                  50, true)
    ON CONFLICT DO NOTHING;
  `);

  // ── Foodgonomy ─────────────────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Just Yogurt Petite',              290, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Just Yogurt Regular',             390, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Just Yogurt Grande',              490, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Petite Yogurt with 1 Topping',   390, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Regular Yogurt with 2 Toppings', 490, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Grande Yogurt with 3 Toppings',  590, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Parfait with 5 Toppings',        690, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Foodgonomy'), 'Extra Topping',                  100, true)
    ON CONFLICT DO NOTHING;
  `);

  // ── Japanese Food ──────────────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Katsu Don Rice',                        350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Katsu Curry Rice',                      350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Teriyaki Rice',                         350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Oyako Don Rice',                        350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Fried Chicken with BBQ Sauce',                  400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Beef Curry Rice',                               500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Fried Beef with BBQ Sauce',                     500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Unatama Don Rice',                              500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Salmon Teriyaki Rice',                          400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Cheese Omelette Rice with Chicken Katsu Curry', 600, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Katsu Rice with Teriyaki Sauce',        400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Udon Soup',                            400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Kitsune Udon or Somen Soup',                   400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Fried Black Pepper Udon',                      400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Chicken Katsu Curry Udon',                     500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Japanese Food'), 'Fish Katsu Curry Rice',                        500, true)
    ON CONFLICT DO NOTHING;
  `);

  // ── Western Food ───────────────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Chop Set',          480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fish & Chip Set',           480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Cutlet Set',        480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Beef Steak Set',            580, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'American Breakfast',        450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Chop Rice',         480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fish Fillet Rice',          480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Cutlet Rice',       480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Beef Steak Rice',           580, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Sausage Rice',      480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken & Popcorn Rice',    480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Nugget Rice',       480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Chop Spaghetti',    480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fish Fillet Spaghetti',     480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Cutlet Spaghetti',  480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Beef Steak Spaghetti',      580, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Sausage Spaghetti', 480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Nugget (5) Spaghetti', 480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Popcorn Chicken Spaghetti', 480, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Burger',            300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fish Fillet Burger',        300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fried Egg',                  60, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'French Fries',              250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Garlic Bread',               50, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Mashed Potato',             250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Hash Brown',                120, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Salad',                     250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Sausage',           100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Nuggets (5 pcs)',           250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Onion Ring',                250, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Cheese Sausage',            150, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Cheese Fries',              300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Chop (Add-on)',     300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Fish Fillet (Add-on)',      300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Chicken Cutlet (Add-on)',   300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Beef Steak (Add-on)',       400, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Ham',                       100, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Pop Corn Chicken',          350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Western Food'), 'Sauce',                      30, true)
    ON CONFLICT DO NOTHING;
  `);

  // ── Hello Handmade Noodles ─────────────────────────────
  await pool.query(`
    INSERT INTO "MenuItem" ("stallId", "name", "priceCents", "isAvailable") VALUES
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Yu Mee / Ban Mee',                          350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Mee Hoon Kueh',                             350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Dumpling Noodle Soup',                      350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Fried Fish / Slice Fish Thick Bee Hoon',    500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Seafood / Double Fish Tom Yam Thin Bee Hoon', 500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Pig Liver Mee Sua Soup',                   350, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Spicy Pork Rib Dry Noodles',               450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Spicy Beef Dry Noodles',                   450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Slice Fish / Fried Fish Soup',             450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Seafood / Double Fish Soup',               450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Pig Organ / Pig Stomach Soup',             300, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Braised Pig Trotter',                      500, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Braised Pork Rib & Pork Belly',            450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'Braised Pork Belly with Preserved Vegetable', 450, true),
      ((SELECT "id" FROM "Stall" WHERE "name" = 'Hello Handmade Noodles'), 'White Rice / Noodles / Vegetables',         50, true)
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