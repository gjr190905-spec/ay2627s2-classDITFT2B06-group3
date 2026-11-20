/* ─────────────────────────────────────────────────────────
   Vendor menu page
   - Add, edit and delete menu items (one photo per item)
   - Switch items between Available and Sold out, and set how many are left
   - Replace or remove the single menu banner
   Everything is read from and saved to /vendors/:id/menu, the same data the
   customer stall page and checkout validation use.
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const SESSION_KEY = 'vendorId';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024; // refuse absurdly large files before decoding
const PHOTO_SIZE = 600; // item photos: square, pixels
const BANNER_WIDTH = 1500; // banner: 3 : 1
const BANNER_HEIGHT = 500;
const QUANTITY_MAX = 9999;

const state = {
  vendorId: null,
  vendor: null,
  bannerUrl: null,
  items: [],
  pendingBanner: null, // data URL chosen but not saved yet
  editing: null, // the item being edited, or null when adding
  pendingPhoto: null, // data URL chosen in the dialog, not saved yet
  removePhoto: false, // the vendor pressed "Remove photo" in the dialog
  deleting: null, // the item waiting for delete confirmation
  busyItems: new Set(), // ids of items with a request in flight
  busy: false,
};

const el = {};

/* ── Session (same approach as the other vendor pages) ──── */

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
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const send = (method, data) => ({ method, body: JSON.stringify(data) });

const api = {
  getMenu: (vid) => request(`/vendors/${vid}/menu`),
  addItem: (vid, data) => request(`/vendors/${vid}/menu/items`, send('POST', data)),
  editItem: (vid, id, data) => request(`/vendors/${vid}/menu/items/${id}`, send('PATCH', data)),
  deleteItem: (vid, id) => request(`/vendors/${vid}/menu/items/${id}`, { method: 'DELETE' }),
  setAvailable: (vid, id, isAvailable) =>
    request(`/vendors/${vid}/menu/items/${id}/availability`, send('PATCH', { isAvailable })),
  savePhoto: (vid, id, image) =>
    request(`/vendors/${vid}/menu/items/${id}/image`, send('PUT', { image })),
  deletePhoto: (vid, id) => request(`/vendors/${vid}/menu/items/${id}/image`, { method: 'DELETE' }),
  saveBanner: (vid, image) => request(`/vendors/${vid}/menu/banner`, send('PUT', { image })),
  deleteBanner: (vid) => request(`/vendors/${vid}/menu/banner`, { method: 'DELETE' }),
};

/* ── Helpers ────────────────────────────────────────────── */

function isSafeImageUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Previews of a picture the vendor just chose (made by prepareImage on this page)
  if (url.startsWith('data:image/jpeg;base64,')) return true;
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

let toastTimer;
function showToast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', error);
  el.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 3200);
}

// Show an image, or run onMissing() if there is none or it fails to load
function renderImage(img, url, onMissing, onShown) {
  if (!isSafeImageUrl(url)) {
    img.hidden = true;
    onMissing();
    return;
  }
  img.onerror = () => {
    img.hidden = true;
    onMissing();
  };
  img.onload = () => {
    img.hidden = false;
    if (onShown) onShown();
  };
  img.src = url;
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

/**
 * Centre-crop a picture to the given shape and shrink it, so uploads stay small
 * (well under the server's 1 MB limit) and every photo has the same shape.
 */
async function prepareImage(file, width, height) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error('Please choose a PNG, JPEG or WebP picture.');
  }
  if (file.size > IMAGE_MAX_INPUT_BYTES) {
    throw new Error('That picture is too large. Please choose one under 10 MB.');
  }

  const img = await loadImage(file);
  const ratio = width / height;
  let sw = img.naturalWidth;
  let sh = sw / ratio;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * ratio;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  const scale = Math.min(1, width / sw);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs become white instead of black in JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

/* ── Header ─────────────────────────────────────────────── */

