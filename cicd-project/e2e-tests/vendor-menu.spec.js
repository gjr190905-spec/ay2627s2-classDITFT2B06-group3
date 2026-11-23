const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
// "Mdm Lim Laksa" from scripts/seed.js. The vendor home tests use vendor 1, so the two
// spec files can run side by side without touching each other's data.
const VENDOR_ID = 2;
const API = `${BASE_URL}/vendors/${VENDOR_ID}/menu`;
const MENU_URL = `${BASE_URL}/vendor/menu.html?vendorId=${VENDOR_ID}`;
const STALL_URL = `${BASE_URL}/stall.html?vendorId=${VENDOR_ID}`;

// A real 1×1 PNG, used wherever a picture is uploaded
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2b2e5a00000000049454e44ae426082',
  'hex',
);
const pngFile = (name) => ({ name, mimeType: 'image/png', buffer: PNG_1PX });

const STARTER_MENU = [
  { name: 'Curry Laksa', description: 'Rich coconut broth', price: '5.50', quantityLeft: null },
  { name: 'Mee Siam', price: '4.50', quantityLeft: 2 },
  { name: 'Otah', price: '1.50', quantityLeft: null, soldOut: true },
];

/**
 * Put vendor 2's menu into a known state through the API:
 * no banner, and exactly the three starter items.
 */
async function resetMenu(request) {
  const menu = await (await request.get(API)).json();
  for (const item of menu.items) {
    expect((await request.delete(`${API}/items/${item.id}`)).status()).toBe(204);
  }
  await request.delete(`${API}/banner`);
  for (const { soldOut, ...item } of STARTER_MENU) {
    const res = await request.post(`${API}/items`, { data: item });
    expect(res.status()).toBe(201);
    if (soldOut) {
      const { id } = await res.json();
      await request.patch(`${API}/items/${id}/availability`, { data: { isAvailable: false } });
    }
  }
}

async function openMenu(page) {
  await page.goto(MENU_URL);
  await expect(page.locator('.vm-item')).toHaveCount(STARTER_MENU.length);
}

const row = (page, name) =>
  page.locator('.vm-item', { has: page.getByRole('heading', { name, exact: true }) });

test.beforeEach(async ({ request }) => resetMenu(request));

