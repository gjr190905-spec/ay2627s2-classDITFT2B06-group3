/* ─────────────────────────────────────────────────────────
   Vendor dashboard
   - Today's figures: stat tiles and charts (/orders/stats)
   - Preparation board: orders grouped by pickup window, earliest first
     (Confirmed → Preparing → Ready; students can cancel before Ready)
   - Handover: find a ready order by number (or open it from the board),
     check the number, take payment, hand over, mark Collected
   Charts follow the data-viz rules: thin columns from one baseline, hairline
   grid, one colour per series, hover/focus tooltips, and a table view.
   ───────────────────────────────────────────────────────── */

const API_URL = ''; // Same origin as the Express server
const SESSION_KEY = 'vendorId';
const TIME_ZONE = 'Asia/Singapore';
const REFRESH_MS = 20000;

// Status colours: categorical slots 1–4 (validated as a set, see README), plus a neutral
// grey for Cancelled. Status is never shown by colour alone – there is always a text label.
const STATUSES = ['CONFIRMED', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'];
const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COLLECTED: 'Collected',
  CANCELLED: 'Cancelled',
};

// Which statuses each board filter shows
const FILTERS = {
  active: ['CONFIRMED', 'PREPARING', 'READY'],
  ready: ['READY'],
  collected: ['COLLECTED'],
  all: STATUSES,
};

const state = {
  vendorId: null,
  orders: null, // { date, windows }
  stats: null,
  filter: 'active',
  handover: null, // the order open in the handover dialog
  busyOrders: new Set(),
  refreshTimer: null,
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
  orders: (vid) => request(`/vendors/${vid}/orders`),
  stats: (vid) => request(`/vendors/${vid}/orders/stats`),
  byNumber: (vid, n) => request(`/vendors/${vid}/orders/number/${encodeURIComponent(n)}`),
  advance: (vid, id, status) =>
    request(`/vendors/${vid}/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  collect: (vid, id, body) =>
    request(`/vendors/${vid}/orders/${id}/collect`, { method: 'POST', body: JSON.stringify(body) }),
};

/* ── Formatting ─────────────────────────────────────────── */

const timeFormat = new Intl.DateTimeFormat('en-SG', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const dayFormat = new Intl.DateTimeFormat('en-SG', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
});
const shortDayFormat = new Intl.DateTimeFormat('en-SG', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC', // YYYY-MM-DD strings are parsed as UTC midnight
});

function formatTime(value) {
  return timeFormat.format(new Date(value));
}

function formatWindow(start, end) {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMoneyShort(cents) {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${(dollars / 1000).toFixed(1)}K` : `$${Math.round(dollars)}`;
}

function minutesBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
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

/** Create an element with a class and (safe) text. */
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

/** True when the student has already paid for this order online (shared "payments" table). */
function isPaidOnline(order) {
  return Boolean(order.payment && order.payment.status === 'PAID');
}

/** A status pill: colour dot + text label (never colour alone). */
function statusPill(status, node = make('span', 'db-status')) {
  node.className = `db-status db-status--${status.toLowerCase()}`;
  node.textContent = STATUS_LABEL[status];
  return node;
}

/* ── Chart tooltip (shared by every chart) ──────────────── */

function showTooltip(target, value, label) {
  el.tooltip.replaceChildren(make('strong', '', value), make('span', '', label));
  el.tooltip.hidden = false;
  const box = target.getBoundingClientRect();
  const tip = el.tooltip.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - tip.width - 8,
    Math.max(8, box.left + box.width / 2 - tip.width / 2),
  );
  el.tooltip.style.left = `${left + window.scrollX}px`;
  el.tooltip.style.top = `${box.top + window.scrollY - tip.height - 8}px`;
}

function hideTooltip() {
  el.tooltip.hidden = true;
}

