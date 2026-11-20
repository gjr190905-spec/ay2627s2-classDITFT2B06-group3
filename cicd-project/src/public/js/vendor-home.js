/* ─────────────────────────────────────────────────────────
   Vendor home page
   - Loads the signed-in vendor (header logo + stall status)
   - Opens/closes the stall (closing asks for a reason)
   - Logs the vendor out
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const LOGIN_PAGE = '/'; // TODO: point at the login page once it exists
const SESSION_KEY = 'vendorId';
const OTHER_CODE = 'OTHER';

// Open / Closed sign pictures. The alt text is what screen readers announce.
const STATUS_SIGNS = {
  open: { src: '../images/status/open-sign.png', alt: 'Open' },
  closed: { src: '../images/status/closed-sign.png', alt: 'Closed' },
};

const state = {
  vendorId: null,
  vendor: null,
  reasons: [],
  busy: false,
};

const el = {};

/* ── Session ────────────────────────────────────────────── */

/**
 * The login page stores the vendor id in sessionStorage.
 * A ?vendorId= query param is also accepted (handy for demos and tests)
 * and is saved so the id survives navigating to other vendor pages.
 */
function resolveVendorId() {
  const fromQuery = new URLSearchParams(window.location.search).get('vendorId');
  if (fromQuery) {
    sessionStorage.setItem(SESSION_KEY, fromQuery);
  }
  const raw = fromQuery || sessionStorage.getItem(SESSION_KEY);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.assign(LOGIN_PAGE);
}

/* ── API ────────────────────────────────────────────────── */

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
  getVendor: (id) => request(`/vendors/${id}`),
  getClosureReasons: () => request('/vendors/closure-reasons'),
  setStatus: (id, payload) =>
    request(`/vendors/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) }),
};

/* ── Rendering ──────────────────────────────────────────── */

// Only allow same-site paths or http(s) URLs as the logo source
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

function showLogoFallback(stallName) {
  el.logo.hidden = true;
  el.logoFallback.hidden = false;
  el.logoFallback.textContent = initialsOf(stallName);
}

function renderHeader(vendor) {
  el.stallName.textContent = vendor.stallName;
  document.title = `${vendor.stallName} · Makan Liao? for vendors`;

  if (isSafeImageUrl(vendor.logoUrl)) {
    el.logo.onerror = () => showLogoFallback(vendor.stallName);
    el.logo.onload = () => {
      el.logo.hidden = false;
      el.logoFallback.hidden = true;
    };
    el.logo.alt = `${vendor.stallName} logo`;
    el.logo.src = vendor.logoUrl;
  } else {
    showLogoFallback(vendor.stallName);
  }
}

function formatSince(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? `Since ${time} today` : `Since ${date.toLocaleDateString()} ${time}`;
}

function renderStatus(vendor, { animate = false } = {}) {
  const open = vendor.isOpen;

  el.statusPanel.dataset.state = open ? 'open' : 'closed';
  el.statusHeading.textContent = `Hi, ${vendor.stallName}`;
  el.statusLine.textContent = open
    ? 'Your stall is open and taking orders.'
    : "Your stall is closed. Students can't order from you right now.";
  el.statusSince.textContent = formatSince(vendor.statusUpdatedAt);

  const sign = open ? STATUS_SIGNS.open : STATUS_SIGNS.closed;
  if (el.statusSign.getAttribute('src') !== sign.src) el.statusSign.src = sign.src;
  el.statusSign.alt = sign.alt;
  el.statusSign.hidden = false;

  el.toggle.hidden = false;
  el.toggle.textContent = open ? 'Close stall' : 'Open stall';
  el.toggle.classList.toggle('ml-btn--primary', open);
  el.toggle.classList.toggle('ml-btn--blue', !open);

  if (animate) {
    el.statusSign.classList.remove('is-changing');
    // Force reflow so the animation restarts every time
    void el.statusSign.offsetWidth;
    el.statusSign.classList.add('is-changing');
  }
}

function renderReasons(reasons) {
  el.reasonOptions.replaceChildren();
  reasons.forEach((reason) => {
    const node = document.importNode(el.reasonTemplate, true);
    const input = node.querySelector('.vh-reason__input');
    input.value = reason.code;
    input.id = `reason-${reason.code}`;
    node.querySelector('.vh-reason__label').textContent = reason.label;
    el.reasonOptions.appendChild(node);
  });
}

let toastTimer;
function showToast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', error);
  el.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3200);
}

function setBusy(busy) {
  state.busy = busy;
  el.toggle.disabled = busy;
  el.confirmClose.disabled = busy;
}

/* ── Close-stall dialog ─────────────────────────────────── */

function selectedReason() {
  const checked = el.closeForm.querySelector('input[name="reason"]:checked');
  return checked ? checked.value : null;
}

function updateOtherField() {
  const isOther = selectedReason() === OTHER_CODE;
  el.otherGroup.hidden = !isOther;
  if (isOther) el.otherReason.focus();
}

function updateOtherCount() {
  el.otherCount.textContent = `${el.otherReason.value.length} / ${el.otherReason.maxLength}`;
}

function openCloseDialog() {
  el.closeForm.reset();
  el.otherGroup.hidden = true;
  el.closeError.textContent = '';
  updateOtherCount();
  el.closeDialog.showModal();
}

function cancelCloseDialog() {
  el.closeDialog.close('cancel');
}

async function submitClose(event) {
  event.preventDefault();
  if (state.busy) return;

  const reason = selectedReason();
  const otherReason = el.otherReason.value.trim();

  if (!reason) {
    el.closeError.textContent = 'Pick a reason for closing.';
    return;
  }
  if (reason === OTHER_CODE && otherReason === '') {
    el.closeError.textContent = 'Type a reason, or pick one from the list.';
    el.otherReason.focus();
    return;
  }

  el.closeError.textContent = '';
  setBusy(true);
  try {
    const payload = { isOpen: false, reason };
    if (reason === OTHER_CODE) payload.otherReason = otherReason;

    state.vendor = await api.setStatus(state.vendorId, payload);
    el.closeDialog.close('confirmed');
    renderStatus(state.vendor, { animate: true });
    showToast('Stall closed');
  } catch (error) {
    if (error.status === 409) {
      // Someone (or another tab) already closed it – just show the truth
      el.closeDialog.close('conflict');
      await refreshVendor();
      showToast('Your stall was already closed');
    } else {
      el.closeError.textContent = error.message;
    }
  } finally {
    setBusy(false);
  }
}

/* ── Open stall (no questions asked) ────────────────────── */

async function openStall() {
  setBusy(true);
  try {
    state.vendor = await api.setStatus(state.vendorId, { isOpen: true });
    renderStatus(state.vendor, { animate: true });
    showToast('Stall opened');
  } catch (error) {
    if (error.status === 409) {
      await refreshVendor();
      showToast('Your stall was already open');
    } else {
      showToast(`Couldn't open your stall: ${error.message}`, { error: true });
    }
  } finally {
    setBusy(false);
  }
}

