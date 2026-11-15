const express = require('express');
const { getAllStalls, getStallById } = require('../models/Stall.model');

const router = express.Router();

router.get('/', (req, res, next) => {
  getAllStalls()
    .then((stalls) => res.status(200).json(stalls))
    .catch(next);
});

router.get('/:id', (req, res, next) => {
  getStallById(req.params.id)
    .then((stall) => {
      if (!stall) return res.status(404).json({ error: 'Stall not found' });
      res.status(200).json(stall);
    })
    .catch(next);
});

module.exports = router;