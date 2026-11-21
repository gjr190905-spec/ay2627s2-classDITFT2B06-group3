const TOKEN_KEY = 'token';
const CART_KEY = 'cart';
const LOGIN_PAGE = 'index.html';
const MAX_QUANTITY = 20;

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
const pageLoading = document.getElementById('page-loading');
const pageError = document.getElementById('page-error');
const stallContent = document.getElementById('stall-content');
const menuList = document.getElementById('menu-list');
const menuEmpty = document.getElementById('menu-empty');
const windowList = document.getElementById('window-list');
const windowsMessage = document.getElementById('windows-message');
const cartSummaryText = document.getElementById('cart-summary-text');
const cartBadge = document.getElementById('cart-count');
const itemTemplate = document.getElementById('menu-item-template');
const replaceDialog = document.getElementById('replace-dialog');
const replaceText = document.getElementById('replace-text');

// ── Page state ───────────────────────────────────────────
let stall = null;
let pendingItem = null; 
const rows = new Map();

// ── API ──────────────────────────────────────────────────
async function apiGet(path) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

    const response = await fetch(path, { headers });
    if (response.status === 401 && requiresAuth) {
    window.location.href = LOGIN_PAGE;
    throw new Error('Not signed in');
    }
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// ── Cart (kept in localStorage) ──────────────────────────
function emptyCart() {
  return { stallId: null, stallName: '', items: [] };
}

function readCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY));
    if (cart && Array.isArray(cart.items)) {
      return cart;
    }
  } catch {
  }
  return emptyCart();
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (error) {
    console.error(error);
  }
  renderCartSummary();
}

function quantityFor(menuItemId) {
  const line = readCart().items.find((entry) => entry.menuItemId === menuItemId);
  if (!line) {
    return 0;
  }
  return line.quantity;
}

function setQuantity(item, quantity) {
  const cart = readCart();
  const index = cart.items.findIndex((entry) => entry.menuItemId === item.id);

  if (index === -1 && quantity > 0) {
    cart.items.push({
      menuItemId: item.id,
      name: item.name,
      priceCents: item.priceCents,
      quantity,
    });
  } else if (index !== -1 && quantity > 0) {
    cart.items[index].quantity = quantity;
  } else if (index !== -1) {
    cart.items.splice(index, 1);
  }

  if (cart.items.length === 0) {
    cart.stallId = null;
    cart.stallName = '';
  } else {
    cart.stallId = stall.id;
    cart.stallName = stall.name;
  }
  saveCart(cart);
}

function pluralise(count, singular, plural) {
  if (count === 1) {
    return `${count} ${singular}`;
  }
  return `${count} ${plural}`;
}

function renderCartSummary() {
  const cart = readCart();
  let count = 0;
  let totalCents = 0;
  cart.items.forEach((line) => {
    count += line.quantity;
    totalCents += line.quantity * line.priceCents;
  });

  cartBadge.textContent = String(count);
  if (count === 0) {
    cartSummaryText.textContent = 'Your cart is empty.';
    return;
  }
  cartSummaryText.textContent = `${pluralise(count, 'item', 'items')} from ${cart.stallName}, ${money.format(totalCents / 100)}`;
}

// ── Menu rows ────────────────────────────────────────────
function updateRow(item) {
  const row = rows.get(item.id);
  const quantity = quantityFor(item.id);

  row.addButton.hidden = quantity > 0;
  row.stepper.hidden = quantity === 0;
  row.qtyText.textContent = String(quantity);
  row.plus.disabled = quantity >= MAX_QUANTITY || !item.isAvailable;
}

function changeQuantity(item, change) {
  const cart = readCart();
  const cartIsForAnotherStall = cart.items.length > 0 && cart.stallId !== stall.id;

  if (cartIsForAnotherStall && change > 0) {
    pendingItem = item;
    replaceText.textContent = `Your cart has items from ${cart.stallName}. A cart can only hold one stall. Replace it with items from ${stall.name}?`;
    replaceDialog.showModal();
    return;
  }

  const next = Math.min(MAX_QUANTITY, Math.max(0, quantityFor(item.id) + change));
  setQuantity(item, next);
  updateRow(item);

  const row = rows.get(item.id);
  if (next === 0) {
    row.addButton.focus();
  } else {
    row.plus.focus();
  }
}

