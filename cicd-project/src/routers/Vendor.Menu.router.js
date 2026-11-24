const express = require('express');
const {
  getVendorMenu,
  getVendorMenuItem,
  addMenuItem,
  editMenuItem,
  changeAvailability,
  removeMenuItem,
  putMenuItemImage,
  removeMenuItemImage,
  sendMenuItemImage,
  putMenuBanner,
  removeMenuBanner,
  sendMenuBanner,
  checkCheckout,
} = require('../controllers/Menu.controller');

// Mounted at /vendors/:vendorId/menu (mergeParams lets the handlers read :vendorId)
const router = express.Router({ mergeParams: true });

// The whole menu: stall, banner and items with availability (vendor page + customer page)
router.get('/', getVendorMenu);

// Check a basket before checkout (sold out / not enough left / stall closed)
router.post('/checkout-check', checkCheckout);

// The single menu banner
router.get('/banner', sendMenuBanner);
router.put('/banner', putMenuBanner);
router.delete('/banner', removeMenuBanner);

// Menu items
router.post('/items', addMenuItem);
router.get('/items/:itemId', getVendorMenuItem);
router.patch('/items/:itemId', editMenuItem);
router.delete('/items/:itemId', removeMenuItem);

// Available / Sold out switch
router.patch('/items/:itemId/availability', changeAvailability);

// The single photo of an item
router.get('/items/:itemId/image', sendMenuItemImage);
router.put('/items/:itemId/image', putMenuItemImage);
router.delete('/items/:itemId/image', removeMenuItemImage);

module.exports = router;