// ── Page load ────────────────────────────────────────────
test.describe('Vendor menu – page load', () => {
  // Valid partition: every item shows with its price and availability
  test('should list the items with price and availability', async ({ page }) => {
    await openMenu(page);

    await expect(page.locator('#vendorStallName')).toHaveText('Mdm Lim Laksa');
    await expect(page.locator('#menuSummary')).toHaveText('3 items · 2 available · 1 sold out');
    await expect(row(page, 'Curry Laksa').locator('.vm-item__price')).toHaveText('$5.50');
    await expect(page.getByRole('switch', { name: 'Curry Laksa available' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: 'Otah available' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(row(page, 'Mee Siam')).toContainText('2 left');
    await expect(row(page, 'Curry Laksa')).toContainText('No limit');
  });

  // Valid partition: the home page's Menu tile opens this page for the signed-in vendor
  test('should open from the Menu tile on the home page', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/home.html?vendorId=${VENDOR_ID}`);
    await page.getByRole('link', { name: /^Menu/ }).click();

    await expect(page).toHaveURL(/\/vendor\/menu\.html$/);
    await expect(page.locator('.vm-item')).toHaveCount(STARTER_MENU.length);
  });

  // Error handling: no session → signed-out panel
  test('should show the signed-out message when there is no session', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/menu.html`);
    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
    await expect(page.locator('#menuPanel')).toBeHidden();
  });

  // Boundary: unknown vendor id is treated as signed out
  test('should treat an unknown vendor as signed out', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/menu.html?vendorId=999999`);
    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
  });
});

// ── Adding items ─────────────────────────────────────────
test.describe('Vendor menu – add item', () => {
  // Valid partition: all fields plus a photo
  test('should add an item with a photo', async ({ page }) => {
    await openMenu(page);

    await page.getByRole('button', { name: 'Add item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add item' });
    await dialog.getByLabel('Name').fill('Lontong');
    await dialog.getByLabel('Description').fill('Rice cakes in vegetable curry');
    await dialog.getByLabel('Price').fill('4.80');
    await dialog.getByLabel('Stock').selectOption({ label: 'Set quantity left' });
    await dialog.getByLabel('Quantity left').fill('10');
    await page.locator('#photoInput').setInputFiles(pngFile('lontong.png'));
    await expect(dialog.getByRole('img', { name: 'Item photo' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add item' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('Lontong added to your menu');
    const added = row(page, 'Lontong');
    await expect(added).toContainText('$4.80');
    await expect(added).toContainText('10 left');
    await expect(added.getByRole('img', { name: 'Lontong photo' })).toBeVisible();
    await expect(page.locator('#menuSummary')).toHaveText('4 items · 3 available · 1 sold out');
  });

  // Boundary: 0 left → added as sold out
  test('should add an item with 0 left as sold out (boundary)', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('Tahu Goreng');
    await page.getByLabel('Price').fill('3');
    await page.getByLabel('Stock').selectOption('limited');
    await page.getByLabel('Quantity left').fill('0');
    await page.locator('#saveItem').click();

    await expect(page.getByRole('switch', { name: 'Tahu Goreng available' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  // Invalid partition: missing price is caught before sending
  test('should not add an item without a price', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('Rojak');
    await page.locator('#saveItem').click();

    await expect(page.locator('#itemError')).toContainText('Enter a price');
    await expect(page.getByLabel('Price')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.vm-item')).toHaveCount(STARTER_MENU.length);
  });

  // Error handling: duplicate name refused by the server, shown in the dialog
  test('should refuse a name that is already on the menu', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('curry laksa');
    await page.getByLabel('Price').fill('6');
    await page.locator('#saveItem').click();

    await expect(page.locator('#itemError')).toContainText('already have an item');
    await expect(page.getByRole('dialog', { name: 'Add item' })).toBeVisible();
  });

  // Valid partition: special characters are shown as typed, never as HTML
  test('should show special characters exactly as typed', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('Ah Ma\'s Mee & Tofu "Special"');
    await page.getByLabel('Price').fill('5');
    await page.locator('#saveItem').click();

    await expect(row(page, 'Ah Ma\'s Mee & Tofu "Special"')).toBeVisible();
  });

  // Valid partition: cancelling adds nothing
  test('should add nothing when cancelled', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('Never saved');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('.vm-item')).toHaveCount(STARTER_MENU.length);
  });
});

// ── Stock: No limit or a set quantity ────────────────────
test.describe('Vendor menu – No limit option', () => {
  // Valid partition: new items default to No limit, and the quantity box is hidden
  test('should default a new item to No limit', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();

    await expect(page.getByLabel('Stock')).toHaveValue('unlimited');
    await expect(page.getByLabel('Quantity left')).toBeHidden();

    await page.getByLabel('Name').fill('Chendol');
    await page.getByLabel('Price').fill('2.50');
    await page.locator('#saveItem').click();

    await expect(row(page, 'Chendol')).toContainText('No limit');
  });

  // Valid partition: switch a No limit item to a set quantity in the edit popup
  test('should switch an item from No limit to a quantity', async ({ page, request }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Edit Curry Laksa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit item' });
    await expect(dialog.getByLabel('Stock')).toHaveValue('unlimited');

    await dialog.getByLabel('Stock').selectOption({ label: 'Set quantity left' });
    await expect(dialog.getByLabel('Quantity left')).toBeFocused();
    await dialog.getByLabel('Quantity left').fill('8');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(row(page, 'Curry Laksa')).toContainText('8 left');
    const menu = await (await request.get(API)).json();
    expect(menu.items.find((i) => i.name === 'Curry Laksa').quantityLeft).toBe(8);
  });

  // Valid partition: switch a counted item back to No limit
  test('should switch an item from a quantity back to No limit', async ({ page, request }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Edit Mee Siam' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit item' });
    await expect(dialog.getByLabel('Stock')).toHaveValue('limited');
    await expect(dialog.getByLabel('Quantity left')).toHaveValue('2');

    await dialog.getByLabel('Stock').selectOption({ label: 'No limit' });
    await expect(dialog.getByLabel('Quantity left')).toBeHidden();
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(row(page, 'Mee Siam')).toContainText('No limit');
    const menu = await (await request.get(API)).json();
    expect(menu.items.find((i) => i.name === 'Mee Siam').quantityLeft).toBeNull();
  });

  // Valid partition: it can be switched back and forth as often as the vendor likes
  test('should switch back and forth repeatedly', async ({ page }) => {
    await openMenu(page);
    for (const [option, expected] of [
      ['limited', '5 left'],
      ['unlimited', 'No limit'],
      ['limited', '5 left'],
    ]) {
      await page.getByRole('button', { name: 'Edit Curry Laksa' }).click();
      await page.getByLabel('Stock').selectOption(option);
      if (option === 'limited') await page.getByLabel('Quantity left').fill('5');
      await page.locator('#saveItem').click();
      await expect(row(page, 'Curry Laksa')).toContainText(expected);
    }
  });

  // Invalid partition: "Set quantity left" with the box left empty
  test('should ask for a number when Set quantity left is chosen', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Name').fill('Rojak');
    await page.getByLabel('Price').fill('4');
    await page.getByLabel('Stock').selectOption('limited');
    await page.locator('#saveItem').click();

    await expect(page.locator('#itemError')).toContainText('Enter how many are left');
    await expect(page.getByLabel('Quantity left')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.vm-item')).toHaveCount(STARTER_MENU.length);
  });
});

// ── Editing and deleting ─────────────────────────────────
test.describe('Vendor menu – edit and delete', () => {
  // Valid partition: change the price
  test('should update an item', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Edit Curry Laksa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit item' });
    await expect(dialog.getByLabel('Price')).toHaveValue('5.50');
    await dialog.getByLabel('Price').fill('6.20');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(row(page, 'Curry Laksa').locator('.vm-item__price')).toHaveText('$6.20');
  });

  // Valid partition: delete after confirming
  test('should delete an item after confirming', async ({ page, request }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Delete Otah' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete Otah?' })).toBeVisible();
    await page.locator('#confirmDelete').click();

    await expect(row(page, 'Otah')).toHaveCount(0);
    const menu = await (await request.get(API)).json();
    expect(menu.items.map((i) => i.name)).not.toContain('Otah');
  });

  // Valid partition: cancelling the delete keeps the item
  test('should keep the item when delete is cancelled', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'Delete Otah' }).click();
    await page.locator('#cancelDelete').click();

    await expect(row(page, 'Otah')).toHaveCount(1);
  });
});

// ── Availability and quantity ────────────────────────────
test.describe('Vendor menu – availability', () => {
  // Valid partition: Available → Sold out, applied to the customer menu and checkout
  test('should mark an item sold out for customers and at checkout', async ({ page, request }) => {
    await openMenu(page);
    const toggle = page.getByRole('switch', { name: 'Curry Laksa available' });

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toHaveText('Sold out');
    await expect(page.locator('#menuSummary')).toHaveText('3 items · 1 available · 2 sold out');

    // Customer menu
    const customer = await page.context().newPage();
    await customer.goto(STALL_URL);
    const card = customer.locator('.sm-card', { hasText: 'Curry Laksa' });
    await expect(card).toHaveClass(/is-sold-out/);
    await expect(card.getByText('Sold out')).toBeVisible();

    // Checkout validation (open the stall so only the item is in question)
    await request.patch(`${BASE_URL}/vendors/${VENDOR_ID}/status`, { data: { isOpen: true } });
    const menu = await (await request.get(API)).json();
    const laksa = menu.items.find((i) => i.name === 'Curry Laksa');
    const check = await request.post(`${API}/checkout-check`, {
      data: { items: [{ itemId: laksa.id, quantity: 1 }] },
    });
    expect(check.status()).toBe(409);
    expect((await check.json()).problems[0].code).toBe('SOLD_OUT');
    await request.patch(`${BASE_URL}/vendors/${VENDOR_ID}/status`, {
      data: { isOpen: false, reason: 'END_OF_DAY' },
    });
  });

  // Valid partition: Sold out → Available
  test('should make a sold-out item available again', async ({ page }) => {
    await openMenu(page);
    const toggle = page.getByRole('switch', { name: 'Otah available' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  // Boundary: counting down to 0 marks it sold out; going back up makes it available
  test('should sell out at 0 left and come back when restocked (boundary)', async ({ page }) => {
    await openMenu(page);
    const mee = row(page, 'Mee Siam');
    const toggle = page.getByRole('switch', { name: 'Mee Siam available' });

    await page.getByRole('button', { name: 'One less Mee Siam' }).click();
    await expect(mee).toContainText('1 left');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'One less Mee Siam' }).click();
    await expect(mee).toContainText('0 left');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('button', { name: 'One less Mee Siam' })).toBeDisabled();

    await page.getByRole('button', { name: 'One more Mee Siam' }).click();
    await expect(mee).toContainText('1 left');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  // Error handling: an item with 0 left can't be switched on
  test('should explain why an item with 0 left cannot be made available', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: 'One less Mee Siam' }).click();
    await page.getByRole('button', { name: 'One less Mee Siam' }).click();
    const toggle = page.getByRole('switch', { name: 'Mee Siam available' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();

    await expect(page.locator('#toast')).toContainText('0 left');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

// ── Banner ───────────────────────────────────────────────
test.describe('Vendor menu – banner', () => {
  // Valid partition: upload, see it on the customer page, then remove it
  test('should save a banner, show it to customers and remove it', async ({ page }) => {
    await openMenu(page);
    await expect(page.locator('#bannerEmpty')).toBeVisible();

    await page.locator('#bannerInput').setInputFiles(pngFile('banner.png'));
    await page.getByRole('button', { name: 'Save banner' }).click();

    await expect(page.locator('#toast')).toHaveText('Banner updated');
    await expect(page.getByRole('img', { name: 'Your menu banner' })).toBeVisible();

    const customer = await page.context().newPage();
    await customer.goto(STALL_URL);
    await expect(customer.getByRole('img', { name: 'Mdm Lim Laksa banner' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove banner' }).click();
    await expect(page.locator('#bannerEmpty')).toBeVisible();
  });

  // Valid partition: discarding a chosen banner keeps the old state
  test('should discard a chosen banner without saving', async ({ page, request }) => {
    await openMenu(page);
    await page.locator('#bannerInput').setInputFiles(pngFile('banner.png'));
    await page.getByRole('button', { name: 'Discard' }).click();

    await expect(page.locator('#bannerEmpty')).toBeVisible();
    expect((await (await request.get(API)).json()).bannerUrl).toBeNull();
  });

  // Invalid partition: a file that isn't a picture
  test('should refuse a file that is not a picture', async ({ page }) => {
    await openMenu(page);
    await page.locator('#bannerInput').setInputFiles({
      name: 'menu.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    await expect(page.locator('#bannerError')).toHaveText(
      'Please choose a PNG, JPEG or WebP picture.',
    );
  });
});

// ── Customer stall page ──────────────────────────────────
test.describe('Customer stall page', () => {
  // Valid partition: shows the menu with live availability
  test('should show the menu with availability', async ({ page }) => {
    await page.goto(STALL_URL);

    await expect(page.getByRole('heading', { name: 'Mdm Lim Laksa' })).toBeVisible();
    await expect(page.locator('.sm-card')).toHaveCount(STARTER_MENU.length);
    await expect(page.locator('.sm-card', { hasText: 'Mee Siam' })).toContainText('Only 2 left');
    await expect(page.locator('.sm-card', { hasText: 'Otah' })).toHaveClass(/is-sold-out/);
    await expect(page.locator('#stallStatus')).toHaveText('Closed right now');
  });

  // Error handling: unknown stall
  test('should say when a stall does not exist', async ({ page }) => {
    await page.goto(`${BASE_URL}/stall.html?vendorId=999999`);
    await expect(page.getByRole('heading', { name: 'Stall not found' })).toBeVisible();
  });
});