function buildRow(item) {
  const fragment = itemTemplate.content.cloneNode(true);
  const row = {
    addButton: fragment.querySelector('.add-button'),
    stepper: fragment.querySelector('.stepper'),
    qtyText: fragment.querySelector('.stepper__qty'),
    minus: fragment.querySelector('.stepper__minus'),
    plus: fragment.querySelector('.stepper__plus'),
  };

  fragment.querySelector('.menu-item__name').textContent = item.name;
  fragment.querySelector('.menu-item__price').textContent = money.format(item.priceCents / 100);

  row.addButton.setAttribute('aria-label', `Add ${item.name} to cart`);
  row.minus.setAttribute('aria-label', `Remove one ${item.name}`);
  row.plus.setAttribute('aria-label', `Add one ${item.name}`);

  if (!item.isAvailable) {
    fragment.querySelector('.menu-item').classList.add('menu-item--sold-out');
    fragment.querySelector('.menu-item__status').hidden = false;
    row.addButton.disabled = true;
  }

  row.addButton.addEventListener('click', () => changeQuantity(item, 1));
  row.plus.addEventListener('click', () => changeQuantity(item, 1));
  row.minus.addEventListener('click', () => changeQuantity(item, -1));

  rows.set(item.id, row);
  menuList.appendChild(fragment);
  updateRow(item);
}

// ── Replace-cart dialog ──────────────────────────────────
document.getElementById('replace-confirm').addEventListener('click', () => {
  const item = pendingItem;
  pendingItem = null;
  replaceDialog.close();
  if (!item) {
    return;
  }

  saveCart(emptyCart());
  setQuantity(item, 1);
  updateRow(item);
  rows.get(item.id).plus.focus();
});

document.getElementById('replace-cancel').addEventListener('click', () => {
  replaceDialog.close();
});

replaceDialog.addEventListener('close', () => {
  pendingItem = null;
});

// ── Pickup times ──
function describeWindow(pickupWindow) {
  const start = new Date(pickupWindow.startTime);
  const end = new Date(pickupWindow.endTime);
  let text = `${timeFormat.format(start)} to ${timeFormat.format(end)}`;

  const startDay = dayFormat.format(start);
  if (startDay !== dayFormat.format(new Date())) {
    text = `${startDay}, ${text}`;
  }
  return text;
}

function renderWindows(windows) {
  windowList.replaceChildren();

  if (windows.length === 0) {
    windowsMessage.textContent = 'No pickup times are open right now.';
    windowsMessage.hidden = false;
    return;
  }

  windowsMessage.hidden = true;
  windows.forEach((pickupWindow) => {
    const item = document.createElement('li');
    item.className = 'window-list__item';

    const time = document.createElement('span');
    time.className = 'window-list__time';
    time.textContent = describeWindow(pickupWindow);

    const status = document.createElement('span');
    status.className = 'status';
    if (pickupWindow.isFull) {
      status.classList.add('status--closed');
      status.textContent = 'Full';
    } else {
      status.classList.add('status--open');
      status.textContent = `${pluralise(Number(pickupWindow.spacesLeft), 'space', 'spaces')} left`;
    }

    item.append(time, status);
    windowList.appendChild(item);
  });
}

async function loadWindows(stallId) {
  try {
    renderWindows(await apiGet(`/stalls/${stallId}/windows`));
  } catch (error) {
    console.error(error);
    windowsMessage.textContent = 'We could not load pickup times. Refresh the page to try again.';
    windowsMessage.hidden = false;
  }
}

// ── Page load ────────────────────────────────────────────
function showPageError(message) {
  pageLoading.hidden = true;
  stallContent.hidden = true;
  pageError.textContent = message;
  pageError.hidden = false;
}

async function loadPage() {
  const stallId = new URLSearchParams(window.location.search).get('id');
  if (!stallId || !/^[1-9]\d{0,9}$/.test(stallId)) {
    showPageError('That stall link is not valid.');
    return;
  }

  let menuItems = [];
  try {
    [stall, menuItems] = await Promise.all([
      apiGet(`/stalls/${stallId}`),
      apiGet(`/stalls/${stallId}/menu`),
    ]);
  } catch (error) {
    console.error(error);
    if (error.status === 400 || error.status === 404) {
      showPageError('We could not find that stall.');
    } else {
      showPageError('We could not load this menu. Refresh the page to try again.');
    }
    return;
  }

  document.title = `${stall.name} | Makan Liao`;
  document.getElementById('stall-name').textContent = stall.name;
  document.getElementById('stall-pickup').textContent = `Collect at: ${stall.pickupLocation}`;

  if (stall.foodCourtName) {
    const court = document.getElementById('stall-court');
    court.textContent = stall.foodCourtName;
    court.hidden = false;
  }

  menuList.replaceChildren();
  menuItems.forEach(buildRow);
  menuEmpty.hidden = menuItems.length > 0;

  pageLoading.hidden = true;
  stallContent.hidden = false;
  renderCartSummary();
  loadWindows(stall.id);
}

document.getElementById('sign-out').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

loadPage();