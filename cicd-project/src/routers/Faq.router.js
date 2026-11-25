const express = require('express');
const {
  listPublishedFaqs,
  listAllFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} = require('../models/Faq.model');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const faqs = await listPublishedFaqs(req.query.category);
    res.json(faqs);
  } catch (error) {
    next(error);
  }
});

router.get('/all', async (req, res, next) => {
  try {
    const faqs = await listAllFaqs();
    res.json(faqs);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const faq = await createFaq(req.body);
    res.status(201).json(faq);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const faq = await updateFaq(req.params.id, req.body);
    res.json(faq);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteFaq(req.params.id);
    res.json({ message: 'FAQ deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;