const QRCode = require('qrcode');

// Generate a QR code for a unique collection reference.
// Returns the QR code as a Base64 data URL.
module.exports.generateQrCode = async function generateQrCode(collectionReference) {
  // Basic input validation
  if (!collectionReference || typeof collectionReference !== 'string') {
    const error = new Error('A valid collection reference is required');
    error.statusCode = 400;
    throw error;
  }

  try {
    const qrCodeDataUrl = await QRCode.toDataURL(collectionReference);
    return qrCodeDataUrl;
  } catch {
    const qrError = new Error('Failed to generate QR code');
    qrError.statusCode = 500;
    throw qrError;
  }
};