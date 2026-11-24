/* ─────────────────────────────────────────────────────────
   Vendor profile page
   - Change the shop name (must be unique; the server decides)
   - Replace the single profile picture (shrunk + cropped in the browser first)
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const SESSION_KEY = 'vendorId';
const NAME_MIN = 2;
const PICTURE_SIZE = 512; // pixels, square
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PICTURE_MAX_INPUT_BYTES = 10 * 1024 * 1024; // refuse absurdly large files before decoding

const state = {
  vendorId: null,
  vendor: null,
  pendingImage: null, // data URL of the picture chosen but not saved yet
  busy: false,
};

const el = {};

/* ── Session (same approach as the vendor home page) ────── */

function resolveVendorId() {
  const fromQuery = new URLSearchParams(window.location.search).get('vendorId');
  if (fromQuery) sessionStorage.setItem(SESSION_KEY, fromQuery);
  const raw = fromQuery || sessionStorage.getItem(SESSION_KEY);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
  saveName: (id, stallName) =>
    request(`/vendors/${id}/profile`, { method: 'PATCH', body: JSON.stringify({ stallName }) }),
  savePicture: (id, image) =>
    request(`/vendors/${id}/logo`, { method: 'PUT', body: JSON.stringify({ image }) }),
};

/* ── Helpers ────────────────────────────────────────────── */

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

// Same cleaning the server does, so the page and server agree on what "the same name" is
function cleanName(value) {
  return value.replace(/\s+/g, ' ').trim();
}

let toastTimer;
function showToast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', error);
  el.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3200);
}

/* ── Rendering ──────────────────────────────────────────── */

// Show an image (or the initials fallback) inside an <img>/<span> pair
function renderImage(img, fallback, url, name) {
  const showFallback = () => {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = initialsOf(name);
  };

  if (!isSafeImageUrl(url)) {
    showFallback();
    return;
  }
  img.onerror = showFallback;
  img.onload = () => {
    img.hidden = false;
    fallback.hidden = true;
  };
  img.src = url;
}

function renderVendor(vendor) {
  el.headerName.textContent = vendor.stallName;
  document.title = `Profile · ${vendor.stallName} · Makan Liao? for vendors`;

  renderImage(el.headerLogo, el.headerFallback, vendor.logoUrl, vendor.stallName);
  if (!state.pendingImage) {
    renderImage(el.pictureImg, el.pictureFallback, vendor.logoUrl, vendor.stallName);
  }

  el.nameInput.value = vendor.stallName;
  updateNameState();
}

function setNameError(message) {
  el.nameError.textContent = message;
  el.nameInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function updateNameState() {
  const value = cleanName(el.nameInput.value);
  el.nameCount.textContent = `${el.nameInput.value.length} / ${el.nameInput.maxLength}`;
  // Saving only makes sense when the name is valid and actually different
  const changed = state.vendor && value !== state.vendor.stallName;
  el.saveName.disabled = state.busy || !changed || value.length < NAME_MIN;
}

function setBusy(busy) {
  state.busy = busy;
  el.saveImage.disabled = busy;
  el.discardImage.disabled = busy;
  updateNameState();
}

/* ── Shop name ──────────────────────────────────────────── */

async function submitName(event) {
  event.preventDefault();
  if (state.busy) return;

  const stallName = cleanName(el.nameInput.value);
  if (stallName.length < NAME_MIN) {
    setNameError(`Shop name must be at least ${NAME_MIN} characters.`);
    return;
  }

  setNameError('');
  setBusy(true);
  try {
    state.vendor = await api.saveName(state.vendorId, stallName);
    renderVendor(state.vendor);
    showToast('Shop name updated');
  } catch (error) {
    setNameError(error.message); // includes "That shop name is already taken"
    el.nameInput.focus();
  } finally {
    setBusy(false);
  }
}

/* ── Profile picture ────────────────────────────────────── */

function setPictureError(message) {
  el.pictureError.textContent = message;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

// Centre-crop to a square and shrink, so uploads stay small and consistent
async function prepareSquareImage(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const size = Math.min(PICTURE_SIZE, side);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white instead of black in JPEG
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function showPendingControls(pending) {
  el.saveImage.hidden = !pending;
  el.discardImage.hidden = !pending;
}

function discardPending() {
  state.pendingImage = null;
  el.pictureInput.value = '';
  setPictureError('');
  showPendingControls(false);
  renderImage(el.pictureImg, el.pictureFallback, state.vendor.logoUrl, state.vendor.stallName);
}

async function onPictureChosen() {
  const file = el.pictureInput.files[0];
  if (!file) return;
  setPictureError('');

  if (!PICTURE_TYPES.includes(file.type)) {
    setPictureError('Please choose a PNG, JPEG or WebP picture.');
    el.pictureInput.value = '';
    return;
  }
  if (file.size > PICTURE_MAX_INPUT_BYTES) {
    setPictureError('That picture is too large. Please choose one under 10 MB.');
    el.pictureInput.value = '';
    return;
  }

  try {
    state.pendingImage = await prepareSquareImage(file);
    el.pictureImg.src = state.pendingImage;
    el.pictureImg.hidden = false;
    el.pictureFallback.hidden = true;
    showPendingControls(true);
  } catch (error) {
    setPictureError(error.message);
    el.pictureInput.value = '';
  }
}

async function savePicture() {
  if (state.busy || !state.pendingImage) return;

  setPictureError('');
  setBusy(true);
  try {
    state.vendor = await api.savePicture(state.vendorId, state.pendingImage);
    state.pendingImage = null;
    el.pictureInput.value = '';
    showPendingControls(false);
    renderVendor(state.vendor);
    showToast('Profile picture updated');
  } catch (error) {
    setPictureError(error.message);
  } finally {
    setBusy(false);
  }
}

/* ── Start-up ───────────────────────────────────────────── */

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    headerLogo: byId('vendorLogo'),
    headerFallback: byId('vendorLogoFallback'),
    headerLogoWrap: byId('vendorLogoWrap'),
    headerName: byId('vendorStallName'),
    backLink: byId('backLink'),
    panel: byId('profilePanel'),
    signedOut: byId('signedOutPanel'),
    pictureImg: byId('pictureImg'),
    pictureFallback: byId('pictureFallback'),
    pictureInput: byId('pictureInput'),
    chooseButton: byId('chooseButton'),
    saveImage: byId('saveImageButton'),
    discardImage: byId('discardImageButton'),
    pictureError: byId('pictureError'),
    nameForm: byId('nameForm'),
    nameInput: byId('stallNameInput'),
    nameCount: byId('nameCount'),
    nameError: byId('nameError'),
    saveName: byId('saveNameButton'),
    toast: byId('toast'),
  });
}

function showSignedOut() {
  el.panel.hidden = true;
  el.backLink.hidden = true;
  el.headerLogoWrap.hidden = true;
  el.headerName.textContent = 'Makan Liao?';
  el.signedOut.hidden = false;
}

function bindEvents() {
  el.nameForm.addEventListener('submit', submitName);
  el.nameInput.addEventListener('input', () => {
    setNameError('');
    updateNameState();
  });
  el.pictureInput.addEventListener('change', onPictureChosen);
  el.saveImage.addEventListener('click', savePicture);
  el.discardImage.addEventListener('click', discardPending);
  // Let keyboard users open the file picker from the styled label
  el.chooseButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      el.pictureInput.click();
    }
  });
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
    state.vendor = await api.getVendor(state.vendorId);
    renderVendor(state.vendor);
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
      return;
    }
    showToast(`We couldn't load your profile: ${error.message}`, { error: true });
  }
}

document.addEventListener('DOMContentLoaded', init);
