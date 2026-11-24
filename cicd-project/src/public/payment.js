const apiUrl = '.';

const params = new URLSearchParams(window.location.search);
const orderId = Number(params.get('orderId'));
const customerIdParam = params.get('customerId');
let customerId = customerIdParam ? Number(customerIdParam) : null;
if (!customerId) {
  const stored = sessionStorage.getItem('customerId');
  if (stored) customerId = Number(stored);
}

let paymentData = null;
let selectedMethod = 'CARD';

const loadingState = document.getElementById('loading');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const paymentState = document.getElementById('payment-state');
const processingState = document.getElementById('processing-state');
const resultState = document.getElementById('result-state');
const resultMessage = document.getElementById('result-message');
const resultDetail = document.getElementById('result-detail');
const receiptButton = document.getElementById('receipt-button');
const retryButton = document.getElementById('retry-button');

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function formatMoney(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return '$' + num.toFixed(2);
}

document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    selectedMethod = radio.value;
  });
});

document.getElementById('reload-button').addEventListener('click', loadOrder);
document.getElementById('pay-button').addEventListener('click', submitPayment);
document.getElementById('retry-button').addEventListener('click', () => {
  hide(resultState);
  show(paymentState);
});
document.getElementById('receipt-button').addEventListener('click', () => {
  const qs = new URLSearchParams();
  if (orderId) qs.set('orderId', orderId);
  if (customerId) qs.set('customerId', customerId);
  window.location.href = './receipt.html?' + qs.toString();
});

async function loadOrder() {
  hide(errorState);
  hide(paymentState);
  hide(processingState);
  hide(resultState);
  show(loadingState);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    hide(loadingState);
    errorMessage.textContent = 'Invalid or missing order ID.';
    show(errorState);
    return;
  }

  try {
    const paymentRes = await fetch(`${apiUrl}/payments/${orderId}`);
    if (!paymentRes.ok) {
      const err = await paymentRes.json().catch(() => ({}));
      throw new Error(err.error || 'Payment not found');
    }
    paymentData = await paymentRes.json();

    if (customerId) sessionStorage.setItem('customerId', customerId);

    hide(loadingState);

    document.getElementById('order-id').textContent = orderId;
    document.getElementById('total-amount').textContent = formatMoney(paymentData.amount);

    if (paymentData.payment_status === 'PAID') {
      resultMessage.textContent = 'Payment already completed.';
      resultDetail.textContent = 'Transaction: ' + (paymentData.transaction_reference || '-');
      hide(retryButton);
      show(receiptButton);
      show(resultState);
    } else {
      show(paymentState);
    }
  } catch (error) {
    hide(loadingState);
    errorMessage.textContent = error.message || 'Failed to load order.';
    show(errorState);
  }
}

async function submitPayment() {
  const simulateFail = document.getElementById('simulate-fail').checked;
  const paymentStatus = simulateFail ? 'FAILED' : 'PAID';

  hide(resultState);
  hide(paymentState);
  show(processingState);

  try {
    const res = await fetch(`${apiUrl}/payments/${orderId}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: selectedMethod,
        paymentStatus: paymentStatus
      })
    });

    const data = await res.json().catch(() => ({}));

    hide(processingState);

    if (!res.ok) {
      if (res.status === 400 && /already been completed/i.test(data.error || '')) {
        resultMessage.textContent = 'Payment already completed.';
        resultDetail.textContent = 'Transaction: ' + ((data.payment && data.payment.transaction_reference) || '-');
        hide(retryButton);
        show(receiptButton);
        show(resultState);
        return;
      }
      throw new Error(data.error || 'Payment failed');
    }

    paymentData = data.payment || paymentData;

    if (paymentData.payment_status === 'PAID') {
      resultMessage.textContent = 'Payment successful.';
      resultDetail.textContent = 'Transaction: ' + (paymentData.transaction_reference || '-');
      hide(retryButton);
      show(receiptButton);
    } else {
      resultMessage.textContent = 'Payment failed.';
      resultDetail.textContent = 'Please try again.';
      hide(receiptButton);
      show(retryButton);
      show(paymentState);
    }
    show(resultState);
  } catch (error) {
    hide(processingState);
    resultMessage.textContent = 'Payment failed.';
    resultDetail.textContent = error.message || 'Please try again.';
    hide(receiptButton);
    show(retryButton);
    show(paymentState);
    show(resultState);
  }
}

loadOrder();