const TOKEN_KEY = 'token';
const LOGIN_PAGE = 'index.html';
const ORDERS_PAGE = 'orders.html';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id') || params.get('orderId');

const loading = document.getElementById('payment-loading');
const errorBox = document.getElementById('payment-error');
const content = document.getElementById('payment-content');
const detailTitle = document.getElementById('detail-title');
const detailStall = document.getElementById('detail-stall');
const detailStatus = document.getElementById('detail-status');
const detailItems = document.getElementById('detail-items');
const detailTotal = document.getElementById('detail-total');
const payNote = document.getElementById('pay-note');
const payButton = document.getElementById('pay-button');
const paymentMessage = document.getElementById('payment-message');
const resultSection = document.getElementById('payment-result');
const resultMessage = document.getElementById('result-message');
const resultDetail = document.getElementById('result-detail');
const receiptLink = document.getElementById('receipt-link');

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

function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((response) => {
    if (response.status === 401) {
      window.location.href = LOGIN_PAGE;
      throw new Error('Not signed in');
    }
    if (!response.ok) {
      return response.json().then((data) => {
        throw new Error(data.error || 'Request failed');
      });
    }
    return response.json();
  });
}

function showError(message) {
  loading.hidden = true;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function loadOrder() {
  if (!orderId) {
    showError('No order selected.');
    return;
  }
  try {
    const order = await apiGet(`/customer-orders/${orderId}`);
    detailTitle.textContent = order.orderNumber
      ? `Order ${order.orderNumber}`
      : `Order ${order.id}`;
    detailStall.textContent = order.foodCourtName
      ? `${order.stallName}, ${order.foodCourtName}`
      : order.stallName;
    detailStatus.textContent = order.status;

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
    payNote.textContent = 'Select a payment method below and pay now.';

    loading.hidden = true;
    content.hidden = false;
  } catch (error) {
    if (error.redirecting) return;
    showError('We could not load this order.');
  }
}

payButton.addEventListener('click', async () => {
  const method = document.querySelector('input[name="paymentMethod"]:checked').value;
  paymentMessage.hidden = true;
  payButton.disabled = true;
  payButton.textContent = 'Processing...';

  try {
    const result = await apiPost(`/payments/${orderId}/simulate`, {
      paymentMethod: method.toUpperCase(),
      paymentStatus: 'PAID',
    });

    resultMessage.textContent = 'Payment successful.';
    resultDetail.textContent = `Transaction: ${result.payment.transaction_reference}`;
    receiptLink.href = `${ORDERS_PAGE}?id=${encodeURIComponent(orderId)}`;
    receiptLink.hidden = false;
    resultSection.hidden = false;
    payButton.hidden = true;
  } catch (error) {
    if (error.redirecting) return;
    resultMessage.textContent = 'Payment failed.';
    resultDetail.textContent = error.message || 'Please try again.';
    resultSection.hidden = false;
    payButton.disabled = false;
    payButton.textContent = 'Pay Now';
  }
});

document.getElementById('sign-out').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

loadOrder();