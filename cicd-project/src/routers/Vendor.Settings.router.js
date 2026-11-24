const express = require('express');
const {
  getVendorSettings,
  putVendorSettings,
  getNotifications,
  readAllNotifications,
  clearAllNotifications,
} = require('../controllers/Settings.controller');

// Mounted at /vendors/:vendorId/settings
const settingsRouter = express.Router({ mergeParams: true });
// Order limit and notification choices
settingsRouter.get('/', getVendorSettings);
settingsRouter.put('/', putVendorSettings);

// Mounted at /vendors/:vendorId/notifications
const notificationsRouter = express.Router({ mergeParams: true });
// Latest notifications and the unread count
notificationsRouter.get('/', getNotifications);
notificationsRouter.post('/read-all', readAllNotifications);
notificationsRouter.delete('/', clearAllNotifications);

module.exports = { settingsRouter, notificationsRouter };
