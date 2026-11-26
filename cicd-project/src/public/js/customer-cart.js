const TOKEN_KEY = 'token';
const CART_KEY = 'cart';
const LOGIN_PAGE = 'index.html';
const MAX_QUANTITY = 20;

//temporaryyy till i get the person table :3
const CHECKOUT_NOT_READY = [404, 501, 503];

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const timeFormat = new Intl.DateTimeFormat('en-SG', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Singapore',
});
const dayFormat = new Intl.DateTimeFormat('en-SG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Singapore',
});

// ── Page elements ────────────────────────────────────────
const cartEmpty = document.getElementById('cart-empty');
const cartContent = document.getElementById('cart-content');
const cartNotice = document.getElementById('cart-notice');
const cartBadge = document.getElementById('cart-count');
const stallNameHeading = document.getElementById('cart-stall-name');
const countText = document.getElementById('cart-count-text');
const cartLines = document.getElementById('cart-lines');
const lineTemplate = document.getElementById('cart-line-template');
const windowsMessage = document.getElementById('windows-message');
const slotsField = document.getElementById('slots');
const slotList = document.getElementById('slot-list');
const summaryItemsLabel = document.getElementById('summary-items-label');
const summaryItems = document.getElementById('summary-items');
const summaryTotal = document.getElementById('summary-total');
const checkoutMessage = document.getElementById('checkout-message');
const checkoutHint = document.getElementById('checkout-hint');
const placeOrderButton = document.getElementById('place-order');
const clearDialog = document.getElementById('clear-dialog');

// ── Page state ───────────────────────────────────────────
let cart = readCart();
let windows = [];
let windowsFailed = false;
let selectedWindowId = null;
const soldOut = new Set();
let placing = false;

// ── API ──────────────────────────────────────────────────
async function readServerMessage(response) {
  try {
    const data = await response.json();
    const text = data.message || data.error;
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

async function apiRequest(path, { method = 'GET', body, requiresAuth = false } = {}) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && requiresAuth) {
    window.location.href = LOGIN_PAGE;
    const error = new Error('Not signed in');
    error.redirecting = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    error.serverMessage = await readServerMessage(response);
    throw error;
  }
  return response.json();
}
// ── Cart (kept in localStorage) ──────────────────────────
function emptyCart() {
  return { stallId: null, stallName: '', items: [] };
}

// localStorage can be edited or stale, so only keep lines that look valid.
function cleanLine(line) {
  if (!line || !Number.isInteger(line.menuItemId)) {
    return null;
  }
  if (!Number.isInteger(line.priceCents) || line.priceCents < 0) {
    return null;
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return null;
  }
  return {
    menuItemId: line.menuItemId,
    name: String(line.name || 'Menu item'),
    priceCents: line.priceCents,
    quantity: Math.min(line.quantity, MAX_QUANTITY),
  };
}

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY));
    if (stored && Array.isArray(stored.items) && Number.isInteger(stored.stallId)) {
      const items = stored.items.map(cleanLine).filter(Boolean);
      if (items.length > 0) {
        return { stallId: stored.stallId, stallName: String(stored.stallName || 'Your stall'), items };
      }
    }
  } catch {
    // ignore parse errors
  }
  return emptyCart();
}

function saveCart(next) {
  cart = next;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (error) {
    console.error(error);
  }
}

function pluralise(count, singular, plural) {
  if (count === 1) {
    return `${count} ${singular}`;
  }
  return `${count} ${plural}`;
}

function itemCount() {
  return cart.items.reduce((sum, line) => sum + line.quantity, 0);
}

function totalCents() {
  return cart.items.reduce((sum, line) => sum + line.quantity * line.priceCents, 0);
}

// ── Rendering: basket ────────────────────────────────────
function showEmpty() {
  cartContent.hidden = true;
  cartEmpty.hidden = false;
  cartBadge.textContent = '0';
}

function renderLines() {
  cartLines.replaceChildren();

  cart.items.forEach((line) => {
    const fragment = lineTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.cart-line');
    const minus = fragment.querySelector('.stepper__minus');
    const plus = fragment.querySelector('.stepper__plus');

    row.dataset.id = String(line.menuItemId);
    fragment.querySelector('.cart-line__name').textContent = line.name;
    fragment.querySelector('.cart-line__each').textContent = `${money.format(line.priceCents / 100)} each`;
    fragment.querySelector('.stepper__qty').textContent = String(line.quantity);
    fragment.querySelector('.cart-line__total').textContent = money.format((line.priceCents * line.quantity) / 100);

    minus.setAttribute('aria-label', `Remove one ${line.name}`);
    plus.setAttribute('aria-label', `Add one ${line.name}`);
    fragment.querySelector('.cart-line__remove').setAttribute('aria-label', `Remove ${line.name} from basket`);

    plus.disabled = line.quantity >= MAX_QUANTITY || soldOut.has(line.menuItemId);
    if (soldOut.has(line.menuItemId)) {
      row.classList.add('cart-line--sold-out');
      fragment.querySelector('.cart-line__status').hidden = false;
    }

    minus.addEventListener('click', () => changeQuantity(line.menuItemId, -1));
    plus.addEventListener('click', () => changeQuantity(line.menuItemId, 1));
    fragment.querySelector('.cart-line__remove').addEventListener('click', () => removeLine(line.menuItemId));

    cartLines.appendChild(fragment);
  });
}

