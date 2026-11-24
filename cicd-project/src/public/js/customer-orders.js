const TOKEN_KEY = 'token';
const CART_KEY = 'cart';
const LOGIN_PAGE = 'index.html';
const ORDERS_PAGE = 'orders.html';
const POLL_MS = 30000;

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

const STATUSES = {
  CONFIRMED: { label: 'Confirmed', step: 0, tone: 'confirmed' },
  PREPARING: { label: 'Preparing', step: 1, tone: 'preparing' },
  READY: { label: 'Ready to collect', step: 2, tone: 'ready' },
  COLLECTED: { label: 'Collected', step: 3, tone: 'collected' },
  CANCELLED: { label: 'Cancelled', step: -1, tone: 'cancelled' },
};
const TRACK_STEPS = ['Confirmed', 'Preparing', 'Ready', 'Collected'];
const FINAL_STATUSES = ['COLLECTED', 'CANCELLED'];

// ── Page elements ────────────────────────────────────────
const ordersLoading = document.getElementById('orders-loading');
const ordersError = document.getElementById('orders-error');
const cartBadge = document.getElementById('cart-count');
const listView = document.getElementById('list-view');
const orderList = document.getElementById('order-list');
const ordersEmpty = document.getElementById('orders-empty');
const placedBanner = document.getElementById('placed-banner');
const placedLink = document.getElementById('placed-link');
const cardTemplate = document.getElementById('order-card-template');
const detailView = document.getElementById('detail-view');
const detailTitle = document.getElementById('detail-title');
const detailStall = document.getElementById('detail-stall');
const detailStatus = document.getElementById('detail-status');
const tracker = document.getElementById('tracker');
const detailCancelled = document.getElementById('detail-cancelled');
const detailPickup = document.getElementById('detail-pickup');
const detailLocation = document.getElementById('detail-location');
const detailPlaced = document.getElementById('detail-placed');
const detailItems = document.getElementById('detail-items');
const detailTotal = document.getElementById('detail-total');

// ── Page state ───────────────────────────────────────────
let lastSignature = '';
let detailIsFinal = false;

// ── API ──────────────────────────────────────────────────
async function apiGet(path) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { headers });
  if (response.status === 401) {
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

// ── Small helpers ────────────────────────────────────────
function statusInfo(status) {
  const key = String(status).toUpperCase();
  return { key, ...(STATUSES[key] || { label: String(status), step: -1, tone: 'collected' }) };
}

function orderReference(order) {
  if (order.collectionReference) {
    return order.collectionReference;
  }
  if (order.orderNumber) {
    return `#${order.orderNumber}`;
  }
  return `Order ${order.id}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${dayFormat.format(date)}, ${timeFormat.format(date)}`;
}

function formatPickupRange(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return formatDateTime(start);
  }
  return `${dayFormat.format(startDate)}, ${timeFormat.format(startDate)} to ${timeFormat.format(endDate)}`;
}

function setStatusPill(element, info) {
  element.textContent = info.label;
  element.className = `order-status order-status--${info.tone}`;
}

function renderCartBadge() {
  let count = 0;
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY));
    if (cart && Array.isArray(cart.items)) {
      count = cart.items.reduce((sum, line) => sum + (Number.isInteger(line.quantity) ? line.quantity : 0), 0);
    }
  } catch {
    // An unreadable cart just shows 0.
  }
  cartBadge.textContent = String(count);
}

function showError(message) {
  ordersLoading.hidden = true;
  listView.hidden = true;
  detailView.hidden = true;
  ordersError.textContent = message;
  ordersError.hidden = false;
}

// Re-check every so often so status changes show up without a refresh.
function startPolling(refresh, shouldStop) {
  const timer = setInterval(async () => {
    if (document.hidden) {
      return;
    }
    await refresh();
    if (shouldStop()) {
      clearInterval(timer);
    }
  }, POLL_MS);
}

// ── List view ────────────────────────────────────────────
function renderList(orders) {
  orderList.replaceChildren();
  ordersEmpty.hidden = orders.length > 0;

  orders.forEach((order) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const info = statusInfo(order.status);
    const reference = orderReference(order);

    fragment.querySelector('.order-card__ref').textContent = reference;
    setStatusPill(fragment.querySelector('.order-status'), info);
    fragment.querySelector('.order-card__stall').textContent = order.stallName;

    const parts = [];
    if (order.foodCourtName) {
      parts.push(order.foodCourtName);
    }
    parts.push(`Pickup ${formatDateTime(order.pickupStart)}`);
    fragment.querySelector('.order-card__meta').textContent = parts.join(' \u00b7 ');

    fragment.querySelector('.order-card__total').textContent = money.format(order.totalCents / 100);

    const link = fragment.querySelector('.order-card__link');
    link.href = `${ORDERS_PAGE}?id=${encodeURIComponent(order.id)}`;
    link.setAttribute('aria-label', `View order ${reference} from ${order.stallName}`);

    orderList.appendChild(fragment);
  });
}

