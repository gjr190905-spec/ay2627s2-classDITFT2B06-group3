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

// Every seeded stall is in this food court ("Vendor"."foodCourtId" is required).
const foodCourt = { name: 'Makan Liao Food Court', location: 'Block A, Level 1' };

// Stall vendors. Vendor 1 is the one the vendor home page E2E tests use.
// Each stall has an owner account in "Person" (role 'vendor'), linked by "ownerUserId".
// Passwords are not seeded here: accounts and hashes come from the role-access account model.
const vendors = [
  {
    email: 'ahseng@makanliao.sg',
    ownerName: 'Tan Ah Seng',
    stallName: 'Ah Seng Chicken Rice',
    logoUrl: '/images/vendors/ah-seng-chicken-rice.svg',
    isOpen: true,
    pickupLocation: 'Stall 01 counter',
    description: 'Hainanese chicken rice, steamed or roasted.',
  },
  {
    email: 'mdmlim@makanliao.sg',
    ownerName: 'Lim Mei Ling',
    stallName: 'Mdm Lim Laksa',
    logoUrl: '/images/vendors/mdm-lim-laksa.svg',
    isOpen: false,
    pickupLocation: 'Stall 02 counter',
    description: 'Curry laksa and Peranakan favourites.',
  },
  // No logo configured – exercises the header's fallback badge
  {
    email: 'kopi@makanliao.sg',
    ownerName: 'Ong Kok Peng',
    stallName: 'Kopi Corner',
    logoUrl: null,
    isOpen: true,
    pickupLocation: 'Drinks counter',
    description: 'Kopi, teh and kaya toast.',
  },
  // Vendor 4 is the one the settings E2E tests use
  {
    email: 'wong@makanliao.sg',
    ownerName: 'Wong Siew Lan',
    stallName: "Wong's Nasi Lemak",
    logoUrl: null,
    isOpen: true,
    pickupLocation: 'Stall 04 counter',
    description: 'Nasi lemak with crispy chicken wings.',
  },
];

// Starter menus, keyed by stall name. quantityLeft: null = not counting.
// Vendor 2 (Mdm Lim Laksa) is the one the menu E2E tests use.
const menuItems = {
  'Ah Seng Chicken Rice': [
    {
      name: 'Steamed Chicken Rice',
      description: 'Poached chicken, fragrant rice, chilli and ginger.',
      priceCents: 450,
      quantityLeft: null,
      isSoldOut: false,
    },
    {
      name: 'Roasted Chicken Rice',
      description: 'Crispy-skin roast chicken with dark soy.',
      priceCents: 480,
      quantityLeft: 20,
      isSoldOut: false,
    },
    { name: 'Braised Egg', description: null, priceCents: 80, quantityLeft: 0, isSoldOut: true },
  ],
  'Mdm Lim Laksa': [
    {
      name: 'Curry Laksa',
      description: 'Rich coconut curry broth with prawns, tau pok and cockles.',
      priceCents: 550,
      quantityLeft: null,
      isSoldOut: false,
    },
    {
      name: 'Mee Siam',
      description: 'Tangy, slightly spicy rice vermicelli.',
      priceCents: 450,
      quantityLeft: 5,
      isSoldOut: false,
    },
    {
      name: 'Otah',
      description: 'Grilled spiced fish cake.',
      priceCents: 150,
      quantityLeft: null,
      isSoldOut: true,
    },
  ],
  "Wong's Nasi Lemak": [
    {
      name: 'Nasi Lemak',
      description: 'Coconut rice, sambal, egg, anchovies and peanuts.',
      priceCents: 400,
      quantityLeft: null,
      isSoldOut: false,
    },
    {
      name: 'Chicken Wing',
      description: 'Fried, crispy, one piece.',
      priceCents: 180,
      quantityLeft: 30,
      isSoldOut: false,
    },
  ],
  'Kopi Corner': [
    {
      name: 'Kopi',
      description: 'Coffee with condensed milk.',
      priceCents: 150,
      quantityLeft: null,
      isSoldOut: false,
    },
    {
      name: 'Teh Tarik',
      description: 'Pulled milk tea.',
      priceCents: 170,
      quantityLeft: null,
      isSoldOut: false,
    },
    {
      name: 'Kaya Toast Set',
      description: 'Two slices of kaya toast with soft-boiled eggs.',
      priceCents: 380,
      quantityLeft: 15,
      isSoldOut: false,
    },
  ],
};

