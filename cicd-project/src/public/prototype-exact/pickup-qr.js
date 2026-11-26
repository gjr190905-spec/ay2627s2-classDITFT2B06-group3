(function () {
  'use strict';
  const status = document.getElementById('pickup-message');
  const list = document.getElementById('ready-orders');
  let csrf = null;
  async function api(url, opts = {}) {
    const headers = { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.method === 'POST' ? { 'X-CSRF-Token': csrf || '' } : {}) };
    const response = await fetch(url, { method: opts.method || 'GET', credentials: 'same-origin', headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    return data;
  }
  function setStatus(msg) { status.textContent = msg; }
  async function showQr(order, box, button) {
    button.disabled = true;
    try {
      const result = await api('/api/pickup/issue', { method: 'POST', body: { orderId: order.id } });
      const src = result.pickup?.qrCode;
      if (typeof src !== 'string' || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(src)) throw Error('Server returned an invalid QR image.');
      box.replaceChildren();
      const img = document.createElement('img'); img.src = src; img.className = 'qr-photo';
      img.alt = `Pickup QR code for ${order.orderNumber}`; img.width = 230; img.height = 230;
      const caption = document.createElement('p'); caption.className = 'hint';
      caption.textContent = 'Show this image to the vendor. Generating another code replaces this one.';
      const pdfButton=document.createElement('button');
      pdfButton.type='button';
      pdfButton.className='btn btn-secondary print-pickup-receipt';
      pdfButton.textContent='Print / Save pickup PDF';
      pdfButton.addEventListener('click',()=>{
        document.querySelectorAll('.order-row.print-selected').forEach(el=>el.classList.remove('print-selected'));
        const selected=box.closest('.order-row');
        if(!selected)return;
        selected.classList.add('print-selected');
        const clear=()=>selected.classList.remove('print-selected');
        window.addEventListener('afterprint',clear,{once:true});
        window.print();
      });
      box.append(img, caption, pdfButton); setStatus('QR generated for ' + order.orderNumber + '.');
    } catch (error) { setStatus(error.message); }
    finally { button.disabled = false; }
  }
  async function boot() {
    try {
      const auth = await api('/api/auth/me');
      if (auth.user?.role !== 'customer' || !auth.csrfToken) {
        setStatus('Please sign in with a student/customer account to view pickup QR codes.'); return;
      }
      csrf = auth.csrfToken;
      const { orders } = await api('/api/pickup/ready-orders');
      if (!Array.isArray(orders) || !orders.length) { setStatus('No READY orders yet. Check back after the vendor marks your food ready.'); return; }
      setStatus(`${orders.length} ready ${orders.length === 1 ? 'order' : 'orders'} found.`);
      for (const order of orders) {
        const row = document.createElement('article'); row.className = 'order-row';
        const details = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = order.orderNumber;
        const tag = document.createElement('span'); tag.className = 'tag-ready'; tag.textContent = 'READY';
        details.append(title, document.createTextNode('  '), tag);
        const button = document.createElement('button'); button.className = 'btn btn-secondary'; button.textContent = 'Show pickup QR';
        const qr = document.createElement('div'); qr.style.width = '100%';
        button.addEventListener('click', () => showQr(order, qr, button));
        row.append(details, button, qr);list.append(row);
      }
    } catch (error) { setStatus(error.message); }
  }
  boot();
})();
