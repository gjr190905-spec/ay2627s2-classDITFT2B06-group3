const express = require('express');
const { requireAuthentication } = require('../middleware/access-control');
const { requireSameOrigin, requireCsrf } = require('../middleware/auth-session');
const { findProfileById, updateProfileById, findAvatarById, saveAvatarById, removeAvatarById } = require('../models/Profile.model');

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

// JSON is limited to 1 MB by src/app.js; avatar binary is capped at 512 KiB.
const MAX_AVATAR_BYTES = 512 * 1024;
function parseImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 720000) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return null;
  const valid = match[1] === 'image/jpeg'
    ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
    : match[1] === 'image/png'
      ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.subarray(-8, -4).toString('ascii') === 'IEND'
      : bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8;
  return valid ? { contentType: match[1], bytes } : null;
}

router.get('/avatar', async (req, res, next) => {
  try {
    const avatar = await findAvatarById(req.user.id);
    if (!avatar) return res.status(404).json({ error: 'Profile photo not found.' });
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', avatar.contentType);
    return res.send(avatar.imageData);
  } catch (error) { return next(error); }
});

router.post('/avatar', requireSameOrigin, requireCsrf, async (req, res, next) => {
  try {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send JSON with Content-Type: application/json.' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'imageDataUrl')) {
      return res.status(400).json({ error: 'Provide a single imageDataUrl.' });
    }
    const image = parseImage(req.body.imageDataUrl);
    if (!image) return res.status(400).json({ error: 'Use a valid JPEG, PNG or WebP image of at most 512 KiB.' });
    const user = await saveAvatarById(req.user.id, image.contentType, image.bytes);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user, message: 'Profile photo saved successfully.' });
  } catch (error) { return next(error); }
});

router.delete('/avatar', requireSameOrigin, requireCsrf, async (req, res, next) => {
  try {
    const user = await removeAvatarById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({ user, message: 'Profile photo removed.' });
  } catch (error) { return next(error); }
});

module.exports = router;
