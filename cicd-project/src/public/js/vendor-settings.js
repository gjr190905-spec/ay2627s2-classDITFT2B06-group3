/* ─────────────────────────────────────────────────────────
   Vendor settings
   - Orders at once: no limit, or a cap on Confirmed + Preparing orders
   - Notification choices: new orders, sold out, low stock (+ threshold)
   - Recent notifications: mark all as read, clear all
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const SESSION_KEY = 'vendorId';
const TIME_ZONE = 'Asia/Singapore';
const MAX_ACTIVE_ORDERS = 200;
const LOW_STOCK_MAX = 50;

const TYPE_LABEL = { NEW_ORDER: 'New order', SOLD_OUT: 'Sold out', LOW_STOCK: 'Low stock' };

const state = {
  vendorId: null,
  saved: null, // the settings as last saved, to spot unsaved changes
  busy: false,
};

const el = {};

/* ── Session ────────────────────────────────────────────── */

function resolveVendorId() {
  const fromQuery = new URLSearchParams(window.location.search).get('vendorId');
  if (fromQuery) sessionStorage.setItem(SESSION_KEY, fromQuery);
  const id = Number(fromQuery || sessionStorage.getItem(SESSION_KEY));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/* ── API ────────────────────────────────────────────────── */

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const api = {
  vendor: (vid) => request(`/vendors/${vid}`),
  settings: (vid) => request(`/vendors/${vid}/settings`),
  save: (vid, data) =>
    request(`/vendors/${vid}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  notifications: (vid) => request(`/vendors/${vid}/notifications`),
  markAllRead: (vid) => request(`/vendors/${vid}/notifications/read-all`, { method: 'POST' }),
  clearAll: (vid) => request(`/vendors/${vid}/notifications`, { method: 'DELETE' }),
};

/* ── Helpers ────────────────────────────────────────────── */

const timeFormat = new Intl.DateTimeFormat('en-SG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const dateFormat = new Intl.DateTimeFormat('en-SG', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});

/** "Just now", "5 min ago", "2:14 pm" (today) or "18 Nov, 2:14 pm" */
function whenText(value) {
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const sameDay = dateFormat.format(date) === dateFormat.format(new Date());
  return sameDay
    ? timeFormat.format(date)
    : `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
}

function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
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

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function showToast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', error);
  el.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3200);
}

/* ── Settings form ──────────────────────────────────────── */

function renderLoad(activeOrders, maxActiveOrders) {
  const full = maxActiveOrders !== null && activeOrders >= maxActiveOrders;
  let text;
  if (maxActiveOrders === null) {
    text = `Right now: ${activeOrders} ${activeOrders === 1 ? 'order' : 'orders'} in progress.`;
  } else {
    text = `Right now: ${activeOrders} of ${maxActiveOrders} orders in progress.`;
    if (full) text += ' New orders are paused until you mark some as Ready.';
  }
  el.loadNote.textContent = text;
  el.loadNote.classList.toggle('is-full', full);
}

function renderLimitField() {
  el.limitField.hidden = el.limitMode.value !== 'limit';
}

function renderThresholdField() {
  el.thresholdField.hidden = !el.notifyLowStock.checked;
}

function fillForm(settings) {
  const limited = settings.maxActiveOrders !== null;
  el.limitMode.value = limited ? 'limit' : 'none';
  el.maxActiveOrders.value = limited ? String(settings.maxActiveOrders) : '';
  el.notifyNewOrder.checked = settings.notifications.newOrder;
  el.notifySoldOut.checked = settings.notifications.soldOut;
  el.notifyLowStock.checked = settings.notifications.lowStock;
  el.lowStockThreshold.value = String(settings.notifications.lowStockThreshold);
  renderLimitField();
  renderThresholdField();
  renderLoad(settings.activeOrders, settings.maxActiveOrders);
}

/**
 * Read and check the form (the server checks again).
 * @returns {{error: string, field: HTMLElement} | {data: object}}
 */