async function loadList(isRefresh) {
  try {
    const orders = await apiGet('/orders');

    const signature = JSON.stringify(orders);
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    renderList(orders);
    ordersLoading.hidden = true;
    listView.hidden = false;
  } catch (error) {
    if (error.redirecting) {
      return;
    }
    console.error(error);
    if (!isRefresh) {
      showError('We could not load your orders. Refresh the page to try again.');
    }
  }
}

// ── Detail view ──────────────────────────────────────────
function renderTracker(info) {
  tracker.replaceChildren();
  const isCancelled = info.key === 'CANCELLED';
  tracker.hidden = isCancelled || info.step < 0;
  detailCancelled.hidden = !isCancelled;

  TRACK_STEPS.forEach((label, index) => {
    const item = document.createElement('li');
    item.className = 'tracker__step';
    item.textContent = label;

    const hint = document.createElement('span');
    hint.className = 'visually-hidden';
    if (index < info.step || info.step === TRACK_STEPS.length - 1) {
      item.classList.add('tracker__step--done');
      hint.textContent = ' (done)';
      item.appendChild(hint);
    }
    if (index === info.step) {
      item.classList.add('tracker__step--current');
      item.setAttribute('aria-current', 'step');
    }
    tracker.appendChild(item);
  });
}

function renderDetail(order) {
  const info = statusInfo(order.status);
  const reference = orderReference(order);

  document.title = `${reference} | Makan Liao`;
  detailTitle.textContent = reference;
  detailStall.textContent = order.foodCourtName ? `${order.stallName}, ${order.foodCourtName}` : order.stallName;
  setStatusPill(detailStatus, info);
  renderTracker(info);

  detailPickup.textContent = formatPickupRange(order.pickupStart, order.pickupEnd);
  detailLocation.textContent = order.pickupLocation;
  detailPlaced.textContent = formatDateTime(order.createdAt);

  detailItems.replaceChildren();
  order.items.forEach((line) => {
    const item = document.createElement('li');
    item.className = 'detail-item';

    const name = document.createElement('span');
    name.className = 'detail-item__name';
    name.textContent = `${line.quantity} \u00d7 ${line.name}`;

    const price = document.createElement('span');
    price.className = 'detail-item__price';
    price.textContent = money.format((line.priceCents * line.quantity) / 100);

    item.append(name, price);
    detailItems.appendChild(item);
  });

  detailTotal.textContent = money.format(order.totalCents / 100);
  detailIsFinal = FINAL_STATUSES.includes(info.key);
}

async function loadDetail(id, isRefresh) {
  try {
    const order = await apiGet(`/customer-orders/${id}`);

    const signature = JSON.stringify(order);
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    renderDetail(order);
    ordersLoading.hidden = true;
    detailView.hidden = false;
  } catch (error) {
    if (error.redirecting) {
      return;
    }
    console.error(error);
    if (isRefresh) {
      return;
    }
    if (error.status === 400 || error.status === 404) {
      showError('We could not find that order.');
    } else {
      showError('We could not load this order. Refresh the page to try again.');
    }
  }
}

// ── Page load ────────────────────────────────────────────
function showPlacedBanner(placedId) {
  placedLink.href = `${ORDERS_PAGE}?id=${encodeURIComponent(placedId)}`;
  placedBanner.hidden = false;
  // Drop ?placed= so refreshing the page does not show the banner again.
  window.history.replaceState(null, '', ORDERS_PAGE);
}

async function loadPage() {
  if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = LOGIN_PAGE;
    return;
  }
  renderCartBadge();

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const placedId = params.get('placed');

  if (id !== null) {
    if (!/^[1-9]\d{0,9}$/.test(id)) {
      showError('That order link is not valid.');
      return;
    }
    await loadDetail(id, false);
    startPolling(() => loadDetail(id, true), () => detailIsFinal);
    return;
  }

  if (placedId !== null && /^[1-9]\d{0,9}$/.test(placedId)) {
    showPlacedBanner(placedId);
  }
  await loadList(false);
  startPolling(() => loadList(true), () => false);
}

document.getElementById('sign-out').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

loadPage();