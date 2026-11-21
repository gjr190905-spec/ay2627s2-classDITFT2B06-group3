const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
// "Wong's Nasi Lemak" from scripts/seed.js. Only this spec uses vendor 4, so changing
// its order limit can't affect the dashboard or menu tests running alongside.
const VENDOR_ID = 4;
const API = `${BASE_URL}/vendors/${VENDOR_ID}`;
const SETTINGS_URL = `${BASE_URL}/vendor/settings.html?vendorId=${VENDOR_ID}`;

const DEFAULTS = {
  maxActiveOrders: null,
  notifications: { newOrder: true, soldOut: true, lowStock: true, lowStockThreshold: 3 },
};

async function nasiLemakId(request) {
  const menu = await (await request.get(`${API}/menu`)).json();
  return menu.items.find((i) => i.name === 'Nasi Lemak').id;
}

/** Place an order through the API (as a student would). Returns the response. */
async function placeOrder(request) {
  const now = Date.now();
  return request.post(`${API}/orders`, {
    data: {
      pickupWindowStart: new Date(now).toISOString(),
      pickupWindowEnd: new Date(now + 15 * 60000).toISOString(),
      items: [{ itemId: await nasiLemakId(request), quantity: 1 }],
    },
  });
}

async function activeOrders(request) {
  return (await (await request.get(`${API}/settings`)).json()).activeOrders;
}

// Every test starts from the default settings and an empty notification list
test.beforeEach(async ({ request }) => {
  expect((await request.put(`${API}/settings`, { data: DEFAULTS })).status()).toBe(200);
  await request.delete(`${API}/notifications`);
});

async function openSettings(page) {
  await page.goto(SETTINGS_URL);
  await expect(page.locator('#loadNote')).toContainText('Right now');
}

// ── Orders at once ───────────────────────────────────────
test.describe('Vendor settings – orders at once', () => {
  // Valid partition: defaults shown
  test('should show the default settings', async ({ page }) => {
    await openSettings(page);

    await expect(page.locator('#vendorStallName')).toHaveText("Wong's Nasi Lemak");
    await expect(page.getByLabel('Limit')).toHaveValue('none');
    await expect(page.getByLabel('Maximum orders')).toBeHidden();
    await expect(page.getByRole('switch', { name: /New orders/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /Sold out/ })).toBeChecked();
    await expect(page.getByRole('switch', { name: /Low stock/ })).toBeChecked();
    await expect(page.getByLabel('Tell me when this many or fewer are left')).toHaveValue('3');
  });

  // Valid partition: set a limit, save, and it is still there after a reload
  test('should save a limit', async ({ page }) => {
    await openSettings(page);

    await page.getByLabel('Limit').selectOption({ label: 'Set a limit' });
    await expect(page.getByLabel('Maximum orders')).toBeFocused();
    await page.getByLabel('Maximum orders').fill('25');
    await expect(page.locator('#saveState')).toHaveText('You have unsaved changes');
    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.locator('#toast')).toHaveText('Settings saved');
    await expect(page.locator('#saveState')).toHaveText('');
    await page.reload();
    await expect(page.getByLabel('Limit')).toHaveValue('limit');
    await expect(page.getByLabel('Maximum orders')).toHaveValue('25');
  });

  // Boundary: at the limit students can't order; back to No limit and they can
  test('should pause orders at the limit and resume with No limit', async ({ page, request }) => {
    const current = await activeOrders(request);
    await openSettings(page);

    // Limit = what's in progress now (at least 1) → full
    await page.getByLabel('Limit').selectOption('limit');
    await page.getByLabel('Maximum orders').fill(String(Math.max(1, current)));
    await page.getByRole('button', { name: 'Save settings' }).click();
    if (current === 0) expect((await placeOrder(request)).status()).toBe(201);

    await page.reload();
    await expect(page.locator('#loadNote')).toContainText('New orders are paused');
    const refused = await placeOrder(request);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).problems[0].code).toBe('STALL_BUSY');

    await page.getByLabel('Limit').selectOption('none');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#toast')).toHaveText('Settings saved');
    expect((await placeOrder(request)).status()).toBe(201);
  });

  // Invalid partition: "Set a limit" with no number, and 0
  for (const value of ['', '0', '201']) {
    test(`should not save a limit of "${value}"`, async ({ page, request }) => {
      await openSettings(page);
      await page.getByLabel('Limit').selectOption('limit');
      await page.getByLabel('Maximum orders').fill(value);
      await page.getByRole('button', { name: 'Save settings' }).click();

      await expect(page.locator('#settingsError')).toContainText('from 1 to 200');
      await expect(page.getByLabel('Maximum orders')).toHaveAttribute('aria-invalid', 'true');
      expect((await (await request.get(`${API}/settings`)).json()).maxActiveOrders).toBeNull();
    });
  }
});