function renderHeader(vendor) {
  el.headerName.textContent = vendor.stallName;
  document.title = `Menu · ${vendor.stallName} · Makan Liao? for vendors`;
  el.headerLogo.alt = `${vendor.stallName} logo`;
  renderImage(
    el.headerLogo,
    vendor.logoUrl,
    () => {
      el.headerFallback.hidden = false;
      el.headerFallback.textContent = initialsOf(vendor.stallName);
    },
    () => {
      el.headerFallback.hidden = true;
    },
  );
  el.customerLink.href = `../stall.html?vendorId=${vendor.id}`;
}

/* ── Banner ─────────────────────────────────────────────── */

function setBannerError(message) {
  el.bannerError.textContent = message;
}

function renderBanner() {
  const pending = state.pendingBanner !== null;
  const url = pending ? state.pendingBanner : state.bannerUrl;

  el.bannerEmpty.hidden = true;
  if (url) {
    renderImage(el.bannerImg, url, () => {
      el.bannerEmpty.hidden = false;
    });
  } else {
    el.bannerImg.hidden = true;
    el.bannerImg.removeAttribute('src');
    el.bannerEmpty.hidden = false;
  }

  el.chooseBanner.textContent = state.bannerUrl ? 'Change banner' : 'Choose banner';
  el.saveBanner.hidden = !pending;
  el.discardBanner.hidden = !pending;
  el.removeBanner.hidden = pending || !state.bannerUrl;
}

async function onBannerChosen() {
  const file = el.bannerInput.files[0];
  el.bannerInput.value = '';
  if (!file) return;
  setBannerError('');
  try {
    state.pendingBanner = await prepareImage(file, BANNER_WIDTH, BANNER_HEIGHT);
    renderBanner();
  } catch (error) {
    setBannerError(error.message);
  }
}

function discardBanner() {
  state.pendingBanner = null;
  setBannerError('');
  renderBanner();
}

async function saveBanner() {
  if (state.busy || !state.pendingBanner) return;
  state.busy = true;
  el.saveBanner.disabled = true;
  setBannerError('');
  try {
    const result = await api.saveBanner(state.vendorId, state.pendingBanner);
    state.bannerUrl = result.bannerUrl;
    state.pendingBanner = null;
    renderBanner();
    showToast('Banner updated');
  } catch (error) {
    setBannerError(error.message);
  } finally {
    state.busy = false;
    el.saveBanner.disabled = false;
  }
}

async function removeBanner() {
  if (state.busy) return;
  state.busy = true;
  el.removeBanner.disabled = true;
  setBannerError('');
  try {
    await api.deleteBanner(state.vendorId);
    state.bannerUrl = null;
    renderBanner();
    showToast('Banner removed');
  } catch (error) {
    setBannerError(error.message);
  } finally {
    state.busy = false;
    el.removeBanner.disabled = false;
  }
}

/* ── Item list ──────────────────────────────────────────── */

function renderSummary() {
  const total = state.items.length;
  const soldOut = state.items.filter((item) => !item.isAvailable).length;
  if (total === 0) {
    el.summary.textContent = 'No items yet';
    return;
  }
  const itemWord = total === 1 ? 'item' : 'items';
  el.summary.textContent = `${total} ${itemWord} · ${total - soldOut} available · ${soldOut} sold out`;
}

