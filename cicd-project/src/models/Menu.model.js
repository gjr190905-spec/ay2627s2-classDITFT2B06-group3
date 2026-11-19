const pool = require('./db');

// Postgres error codes
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

// Columns of a menu item plus when its photo last changed (used to build imageUrl).
// "m" is "MenuItem" (or a CTE with the same columns), "img" is "MenuItemImage".
const ITEM_SELECT = `
  SELECT m."id", m."vendorId", m."name", m."description", m."priceCents",
         m."quantityLeft", m."isSoldOut", m."updatedAt", img."updatedAt" AS "imageUpdatedAt"`;

// ── Addresses for stored pictures ────────────────────────
// The ?v= part changes with every upload, so browsers never show a cached old picture.

function itemImageUrlFor(vendorId, itemId, version) {
  return `/vendors/${vendorId}/menu/items/${itemId}/image?v=${version}`;
}

function bannerUrlFor(vendorId, version) {
  return `/vendors/${vendorId}/menu/banner?v=${version}`;
}

/**
 * Turn a database row into the shape the API sends.
 * "isAvailable" is what both the customer menu and checkout validation go by.
 */
function toMenuItem(row) {
  return {
    id: row.id,
    vendorId: row.vendorId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    price: row.priceCents / 100,
    quantityLeft: row.quantityLeft,
    isSoldOut: row.isSoldOut,
    isAvailable: !row.isSoldOut,
    imageUrl: row.imageUpdatedAt
      ? itemImageUrlFor(row.vendorId, row.id, row.imageUpdatedAt.getTime())
      : null,
    updatedAt: row.updatedAt,
  };
}

module.exports.itemImageUrlFor = itemImageUrlFor;
module.exports.bannerUrlFor = bannerUrlFor;
module.exports.toMenuItem = toMenuItem;

/**
 * Run fn(client) inside a transaction. Rolls back if fn throws.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Reading the menu ─────────────────────────────────────

/**
 * Everything the menu pages need: the stall, its banner and its (not deleted) items.
 * Used by the vendor's menu page and the customer-facing stall page.
 *
 * @returns {Promise<{vendor: object, bannerUrl: string|null, items: object[]}|undefined>}
 *          undefined if the vendor does not exist
 */
module.exports.getMenu = async function getMenu(vendorId) {
  const vendorResult = await pool.query(
    `SELECT v."id", v."stallName", v."logoUrl", v."isOpen", b."updatedAt" AS "bannerUpdatedAt"
     FROM "Vendor" v
     LEFT JOIN "MenuBanner" b ON b."vendorId" = v."id"
     WHERE v."id" = $1`,
    [vendorId],
  );
  const row = vendorResult.rows[0];
  if (!row) return undefined;

  const itemsResult = await pool.query(
    `${ITEM_SELECT}
     FROM "MenuItem" m
     LEFT JOIN "MenuItemImage" img ON img."itemId" = m."id"
     WHERE m."vendorId" = $1 AND m."deletedAt" IS NULL
     ORDER BY m."id"`,
    [vendorId],
  );

  return {
    vendor: { id: row.id, stallName: row.stallName, logoUrl: row.logoUrl, isOpen: row.isOpen },
    bannerUrl: row.bannerUpdatedAt ? bannerUrlFor(row.id, row.bannerUpdatedAt.getTime()) : null,
    items: itemsResult.rows.map(toMenuItem),
  };
};

/**
 * One (not deleted) menu item that belongs to the given vendor.
 * @returns {Promise<object|undefined>}
 */
module.exports.getMenuItem = async function getMenuItem(vendorId, itemId) {
  const { rows } = await pool.query(
    `${ITEM_SELECT}
     FROM "MenuItem" m
     LEFT JOIN "MenuItemImage" img ON img."itemId" = m."id"
     WHERE m."id" = $1 AND m."vendorId" = $2 AND m."deletedAt" IS NULL`,
    [itemId, vendorId],
  );
  return rows[0] ? toMenuItem(rows[0]) : undefined;
};

