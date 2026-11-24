const express = require('express');
const { requireRole } = require('../middleware/access-control');
const { getWeeklyStatsForAssignedStall } = require('../models/VendorWeekly.model');
const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', requireRole('vendor'), async (req, res, next) => {
  try {
    if (!Number.isSafeInteger(req.user.stallId) || req.user.stallId <= 0) {
      return res.status(403).json({ error: 'Vendor has no assigned stall.' });
    }
    const stats = await getWeeklyStatsForAssignedStall(req.user.stallId);
    return res.json({ stats });
  } catch (error) { return next(error); }
});
module.exports = router;