function fillItemRow(row, item) {
  const busy = state.busyItems.has(item.id);
  row.dataset.itemId = String(item.id);
  row.classList.toggle('is-sold-out', !item.isAvailable);
  row.setAttribute('aria-busy', busy ? 'true' : 'false');

  row.querySelector('.vm-item__name').textContent = item.name;
  const desc = row.querySelector('.vm-item__desc');
  desc.textContent = item.description || '';
  desc.hidden = !item.description;
  row.querySelector('.vm-item__price').textContent = formatPrice(item.priceCents);

  const img = row.querySelector('.vm-item__img');
  const initial = row.querySelector('.vm-item__initial');
  img.alt = `${item.name} photo`;
  initial.textContent = initialsOf(item.name);
  if (img.dataset.src !== (item.imageUrl || '')) {
    img.dataset.src = item.imageUrl || '';
    initial.hidden = true;
    renderImage(
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

  const counting = item.quantityLeft !== null;
  row.querySelector('[data-role="qty"]').hidden = !counting;
  row.querySelector('[data-role="qtyOff"]').hidden = counting;
  if (counting) {
    row.querySelector('[data-role="qtyValue"]').textContent = `${item.quantityLeft} left`;
    const dec = row.querySelector('[data-action="decrease"]');
    const inc = row.querySelector('[data-action="increase"]');
    dec.setAttribute('aria-label', `One less ${item.name}`);
    inc.setAttribute('aria-label', `One more ${item.name}`);
    // Busy buttons use aria-disabled (not disabled) so keyboard focus stays on them
    dec.disabled = item.quantityLeft === 0;
    inc.disabled = item.quantityLeft >= QUANTITY_MAX;
    dec.setAttribute('aria-disabled', busy ? 'true' : 'false');
    inc.setAttribute('aria-disabled', busy ? 'true' : 'false');
  }

  const toggle = row.querySelector('[data-action="toggle"]');
  toggle.setAttribute('aria-checked', item.isAvailable ? 'true' : 'false');
  toggle.setAttribute('aria-label', `${item.name} available`);
  toggle.querySelector('.vm-switch__label').textContent = item.isAvailable
    ? 'Available'
    : 'Sold out';
  toggle.setAttribute('aria-disabled', busy ? 'true' : 'false');

  row.querySelector('[data-action="edit"]').setAttribute('aria-label', `Edit ${item.name}`);
  row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${item.name}`);
}

function renderItems() {
  const rows = state.items.map((item) => {
    const existing = el.list.querySelector(`[data-item-id="${item.id}"]`);
    const row = existing || document.importNode(el.itemTemplate, true).firstElementChild;
    fillItemRow(row, item);
    return row;
  });
  // Update rows in place (only moving what moved) so keyboard focus isn't lost
  [...el.list.children].forEach((child) => {
    if (!rows.includes(child)) child.remove();
  });
  rows.forEach((row, index) => {
    if (el.list.children[index] !== row) el.list.insertBefore(row, el.list.children[index] || null);
  });
  el.emptyMenu.hidden = state.items.length > 0;
  renderSummary();
}

function replaceItem(updated) {
  state.items = state.items.map((item) => (item.id === updated.id ? updated : item));
  renderItems();
}

function itemById(id) {
  return state.items.find((item) => item.id === id);
}

// Run a request for one item, keeping its buttons disabled while it's in flight
async function withItemBusy(item, task) {
  if (state.busyItems.has(item.id)) return;
  state.busyItems.add(item.id);
  renderItems();
  try {
    await task();
  } finally {
    state.busyItems.delete(item.id);
    renderItems();
  }
}

async function handleItemError(error) {
  if (error.status === 404) {
    // Deleted in another tab – show the menu as it really is
    await refreshMenu();
    showToast('That item is no longer on your menu', { error: true });
    return;
  }
  showToast(error.message, { error: true });
}

async function toggleAvailability(item) {
  await withItemBusy(item, async () => {
    try {
      const updated = await api.setAvailable(state.vendorId, item.id, !item.isAvailable);
      replaceItem(updated);
      showToast(updated.isAvailable ? `${updated.name} is available` : `${updated.name} sold out`);
    } catch (error) {
      await handleItemError(error);
    }
  });
}

async function changeQuantity(item, delta) {
  const next = Math.min(QUANTITY_MAX, Math.max(0, item.quantityLeft + delta));
  if (next === item.quantityLeft) return;
  await withItemBusy(item, async () => {
    try {
      const updated = await api.editItem(state.vendorId, item.id, { quantityLeft: next });
      replaceItem(updated);
      if (next === 0) showToast(`${updated.name} sold out`);
    } catch (error) {
      await handleItemError(error);
    }
  });
}

function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  const row = button.closest('.vm-item');
  const item = itemById(Number(row.dataset.itemId));
  if (!item) return;

  const actions = {
    toggle: () => toggleAvailability(item),
    decrease: () => changeQuantity(item, -1),
    increase: () => changeQuantity(item, 1),
    edit: () => openItemDialog(item),
    delete: () => openDeleteDialog(item),
  };
  actions[button.dataset.action]();
}

/* ── Add / edit dialog ──────────────────────────────────── */

function renderDialogPhoto() {
  const existing = state.editing && !state.removePhoto ? state.editing.imageUrl : null;
  const url = state.pendingPhoto || existing;
  el.photoEmpty.hidden = true;
  if (url) {
    renderImage(el.photoImg, url, () => {
      el.photoEmpty.hidden = false;
    });
  } else {
    el.photoImg.hidden = true;
    el.photoImg.removeAttribute('src');
    el.photoEmpty.hidden = false;
  }
  el.removePhoto.hidden = !url;
  el.choosePhoto.textContent = url ? 'Change photo' : 'Choose photo';
}

function setItemError(message, field) {
  el.itemError.textContent = message;
  [el.itemName, el.itemPrice, el.itemQuantity, el.itemDescription].forEach((input) => {
    input.setAttribute('aria-invalid', input === field ? 'true' : 'false');
  });
  if (field) field.focus();
}

function openItemDialog(item = null) {
  state.editing = item;
  state.pendingPhoto = null;
  state.removePhoto = false;
  el.itemForm.reset();
  setItemError('');

  el.itemDialogHeading.textContent = item ? 'Edit item' : 'Add item';
  el.itemDialogHint.textContent = item
    ? 'Changes show up on your menu straight away.'
    : 'Students see this on your menu.';
  el.saveItem.textContent = item ? 'Save changes' : 'Add item';

  if (item) {
    el.itemName.value = item.name;
    el.itemDescription.value = item.description || '';
    el.itemPrice.value = (item.priceCents / 100).toFixed(2);
    el.itemQuantity.value = item.quantityLeft === null ? '' : String(item.quantityLeft);
  }
  el.itemStock.value = item && item.quantityLeft !== null ? 'limited' : 'unlimited';
  renderStockField();
  renderDialogPhoto();
  el.itemDialog.showModal();
  el.itemName.focus();
}

// Show the quantity box only when "Set quantity left" is chosen
function renderStockField() {
  const limited = el.itemStock.value === 'limited';
  el.quantityField.hidden = !limited;
  el.stockNote.textContent = limited
    ? 'At 0 left the item shows as sold out. Choose No limit any time to stop counting.'
    : 'No limit: the item stays available until you mark it sold out. You can switch this any time.';
}

function onStockChanged() {
  setItemError('');
  renderStockField();
  if (el.itemStock.value === 'limited') {
    // Switching back to counting: start from the item's last count, if it had one
    const previous = state.editing && state.editing.quantityLeft;
    if (el.itemQuantity.value === '' && Number.isInteger(previous)) {
      el.itemQuantity.value = String(previous);
    }
    el.itemQuantity.focus();
  }
}

/**
 * Read and check the dialog fields (the server checks again).
 * @returns {{error: string, field: HTMLElement} | {data: object}}
 */
function readItemForm() {
  const name = el.itemName.value.replace(/\s+/g, ' ').trim();
  if (name === '') return { error: 'Give the item a name.', field: el.itemName };

  const priceText = el.itemPrice.value.trim().replace(/^\$/, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0) {
    return { error: 'Enter a price from 0.01 to 999.99, e.g. 4.50.', field: el.itemPrice };
  }

  // "No limit" sends null; "Set quantity left" needs a number
  let quantityLeft = null;
  if (el.itemStock.value === 'limited') {
    const quantityText = el.itemQuantity.value.trim();
    quantityLeft = Number(quantityText);
    if (
      quantityText === '' ||
      !Number.isInteger(quantityLeft) ||
      quantityLeft < 0 ||
      quantityLeft > QUANTITY_MAX
    ) {
      return {
        error: `Enter how many are left, a whole number from 0 to ${QUANTITY_MAX}. Or choose No limit.`,
        field: el.itemQuantity,
      };
    }
  }

  return {
    data: { name, description: el.itemDescription.value.trim(), price: priceText, quantityLeft },
  };
}

// Only send what actually changed when editing
function changedFields(item, data) {
  const changes = {};
  if (data.name !== item.name) changes.name = data.name;
  if (data.description !== (item.description || '')) changes.description = data.description;
  if (Math.round(Number(data.price) * 100) !== item.priceCents) changes.price = data.price;
  if (data.quantityLeft !== item.quantityLeft) changes.quantityLeft = data.quantityLeft;
  return changes;
}

async function savePhotoChanges(itemId, current) {
  if (state.pendingPhoto) return api.savePhoto(state.vendorId, itemId, state.pendingPhoto);
  if (state.removePhoto && current.imageUrl) return api.deletePhoto(state.vendorId, itemId);
  return current;
}

async function submitItem(event) {
  event.preventDefault();
  if (state.busy) return;

  const form = readItemForm();
  if (form.error) {
    setItemError(form.error, form.field);
    return;
  }
  setItemError('');
  state.busy = true;
  el.saveItem.disabled = true;

  const editing = state.editing;
  let saved = null;
  try {
    if (editing) {
      const changes = changedFields(editing, form.data);
      saved =
        Object.keys(changes).length > 0
          ? await api.editItem(state.vendorId, editing.id, changes)
          : editing;
      saved = await savePhotoChanges(editing.id, saved);
      replaceItem(saved);
    } else {
      saved = await api.addItem(state.vendorId, form.data);
      state.items = [...state.items, saved];
      renderItems();
      saved = await savePhotoChanges(saved.id, saved);
      replaceItem(saved);
    }
    el.itemDialog.close('saved');
    showToast(editing ? `${saved.name} updated` : `${saved.name} added to your menu`);
  } catch (error) {
    if (saved && !editing) {
      // The item was added but its photo wasn't saved: keep the item, say what failed
      el.itemDialog.close('saved');
      showToast(`${saved.name} was added, but the photo wasn't saved: ${error.message}`, {
        error: true,
      });
    } else if (error.status === 404) {
      el.itemDialog.close('gone');
      await handleItemError(error);
    } else {
      const field = error.status === 409 ? el.itemName : null;
      setItemError(error.message, field);
    }
  } finally {
    state.busy = false;
    el.saveItem.disabled = false;
  }
}