async function seed() {
  console.log('Seeding data...');

  // Insert persons (batch). These are customers (the "Person"."role" default).
  if (persons.length > 0) {
    const personPlaceholders = persons.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`);
    const personValues = persons.flatMap((p) => [p.email, p.name]);
    const { rows } = await pool.query(
      `INSERT INTO "Person" ("email", "name") VALUES ${personPlaceholders.join(', ')}
       RETURNING "id", "name"`,
      personValues,
    );
    customers.push(...rows);
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
  INSERT INTO "Vendor" ("foodCourtId", "stallName", "pickupLocation", "isActive", "isOpen") VALUES
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Our Sweet Toast', 'Counter A', true, true),
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Canopy Greens', 'Counter B', true, true),
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Foodgonomy', 'Counter C', true, true),
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Japanese Food', 'Counter D', true, true),
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Western Food', 'Counter E', true, true),
    ((SELECT "id" FROM "FoodCourt" WHERE "name" = 'Food Court 6'), 'Hello Handmade Noodles', 'Counter F', true, true)
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
            date_trunc('hour', NOW()) + interval '8 hours',
            interval '5 minutes') AS gs(slot)
     WHERE s."isActive" = true;
  `);

  console.log('Inserted pickup windows.');

  const { rows: courts } = await pool.query(
    'INSERT INTO "FoodCourt" ("name", "location") VALUES ($1, $2) RETURNING "id"',
    [foodCourt.name, foodCourt.location],
  );
  const foodCourtId = courts[0].id;
  console.log('Inserted 1 food court.');

  // Insert vendors (batch): owner accounts first, then their stalls in the same order
  if (vendors.length > 0) {
    const ownerPlaceholders = vendors.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 'vendor')`);
    const { rows: owners } = await pool.query(
      `INSERT INTO "Person" ("email", "name", "role") VALUES ${ownerPlaceholders.join(', ')}
       RETURNING "id"`,
      vendors.flatMap((v) => [v.email, v.ownerName]),
    );

    const COLS = 8;
    const vendorPlaceholders = vendors.map(
      (_, i) => `(${Array.from({ length: COLS }, (__, c) => `$${i * COLS + c + 1}`).join(', ')})`,
    );
    const vendorValues = vendors.flatMap((v, i) => [
      v.email,
      v.stallName,
      v.logoUrl,
      v.isOpen,
      foodCourtId,
      owners[i].id,
      v.pickupLocation,
      v.description,
    ]);
    const { rows: insertedVendors } = await pool.query(
      `INSERT INTO "Vendor" ("email", "stallName", "logoUrl", "isOpen", "foodCourtId",
         "ownerUserId", "pickupLocation", "description")
       VALUES ${vendorPlaceholders.join(', ')} RETURNING "id", "stallName", "ownerUserId"`,
      vendorValues,
    );
    console.log(`Inserted ${owners.length} vendor owner accounts.`);

    // Insert each vendor's starter menu (batch)
    const items = insertedVendors.flatMap((v) =>
      (menuItems[v.stallName] || []).map((item) => ({ vendorId: v.id, ...item })),
    );
    if (items.length > 0) {
      const itemPlaceholders = items.map(
        (_, i) =>
          `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`,
      );
      const itemValues = items.flatMap((m) => [
        m.vendorId,
        m.name,
        m.description,
        m.priceCents,
        m.quantityLeft,
        m.isSoldOut,
      ]);
      const { rows: menuRows } = await pool.query(
        `INSERT INTO "MenuItem" ("vendorId", "name", "description", "priceCents", "quantityLeft", "isSoldOut") VALUES ${itemPlaceholders.join(', ')} RETURNING "id", "vendorId", "name", "priceCents"`,
        itemValues,
      );

      // Sample orders for the dashboard: today around the current time, plus the last 6 days
      let orderCount = 0;
      for (const vendor of insertedVendors) {
        const vendorMenu = menuRows.filter((m) => m.vendorId === vendor.id);
        const orders = buildSampleOrders(vendorMenu, new Date());
        for (const order of orders) {
          await insertOrder(vendor, order);
        }
        orderCount += orders.length;
      }
      console.log(`Inserted ${orderCount} sample orders.`);
    }
    console.log(`Inserted ${items.length} menu items.`);
  }
  console.log(`Inserted ${vendors.length} vendors.`);

  console.log('Seed data inserted successfully.');
}

// ── Sample orders ────────────────────────────────────────
// Singapore has no daylight saving, so "SG time" is always UTC+8.
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const WINDOW_MINUTES = 15;
const WINDOW_CAPACITY = 20;
const customerNames = persons.map((p) => p.name);
const customers = []; // { id, name } of the seeded customer accounts, filled in by seed()

// Midnight (SG) of the day `daysAgo` days before `now`
function sgMidnight(now, daysAgo) {
  const sg = new Date(now.getTime() + SG_OFFSET_MS);
  return new Date(
    Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate() - daysAgo) - SG_OFFSET_MS,
  );
}

/**
 * Decide an order's status and timestamps from its window and the current time,
 * so the seeded data always obeys the "Order_timestamps_check" rule.
 * `n` is a running counter used to vary the data without randomness.
 * `checkout` marks today's orders, which are seeded the way the shared checkout makes
 * them (a customer account, a booked pickup window, a collection reference and a payment
 * record); past days are seeded as imported manual orders.
 */
function sampleOrder(start, now, n, menu, checkout = false) {
  const end = new Date(start.getTime() + WINDOW_MINUTES * MINUTE);
  const late = n % 6 === 5; // every 6th order is made ready after its window ends
  const preparingAt = new Date(start.getTime() - 12 * MINUTE);
  const readyAt = late
    ? new Date(end.getTime() + (3 + (n % 4)) * MINUTE)
    : new Date(start.getTime() - (n % 5) * MINUTE);
  const collectedAt = new Date(readyAt.getTime() + (2 + (n % 7)) * MINUTE);

  let status = 'CONFIRMED';
  if (collectedAt <= now && end.getTime() + 20 * MINUTE <= now.getTime()) status = 'COLLECTED';
  else if (readyAt <= now) status = 'READY';
  else if (preparingAt <= now) status = 'PREPARING';
  // Now and then a student cancels before the food is ready (allowed until READY)
  const cancelled = checkout && n % 9 === 4 && (status === 'CONFIRMED' || status === 'PREPARING');
  if (cancelled) status = 'CANCELLED';

  const lineCount = 1 + (n % 3 === 0 ? 1 : 0);
  const lines = [];
  for (let i = 0; i < lineCount && i < menu.length; i += 1) {
    const item = menu[(n + i * 2) % menu.length];
    lines.push({ item, quantity: 1 + ((n + i) % 3 === 0 ? 1 : 0) });
  }

  const createdAt = new Date(start.getTime() - 45 * MINUTE);
  const customer = checkout && customers.length > 0 ? customers[n % customers.length] : null;
  return {
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : customerNames[n % customerNames.length],
    status,
    start,
    end,
    createdAt,
    preparingAt: status === 'CONFIRMED' || (cancelled && preparingAt > now) ? null : preparingAt,
    readyAt: status === 'READY' || status === 'COLLECTED' ? readyAt : null,
    collectedAt: status === 'COLLECTED' ? collectedAt : null,
    cancelledAt: cancelled ? new Date(Math.min(now.getTime(), start.getTime())) : null,
    payment: customer ? { status: samplePaymentStatus(status, n), method: 'PAYNOW' } : null,
    lines,
  };
}

// Most checkout orders are paid online; every 4th open one is still pending (the student
// pays at the stall). Cancelled orders are refunded.
function samplePaymentStatus(status, n) {
  if (status === 'CANCELLED') return 'REFUNDED';
  if (status !== 'COLLECTED' && n % 4 === 3) return 'PENDING';
  return 'PAID';
}

function buildSampleOrders(menu, now) {
  if (menu.length === 0) return [];
  const orders = [];
  let n = 0;

  // Last 6 days: lunch windows 11:30–13:30, a few orders each, all collected
  for (let daysAgo = 6; daysAgo >= 1; daysAgo -= 1) {
    const midnight = sgMidnight(now, daysAgo);
    for (let w = 0; w < 8; w += 1) {
      const start = new Date(midnight.getTime() + (11 * 60 + 30 + w * WINDOW_MINUTES) * MINUTE);
      const perWindow = 1 + ((daysAgo + w) % 3);
      for (let k = 0; k < perWindow; k += 1) {
        orders.push(sampleOrder(start, now, n, menu));
        n += 1;
      }
    }
  }

  // Today: windows from an hour before now to an hour and a half after
  const current = Math.floor(now.getTime() / (WINDOW_MINUTES * MINUTE)) * WINDOW_MINUTES * MINUTE;
  for (let w = -4; w <= 5; w += 1) {
    const start = new Date(current + w * WINDOW_MINUTES * MINUTE);
    const perWindow = 1 + ((w + 4) % 3);
    for (let k = 0; k < perWindow; k += 1) {
      orders.push(sampleOrder(start, now, n, menu, true));
      n += 1;
    }
  }

  return orders;
}

/**
 * The stall's "PickupWindow" row for a window start, created the first time it is needed.
 * "bookedCount" counts the orders holding a place (cancelled orders give theirs back).
 */
const pickupWindows = new Map();
async function bookPickupWindow(vendorId, order) {
  const key = `${vendorId}:${order.start.getTime()}`;
  if (!pickupWindows.has(key)) {
    const { rows } = await pool.query(
      `INSERT INTO "PickupWindow" ("stallId", "startTime", "endTime", "maxOrders")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [vendorId, order.start, order.end, WINDOW_CAPACITY],
    );
    pickupWindows.set(key, rows[0].id);
  }
  const windowId = pickupWindows.get(key);
  if (order.status !== 'CANCELLED') {
    await pool.query(
      'UPDATE "PickupWindow" SET "bookedCount" = "bookedCount" + 1 WHERE "id" = $1',
      [windowId],
    );
  }
  return windowId;
}

