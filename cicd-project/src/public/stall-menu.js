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
const ITEM_IMAGES = {
  'Just Yogurt Petite':              'https://images.unsplash.com/photo-1786912029812-f1516e62b8f4?q=80&w=880&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Just Yogurt Regular':             'https://images.unsplash.com/photo-1786386370191-6c427763c0a3?q=80&w=627&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Just Yogurt Grande':              'https://images.unsplash.com/photo-1786386370191-6c427763c0a3?q=80&w=627&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Petite Yogurt with 1 Topping':    'https://images.unsplash.com/photo-1669127045641-0ae683639570?q=80&w=688&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Regular Yogurt with 2 Toppings':  'https://images.unsplash.com/photo-1670843838196-0c1c15e85d5e?q=80&w=1169&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Grande Yogurt with 3 Toppings':   'https://images.unsplash.com/photo-1593450298197-e6031f033a44?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Parfait with 5 Toppings':         'https://images.unsplash.com/photo-1615522894493-2f3e3fda615c?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
  'Extra Topping':                   'https://images.unsplash.com/photo-1601493701002-3223e7e1ebaf?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=400&h=300&fit=crop',
};

// ── Page state ───────────────────────────────────────────
let stall = null;
let pendingItem = null; 
const rows = new Map();

// ── API ──────────────────────────────────────────────────
async function apiGet(path, requiresAuth = false) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { headers });
  if (response.status === 401 && requiresAuth) {
    window.location.href = LOGIN_PAGE;
    const error = new Error('Not signed in');
    error.redirecting = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// ── Cart (kept in localStorage) ──────────────────────────
function requireAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = LOGIN_PAGE;
    return false;
  }
  return true;
}

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
  if (!requireAuth()) return;
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
  const imageUrl = ITEM_IMAGES[item.name];
      if (imageUrl) {
        fragment.querySelector('.menu-item__image').style.backgroundImage = `url('${imageUrl}')`;
        fragment.querySelector('.menu-item__image').style.backgroundSize = 'cover';
        fragment.querySelector('.menu-item__image').style.backgroundPosition = 'center';
      }
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
     if (error.status === 401) {
      windowsMessage.textContent = 'Sign in to see available pickup times.';
    } else {
      windowsMessage.textContent = 'We could not load pickup times. Refresh the page to try again.';
    }
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

  // In loadPage(), after you get the stall data back:
const heroArt = document.querySelector('.stall-hero__art');
const STALL_IMAGES = {
  'Foodgonomy':            'https://images.unsplash.com/photo-1603362548634-f26e6ce7237a?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D?w=600&h=400&fit=crop',
  'Our Sweet Toast':       'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&h=400&fit=crop',
  'Canopy Greens':         'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&h=400&fit=crop',
  'Japanese Food':         'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=600&h=400&fit=crop',
  'Western Food':          'https://images.unsplash.com/photo-1432139509613-5c4255815697?w=600&h=400&fit=crop',
  'Hello Handmade Noodles':'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&h=400&fit=crop',
};

if (STALL_IMAGES[stall.name]) {
  heroArt.style.backgroundImage = `url('${STALL_IMAGES[stall.name]}')`;
  heroArt.style.backgroundSize = 'cover';
  heroArt.style.backgroundPosition = 'center';
  heroArt.style.borderRadius = '0'; // remove the circle
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