async function onPhotoChosen() {
  const file = el.photoInput.files[0];
  el.photoInput.value = '';
  if (!file) return;
  setItemError('');
  try {
    state.pendingPhoto = await prepareImage(file, PHOTO_SIZE, PHOTO_SIZE);
    state.removePhoto = false;
    renderDialogPhoto();
  } catch (error) {
    setItemError(error.message);
  }
}

function onRemovePhoto() {
  state.pendingPhoto = null;
  state.removePhoto = true;
  renderDialogPhoto();
}

/* ── Delete dialog ──────────────────────────────────────── */

function openDeleteDialog(item) {
  state.deleting = item;
  el.deleteHeading.textContent = `Delete ${item.name}?`;
  el.deleteError.textContent = '';
  el.deleteDialog.showModal();
  el.cancelDelete.focus();
}

async function confirmDelete() {
  const item = state.deleting;
  if (!item || state.busy) return;
  state.busy = true;
  el.confirmDelete.disabled = true;
  try {
    await api.deleteItem(state.vendorId, item.id);
    state.items = state.items.filter((i) => i.id !== item.id);
    renderItems();
    el.deleteDialog.close('deleted');
    showToast(`${item.name} deleted`);
  } catch (error) {
    if (error.status === 404) {
      el.deleteDialog.close('gone');
      await refreshMenu();
      showToast(`${item.name} was already deleted`);
    } else {
      el.deleteError.textContent = error.message;
    }
  } finally {
    state.busy = false;
    el.confirmDelete.disabled = false;
  }
}

