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
      await pool.query(
        `INSERT INTO "MenuItem" ("vendorId", "name", "description", "priceCents", "quantityLeft", "isSoldOut") VALUES ${itemPlaceholders.join(', ')}`,
        itemValues,
      );
    }
    console.log(`Inserted ${items.length} menu items.`);
  }
  console.log(`Inserted ${vendors.length} vendors.`);

  console.log('Seed data inserted successfully.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seeding failed:', err);
    pool.end();
    process.exit(1);
  });
