const { test, expect } = require('@playwright/test');

// ── Helpers ──────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
const VENDOR_ID = 1; // "Ah Seng Chicken Rice" from scripts/seed.js
const HOME_URL = `${BASE_URL}/vendor/home.html?vendorId=${VENDOR_ID}`;

/**
 * Put the seeded vendor into a known state before each test.
 * A 409 just means it was already in that state, which is fine.
 */
async function setStall(request, isOpen) {
  const body = isOpen ? { isOpen } : { isOpen, reason: 'BREAK' };
  const res = await request.patch(`${BASE_URL}/vendors/${VENDOR_ID}/status`, { data: body });
  expect([200, 409]).toContain(res.status());
}

async function openHome(page) {
  await page.goto(HOME_URL);
  await expect(page.locator('#statusToggle')).toBeVisible();
}

// ── Page load ────────────────────────────────────────────
test.describe('Vendor home – page load', () => {
  test.beforeEach(async ({ request }) => setStall(request, true));

  // Valid partition: header shows the vendor's name and configured logo
  test('should show the stall name and logo in the header', async ({ page }) => {
    await openHome(page);

    const header = page.getByRole('banner');
    await expect(header.locator('#vendorStallName')).toHaveText('Ah Seng Chicken Rice');
    await expect(header.getByRole('img', { name: 'Ah Seng Chicken Rice logo' })).toBeVisible();
  });

  // Valid partition: logout sits in the header
  test('should show a Log out button in the header', async ({ page }) => {
    await openHome(page);

    await expect(page.getByRole('banner').getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  // Valid partition: all five services are linked
  test('should link to the five vendor services', async ({ page }) => {
    await openHome(page);

    const nav = page.getByRole('navigation', { name: 'Where to next?' });
    const expected = [
      ['Dashboard', /dashboard\.html$/],
      ['Menu', /menu\.html$/],
      ['Payment & pickup handover', /payment-pickup\.html$/],
      ['Profile', /profile\.html$/],
      ['Settings', /settings\.html$/],
    ];

    await expect(nav.getByRole('link')).toHaveCount(expected.length);
    for (const [name, href] of expected) {
      await expect(nav.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
        'href',
        href,
      );
    }
  });

  // Valid partition: clicking a service leaves the home page
  test('should navigate away when a service is clicked', async ({ page }) => {
    await openHome(page);

    await page.getByRole('link', { name: /^Menu/ }).click();

    await expect(page).toHaveURL(/\/vendor\/menu\.html$/);
  });
});

/**
 * Check the Open / Closed sign: the right picture, its alt text, and that it loaded.
 */
async function expectSign(page, word) {
  const sign = page.getByRole('img', { name: word, exact: true });
  await expect(sign).toBeVisible();
  await expect(sign).toHaveAttribute('src', `../images/status/${word.toLowerCase()}-sign.png`);
  await expect.poll(() => sign.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
}

// ── Closing the stall ────────────────────────────────────
test.describe('Vendor home – close stall', () => {
  test.beforeEach(async ({ request, page }) => {
    await setStall(request, true);
    await openHome(page);
  });

  // Valid partition: open stall shows OPEN and a Close stall button
  test('should show the open status', async ({ page }) => {
    await expectSign(page, 'Open');
    await expect(page.getByRole('button', { name: 'Close stall' })).toBeVisible();
  });

  // Valid partition: closing asks for a reason first
  test('should ask for a reason when closing', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();

    const dialog = page.getByRole('dialog', { name: 'Why are you closing?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    await expect(dialog.getByRole('radio', { name: 'Other' })).toBeVisible();
  });

  // Valid partition: Cancel leaves the stall open
  test('should keep the stall open when Cancel is clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expectSign(page, 'Open');
  });

  // Valid partition: pick a listed reason and confirm
  test('should close the stall with a listed reason', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Sold out for the day' }).check();
    await dialog.getByRole('button', { name: 'Close stall' }).click();

    await expect(dialog).toBeHidden();
    await expectSign(page, 'Closed');
    await expect(page.getByRole('button', { name: 'Open stall' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Stall closed');
  });

  // Valid partition: closed status survives a reload (persisted in DB)
  test('should still be closed after reloading', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    await page.getByRole('radio', { name: 'Taking a short break' }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Close stall' }).click();
    await expectSign(page, 'Closed');

    await page.reload();

    await expectSign(page, 'Closed');
  });

  // Valid partition: Other reveals a text box; typed reason is accepted
  test('should close with an Other reason the vendor types', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Tell us what happened')).toBeHidden();

    await dialog.getByRole('radio', { name: 'Other' }).check();
    await expect(dialog.getByLabel('Tell us what happened')).toBeVisible();
    await dialog.getByLabel('Tell us what happened').fill('Gas tank ran out');
    await dialog.getByRole('button', { name: 'Close stall' }).click();

    await expectSign(page, 'Closed');
  });

  // Boundary: confirming with no reason selected is blocked
  test('should not close when no reason is picked', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Close stall' }).click();

    await expect(dialog.getByRole('alert')).toHaveText('Pick a reason for closing.');
    await expect(dialog).toBeVisible();
  });

  // Boundary: Other with blank text is blocked
  test('should not close when Other is picked but left blank', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Other' }).check();
    await dialog.getByLabel('Tell us what happened').fill('   ');
    await dialog.getByRole('button', { name: 'Close stall' }).click();

    await expect(dialog.getByRole('alert')).toHaveText('Type a reason, or pick one from the list.');
    await expectSign(page, 'Open');
  });

  // Boundary / XSS: typed reason with HTML is accepted as plain text
  test('should accept special characters in the Other reason', async ({ page }) => {
    await page.getByRole('button', { name: 'Close stall' }).click();
    await page.getByRole('radio', { name: 'Other' }).check();
    await page.getByLabel('Tell us what happened').fill('<b>bold</b> & "quotes"');
    await page.getByRole('dialog').getByRole('button', { name: 'Close stall' }).click();

    await expectSign(page, 'Closed');
  });
});

// ── Opening the stall ────────────────────────────────────
test.describe('Vendor home – open stall', () => {
  test.beforeEach(async ({ request }) => setStall(request, false));

  // Valid partition: opening asks no questions
  test('should open the stall straight away without a prompt', async ({ page }) => {
    await openHome(page);
    await expectSign(page, 'Closed');

    await page.getByRole('button', { name: 'Open stall' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expectSign(page, 'Open');
    await expect(page.getByRole('status')).toHaveText('Stall opened');
  });
});

// ── Session / logout ─────────────────────────────────────
test.describe('Vendor home – session', () => {
  // Valid partition: logout clears the session and leaves the page
  test('should log out and clear the session', async ({ page }) => {
    await openHome(page);

    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).not.toHaveURL(/vendor\/home\.html/);
    expect(await page.evaluate(() => sessionStorage.getItem('vendorId'))).toBeNull();
  });

  // Valid partition: after logout, returning to home shows the signed-out state
  test('should show the signed-out message when there is no session', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/home.html`);

    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();
  });

  // Boundary: a vendor id that doesn't exist is treated as signed out
  test('should treat an unknown vendor id as signed out', async ({ page }) => {
    await page.goto(`${BASE_URL}/vendor/home.html?vendorId=999999`);

    await expect(page.getByRole('heading', { name: "You're signed out" })).toBeVisible();
  });

  // Valid partition: session id is remembered without the query param
  test('should remember the vendor when the page is opened again', async ({ page }) => {
    await openHome(page);

    await page.goto(`${BASE_URL}/vendor/home.html`);

    await expect(page.locator('#vendorStallName')).toHaveText('Ah Seng Chicken Rice');
  });
});