// ── Notifications ────────────────────────────────────────
test.describe('Vendor settings – notifications', () => {
  // Valid partition: a new order shows as an unread notification
  test('should list a new order as unread', async ({ page, request }) => {
    const placed = await (await placeOrder(request)).json();
    await openSettings(page);

    const note = page.locator('.vs-note').first();
    await expect(note).toContainText(`New order #${placed.orderNumber}`);
    await expect(note.getByText('New', { exact: true })).toBeVisible();
    await expect(page.locator('#unreadNote')).toHaveText('1 unread');
  });

  // Valid partition: switching a type off stops it; switching it on again restarts it
  test('should stop and restart new-order notifications', async ({ page, request }) => {
    await openSettings(page);
    await page.getByRole('switch', { name: /New orders/ }).uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#toast')).toHaveText('Settings saved');

    await placeOrder(request);
    await page.reload();
    await expect(page.locator('#inboxEmpty')).toBeVisible();

    await page.getByRole('switch', { name: /New orders/ }).check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#toast')).toHaveText('Settings saved');
    await placeOrder(request);
    await page.reload();
    await expect(page.locator('.vs-note')).toHaveCount(1);
  });

  // Valid partition: the threshold box only shows while low-stock alerts are on
  test('should hide the low-stock number when low stock is off', async ({ page }) => {
    await openSettings(page);
    const threshold = page.getByLabel('Tell me when this many or fewer are left');
    await page.getByRole('switch', { name: /Low stock/ }).uncheck();
    await expect(threshold).toBeHidden();
    await page.getByRole('switch', { name: /Low stock/ }).check();
    await expect(threshold).toBeVisible();
  });

  // Invalid partition: low-stock number out of range
  test('should not save a low-stock number of 51', async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Tell me when this many or fewer are left').fill('51');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#settingsError')).toContainText('from 1 to 50');
  });

  // Valid partition: mark all as read
  test('should mark all as read', async ({ page, request }) => {
    await placeOrder(request);
    await placeOrder(request);
    await openSettings(page);
    await expect(page.locator('#unreadNote')).toHaveText('2 unread');

    await page.getByRole('button', { name: 'Mark all as read' }).click();

    await expect(page.locator('#toast')).toHaveText('2 notifications marked as read');
    await expect(page.locator('#unreadNote')).toHaveText('All caught up');
    await expect(page.locator('.vs-note.is-unread')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  // Valid partition: clear all after confirming; cancelling keeps them
  test('should clear all only after confirming', async ({ page, request }) => {
    await placeOrder(request);
    await openSettings(page);

    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.vs-note')).toHaveCount(1);

    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear all' }).click();
    await expect(page.locator('#inboxEmpty')).toBeVisible();
    await expect(page.locator('#toast')).toHaveText('Notifications cleared');
  });

  // Valid partition: the home page shows the unread count on the Settings tile
  test('should show unread notifications on the home page', async ({ page, request }) => {
    await placeOrder(request);
    await page.goto(`${BASE_URL}/vendor/home.html?vendorId=${VENDOR_ID}`);
    await expect(page.locator('#settingsBadge')).toHaveText('1 new');

    await request.post(`${API}/notifications/read-all`);
    await page.reload();
    await expect(page.locator('#vendorStallName')).toHaveText("Wong's Nasi Lemak");
    await expect(page.locator('#settingsBadge')).toBeHidden();
  });
});

// ── Session ──────────────────────────────────────────────
test('should show the signed-out message without a session', async ({ page }) => {
  await page.goto(`${BASE_URL}/vendor/settings.html`);
  await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
});
