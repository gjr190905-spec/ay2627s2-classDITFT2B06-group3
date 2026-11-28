const TOKEN_KEY = 'token';
const LOGIN_PAGE = 'index.html';
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

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id') || params.get('orderId');

const loading = document.getElementById('receipt-loading');
const errorBox = document.getElementById('receipt-error');
const content = document.getElementById('receipt-content');
const detailTitle = document.getElementById('detail-title');
const detailStall = document.getElementById('detail-stall');
const detailStatus = document.getElementById('detail-status');
const detailPickup = document.getElementById('detail-pickup');
const detailPlaced = document.getElementById('detail-placed');
const paymentStatus = document.getElementById('payment-status');
const paymentMethod = document.getElementById('payment-method');
const transactionRef = document.getElementById('transaction-ref');
const paidAt = document.getElementById('paid-at');
const collectionRef = document.getElementById('collection-ref');
const detailItems = document.getElementById('detail-items');
const detailTotal = document.getElementById('detail-total');
const qrSection = document.getElementById('qr-section');
const qrImage = document.getElementById('qr-image');
const qrNote = document.getElementById('qr-note');
const qrUnavailable = document.getElementById('qr-unavailable');

function apiGet(path) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { headers }).then((response) => {
    if (response.status === 401) {
      window.location.href = LOGIN_PAGE;
      throw new Error('Not signed in');
    }
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
    return response.json();
  });
}

function apiPost(path, body, csrfToken) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return fetch(path, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) }).then((response) => {
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  });
}

function formatPickupRange(start, end) {
  if (!start || !end) return 'TBC';
  return `${dayFormat.format(new Date(start))}, ${timeFormat.format(new Date(start))} - ${timeFormat.format(new Date(end))}`;
}

function showError(message) {
  loading.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function loadReceipt() {
  if (!orderId) {
    showError('No order selected.');
    return;
  }
  try {
    const order = await apiGet(`/customer-orders/${orderId}`);

    detailTitle.textContent = order.orderNumber ? `Order ${order.orderNumber}` : `Order ${order.id}`;
    detailStall.textContent = order.foodCourtName ? `${order.stallName}, ${order.foodCourtName}` : order.stallName;
    detailStatus.textContent = order.status;
    detailPickup.textContent = formatPickupRange(order.pickupStart, order.pickupEnd);
    detailPlaced.textContent = order.createdAt ? new Date(order.createdAt).toLocaleString() : '-';
    collectionRef.textContent = order.collectionReference || '-';

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

    // Payment info
    try {
      const payment = await apiGet(`/payments/${orderId}`);
      paymentStatus.textContent = payment.payment_status || '-';
      paymentMethod.textContent = payment.payment_method || '-';
      transactionRef.textContent = payment.transaction_reference || '-';
      paidAt.textContent = payment.paid_at ? new Date(payment.paid_at).toLocaleString() : '-';
    } catch {
      paymentStatus.textContent = '-';
      paymentMethod.textContent = '-';
      transactionRef.textContent = '-';
      paidAt.textContent = '-';
    }

    loading.hidden = true;
    content.hidden = false;

    const cacheKey = `pickupQr_${orderId}`;
    const cachedQr = sessionStorage.getItem(cacheKey);

    // QR: reuse existing pickup QR workflow only when order is ready
    if (order.status === 'READY') {
      if (cachedQr) {
        qrImage.src = cachedQr;
        qrImage.alt = `Pickup QR for ${order.orderNumber}`;
        qrNote.textContent = 'Show this QR to the vendor when collecting. Keep it available.';
        qrSection.hidden = false;
        qrUnavailable.hidden = true;
      } else {
        try {
          const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
          const csrf = me.csrfToken;
          if (csrf) {
            const result = await apiPost('/api/pickup/issue', { orderId: Number(orderId) }, csrf);
            if (result.pickup && result.pickup.alreadyIssued) {
              qrSection.hidden = true;
              qrUnavailable.hidden = false;
              qrUnavailable.textContent = 'Pickup QR already issued. Use your saved copy.';
            } else if (result.pickup && result.pickup.qrCode) {
              sessionStorage.setItem(cacheKey, result.pickup.qrCode);
              qrImage.src = result.pickup.qrCode;
              qrImage.alt = `Pickup QR for ${order.orderNumber}`;
              qrNote.textContent = 'Show this QR to the vendor when collecting. Keep it available.';
              qrSection.hidden = false;
              qrUnavailable.hidden = true;
            } else {
              qrSection.hidden = true;
              qrUnavailable.hidden = false;
            }
          } else {
            qrSection.hidden = true;
            qrUnavailable.hidden = false;
          }
        } catch {
          qrSection.hidden = true;
          qrUnavailable.hidden = false;
        }
      }
    } else {
      qrSection.hidden = true;
      qrUnavailable.hidden = false;
      qrUnavailable.textContent = 'Your pickup QR will be available here once your order is ready.';
    }
  } catch (error) {
    if (error.redirecting) return;
    showError('We could not load this receipt.');
  }
}

document.getElementById('sign-out').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

loadReceipt();