// ── Adding, changing and deleting items ──────────────────

/**
 * Add an item to a vendor's menu. An item added with 0 left starts as sold out.
 *
 * @param {number} vendorId
 * @param {{name: string, description: string|null, priceCents: number, quantityLeft: number|null}} fields
 * @returns {Promise<object|undefined|null>}
 *          the new item, undefined if the vendor does not exist,
 *          or null if the vendor already has an item with that name
 */
module.exports.createMenuItem = async function createMenuItem(vendorId, fields) {
  const { name, description, priceCents, quantityLeft } = fields;
  try {
    const { rows } = await pool.query(
      `INSERT INTO "MenuItem" ("vendorId", "name", "description", "priceCents", "quantityLeft", "isSoldOut")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "id", "vendorId", "name", "description", "priceCents", "quantityLeft",
                 "isSoldOut", "updatedAt", NULL::timestamptz AS "imageUpdatedAt"`,
      [vendorId, name, description, priceCents, quantityLeft, quantityLeft === 0],
    );
    return toMenuItem(rows[0]);
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    if (error.code === FOREIGN_KEY_VIOLATION) return undefined;
    throw error;
  }
};

// Columns the vendor may change through updateMenuItem, in a fixed order
const EDITABLE_COLUMNS = ['name', 'description', 'priceCents', 'quantityLeft'];

/**
 * Change some of an item's details. Only the fields present in `fields` are changed.
 *
 * Setting quantityLeft also sets availability: 0 left marks it Sold out, and a number
 * above 0 marks it Available again (the vendor has restocked). Setting it to null
 * (stop counting) leaves the Available / Sold out switch as it was.
 *
 * @returns {Promise<object|undefined|null>}
 *          the updated item, undefined if the item does not exist (or belongs to another
 *          vendor, or was deleted), or null if the new name is already used on this menu
 */
module.exports.updateMenuItem = async function updateMenuItem(vendorId, itemId, fields) {
  const sets = [];
  const params = [itemId, vendorId];

  EDITABLE_COLUMNS.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(fields, column)) {
      params.push(fields[column]);
      sets.push(`"${column}" = $${params.length}`);
    }
  });

  if (
    Object.prototype.hasOwnProperty.call(fields, 'quantityLeft') &&
    fields.quantityLeft !== null
  ) {
    params.push(fields.quantityLeft === 0);
    sets.push(`"isSoldOut" = $${params.length}`);
  }

  sets.push('"updatedAt" = NOW()');

  try {
    const { rows } = await pool.query(
      `WITH m AS (
         UPDATE "MenuItem" SET ${sets.join(', ')}
         WHERE "id" = $1 AND "vendorId" = $2 AND "deletedAt" IS NULL
         RETURNING *
       )
       ${ITEM_SELECT}
       FROM m
       LEFT JOIN "MenuItemImage" img ON img."itemId" = m."id"`,
      params,
    );
    return rows[0] ? toMenuItem(rows[0]) : undefined;
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw error;
  }
};

/**
 * Switch an item between Available and Sold out.
 * The row is locked (FOR UPDATE) so a quantity change can't slip in between the check and
 * the update. An item with 0 left can't be made Available: the vendor must set how many
 * are left first (or stop counting).
 *
 * @returns {Promise<{item: object, changed: boolean}|{noneLeft: true, item: object}|undefined>}
 *          undefined if the item does not exist for this vendor
 */
module.exports.setMenuItemAvailability = async function setMenuItemAvailability(
  vendorId,
  itemId,
  isAvailable,
) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT "quantityLeft", "isSoldOut" FROM "MenuItem"
       WHERE "id" = $1 AND "vendorId" = $2 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [itemId, vendorId],
    );
    const row = current.rows[0];
    if (!row) return undefined;

    if (row.isSoldOut === !isAvailable) {
      return { item: await readItem(client, itemId), changed: false };
    }
    if (isAvailable && row.quantityLeft === 0) {
      return { noneLeft: true, item: await readItem(client, itemId) };
    }

    await client.query(
      'UPDATE "MenuItem" SET "isSoldOut" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [!isAvailable, itemId],
    );
    return { item: await readItem(client, itemId), changed: true };
  });
};

