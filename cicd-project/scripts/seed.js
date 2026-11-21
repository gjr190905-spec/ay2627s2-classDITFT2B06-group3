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

const somethings = [{ name: 'Seed 1' }, { name: 'Seed 2' }];

// Stall vendors. Vendor 1 is the one the vendor home page E2E tests use.
const vendors = [
  {
    email: 'ahseng@makanliao.sg',
    stallName: 'Ah Seng Chicken Rice',
    logoUrl: '/images/vendors/ah-seng-chicken-rice.svg',
    isOpen: true,
  },
  {
    email: 'mdmlim@makanliao.sg',
    stallName: 'Mdm Lim Laksa',
    logoUrl: '/images/vendors/mdm-lim-laksa.svg',
    isOpen: false,
  },
  // No logo configured – exercises the header's fallback badge
  { email: 'kopi@makanliao.sg', stallName: 'Kopi Corner', logoUrl: null, isOpen: true },
  // Vendor 4 is the one the settings E2E tests use
  { email: 'wong@makanliao.sg', stallName: "Wong's Nasi Lemak", logoUrl: null, isOpen: true },
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
  if (somethings.length > 0) {
    const somethingPlaceholders = somethings.map((_, i) => `($${i + 1})`);
    const somethingValues = somethings.map((s) => s.name);
    await pool.query(
      `INSERT INTO "Something" ("name") VALUES ${somethingPlaceholders.join(', ')}`,
      somethingValues,
    );
  }
  console.log(`Inserted ${somethings.length} somethings.`);

  // Insert vendors (batch)
  if (vendors.length > 0) {
    const vendorPlaceholders = vendors.map(
      (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
    );
    const vendorValues = vendors.flatMap((v) => [v.email, v.stallName, v.logoUrl, v.isOpen]);
    const { rows: insertedVendors } = await pool.query(
      `INSERT INTO "Vendor" ("email", "stallName", "logoUrl", "isOpen") VALUES ${vendorPlaceholders.join(', ')} RETURNING "id", "stallName"`,
      vendorValues,
    );

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
          await insertOrder(vendor.id, order);
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
const customerNames = persons.map((p) => p.name);

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
 */
function sampleOrder(start, now, n, menu) {
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

  const lineCount = 1 + (n % 3 === 0 ? 1 : 0);
  const lines = [];
  for (let i = 0; i < lineCount && i < menu.length; i += 1) {
    const item = menu[(n + i * 2) % menu.length];
    lines.push({ item, quantity: 1 + ((n + i) % 3 === 0 ? 1 : 0) });
  }

  return {
    customerName: customerNames[n % customerNames.length],
    status,
    start,
    end,
    createdAt: new Date(start.getTime() - 45 * MINUTE),
    preparingAt: status === 'CONFIRMED' ? null : preparingAt,
    readyAt: status === 'READY' || status === 'COLLECTED' ? readyAt : null,
    collectedAt: status === 'COLLECTED' ? collectedAt : null,
    lines,
  };
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
      orders.push(sampleOrder(start, now, n, menu));
      n += 1;
    }
  }

  return orders;
}

const nextOrderNumber = {};
async function insertOrder(vendorId, order) {
  nextOrderNumber[vendorId] = (nextOrderNumber[vendorId] || 1000) + 1;
  const totalCents = order.lines.reduce((sum, l) => sum + l.item.priceCents * l.quantity, 0);
  const { rows } = await pool.query(
    `INSERT INTO "Order" ("vendorId", "orderNumber", "customerName", "status",
       "pickupWindowStart", "pickupWindowEnd", "totalCents", "createdAt",
       "preparingAt", "readyAt", "collectedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING "id"`,
    [
      vendorId,
      nextOrderNumber[vendorId],
      order.customerName,
      order.status,
      order.start,
      order.end,
      totalCents,
      order.createdAt,
      order.preparingAt,
      order.readyAt,
      order.collectedAt,
    ],
  );
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
