const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
// "Kopi Corner" from scripts/seed.js (open). The home tests use vendor 1 and the
// menu tests vendor 2, so the three spec files never touch each other's data.
const VENDOR_ID = 3;
const API = `${BASE_URL}/vendors/${VENDOR_ID}`;
const DASHBOARD_URL = `${BASE_URL}/vendor/dashboard.html?vendorId=${VENDOR_ID}`;

async function menuItemId(request, name) {
  const menu = await (await request.get(`${API}/menu`)).json();
  return menu.items.find((i) => i.name === name).id;
}

/** Place an order through the API, in a window starting now. */
async function placeOrder(request, items, customerName = 'Test Student') {
  const lines = [];
  for (const [name, quantity] of items) {
    lines.push({ itemId: await menuItemId(request, name), quantity });
  }
  const now = Date.now();
  const res = await request.post(`${API}/orders`, {
    data: {
      customerName,
      pickupWindowStart: new Date(now).toISOString(),
      pickupWindowEnd: new Date(now + 15 * 60000).toISOString(),
      items: lines,
    },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function makeReady(request, order) {
  await request.patch(`${API}/orders/${order.id}/status`, { data: { status: 'PREPARING' } });
  await request.patch(`${API}/orders/${order.id}/status`, { data: { status: 'READY' } });
}

const card = (page, order) =>
  page.locator('.db-order', {
    has: page.getByRole('heading', { name: `#${order.orderNumber}`, exact: true }),
  });

async function openDashboard(page) {
  await page.goto(DASHBOARD_URL);
  await expect(page.locator('#tileOrders')).not.toHaveText('–');
}

// ── Page load and charts ─────────────────────────────────
test.describe('Vendor dashboard – figures', () => {
  // Valid partition: tiles and charts are filled in
  test('should show the tiles and charts', async ({ page }) => {
    await openDashboard(page);

    await expect(page.locator('#vendorStallName')).toHaveText('Kopi Corner');
    await expect(page.getByRole('heading', { name: 'Orders by pickup window' })).toBeVisible();
    await expect(page.locator('#windowsChart .db-columns__bar').first()).toBeVisible();
    await expect(page.locator('#salesChart .db-columns__bar')).toHaveCount(7);
    await expect(page.getByRole('meter', { name: 'Ready on time' })).toBeVisible();
    await expect(page.locator('#statusChart .db-legend li')).toHaveCount(5);
  });

  // Valid partition: the chart numbers are reachable without hovering
  test('should offer each chart as a table and a keyboard tooltip', async ({ page }) => {
    await openDashboard(page);

    await page.locator('#salesChart summary').click();
    await expect(page.locator('#salesChart table tbody tr')).toHaveCount(7);

    await page.locator('#windowsChart .db-columns__slot').first().focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await expect(page.getByRole('tooltip')).toContainText(/order/);
  });

  // Valid partition: a new order is counted
  test('should count a newly placed order', async ({ page, request }) => {
    await openDashboard(page);
    const before = Number(await page.locator('#tileOrders').textContent());

    await placeOrder(request, [['Kopi', 1]]);
    await page.reload();

    await expect(page.locator('#tileOrders')).toHaveText(String(before + 1));
  });

  // Error handling: no session
  test('should show the signed-out message without a session', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/dashboard.html`);
    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
  });
});

// ── Preparation board ────────────────────────────────────
test.describe('Vendor dashboard – preparation', () => {
  // Valid partition: an order shows in its window with number, items, quantities, status
  test('should show an order in its pickup window', async ({ page, request }) => {
    const order = await placeOrder(request, [
      ['Kopi', 2],
      ['Teh Tarik', 1],
    ]);
    await openDashboard(page);

    const c = card(page, order);
    await expect(c).toContainText('2 × Kopi');
    await expect(c).toContainText('1 × Teh Tarik');
    await expect(c).toContainText('$4.70');
    await expect(c.locator('.db-status')).toHaveText('Confirmed');
    // It sits in the window that is on now
    const win = page.locator('.db-window', { has: c });
    await expect(win.locator('.db-window__tag')).toHaveText('Now');
  });

  // Valid partition: Confirmed → Preparing → Ready, with the ready time recorded
  test('should move an order from Confirmed to Preparing to Ready', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 1]]);
    await openDashboard(page);
    const c = card(page, order);

    await c.getByRole('button', { name: `Start preparing: order ${order.orderNumber}` }).click();
    await expect(c.locator('.db-status')).toHaveText('Preparing');

    await c.getByRole('button', { name: `Mark ready: order ${order.orderNumber}` }).click();
    await expect(c.locator('.db-status')).toHaveText('Ready');
    await expect(c.locator('.db-order__ready')).toContainText('on time');

    const saved = await (await request.get(`${API}/orders/${order.id}`)).json();
    expect(saved.readyAt).not.toBeNull();
    expect(saved.readyOnTime).toBe(true);
  });

  // Valid partition: filters show only the matching orders
  test('should filter the board', async ({ page, request }) => {
    const ready = await placeOrder(request, [['Kopi', 1]]);
    await makeReady(request, ready);
    const confirmed = await placeOrder(request, [['Teh Tarik', 1]]);
    await openDashboard(page);

    await page.getByRole('button', { name: /^Ready \d+/ }).click();
    await expect(card(page, ready)).toBeVisible();
    await expect(card(page, confirmed)).toHaveCount(0);

    await page.getByRole('button', { name: /^All \d+/ }).click();
    await expect(card(page, confirmed)).toBeVisible();
  });
});

// ── Handover and collection ──────────────────────────────
test.describe('Vendor dashboard – handover', () => {
  // Valid partition: open from the board, check, take payment, hand over, collect
  test('should hand over a ready order and mark it collected', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 2]]);
    await makeReady(request, order);
    await openDashboard(page);

    await card(page, order)
      .getByRole('button', { name: `Hand over order ${order.orderNumber}` })
      .click();
    const dialog = page.getByRole('dialog', { name: `Order #${order.orderNumber}` });
    await expect(dialog).toContainText('2 ×');
    await expect(dialog).toContainText('Kopi');
    await expect(dialog.locator('#handoverAmount')).toHaveText('$3.00');

    await dialog.getByLabel("Order number on the student's screen").fill(String(order.orderNumber));
    await dialog.getByLabel("I've taken payment of $3.00").check();
    await dialog.getByLabel("I've handed over the food").check();
    await dialog.getByRole('button', { name: 'Mark collected' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('#toast')).toHaveText(`#${order.orderNumber} collected`);
    await page.getByRole('button', { name: /^Collected \d+/ }).click();
    await expect(card(page, order)).toContainText(/Collected \d/);

    const saved = await (await request.get(`${API}/orders/${order.id}`)).json();
    expect(saved.status).toBe('COLLECTED');
    expect(saved.collectedAt).not.toBeNull();
  });

  // Error handling: the number typed must match the order
  test('should refuse a number that does not match', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 1]]);
    await makeReady(request, order);
    await openDashboard(page);

    await card(page, order)
      .getByRole('button', { name: `Hand over order ${order.orderNumber}` })
      .click();
    await page.getByLabel("Order number on the student's screen").fill('1');
    await page.getByLabel(/I've taken payment/).check();
    await page.getByLabel("I've handed over the food").check();
    await page.getByRole('button', { name: 'Mark collected' }).click();

    await expect(page.locator('#collectError')).toContainText("doesn't match");
    const saved = await (await request.get(`${API}/orders/${order.id}`)).json();
    expect(saved.status).toBe('READY');
  });

  // Invalid partition: payment and handover must both be ticked
  test('should ask for payment before collecting', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 1]]);
    await makeReady(request, order);
    await openDashboard(page);

    await card(page, order)
      .getByRole('button', { name: `Hand over order ${order.orderNumber}` })
      .click();
    await page.getByLabel("Order number on the student's screen").fill(String(order.orderNumber));
    await page.getByRole('button', { name: 'Mark collected' }).click();

    await expect(page.locator('#collectError')).toContainText('Take payment first');
  });

  // Valid partition: find a ready order by number and open it
  test('should find a ready order by number', async ({ page, request }) => {
    const order = await placeOrder(request, [['Teh Tarik', 2]]);
    await makeReady(request, order);
    await openDashboard(page);

    await page.getByLabel('Find an order').fill(String(order.orderNumber));
    await page.getByRole('button', { name: 'Find' }).click();

    const dialog = page.getByRole('dialog', { name: `Order #${order.orderNumber}` });
    await expect(dialog.locator('#handoverAmount')).toHaveText('$3.40');
    await expect(dialog.getByRole('button', { name: 'Mark collected' })).toBeVisible();
  });

  // Error handling: an order that isn't ready can be found but not collected
  test('should not offer collection for an order that is not ready', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 1]]);
    await openDashboard(page);

    await page.getByLabel('Find an order').fill(String(order.orderNumber));
    await page.getByRole('button', { name: 'Find' }).click();

    const dialog = page.getByRole('dialog', { name: `Order #${order.orderNumber}` });
    await expect(dialog.locator('#handoverState')).toContainText('Not ready yet');
    await expect(dialog.getByRole('button', { name: 'Mark collected' })).toBeHidden();
  });

  // Error handling: a collected order shows its collection time and can't be collected again
  test('should show a collected order as closed', async ({ page, request }) => {
    const order = await placeOrder(request, [['Kopi', 1]]);
    await makeReady(request, order);
    await request.post(`${API}/orders/${order.id}/collect`, {
      data: { orderNumber: order.orderNumber, paymentReceived: true, foodHandedOver: true },
    });
    await openDashboard(page);

    await page.getByLabel('Find an order').fill(String(order.orderNumber));
    await page.getByRole('button', { name: 'Find' }).click();

    await expect(page.locator('#handoverState')).toContainText('This order is closed');
    await expect(page.getByRole('button', { name: 'Mark collected' })).toBeHidden();
  });

  // Error handling: unknown number and bad input
  for (const [typed, message] of [
    ['999999', 'No order #999999 at your stall'],
    ['abc', 'Enter the order number'],
  ]) {
    test(`should explain when "${typed}" can't be found`, async ({ page }) => {
      await openDashboard(page);
      await page.getByLabel('Find an order').fill(typed);
      await page.getByRole('button', { name: 'Find' }).click();
      await expect(page.locator('#findError')).toContainText(message);
      await expect(page.getByRole('dialog')).toBeHidden();
    });
  }
});
