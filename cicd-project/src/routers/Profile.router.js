const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const { findProfileById, updateProfileById } = require('../models/Profile.model');

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(requireAuthentication);

router.get('/', async (req, res, next) => {
  try {
    const user = await findProfileById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

router.patch('/', requireSameOrigin, requireCsrf, async (req, res, next) => {
  try {
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Send JSON with Content-Type: application/json.' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid profile details.' });
    }
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !['displayName', 'phone'].includes(key))) {
      return res.status(400).json({ error: 'Only display name and phone can be edited.' });
    }
    const current = await findProfileById(req.user.id);
    if (!current) return res.status(404).json({ error: 'Account not found.' });

    const displayName = Object.hasOwn(body, 'displayName') ? body.displayName : current.displayName;
    const phoneInput = Object.hasOwn(body, 'phone') ? body.phone : current.phone;
    const errors = {};
    if (typeof displayName !== 'string') errors.displayName = 'Display name must be text.';
    if (typeof phoneInput !== 'string') errors.phone = 'Phone number must be text.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const name = displayName.trim().replace(/\s+/gu, ' ');
    const phone = phoneInput.trim();
    if (name.length < 2 || name.length > 70 || /[\x00-\x1f\x7f<>]/u.test(name)) {
      errors.displayName = 'Display name must contain 2–70 valid characters.';
    }
    const digits = phone.replace(/\D/g, '');
    if (phone && (!/^[+0-9()\s-]+$/u.test(phone) || digits.length < 8 || digits.length > 15 || phone.length > 20)) {
      errors.phone = 'Enter a valid phone number with 8–15 digits (20 characters maximum).';
    }
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const user = await updateProfileById(req.user.id, name, phone);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user, message: 'Profile saved successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