/** Hover and keyboard focus show the same tooltip. */
function attachTooltip(node, value, label) {
  node.tabIndex = 0;
  node.setAttribute('aria-label', `${label}: ${value}`);
  const show = () => showTooltip(node, value, label);
  node.addEventListener('pointerenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('pointerleave', hideTooltip);
  node.addEventListener('blur', hideTooltip);
}

/** A collapsible table with the same numbers as the chart. */
function tableView(headers, rows) {
  const details = make('details', 'db-table-view');
  details.append(make('summary', '', 'View as table'));
  const table = make('table', 'db-table');
  const head = table.createTHead().insertRow();
  headers.forEach((h) => head.append(make('th', '', h)));
  const body = table.createTBody();
  rows.forEach((cells) => {
    const tr = body.insertRow();
    cells.forEach((c) => tr.append(make('td', '', c)));
  });
  details.append(table);
  return details;
}

/* ── Charts ─────────────────────────────────────────────── */

/** Clean y-axis ticks: 0 to a round maximum, at most 5 ticks. */
function niceTicks(max) {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/**
 * A single-series column chart: thin columns (max 24px) with rounded tops growing from
 * one baseline, hairline gridlines, the highest column labelled on its cap.
 *
 * @param {HTMLElement} container
 * @param {{label: string, value: number, tooltipLabel: string}[]} data
 * @param {{format: Function, tickFormat: Function, unit: string, emptyText: string}} options
 */
function renderColumns(container, data, options) {
  container.replaceChildren();
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    container.append(make('p', 'db-chart__empty', options.emptyText));
    return;
  }

  const ticks = niceTicks(Math.max(...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1];
  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);

  const figure = make('div', 'db-columns');
  const axis = make('div', 'db-columns__axis');
  const plot = make('div', 'db-columns__plot');
  ticks
    .slice()
    .reverse()
    .forEach((t) => {
      axis.append(make('span', '', options.tickFormat(t)));
      const line = make('span', 'db-columns__grid');
      line.style.bottom = `${(t / top) * 100}%`;
      plot.append(line);
    });

  const bars = make('div', 'db-columns__bars');
  const labels = make('div', 'db-columns__labels');
  data.forEach((d) => {
    const slot = make('div', 'db-columns__slot');
    const bar = make('div', 'db-columns__bar');
    bar.style.height = `${(d.value / top) * 100}%`;
    if (d.value === 0) bar.classList.add('is-zero');
    if (d === peak) {
      bar.append(make('span', 'db-columns__cap', options.format(d.value)));
    }
    attachTooltip(slot, options.format(d.value), d.tooltipLabel);
    slot.append(bar);
    bars.append(slot);
    labels.append(make('span', '', d.label));
  });
  plot.append(bars);
  figure.append(axis, plot, make('span', ''), labels);
  // When slots get narrow, show every other x label so they never overlap
  // (each value is still in the tooltip and the table view)
  const thin = () => labels.classList.toggle('is-dense', labels.clientWidth / data.length < 52);
  if (window.ResizeObserver) new ResizeObserver(thin).observe(labels);
  container.append(
    figure,
    tableView(
      [options.columnHeading, options.unit],
      data.map((d) => [d.tooltipLabel, options.format(d.value)]),
    ),
  );
}

/**
 * Order status as one tall segmented bar (one whole, four parts) with a legend.
 * Each part shows its count inside when it fits; hover/focus gives the full detail.
 */
function renderStatusBar(container, counts) {
  container.replaceChildren();
  if (counts.total === 0) {
    container.append(make('p', 'db-chart__empty', 'No orders yet today.'));
    return;
  }

  const bar = make('div', 'db-segbar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', STATUSES.map((s) => `${STATUS_LABEL[s]} ${counts[s]}`).join(', '));
  STATUSES.forEach((status) => {
    if (counts[status] === 0) return;
    const share = counts[status] / counts.total;
    const part = make('div', `db-segbar__part db-segbar__part--${status.toLowerCase()}`);
    part.style.flexGrow = String(counts[status]);
    // Print the count inside only when the part is wide enough to hold it
    if (share >= 0.1) part.append(make('span', '', String(counts[status])));
    attachTooltip(part, `${counts[status]} (${Math.round(share * 100)}%)`, STATUS_LABEL[status]);
    bar.append(part);
  });

  const legend = make('ul', 'db-legend');
  STATUSES.forEach((status) => {
    const li = make('li', '');
    li.append(make('span', `db-legend__key db-legend__key--${status.toLowerCase()}`));
    li.append(make('span', 'db-legend__name', STATUS_LABEL[status]));
    li.append(make('span', 'db-legend__value', String(counts[status])));
    legend.append(li);
  });

  container.append(bar, legend);
}

/** Ready-on-time as a meter: share of ready orders that were ready by the window end. */
function renderOnTime(container, readyOnTime) {
  container.replaceChildren();
  const total = readyOnTime.onTime + readyOnTime.late;
  if (total === 0) {
    container.append(make('p', 'db-chart__empty', 'No orders have been marked ready yet.'));
    return;
  }

  const percent = Math.round(readyOnTime.rate * 100);
  container.append(make('p', 'db-meter__value', `${percent}%`));
  const meter = make('div', 'db-meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.setAttribute('aria-valuenow', String(percent));
  meter.setAttribute('aria-label', 'Ready on time');
  const fill = make('div', 'db-meter__fill');
  fill.style.width = `${percent}%`;
  meter.append(fill);
  container.append(meter);
  container.append(
    make(
      'p',
      'db-meter__note',
      `${readyOnTime.onTime} of ${total} ready on time · ${readyOnTime.late} late`,
    ),
  );
}

/** Top items as a list of horizontal bars (one series), value at the bar tip. */
function renderTopItems(container, items) {
  container.replaceChildren();
  if (items.length === 0) {
    container.append(make('p', 'db-chart__empty', 'No items ordered yet today.'));
    return;
  }
  const max = Math.max(...items.map((i) => i.quantity));
  const list = make('ul', 'db-hbars');
  items.forEach((item) => {
    const li = make('li', 'db-hbars__row');
    li.append(make('span', 'db-hbars__name', item.name));
    const track = make('span', 'db-hbars__track');
    const bar = make('span', 'db-hbars__bar');
    bar.style.width = `${(item.quantity / max) * 100}%`;
    track.append(bar);
    li.append(track, make('span', 'db-hbars__value', String(item.quantity)));
    list.append(li);
  });
  container.append(list);
}

/* ── Stat tiles and charts ──────────────────────────────── */

function renderStats(stats) {
  const c = stats.counts;
  el.tileOrders.textContent = String(c.total);
  const cancelled = c.CANCELLED ? ` · ${c.CANCELLED} cancelled` : '';
  el.tileOrdersNote.textContent = `${stats.byWindow.length} pickup windows${cancelled}`;
  el.tilePrepare.textContent = String(c.CONFIRMED + c.PREPARING);
  el.tilePrepareNote.textContent = `${c.CONFIRMED} confirmed · ${c.PREPARING} preparing`;
  el.tileReady.textContent = String(c.READY);
  el.tileReadyNote.textContent = `${formatMoney(stats.toCollectCents)} to collect`;
  el.tileCollected.textContent = String(c.COLLECTED);
  el.tileCollectedNote.textContent = `${formatMoney(stats.collectedCents)} taken`;

  renderColumns(
    el.windowsChart,
    stats.byWindow.map((w) => ({
      label: formatTime(w.start),
      value: w.orders,
      tooltipLabel: formatWindow(w.start, w.end),
    })),
    {
      format: (v) => `${v} ${v === 1 ? 'order' : 'orders'}`,
      tickFormat: (v) => String(v),
      columnHeading: 'Pickup window',
      unit: 'Orders',
      emptyText: 'No orders yet today.',
    },
  );

  renderColumns(
    el.salesChart,
    stats.last7Days.map((d) => ({
      label: shortDayFormat.format(new Date(d.date)),
      value: d.collectedCents,
      tooltipLabel: `${shortDayFormat.format(new Date(d.date))} · ${d.orders} orders`,
    })),
    {
      format: formatMoney,
      tickFormat: formatMoneyShort,
      columnHeading: 'Day',
      unit: 'Collected',
      emptyText: 'No sales in the last 7 days.',
    },
  );

  renderStatusBar(el.statusChart, c);
  renderOnTime(el.onTimeChart, stats.readyOnTime);
  renderTopItems(el.topItemsChart, stats.topItems);
}

/* ── Preparation board ──────────────────────────────────── */

function allOrders() {
  return state.orders ? state.orders.windows.flatMap((w) => w.orders) : [];
}

function readinessText(order) {
  if (!order.readyAt) return '';
  const time = formatTime(order.readyAt);
  if (order.readyOnTime) return `Ready ${time} · on time`;
  const late = Math.max(1, minutesBetween(order.pickupWindowEnd, order.readyAt));
  return `Ready ${time} · ${late} min late`;
}

function orderActions(order) {
  const busy = state.busyOrders.has(order.id);
  const wrap = make('div', 'db-order__actions');
  const action = {
    CONFIRMED: ['Start preparing', 'PREPARING'],
    PREPARING: ['Mark ready', 'READY'],
  }[order.status];

  if (action) {
    const button = make('button', 'ml-btn ml-btn--primary db-btn--small', action[0]);
    button.type = 'button';
    button.dataset.action = 'advance';
    button.dataset.next = action[1];
    button.setAttribute('aria-label', `${action[0]}: order ${order.orderNumber}`);
    button.setAttribute('aria-disabled', busy ? 'true' : 'false');
    wrap.append(button);
  } else if (order.status === 'READY') {
    const button = make('button', 'ml-btn ml-btn--primary db-btn--small', 'Hand over');
    button.type = 'button';
    button.dataset.action = 'open';
    button.setAttribute('aria-label', `Hand over order ${order.orderNumber}`);
    wrap.append(button);
  } else {
    const button = make('button', 'ml-btn db-btn--small', 'Details');
    button.type = 'button';
    button.dataset.action = 'open';
    button.setAttribute('aria-label', `Details of order ${order.orderNumber}`);
    const done =
      order.status === 'CANCELLED'
        ? `Cancelled ${formatTime(order.cancelledAt)}`
        : `Collected ${formatTime(order.collectedAt)}`;
    wrap.append(button, make('span', 'db-order__done', done));
  }
  return wrap;
}

function orderCard(order) {
  const card = make('li', `db-order db-order--${order.status.toLowerCase()}`);
  card.dataset.orderId = String(order.id);
  card.dataset.orderNumber = String(order.orderNumber);

  const top = make('div', 'db-order__top');
  top.append(make('h4', 'db-order__number', `#${order.orderNumber}`), statusPill(order.status));
  card.append(top);

  if (order.customerName) card.append(make('p', 'db-order__name', order.customerName));

  const items = make('ul', 'db-order__items');
  order.items.forEach((item) => {
    const li = make('li', '');
    li.append(
      make('span', 'db-order__qty', `${item.quantity} ×`),
      document.createTextNode(` ${item.name}`),
    );
    items.append(li);
  });
  card.append(items);

  const foot = make('div', 'db-order__foot');
  foot.append(make('span', 'db-order__total', formatMoney(order.totalCents)));
  if (isPaidOnline(order)) foot.append(make('span', 'db-order__paid', 'Paid online'));
  const readiness = readinessText(order);
  if (readiness) {
    const note = make('span', `db-order__ready${order.readyOnTime ? '' : ' is-late'}`, readiness);
    foot.append(note);
  }
  card.append(foot, orderActions(order));
  return card;
}

function windowTag(win, now) {
  const start = new Date(win.start).getTime();
  const end = new Date(win.end).getTime();
  if (now >= start && now < end) return ['Now', 'is-now'];
  if (now >= end) {
    const notReady = win.orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PREPARING');
    return notReady.length > 0
      ? [`Ended · ${notReady.length} not ready`, 'is-late']
      : ['Ended', ''];
  }
  return [`In ${minutesBetween(now, start)} min`, ''];
}

function renderBoard() {
  const orders = allOrders();
  const counts = {};
  Object.entries(FILTERS).forEach(([key, statuses]) => {
    counts[key] = orders.filter((o) => statuses.includes(o.status)).length;
  });
  el.filterButtons.forEach((button) => {
    const key = button.dataset.filter;
    button.setAttribute('aria-pressed', key === state.filter ? 'true' : 'false');
    button.querySelector('[data-count]').textContent = String(counts[key]);
  });

  const shown = FILTERS[state.filter];
  const now = Date.now();
  const sections = [];
  (state.orders ? state.orders.windows : []).forEach((win) => {
    const visible = win.orders.filter((o) => shown.includes(o.status));
    if (visible.length === 0) return;

    const section = make('section', 'db-window');
    section.setAttribute('aria-label', `Pickup ${formatWindow(win.start, win.end)}`);
    const head = make('div', 'db-window__head');
    head.append(make('h3', 'db-window__time', formatWindow(win.start, win.end)));
    const [tagText, tagClass] = windowTag(win, now);
    head.append(make('span', `db-window__tag ${tagClass}`.trim(), tagText));
    head.append(
      make(
        'span',
        'db-window__count',
        `${visible.length} ${visible.length === 1 ? 'order' : 'orders'}`,
      ),
    );
    const list = make('ul', 'db-window__orders');
    visible.forEach((order) => list.append(orderCard(order)));
    section.append(head, list);
    sections.push(section);
  });

  el.windowList.replaceChildren(...sections);
  el.boardEmpty.hidden = sections.length > 0;
  el.boardEmpty.textContent =
    orders.length === 0 ? 'No orders today yet.' : 'No orders here right now.';
}

function orderById(id) {
  return allOrders().find((o) => o.id === id);
}

async function advance(order, next) {
  if (state.busyOrders.has(order.id)) return;
  state.busyOrders.add(order.id);
  renderBoard();
  try {
    const updated = await api.advance(state.vendorId, order.id, next);
    showToast(`#${updated.orderNumber} is ${STATUS_LABEL[updated.status].toLowerCase()}`);
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    state.busyOrders.delete(order.id);
    await refresh();
  }
}

function onBoardClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || button.getAttribute('aria-disabled') === 'true') return;
  const card = button.closest('.db-order');
  const order = orderById(Number(card.dataset.orderId));
  if (!order) return;
  if (button.dataset.action === 'advance') advance(order, button.dataset.next);
  if (button.dataset.action === 'open') openHandover(order);
}

