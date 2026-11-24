const apiUrl = '.';

function formatMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return '$' + num.toFixed(2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function renderReceipt(order, collectionReference, qrCode, payment) {
  const loading = document.getElementById('loading');
  const content = document.getElementById('receipt-content');
  const collectionEl = document.getElementById('collection-reference');
  const qrImage = document.getElementById('qr-code');
  const fallbackEl = document.getElementById('collection-reference-fallback');
  const itemsBody = document.getElementById('receipt-items');
  const totalEl = document.getElementById('receipt-total');
  const statusEl = document.getElementById('payment-status');
  const txnEl = document.getElementById('txn-ref');

  if (loading) loading.classList.add('hidden');
  content.classList.remove('hidden');

  collectionEl.textContent = collectionReference || '-';
  fallbackEl.textContent = 'Collection Reference: ' + (collectionReference || '-');

  if (qrCode) {
    qrImage.src = qrCode;
    qrImage.alt = 'QR code for ' + collectionReference;
  } else {
    qrImage.removeAttribute('src');
    qrImage.alt = 'No QR code available';
  }

  itemsBody.innerHTML = '';
  const items = (order && Array.isArray(order.items)) ? order.items : [];
  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(item.item_name) + '</td>' +
      '<td>' + item.quantity + '</td>' +
      '<td>' + formatMoney(item.subtotal) + '</td>';
    itemsBody.appendChild(tr);
  });

  const total = payment ? payment.amount : (order ? order.total_amount : null);
  totalEl.textContent = formatMoney(total);

  if (payment) {
    statusEl.textContent = payment.payment_status || '-';
    txnEl.textContent = payment.transaction_reference || '-';
  } else {
    statusEl.textContent = '-';
    txnEl.textContent = '-';
  }
}

async function autoLoad() {
  const params = new URLSearchParams(window.location.search);
  const orderId = Number(params.get('orderId'));
  const customerId = Number(params.get('customerId'));

  if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(customerId) || customerId <= 0) {
    // Fall back to manual mode
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    document.getElementById('receipt-content').classList.add('hidden');
    return;
  }

  try {
    const orderRes = await fetch(`${apiUrl}/orders/${orderId}?customerId=${customerId}`);
    if (!orderRes.ok) throw new Error('Order not found');
    const order = await orderRes.json();

    let collectionReference = order.collection_reference || null;
    let qrCode = null;
    try {
      const pickupRes = await fetch(`${apiUrl}/pickup/${orderId}/qr?customerId=${customerId}`);
      if (pickupRes.ok) {
        const pickupData = await pickupRes.json();
        collectionReference = pickupData.pickup.collectionReference || collectionReference;
        qrCode = pickupData.pickup.qrCode || null;
      }
    } catch {
      // ignore, receipt still shows reference if available
    }

    let payment = null;
    try {
      const paymentRes = await fetch(`${apiUrl}/payments/${orderId}`);
      if (paymentRes.ok) payment = await paymentRes.json();
    } catch {
      // ignore
    }

    renderReceipt(order, collectionReference, qrCode, payment);
  } catch (error) {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    const errEl = document.getElementById('error');
    const msgEl = document.getElementById('error-message');
    msgEl.textContent = error.message || 'Failed to load receipt.';
    errEl.classList.remove('hidden');
  }
}

// Manual render (original behaviour)
document.getElementById('render-receipt').addEventListener('click', () => {
  const textarea = document.getElementById('order-response');
  try {
    const order = JSON.parse(textarea.value);
    const collectionReference = order.collection_reference || order.collectionReference || '-';
    renderReceipt(order, collectionReference, order.qrCode || null, null);
  } catch {
    alert('Invalid order response JSON');
  }
});

// Kick off auto-load if query params are present
autoLoad();