/* ── Start-up ───────────────────────────────────────────── */

async function refreshMenu() {
  const menu = await api.getMenu(state.vendorId);
  state.vendor = menu.vendor;
  state.bannerUrl = menu.bannerUrl;
  state.items = menu.items;
  renderHeader(menu.vendor);
  renderBanner();
  renderItems();
}

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    headerLogo: byId('vendorLogo'),
    headerFallback: byId('vendorLogoFallback'),
    headerLogoWrap: byId('vendorLogoWrap'),
    headerName: byId('vendorStallName'),
    backLink: byId('backLink'),
    panel: byId('menuPanel'),
    signedOut: byId('signedOutPanel'),
    customerLink: byId('customerViewLink'),
    bannerImg: byId('bannerImg'),
    bannerEmpty: byId('bannerEmpty'),
    bannerInput: byId('bannerInput'),
    chooseBanner: byId('chooseBannerButton'),
    saveBanner: byId('saveBannerButton'),
    discardBanner: byId('discardBannerButton'),
    removeBanner: byId('removeBannerButton'),
    bannerError: byId('bannerError'),
    summary: byId('menuSummary'),
    addItem: byId('addItemButton'),
    list: byId('itemList'),
    emptyMenu: byId('emptyMenu'),
    itemTemplate: byId('itemTemplate').content,
    itemDialog: byId('itemDialog'),
    itemDialogHeading: byId('itemDialogHeading'),
    itemDialogHint: byId('itemDialogHint'),
    itemForm: byId('itemForm'),
    itemName: byId('itemName'),
    itemDescription: byId('itemDescription'),
    itemPrice: byId('itemPrice'),
    itemQuantity: byId('itemQuantity'),
    itemStock: byId('itemStock'),
    quantityField: byId('quantityField'),
    stockNote: byId('stockNote'),
    itemError: byId('itemError'),
    cancelItem: byId('cancelItem'),
    saveItem: byId('saveItem'),
    photoImg: byId('photoImg'),
    photoEmpty: byId('photoEmpty'),
    photoInput: byId('photoInput'),
    choosePhoto: byId('choosePhotoButton'),
    removePhoto: byId('removePhotoButton'),
    deleteDialog: byId('deleteDialog'),
    deleteHeading: byId('deleteDialogHeading'),
    deleteError: byId('deleteError'),
    cancelDelete: byId('cancelDelete'),
    confirmDelete: byId('confirmDelete'),
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

