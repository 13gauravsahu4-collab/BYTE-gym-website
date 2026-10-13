const express = require('express');
const store = require('../store');
const { HttpError, book, cancel, waitlistPosition } = require('../logic/booking');

const router = express.Router();

// book a mat, or join the waitlist if the session is full
router.post('/', (req, res) => {
  const { sessionId, memberId, name } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 40);

  if (!sessionId || !memberId || !cleanName) {
    throw new HttpError(400, 'sessionId, memberId and name are required');
  }

  const session = store.read('sessions').find((s) => s.id === sessionId);

  const result = store.update('bookings', (bookings) => {
    const booking = book(bookings, session, String(memberId), cleanName);
    return { ...booking, position: waitlistPosition(bookings, booking) };
  });

  res.status(201).json(result);
});

// one member's active bookings, with their waitlist position
router.get('/', (req, res) => {
  const memberId = String(req.query.memberId || '');
  if (!memberId) throw new HttpError(400, 'memberId is required');

  const bookings = store.read('bookings');
  const sessions = store.read('sessions');

  const mine = bookings
    .filter((b) => b.memberId === memberId && b.status !== 'cancelled')
    .map((b) => {
      const session = sessions.find((s) => s.id === b.sessionId);
      return { ...b, position: waitlistPosition(bookings, b), startsAt: session ? session.startsAt : null };
    });

  res.json({ bookings: mine });
});

// cancel, and the next person in the queue is booked in the same step
router.delete('/:id', (req, res) => {
  const memberId = String(req.query.memberId || '');

  const result = store.update('bookings', (bookings) => cancel(bookings, req.params.id, memberId));

  res.json({ cancelled: result.booking.id, promoted: result.promoted.length });
});

module.exports = { router };