function renderSummary() {
  const count = itemCount();
  summaryItemsLabel.textContent = `Items (${count})`;
  summaryItems.textContent = money.format(totalCents() / 100);
  summaryTotal.textContent = money.format(totalCents() / 100);
  countText.textContent = `${pluralise(count, 'item', 'items')} in your basket`;
  cartBadge.textContent = String(count);
}

function renderAll() {
  if (cart.items.length === 0) {
    showEmpty();
    return;
  }
  cartEmpty.hidden = true;
  cartContent.hidden = false;
  stallNameHeading.textContent = cart.stallName;
  renderLines();
  renderSummary();
  updateCheckoutState();
}

function focusControl(menuItemId, selector) {
  const row = cartLines.querySelector(`[data-id="${menuItemId}"]`);
  const control = row && row.querySelector(selector);
  if (control && !control.disabled) {
    control.focus();
    return true;
  }
  return false;
}

function changeQuantity(menuItemId, change) {
  const line = cart.items.find((entry) => entry.menuItemId === menuItemId);
  if (!line) {
    return;
  }

  const next = Math.min(MAX_QUANTITY, line.quantity + change);
  if (next < 1) {
    removeLine(menuItemId);
    return;
  }

  line.quantity = next;
  saveCart(cart);
  renderAll();

  const preferred = change > 0 ? '.stepper__plus' : '.stepper__minus';
  if (!focusControl(menuItemId, preferred)) {
    focusControl(menuItemId, '.stepper__minus');
  }
}

function removeLine(menuItemId) {
  const items = cart.items.filter((entry) => entry.menuItemId !== menuItemId);
  soldOut.delete(menuItemId);

  if (items.length === 0) {
    saveCart(emptyCart());
    selectedWindowId = null;
    renderAll();
    return;
  }

  saveCart({ stallId: cart.stallId, stallName: cart.stallName, items });
  renderAll();
  stallNameHeading.focus();
}

// ── Re-check the basket against the live menu ────────────
// Prices and stock can change after an item was added, so the basket
// refreshes from the menu. The server still has the final say at checkout.
async function syncWithMenu() {
  try {
    const menu = await apiRequest(`/stalls/${cart.stallId}/menu`);
    const byId = new Map(menu.map((item) => [item.id, item]));
    let changed = false;

    soldOut.clear();
    cart.items.forEach((line) => {
      const current = byId.get(line.menuItemId);
      if (!current || !current.isAvailable) {
        soldOut.add(line.menuItemId);
        return;
      }
      if (current.priceCents !== line.priceCents || current.name !== line.name) {
        changed = true;
        line.priceCents = current.priceCents;
        line.name = current.name;
      }
    });

    saveCart(cart);
    if (changed) {
      cartNotice.textContent = 'Some prices or names changed since you added them. Your basket shows the latest.';
      cartNotice.hidden = false;
    }
  } catch (error) {
    console.error(error);
  }
}

// ── Pickup times ─────────────────────────────────────────
function describeWindow(pickupWindow) {
  const start = new Date(pickupWindow.startTime);
  const end = new Date(pickupWindow.endTime);
  let text = `${timeFormat.format(start)} to ${timeFormat.format(end)}`;

  const startDay = dayFormat.format(start);
  if (startDay !== dayFormat.format(new Date())) {
    text = `${startDay}, ${text}`;
  } else {
    text = `Today, ${text}`;
  }
  return text;
}