// Let keyboard users open a file picker from its styled <label>
function openPickerOnKey(label, input) {
  label.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
}

function bindEvents() {
  el.bannerInput.addEventListener('change', onBannerChosen);
  el.saveBanner.addEventListener('click', saveBanner);
  el.discardBanner.addEventListener('click', discardBanner);
  el.removeBanner.addEventListener('click', removeBanner);
  openPickerOnKey(el.chooseBanner, el.bannerInput);

  el.addItem.addEventListener('click', () => openItemDialog());
  el.list.addEventListener('click', onListClick);

  el.itemForm.addEventListener('submit', submitItem);
  el.cancelItem.addEventListener('click', () => el.itemDialog.close('cancel'));
  el.photoInput.addEventListener('change', onPhotoChosen);
  el.itemStock.addEventListener('change', onStockChanged);
  el.removePhoto.addEventListener('click', onRemovePhoto);
  openPickerOnKey(el.choosePhoto, el.photoInput);
  [el.itemName, el.itemPrice, el.itemQuantity, el.itemDescription].forEach((input) =>
    input.addEventListener('input', () => setItemError('')),
  );

  el.cancelDelete.addEventListener('click', () => el.deleteDialog.close('cancel'));
  el.confirmDelete.addEventListener('click', confirmDelete);
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
    await refreshMenu();
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
      return;
    }
    showToast(`We couldn't load your menu: ${error.message}`, { error: true });
  }
}

document.addEventListener('DOMContentLoaded', init);