function readForm() {
  let maxActiveOrders = null;
  if (el.limitMode.value === 'limit') {
    const text = el.maxActiveOrders.value.trim();
    maxActiveOrders = Number(text);
    if (
      text === '' ||
      !Number.isInteger(maxActiveOrders) ||
      maxActiveOrders < 1 ||
      maxActiveOrders > MAX_ACTIVE_ORDERS
    ) {
      return {
        error: `Enter how many orders you can take at once, from 1 to ${MAX_ACTIVE_ORDERS}. Or choose No limit.`,
        field: el.maxActiveOrders,
      };
    }
  }

  // The threshold is kept even when low-stock alerts are off, so it's there if they're switched back on
  const thresholdText = el.lowStockThreshold.value.trim();
  const threshold = Number(thresholdText);
  if (
    thresholdText === '' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > LOW_STOCK_MAX
  ) {
    return {
      error: `The low-stock number must be a whole number from 1 to ${LOW_STOCK_MAX}.`,
      field: el.lowStockThreshold,
    };
  }

  return {
    data: {
      maxActiveOrders,
      notifications: {
        newOrder: el.notifyNewOrder.checked,
        soldOut: el.notifySoldOut.checked,
        lowStock: el.notifyLowStock.checked,
        lowStockThreshold: threshold,
      },
    },
  };
}

function setError(message, field = null) {
  el.settingsError.textContent = message;
  [el.maxActiveOrders, el.lowStockThreshold].forEach((input) =>
    input.setAttribute('aria-invalid', input === field ? 'true' : 'false'),
  );
  if (field) field.focus();
}

function sameSettings(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function onFormChange() {
  renderLimitField();
  renderThresholdField();
  setError('');
  const form = readForm();
  const changed = form.error || !sameSettings(form.data, state.saved);
  el.saveState.textContent = changed ? 'You have unsaved changes' : '';
}

async function onSave(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = readForm();
  if (form.error) {
    setError(form.error, form.field);
    return;
  }

  state.busy = true;
  el.saveButton.disabled = true;
  setError('');
  try {
    const saved = await api.save(state.vendorId, form.data);
    state.saved = { maxActiveOrders: saved.maxActiveOrders, notifications: saved.notifications };
    fillForm(saved);
    el.saveState.textContent = '';
    showToast('Settings saved');
  } catch (error) {
    setError(error.message);
  } finally {
    state.busy = false;
    el.saveButton.disabled = false;
  }
}

/* ── Notification list ──────────────────────────────────── */

function renderInbox({ unreadCount, notifications }) {
  el.inbox.replaceChildren(
    ...notifications.map((n) => {
      const li = make(
        'li',
        `vs-note vs-note--${n.type.toLowerCase()}${n.readAt ? '' : ' is-unread'}`,
      );
      const top = make('div', 'vs-note__top');
      top.append(make('span', 'vs-note__type', TYPE_LABEL[n.type] || n.type));
      if (!n.readAt) top.append(make('span', 'vs-note__new', 'New'));
      top.append(make('time', 'vs-note__when', whenText(n.createdAt)));
      li.append(top, make('p', 'vs-note__message', n.message));
      return li;
    }),
  );
  el.inboxEmpty.hidden = notifications.length > 0;
  el.unreadNote.textContent =
    notifications.length === 0 ? '' : unreadCount === 0 ? 'All caught up' : `${unreadCount} unread`;
  el.markReadButton.disabled = unreadCount === 0;
  el.clearButton.disabled = notifications.length === 0;
}

async function loadInbox() {
  renderInbox(await api.notifications(state.vendorId));
}

async function onMarkAllRead() {
  el.markReadButton.disabled = true;
  try {
    const result = await api.markAllRead(state.vendorId);
    await loadInbox();
    showToast(
      result.marked === 1
        ? '1 notification marked as read'
        : `${result.marked} notifications marked as read`,
    );
  } catch (error) {
    showToast(error.message, { error: true });
    el.markReadButton.disabled = false;
  }
}

async function onConfirmClear() {
  el.confirmClear.disabled = true;
  try {
    await api.clearAll(state.vendorId);
    el.clearDialog.close('cleared');
    await loadInbox();
    showToast('Notifications cleared');
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    el.confirmClear.disabled = false;
  }
}

/* ── Start-up ───────────────────────────────────────────── */

function renderHeader(vendor) {
  el.headerName.textContent = vendor.stallName;
  document.title = `Settings · ${vendor.stallName} · Makan Liao? for vendors`;
  el.headerLogo.alt = `${vendor.stallName} logo`;
  const fallback = () => {
    el.headerLogo.hidden = true;
    el.headerFallback.hidden = false;
    el.headerFallback.textContent = initialsOf(vendor.stallName);
  };
  if (!isSafeImageUrl(vendor.logoUrl)) {
    fallback();
    return;
  }
  el.headerLogo.onerror = fallback;
  el.headerLogo.onload = () => {
    el.headerLogo.hidden = false;
    el.headerFallback.hidden = true;
  };
  el.headerLogo.src = vendor.logoUrl;
}

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    headerLogo: byId('vendorLogo'),
    headerFallback: byId('vendorLogoFallback'),
    headerLogoWrap: byId('vendorLogoWrap'),
    headerName: byId('vendorStallName'),
    backLink: byId('backLink'),
    panel: byId('settingsPanel'),
    signedOut: byId('signedOutPanel'),
    form: byId('settingsForm'),
    limitMode: byId('limitMode'),
    limitField: byId('limitField'),
    maxActiveOrders: byId('maxActiveOrders'),
    loadNote: byId('loadNote'),
    notifyNewOrder: byId('notifyNewOrder'),
    notifySoldOut: byId('notifySoldOut'),
    notifyLowStock: byId('notifyLowStock'),
    thresholdField: byId('thresholdField'),
    lowStockThreshold: byId('lowStockThreshold'),
    settingsError: byId('settingsError'),
    saveState: byId('saveState'),
    saveButton: byId('saveButton'),
    inbox: byId('inbox'),
    inboxEmpty: byId('inboxEmpty'),
    unreadNote: byId('unreadNote'),
    markReadButton: byId('markReadButton'),
    clearButton: byId('clearButton'),
    clearDialog: byId('clearDialog'),
    cancelClear: byId('cancelClear'),
    confirmClear: byId('confirmClear'),
    toast: byId('toast'),
  });
}