function renderWindows() {
  slotList.replaceChildren();

  if (windows.length === 0) {
    windowsMessage.textContent = 'No pickup times are open right now.';
    windowsMessage.hidden = false;
    slotsField.hidden = true;
    return;
  }

  windowsMessage.hidden = true;
  slotsField.hidden = false;

  windows.forEach((pickupWindow) => {
    const item = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'slot';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pickup-window';
    input.value = String(pickupWindow.id);
    input.disabled = Boolean(pickupWindow.isFull);
    input.checked = pickupWindow.id === selectedWindowId;
    input.addEventListener('change', () => {
      selectedWindowId = pickupWindow.id;
      updateCheckoutState();
    });

    const time = document.createElement('span');
    time.className = 'slot__time';
    time.textContent = describeWindow(pickupWindow);

    const left = document.createElement('span');
    left.className = 'slot__left';
    if (pickupWindow.isFull) {
      label.classList.add('slot--full');
      left.textContent = 'Full';
    } else {
      left.textContent = `${pluralise(Number(pickupWindow.spacesLeft), 'space', 'spaces')} left`;
    }

    label.append(input, time, left);
    item.appendChild(label);
    slotList.appendChild(item);
  });
}

async function loadWindows() {
  windowsMessage.textContent = 'Loading pickup times...';
  windowsMessage.hidden = false;
  slotsField.hidden = true;

  try {
    windows = await apiRequest(`/stalls/${cart.stallId}/windows`, { requiresAuth: true });
    windowsFailed = false;

    const stillOpen = windows.some((entry) => entry.id === selectedWindowId && !entry.isFull);
    if (!stillOpen) {
      const firstOpen = windows.find((entry) => !entry.isFull);
      selectedWindowId = firstOpen ? firstOpen.id : null;
    }
    renderWindows();
  } catch (error) {
    if (error.redirecting) {
      return;
    }
    console.error(error);
    windows = [];
    windowsFailed = true;
    selectedWindowId = null;
    windowsMessage.textContent = 'We could not load pickup times. Refresh the page to try again.';
    windowsMessage.hidden = false;
  }
  updateCheckoutState();
}

// ── Checkout ─────────────────────────────────────────────
function checkoutBlocker() {
  if (cart.items.length === 0) {
    return 'Your basket is empty.';
  }
  if (soldOut.size > 0) {
    return 'Remove the sold-out items to continue.';
  }
  if (windowsFailed) {
    return 'Pickup times could not be loaded.';
  }
  if (selectedWindowId === null) {
    return 'Choose a pickup time to continue.';
  }
  return '';
}

function updateCheckoutState() {
  const blocker = checkoutBlocker();
  placeOrderButton.disabled = placing || blocker !== '';
  placeOrderButton.textContent = placing ? 'Placing order...' : 'Place order';
  checkoutHint.textContent = blocker;
  checkoutHint.hidden = blocker === '';
}

function showCheckoutError(error) {
  let message = 'We could not place your order. Check your connection and try again.';

  if (CHECKOUT_NOT_READY.includes(error.status)) {
    message = 'Checkout is not available yet. Your basket is saved, so you can try again later.';
  } else if (error.status === 409) {
    message =
      error.serverMessage || 'That pickup time or one of your items is no longer available. Choose again and retry.';
  } else if (error.status === 400) {
    message = error.serverMessage || 'Something in your order is not valid. Check your basket and try again.';
  }

  checkoutMessage.textContent = message;
  checkoutMessage.hidden = false;
}

async function placeOrder() {
  if (placing || checkoutBlocker() !== '') {
    return;
  }

  placing = true;
  checkoutMessage.hidden = true;
  updateCheckoutState();

  try {
    // Prices are not sent. The server looks them up so the total cannot be faked.
    const order = await apiRequest('/customer-orders', {
      method: 'POST',
      requiresAuth: true,
      body: {
        stallId: cart.stallId,
        pickupWindowId: selectedWindowId,
        items: cart.items.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
      },
    });

    saveCart(emptyCart());
    window.location.href = `payment.html?id=${encodeURIComponent(order.id)}`;
    return;
  } catch (error) {
    if (error.redirecting) {
      return;
    }
    console.error(error);
    showCheckoutError(error);

    // A full slot or sold-out item means the page data is stale, so refresh it.
    if (error.status === 409) {
      await syncWithMenu();
      renderAll();
      loadWindows();
    }
  }

  placing = false;
  updateCheckoutState();
}

placeOrderButton.addEventListener('click', placeOrder);

// ── Clear basket dialog ──────────────────────────────────
document.getElementById('clear-cart').addEventListener('click', () => clearDialog.showModal());
document.getElementById('clear-cancel').addEventListener('click', () => clearDialog.close());
document.getElementById('clear-confirm').addEventListener('click', () => {
  clearDialog.close();
  saveCart(emptyCart());
  soldOut.clear();
  selectedWindowId = null;
  cartNotice.hidden = true;
  renderAll();
});

document.getElementById('sign-out').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

// ── Page load ────────────────────────────────────────────
async function loadPage() {
  if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = LOGIN_PAGE;
    return;
  }

  renderAll();
  await syncWithMenu();
  renderAll();
  loadWindows();
}

loadPage();