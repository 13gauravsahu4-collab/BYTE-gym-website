const express = require('express');
const store = require('../store');
const { CAPACITY, confirmedCount, waitlistOf } = require('../logic/booking');

const router = express.Router();

// every session that has not finished yet, with live mat counts
router.get('/', (req, res) => {
  const now = Date.now();
  const bookings = store.read('bookings');

  const sessions = store
    .read('sessions')
    .filter((s) => new Date(s.startsAt).getTime() + 3600000 > now)
    .map((s) => {
      const taken = confirmedCount(bookings, s.id);
      return { ...s, taken, matsLeft: CAPACITY - taken, waiting: waitlistOf(bookings, s.id).length };
    });

  res.json({ sessions, capacity: CAPACITY });
});

module.exports = { router };