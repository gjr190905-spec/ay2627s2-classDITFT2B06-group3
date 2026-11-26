'use strict';
// Bundled MIT-licensed QR generator is already part of the user's supplied reference project.
const QRCode = require('../vendor/qrcode');
function qrSvg(value) {
  if (typeof value !== 'string' || !/^MLP-[a-f0-9]{64}$/.test(value)) throw new Error('Invalid pickup token.');
  const qr = new QRCode(0, 1);
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) cells.push(`<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`);
  const size = n + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><g fill="#231715">${cells.join('')}</g></svg>`;
}
module.exports = { qrSvg };
