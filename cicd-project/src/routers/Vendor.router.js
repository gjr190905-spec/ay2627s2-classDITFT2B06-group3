const express = require('express');
const {
  getClosureReasons,
  getVendor,
  updateVendorStatus,
} = require('../controllers/Vendor.controller');

const router = express.Router();

// List of reasons shown in the "close stall" prompt
// (declared before /:id so "closure-reasons" isn't treated as an id)
router.get('/closure-reasons', getClosureReasons);

// Vendor details for the home page header and status panel
router.get('/:id', getVendor);

// Open or close the stall. Closing requires a reason.
router.patch('/:id/status', updateVendorStatus);

module.exports = router;
