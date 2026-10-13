const express = require('express');
const store = require('../store');
const { HttpError, checkIn } = require('../logic/booking');

const router = express.Router();
const STAFF_KEY = process.env.STAFF_KEY || 'gym-staff';

router.post('/', (req, res) => {
  if (req.get('X-Staff-Key') !== STAFF_KEY) throw new HttpError(401, 'Wrong staff key');

  const booking = store.update('bookings', (bookings) => checkIn(bookings, req.body && req.body.code));

  res.json({ name: booking.name, code: booking.code, sessionId: booking.sessionId });
});

module.exports = { router };