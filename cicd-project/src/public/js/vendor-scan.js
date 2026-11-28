/* global jsQR */
const API_BASE = '/api/pickup';

const camera = document.getElementById('camera');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('start-camera');
const stopButton = document.getElementById('stop-camera');
const retryButton = document.getElementById('retry-scan');
const statusEl = document.getElementById('scan-status');
const errorEl = document.getElementById('scan-error');
const uploadInput = document.getElementById('image-upload');
const usbForm = document.getElementById('usb-form');
const usbCode = document.getElementById('usb-code');
const orderPanel = document.getElementById('order-panel');
const orderNumber = document.getElementById('order-number');
const orderStatus = document.getElementById('order-status');
const orderMessage = document.getElementById('order-message');
const handoverBox = document.getElementById('handover');
const paymentBox = document.getElementById('payment');
const confirmButton = document.getElementById('confirm-collection');
const successMessage = document.getElementById('success-message');

let stream = null;
let scanning = false;
let rafId = null;
let csrfToken = null;
let scannedCode = null;
let approved = false;

function setStatus(text) { statusEl.textContent = text; }
function showError(text) { errorEl.textContent = text; errorEl.hidden = false; }
function clearError() { errorEl.hidden = true; errorEl.textContent = ''; }

async function api(path, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
  return data;
}

async function boot() {
  try {
    const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
    if (!me.user || me.user.role !== 'vendor') {
      showError('Please sign in with a vendor account.');
      startButton.disabled = true;
      uploadInput.disabled = true;
      usbCode.disabled = true;
      return;
    }
    csrfToken = me.csrfToken;
    setStatus('Ready to scan.');
  } catch {
    showError('Could not verify your session. Please sign in again.');
  }
}

function stopCamera() {
  scanning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  camera.hidden = true;
  camera.srcObject = null;
  startButton.hidden = false;
  stopButton.hidden = true;
}

async function startCamera() {
  clearError();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Camera is not supported in this browser.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    camera.srcObject = stream;
    camera.hidden = false;
    scanning = true;
    startButton.hidden = true;
    stopButton.hidden = false;
    retryButton.hidden = true;
    setStatus('Scanning...');
    scanFrame();
  } catch (err) {
    if (err && err.name === 'NotAllowedError') showError('Camera permission denied.');
    else if (err && err.name === 'NotFoundError') showError('No camera found.');
    else showError('Could not start camera.');
  }
}

function scanFrame() {
  if (!scanning) return;
  if (camera.readyState === camera.HAVE_ENOUGH_DATA) {
    canvas.width = camera.videoWidth;
    canvas.height = camera.videoHeight;
    ctx.drawImage(camera, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code && code.data) {
      stopCamera();
      reviewCode(code.data);
      return;
    }
  }
  rafId = requestAnimationFrame(scanFrame);
}

async function reviewCode(code) {
  clearError();
  scannedCode = code;
  approved = false;
  orderPanel.hidden = true;
  successMessage.hidden = true;
  confirmButton.disabled = true;
  handoverBox.checked = false;
  paymentBox.checked = false;
  setStatus('Verifying code...');

  try {
    const result = await api(`${API_BASE}/review`, 'POST', { code });
    orderNumber.textContent = result.orderNumber || '-';
    orderStatus.textContent = result.orderStatus || '-';
    orderMessage.textContent = result.message || 'Verified.';
    orderPanel.hidden = false;
    setStatus('Order verified. Confirm collection below.');
  } catch (err) {
    showError(err.message || 'Verification failed.');
    setStatus('Scan failed.');
    retryButton.hidden = false;
  }
}

async function confirmCollection() {
  if (approved || !scannedCode) return;
  confirmButton.disabled = true;
  confirmButton.textContent = 'Confirming...';
  try {
    const result = await api(`${API_BASE}/approve`, 'POST', {
      code: scannedCode,
      handoverConfirmed: true,
      paymentConfirmed: true,
    });
    successMessage.textContent = result.message || 'Collection confirmed.';
    successMessage.hidden = false;
    orderStatus.textContent = result.orderStatus || 'COLLECTED';
    approved = true;
    confirmButton.hidden = true;
    retryButton.hidden = false;
    setStatus('Collection complete.');
  } catch (err) {
    showError(err.message || 'Collection failed.');
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirm collection';
  }
}

function decodeImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        reviewCode(code.data);
      } else {
        showError('No QR code found in the image.');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
retryButton.addEventListener('click', () => {
  clearError();
  scannedCode = null;
  approved = false;
  orderPanel.hidden = true;
  successMessage.hidden = true;
  retryButton.hidden = true;
  confirmButton.hidden = false;
  confirmButton.textContent = 'Confirm collection';
  setStatus('Ready to scan.');
});

uploadInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) decodeImage(file);
});

usbForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = usbCode.value.trim();
  if (!code) return;
  reviewCode(code);
  usbCode.value = '';
});

handoverBox.addEventListener('change', updateConfirmButton);
paymentBox.addEventListener('change', updateConfirmButton);

function updateConfirmButton() {
  confirmButton.disabled = !(handoverBox.checked && paymentBox.checked) || approved;
}

confirmButton.addEventListener('click', confirmCollection);

window.addEventListener('beforeunload', stopCamera);

boot();