function onToggleClick() {
  if (state.busy || !state.vendor) return;
  if (state.vendor.isOpen) {
    openCloseDialog();
  } else {
    openStall();
  }
}

async function refreshVendor() {
  state.vendor = await api.getVendor(state.vendorId);
  renderStatus(state.vendor, { animate: true });
}

/* ── Start-up ───────────────────────────────────────────── */

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    logo: byId('vendorLogo'),
    logoWrap: byId('vendorLogoWrap'),
    brandSubline: byId('brandSubline'),
    logoFallback: byId('vendorLogoFallback'),
    stallName: byId('vendorStallName'),
    logout: byId('logoutButton'),
    statusPanel: byId('statusPanel'),
    statusHeading: byId('statusHeading'),
    statusLine: byId('statusLine'),
    statusSince: byId('statusSince'),
    statusSign: byId('statusSign'),
    toggle: byId('statusToggle'),
    services: byId('servicesNav'),
    signedOut: byId('signedOutPanel'),
    closeDialog: byId('closeDialog'),
    closeForm: byId('closeForm'),
    reasonOptions: byId('reasonOptions'),
    reasonTemplate: byId('reasonOptionTemplate').content,
    otherGroup: byId('otherReasonGroup'),
    otherReason: byId('otherReason'),
    otherCount: byId('otherReasonCount'),
    closeError: byId('closeError'),
    cancelClose: byId('cancelClose'),
    confirmClose: byId('confirmClose'),
    toast: byId('toast'),
  });
}

function showSignedOut() {
  el.statusPanel.hidden = true;
  el.services.hidden = true;
  el.logout.hidden = true;
  el.logoWrap.hidden = true;
  if (el.brandSubline) el.brandSubline.hidden = true; // element was removed from the header
  el.stallName.textContent = 'Makan Liao?';
  el.signedOut.hidden = false;
}

function bindEvents() {
  el.logout.addEventListener('click', logout);
  el.toggle.addEventListener('click', onToggleClick);
  el.cancelClose.addEventListener('click', cancelCloseDialog);
  el.closeForm.addEventListener('submit', submitClose);
  el.reasonOptions.addEventListener('change', () => {
    el.closeError.textContent = '';
    updateOtherField();
  });
  el.otherReason.addEventListener('input', updateOtherCount);
}

// Load both signs up front so switching between them is instant
function preloadSigns() {
  Object.values(STATUS_SIGNS).forEach(({ src }) => {
    new Image().src = src;
  });
}

async function init() {
  preloadSigns();
  cacheElements();
  bindEvents();

  state.vendorId = resolveVendorId();
  if (state.vendorId === null) {
    showSignedOut();
    return;
  }

  try {
    const [vendor, reasons] = await Promise.all([
      api.getVendor(state.vendorId),
      api.getClosureReasons(),
    ]);
    state.vendor = vendor;
    state.reasons = reasons;
    renderHeader(vendor);
    renderStatus(vendor);
    renderReasons(reasons);
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      // Stale or bad session – treat as signed out
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
      return;
    }
    el.statusLine.textContent = "We couldn't load your stall. Refresh the page to try again.";
    showToast(error.message, { error: true });
  }
}

document.addEventListener('DOMContentLoaded', init);