function bindEvents() {
  el.form.addEventListener('submit', onSave);
  el.form.addEventListener('input', onFormChange);
  el.form.addEventListener('change', onFormChange);
  el.limitMode.addEventListener('change', () => {
    if (el.limitMode.value === 'limit') {
      if (el.maxActiveOrders.value === '') el.maxActiveOrders.value = '10';
      el.maxActiveOrders.focus();
    }
  });
  el.markReadButton.addEventListener('click', onMarkAllRead);
  el.clearButton.addEventListener('click', () => el.clearDialog.showModal());
  el.cancelClear.addEventListener('click', () => el.clearDialog.close('cancel'));
  el.confirmClear.addEventListener('click', onConfirmClear);
}

function showSignedOut() {
  el.panel.hidden = true;
  el.backLink.hidden = true;
  el.headerLogoWrap.hidden = true;
  el.headerName.textContent = 'Makan Liao?';
  el.signedOut.hidden = false;
}

async function init() {
  cacheElements();
  bindEvents();

  state.vendorId = resolveVendorId();
  if (state.vendorId === null) {
    showSignedOut();
    return;
  }

  try {
    const [vendor, settings] = await Promise.all([
      api.vendor(state.vendorId),
      api.settings(state.vendorId),
    ]);
    renderHeader(vendor);
    state.saved = {
      maxActiveOrders: settings.maxActiveOrders,
      notifications: settings.notifications,
    };
    fillForm(settings);
    await loadInbox();
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
      return;
    }
    showToast(`We couldn't load your settings: ${error.message}`, { error: true });
  }
}

document.addEventListener('DOMContentLoaded', init);