const nextOrderNumber = {};
async function insertOrder(vendor, order) {
  const vendorId = vendor.id;
  nextOrderNumber[vendorId] = (nextOrderNumber[vendorId] || 1000) + 1;
  const orderNumber = nextOrderNumber[vendorId];
  const totalCents = order.lines.reduce((sum, l) => sum + l.item.priceCents * l.quantity, 0);
  const windowId = order.customerId ? await bookPickupWindow(vendorId, order) : null;
  const reference = order.customerId ? `ML-${vendorId}-${orderNumber}` : null;
  const { rows } = await pool.query(
    `INSERT INTO "Order" ("vendorId", "orderNumber", "customerId", "pickupWindowId",
       "collectionReference", "customerName", "status",
       "pickupWindowStart", "pickupWindowEnd", "totalCents", "createdAt",
       "preparingAt", "readyAt", "collectedAt", "cancelledAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING "id"`,
    [
      vendorId,
      orderNumber,
      order.customerId,
      windowId,
      reference,
      order.customerName,
      order.status,
      order.start,
      order.end,
      totalCents,
      order.createdAt,
      order.preparingAt,
      order.readyAt,
      order.collectedAt,
      order.cancelledAt,
    ],
  );
  if (order.payment) {
    await pool.query(
      `INSERT INTO payments (order_id, amount, payment_status, payment_method, paid_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        rows[0].id,
        (totalCents / 100).toFixed(2),
        order.payment.status,
        order.payment.method,
        order.payment.status === 'PAID' ? order.createdAt : null,
        order.createdAt,
      ],
    );
  }
  // The handover record the vendor dashboard writes when a checkout order is collected
  if (order.customerId && order.status === 'COLLECTED') {
    await pool.query(
      'INSERT INTO collections (order_id, collected_by, collected_at) VALUES ($1, $2, $3)',
      [rows[0].id, vendor.ownerUserId, order.collectedAt],
    );
  }
  for (const line of order.lines) {
    await pool.query(
      `INSERT INTO "OrderItem" ("orderId", "menuItemId", "name", "unitPriceCents", "quantity")
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, line.item.id, line.item.name, line.item.priceCents, line.quantity],
    );
  }
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seeding failed:', err);
    pool.end();
    process.exit(1);
  });