async function readItem(client, itemId) {
  const { rows } = await client.query(
    `${ITEM_SELECT}
     FROM "MenuItem" m
     LEFT JOIN "MenuItemImage" img ON img."itemId" = m."id"
     WHERE m."id" = $1`,
    [itemId],
  );
  return toMenuItem(rows[0]);
}

/**
 * Delete an item from the menu. The row is kept but hidden ("deletedAt"), so records
 * that point at it stay intact; its photo is removed to free the space.
 *
 * @returns {Promise<boolean>} false if the item does not exist for this vendor
 */
module.exports.deleteMenuItem = async function deleteMenuItem(vendorId, itemId) {
  return withTransaction(async (client) => {
    const deleted = await client.query(
      `UPDATE "MenuItem" SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = $1 AND "vendorId" = $2 AND "deletedAt" IS NULL
       RETURNING "id"`,
      [itemId, vendorId],
    );
    if (deleted.rows.length === 0) return false;
    await client.query('DELETE FROM "MenuItemImage" WHERE "itemId" = $1', [itemId]);
    return true;
  });
};

// ── Item photos (one per item) ───────────────────────────

/**
 * Replace an item's photo. One row per item, so a new photo replaces the old one.
 *
 * @returns {Promise<object|undefined>} the updated item, or undefined if it does not exist
 */
module.exports.updateMenuItemImage = async function updateMenuItemImage(
  vendorId,
  itemId,
  data,
  mimeType,
) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT "id" FROM "MenuItem"
       WHERE "id" = $1 AND "vendorId" = $2 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [itemId, vendorId],
    );
    if (current.rows.length === 0) return undefined;

    await client.query(
      `INSERT INTO "MenuItemImage" ("itemId", "data", "mimeType", "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("itemId")
       DO UPDATE SET "data" = EXCLUDED."data", "mimeType" = EXCLUDED."mimeType", "updatedAt" = NOW()`,
      [itemId, data, mimeType],
    );
    await client.query('UPDATE "MenuItem" SET "updatedAt" = NOW() WHERE "id" = $1', [itemId]);
    return readItem(client, itemId);
  });
};

/**
 * Remove an item's photo. Removing a photo that isn't there is not an error.
 *
 * @returns {Promise<object|undefined>} the updated item, or undefined if it does not exist
 */
module.exports.deleteMenuItemImage = async function deleteMenuItemImage(vendorId, itemId) {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT "id" FROM "MenuItem"
       WHERE "id" = $1 AND "vendorId" = $2 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [itemId, vendorId],
    );
    if (current.rows.length === 0) return undefined;

    await client.query('DELETE FROM "MenuItemImage" WHERE "itemId" = $1', [itemId]);
    return readItem(client, itemId);
  });
};

/**
 * Read an item's stored photo (only for items that are still on the menu).
 * @returns {Promise<{data: Buffer, mimeType: string, updatedAt: Date}|undefined>}
 */
module.exports.getMenuItemImage = async function getMenuItemImage(vendorId, itemId) {
  const { rows } = await pool.query(
    `SELECT img."data", img."mimeType", img."updatedAt"
     FROM "MenuItemImage" img
     JOIN "MenuItem" m ON m."id" = img."itemId"
     WHERE img."itemId" = $1 AND m."vendorId" = $2 AND m."deletedAt" IS NULL`,
    [itemId, vendorId],
  );
  return rows[0];
};

// ── Menu banner (one per vendor) ─────────────────────────

/**
 * Replace the vendor's menu banner. One row per vendor, so there is only ever one banner.
 *
 * @returns {Promise<{bannerUrl: string}|undefined>} undefined if the vendor does not exist
 */