function onFilterClick(event) {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  renderBoard();
}

/* ── Find by number ─────────────────────────────────────── */

async function onFind(event) {
  event.preventDefault();
  const number = el.findInput.value.trim().replace(/^#/, '');
  el.findError.textContent = '';
  if (!/^\d{1,6}$/.test(number)) {
    el.findError.textContent = 'Enter the order number, e.g. 1042.';
    el.findInput.focus();
    return;
  }
  try {
    const order = await api.byNumber(state.vendorId, number);
    el.findInput.value = '';
    openHandover(order);
  } catch (error) {
    el.findError.textContent = error.message;
  }
}

/* ── Handover dialog ────────────────────────────────────── */

function renderHandover() {
  const order = state.handover;
  el.handoverHeading.textContent = `Order #${order.orderNumber}`;
  statusPill(order.status, el.handoverStatus);
  const who = order.customerName ? ` · ${order.customerName}` : '';
  const ref = order.collectionReference ? ` · Ref ${order.collectionReference}` : '';
  el.handoverMeta.textContent = `Pickup ${formatWindow(order.pickupWindowStart, order.pickupWindowEnd)}${who}${ref}`;

  el.handoverItems.replaceChildren(
    ...order.items.map((item) => {
      const li = make('li', '');
      li.append(
        make('span', 'db-handover__qty', `${item.quantity} ×`),
        make('span', 'db-handover__name', item.name),
        make('span', 'db-handover__line', formatMoney(item.lineTotalCents)),
      );
      return li;
    }),
  );
  el.handoverAmount.textContent = formatMoney(order.totalCents);
  const paidOnline = isPaidOnline(order);
  el.handoverAmountLabel.textContent = paidOnline ? 'Paid online' : 'Amount to collect';

  const ready = order.status === 'READY';
  el.collectForm.hidden = !ready;
  el.handoverCloseRow.hidden = ready;
  el.handoverState.hidden = ready;
  if (ready) {
    // Paid online: nothing to take at the counter, so the payment check is already done
    el.collectPaidLabel.textContent = paidOnline
      ? `Paid online (${formatMoney(order.totalCents)}), nothing to take`
      : `I've taken payment of ${formatMoney(order.totalCents)}`;
    el.collectPaid.checked = paidOnline;
  } else if (order.status === 'CANCELLED') {
    el.handoverState.textContent = `Cancelled at ${formatTime(order.cancelledAt)}. Don't hand this order over.`;
  } else if (order.status === 'COLLECTED') {
    el.handoverState.textContent = `Collected at ${formatTime(order.collectedAt)}. This order is closed.`;
  } else {
    el.handoverState.textContent = `Not ready yet: this order is ${STATUS_LABEL[order.status].toLowerCase()}. Mark it ready before handing it over.`;
  }
}

function openHandover(order) {
  state.handover = order;
  el.collectForm.reset();
  el.collectError.textContent = '';
  renderHandover();
  el.handoverDialog.showModal();
  if (order.status === 'READY') el.collectNumber.focus();
}

async function onCollect(event) {
  event.preventDefault();
  const order = state.handover;
  const typed = el.collectNumber.value.trim().replace(/^#/, '');
  el.collectError.textContent = '';

  if (!/^\d{1,6}$/.test(typed)) {
    el.collectError.textContent = "Type the order number shown on the student's screen.";
    el.collectNumber.focus();
    return;
  }
  if (!el.collectPaid.checked) {
    el.collectError.textContent = 'Take payment first, then tick the payment box.';
    return;
  }
  if (!el.collectHanded.checked) {
    el.collectError.textContent = 'Hand over the food, then tick the food box.';
    return;
  }

  el.collectButton.disabled = true;
  try {
    const updated = await api.collect(state.vendorId, order.id, {
      orderNumber: Number(typed),
      paymentReceived: true,
      foodHandedOver: true,
    });
    el.handoverDialog.close('collected');
    showToast(`#${updated.orderNumber} collected`);
    await refresh();
  } catch (error) {
    el.collectError.textContent = error.message;
    if (error.status === 409 && !/doesn't match/.test(error.message)) {
      // Collected elsewhere or no longer ready: show the order as it is now
      await refresh();
      const fresh = orderById(order.id);
      if (fresh) {
        state.handover = fresh;
        renderHandover();
        el.collectError.textContent = error.message;
      }
    }
  } finally {
    el.collectButton.disabled = false;
  }
}

/* ── Loading ────────────────────────────────────────────── */

function renderHeader(vendor) {
  el.headerName.textContent = vendor.stallName;
  document.title = `Dashboard · ${vendor.stallName} · Makan Liao? for vendors`;
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

async function refresh() {
  el.panel.classList.add('is-refreshing');
  try {
    const [orders, stats] = await Promise.all([
      api.orders(state.vendorId),
      api.stats(state.vendorId),
    ]);
    state.orders = orders;
    state.stats = stats;
    el.todayLabel.textContent = dayFormat.format(new Date(`${orders.date}T12:00:00+08:00`));
    el.updatedLabel.textContent = `Updated ${formatTime(new Date())}`;
    renderStats(stats);
    renderBoard();
  } catch (error) {
    el.updatedLabel.textContent = "Couldn't refresh. Retrying…";
    if (!state.orders)
      showToast(`We couldn't load your dashboard: ${error.message}`, { error: true });
  } finally {
    el.panel.classList.remove('is-refreshing');
  }
}

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  Object.assign(el, {
    headerLogo: byId('vendorLogo'),
    headerFallback: byId('vendorLogoFallback'),
    headerLogoWrap: byId('vendorLogoWrap'),
    headerName: byId('vendorStallName'),
    backLink: byId('backLink'),
    panel: byId('dashboardPanel'),
    signedOut: byId('signedOutPanel'),
    todayLabel: byId('todayLabel'),
    updatedLabel: byId('updatedLabel'),
    tileOrders: byId('tileOrders'),
    tileOrdersNote: byId('tileOrdersNote'),
    tilePrepare: byId('tilePrepare'),
    tilePrepareNote: byId('tilePrepareNote'),
    tileReady: byId('tileReady'),
    tileReadyNote: byId('tileReadyNote'),
    tileCollected: byId('tileCollected'),
    tileCollectedNote: byId('tileCollectedNote'),
    windowsChart: byId('windowsChart'),
    salesChart: byId('salesChart'),
    statusChart: byId('statusChart'),
    onTimeChart: byId('onTimeChart'),
    topItemsChart: byId('topItemsChart'),
    findForm: byId('findForm'),
    findInput: byId('findInput'),
    findError: byId('findError'),
    filterGroup: document.querySelector('.db-filters'),
    filterButtons: [...document.querySelectorAll('.db-filter')],
    windowList: byId('windowList'),
    boardEmpty: byId('boardEmpty'),
    handoverDialog: byId('handoverDialog'),
    handoverHeading: byId('handoverHeading'),
    handoverStatus: byId('handoverStatus'),
    handoverMeta: byId('handoverMeta'),
    handoverItems: byId('handoverItems'),
    handoverAmount: byId('handoverAmount'),
    handoverAmountLabel: byId('handoverAmountLabel'),
    handoverState: byId('handoverState'),
    handoverCloseRow: byId('handoverCloseRow'),
    collectForm: byId('collectForm'),
    collectNumber: byId('collectNumber'),
    collectPaid: byId('collectPaid'),
    collectPaidLabel: byId('collectPaidLabel'),
    collectHanded: byId('collectHanded'),
    collectError: byId('collectError'),
    collectButton: byId('collectButton'),
    tooltip: byId('chartTooltip'),
    toast: byId('toast'),
  });
}

function bindEvents() {
  el.windowList.addEventListener('click', onBoardClick);
  el.filterGroup.addEventListener('click', onFilterClick);
  el.findForm.addEventListener('submit', onFind);
  el.collectForm.addEventListener('submit', onCollect);
  el.handoverDialog
    .querySelectorAll('[data-close]')
    .forEach((button) => button.addEventListener('click', () => el.handoverDialog.close('cancel')));
  [el.collectNumber, el.collectPaid, el.collectHanded].forEach((input) =>
    input.addEventListener('input', () => {
      el.collectError.textContent = '';
    }),
  );
  window.addEventListener('scroll', hideTooltip, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
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
    renderHeader(await api.vendor(state.vendorId));
  } catch (error) {
    if (error.status === 404 || error.status === 400) {
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
      return;
    }
  }

  await refresh();
  // New orders arrive while the vendor works; keep the board current
  state.refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !el.handoverDialog.open) refresh();
  }, REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', init);
