/* ─────────────────────────────────────────────────────────
   Customer stall page: /stall.html?vendorId=<id>
   Shows a stall's banner, menu and live item availability.
   Reads GET /vendors/:id/menu – the same data the vendor edits –
   and checks again every few seconds, so a vendor marking an item
   Sold out shows up here without a reload.
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const REFRESH_MS = 15000;
const FEW_LEFT = 5; // "Only 3 left" at or below this

const el = {};
let refreshTimer = null;

/* ── Helpers ────────────────────────────────────────────── */

function vendorIdFromUrl() {
  const id = Number(new URLSearchParams(window.location.search).get('vendorId'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getMenu(vendorId) {
  const response = await fetch(`${API_URL}/vendors/${vendorId}/menu`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Load an image only if its address changed, so refreshing doesn't flicker
function showImage(img, url, onMissing, onShown) {
  const next = isSafeImageUrl(url) ? url : '';
  if (img.dataset.src === next) return;
  img.dataset.src = next;
  if (!next) {
    img.hidden = true;
    img.removeAttribute('src');
    onMissing();
    return;
  }
  img.onerror = () => {
    img.hidden = true;
    onMissing();
  };
  img.onload = () => {
    img.hidden = false;
    onShown();
  };
  img.src = next;
}

/* ── Rendering ──────────────────────────────────────────── */

function renderStall(menu) {
  const { vendor } = menu;
  document.title = `${vendor.stallName} · Makan Liao?`;
  el.stallName.textContent = vendor.stallName;
  el.stallStatus.dataset.open = String(vendor.isOpen);
  el.stallStatus.textContent = vendor.isOpen ? 'Open for orders' : 'Closed right now';

  el.stallLogo.alt = `${vendor.stallName} logo`;
  showImage(
    el.stallLogo,
    vendor.logoUrl,
    () => {
      el.stallLogoFallback.hidden = false;
      el.stallLogoFallback.textContent = initialsOf(vendor.stallName);
    },
    () => {
      el.stallLogoFallback.hidden = true;
    },
  );

  el.bannerImg.alt = `${vendor.stallName} banner`;
  showImage(
    el.bannerImg,
    menu.bannerUrl,
    () => {
      el.banner.dataset.hasImage = 'false';
    },
    () => {
      el.banner.dataset.hasImage = 'true';
    },
  );
}

function stockText(item) {
  if (!item.isAvailable) return '';
  if (item.quantityLeft !== null && item.quantityLeft <= FEW_LEFT) {
    return `Only ${item.quantityLeft} left`;
  }
  return '';
}

function fillCard(card, item) {
  card.dataset.itemId = String(item.id);
  card.classList.toggle('is-sold-out', !item.isAvailable);

  card.querySelector('.sm-card__name').textContent = item.name;
  const desc = card.querySelector('.sm-card__desc');
  desc.textContent = item.description || '';
  desc.hidden = !item.description;
  card.querySelector('.sm-card__price').textContent = formatPrice(item.priceCents);
  card.querySelector('[data-role="stock"]').textContent = stockText(item);

  const badge = card.querySelector('[data-role="badge"]');
  badge.hidden = item.isAvailable;
  badge.textContent = 'Sold out';

  const img = card.querySelector('.sm-card__img');
  const initial = card.querySelector('.sm-card__initial');
  img.alt = item.name;
  initial.textContent = initialsOf(item.name);
  showImage(
    img,
    item.imageUrl,
    () => {
      initial.hidden = false;
    },
    () => {
      initial.hidden = true;
    },
  );
}

function renderItems(items) {
  const cards = items.map((item) => {
    const existing = el.grid.querySelector(`[data-item-id="${item.id}"]`);
    const card = existing || document.importNode(el.template, true).firstElementChild;
    fillCard(card, item);
    return card;
  });
  el.grid.replaceChildren(...cards);
  el.empty.hidden = items.length > 0;
}

function showMessage(heading, text) {
  el.stallPanel.hidden = true;
  el.messageHeading.textContent = heading;
  el.messageText.textContent = text;
  el.messagePanel.hidden = false;
}

/* ── Loading ────────────────────────────────────────────── */

async function load(vendorId) {
  try {
    const menu = await getMenu(vendorId);
    renderStall(menu);
    renderItems(menu.items);
    el.messagePanel.hidden = true;
    el.stallPanel.hidden = false;
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.updated.textContent = `Availability updated ${time}`;
    return true;
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      showMessage('Stall not found', 'Check the link and try again.');
      return false;
    }
    // Keep showing the last menu if a refresh fails; say so only on first load
    if (el.stallPanel.hidden) {
      showMessage("We couldn't load this menu", 'Refresh the page to try again.');
    } else {
      el.updated.textContent = "Couldn't refresh availability. Retrying…";
    }
    return true;
  }
}

function scheduleRefresh(vendorId) {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') load(vendorId);
  }, REFRESH_MS);
}

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    stallPanel: byId('stallPanel'),
    banner: byId('banner'),
    bannerImg: byId('bannerImg'),
    stallLogo: byId('stallLogo'),
    stallLogoFallback: byId('stallLogoFallback'),
    stallName: byId('stallName'),
    stallStatus: byId('stallStatus'),
    grid: byId('menuGrid'),
    empty: byId('menuEmpty'),
    updated: byId('updatedNote'),
    messagePanel: byId('messagePanel'),
    messageHeading: byId('messageHeading'),
    messageText: byId('messageText'),
    template: byId('menuItemTemplate').content,
  });
}

async function init() {
  cacheElements();
  const vendorId = vendorIdFromUrl();
  if (vendorId === null) {
    showMessage('Stall not found', 'Check the link and try again.');
    return;
  }

  const keepGoing = await load(vendorId);
  if (!keepGoing) return;
  scheduleRefresh(vendorId);
  // Coming back to the tab shows the latest availability straight away
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load(vendorId);
  });
}

document.addEventListener('DOMContentLoaded', init);