module.exports.updateMenuBanner = async function updateMenuBanner(vendorId, data, mimeType) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO "MenuBanner" ("vendorId", "data", "mimeType", "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("vendorId")
       DO UPDATE SET "data" = EXCLUDED."data", "mimeType" = EXCLUDED."mimeType", "updatedAt" = NOW()
       RETURNING "updatedAt"`,
      [vendorId, data, mimeType],
    );
    return { bannerUrl: bannerUrlFor(vendorId, rows[0].updatedAt.getTime()) };
  } catch (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) return undefined;
    throw error;
  }
};

/**
 * Remove the vendor's menu banner. Removing a banner that isn't there is not an error.
 *
 * @returns {Promise<{bannerUrl: null}|undefined>} undefined if the vendor does not exist
 */
module.exports.deleteMenuBanner = async function deleteMenuBanner(vendorId) {
  const vendor = await pool.query('SELECT "id" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;
  await pool.query('DELETE FROM "MenuBanner" WHERE "vendorId" = $1', [vendorId]);
  return { bannerUrl: null };
};

/**
 * Read the vendor's stored banner.
 * @returns {Promise<{data: Buffer, mimeType: string, updatedAt: Date}|undefined>}
 */
module.exports.getMenuBanner = async function getMenuBanner(vendorId) {
  const { rows } = await pool.query(
    'SELECT "data", "mimeType", "updatedAt" FROM "MenuBanner" WHERE "vendorId" = $1',
    [vendorId],
  );
  return rows[0];
};

// ── Checkout validation ──────────────────────────────────

/**
 * Check a basket against the menu as it is right now, for checkout.
 * Refuses items that are Sold out, deleted, from another stall, or short on quantity,
 * and refuses the whole basket when the stall is closed.
 *
 * This only checks; it does not reserve anything. The order step (not built yet) should
 * repeat these checks and reduce "quantityLeft" inside the same transaction that saves
 * the order, with the item rows locked (FOR UPDATE).
 *
 * @param {number} vendorId
 * @param {{itemId: number, quantity: number}[]} lines  one line per item (already merged)
 * @returns {Promise<{ok: boolean, items: object[], problems: object[], totalCents: number}|undefined>}
 *          undefined if the vendor does not exist
 */
module.exports.checkCheckoutItems = async function checkCheckoutItems(vendorId, lines) {
  const vendor = await pool.query('SELECT "isOpen" FROM "Vendor" WHERE "id" = $1', [vendorId]);
  if (vendor.rows.length === 0) return undefined;

  const ids = lines.map((line) => line.itemId);
  const { rows } = await pool.query(
    `SELECT "id", "name", "priceCents", "quantityLeft", "isSoldOut"
     FROM "MenuItem"
     WHERE "vendorId" = $1 AND "id" = ANY($2::int[]) AND "deletedAt" IS NULL`,
    [vendorId, ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  const problems = [];
  if (!vendor.rows[0].isOpen) {
    problems.push({ itemId: null, code: 'STALL_CLOSED', message: 'This stall is closed' });
  }

  const items = [];
  lines.forEach(({ itemId, quantity }) => {
    const item = byId.get(itemId);
    if (!item) {
      problems.push({ itemId, code: 'NOT_FOUND', message: 'This item is no longer on the menu' });
      return;
    }
    if (item.isSoldOut) {
      problems.push({ itemId, code: 'SOLD_OUT', message: `${item.name} is sold out` });
      return;
    }
    if (item.quantityLeft !== null && quantity > item.quantityLeft) {
      problems.push({
        itemId,
        code: 'NOT_ENOUGH',
        message: `Only ${item.quantityLeft} ${item.name} left`,
        quantityLeft: item.quantityLeft,
      });
      return;
    }
    items.push({
      itemId,
      name: item.name,
      priceCents: item.priceCents,
      quantity,
      lineTotalCents: item.priceCents * quantity,
    });
  });

  const totalCents = items.reduce((sum, line) => sum + line.lineTotalCents, 0);
  return { ok: problems.length === 0, items, problems, totalCents };
};
