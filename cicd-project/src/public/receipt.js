document.addEventListener('DOMContentLoaded', () => {
  const renderButton = document.getElementById('render-receipt');

  renderButton.addEventListener('click', () => {
    const textarea = document.getElementById('order-response');
    const collectionReferenceElement = document.getElementById('collection-reference');
    const qrImage = document.getElementById('qr-code');
    const fallbackElement = document.getElementById('collection-reference-fallback');

    try {
      const order = JSON.parse(textarea.value);
      const collectionReference =
        order.collection_reference || order.collectionReference || '-';

      collectionReferenceElement.textContent = collectionReference;
      fallbackElement.textContent = 'Collection Reference: ' + collectionReference;

      if (order.qrCode) {
        qrImage.src = order.qrCode;
        qrImage.alt = 'QR code for ' + collectionReference;
      } else {
        qrImage.removeAttribute('src');
        qrImage.alt = 'No QR code available';
      }
    } catch (error) {
      alert('Invalid order response JSON');
    }
  });
});