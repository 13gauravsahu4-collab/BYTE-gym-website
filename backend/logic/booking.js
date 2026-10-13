// booking.js - every rule lives here. Routes only call these functions.
// Each function takes the bookings array, changes it, and returns a result.

const crypto = require('crypto');

const CAPACITY = 20;
const HOUR_MS = 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no I/O/0/1

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isActive = (b) => b.status === 'confirmed' || b.status === 'waitlisted';

function confirmedCount(bookings, sessionId) {
  return bookings.filter((b) => b.sessionId === sessionId && b.status === 'confirmed').length;
}

// the waitlist is ordered by seq: lower number joined earlier
function waitlistOf(bookings, sessionId) {
  return bookings
    .filter((b) => b.sessionId === sessionId && b.status === 'waitlisted')
    .sort((a, b) => a.seq - b.seq);
}

function waitlistPosition(bookings, booking) {
  if (booking.status !== 'waitlisted') return null;
  return waitlistOf(bookings, booking.sessionId).findIndex((b) => b.id === booking.id) + 1;
}

function nextSeq(bookings) {
  return bookings.reduce((max, b) => Math.max(max, b.seq), 0) + 1;
}

function makeCode(bookings) {
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
  } while (bookings.some((b) => b.code === code));
  return code;
}

/** Mats left -> confirmed. Full -> waitlisted. This is the 20-mat rule. */
function book(bookings, session, memberId, name, now = new Date()) {
  if (!session) throw new HttpError(404, 'Session not found');

  if (now.getTime() >= new Date(session.startsAt).getTime() + HOUR_MS) {
    throw new HttpError(409, 'This session has already finished');
  }

  const duplicate = bookings.find(
    (b) => b.sessionId === session.id && b.memberId === memberId && isActive(b)
  );
  if (duplicate) throw new HttpError(409, 'You already have a booking for this session');

  const status = confirmedCount(bookings, session.id) < CAPACITY ? 'confirmed' : 'waitlisted';

  const booking = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    memberId,
    name,
    code: makeCode(bookings),
    status,
    seq: nextSeq(bookings),
    checkedIn: false,
    createdAt: now.toISOString(),
  };

  bookings.push(booking);
  return booking;
}

/** Book the next people in the queue while there are free mats. */
function promoteWaitlist(bookings, sessionId) {
  const promoted = [];

  while (confirmedCount(bookings, sessionId) < CAPACITY) {
    const next = waitlistOf(bookings, sessionId)[0];
    if (!next) break;
    next.status = 'confirmed';
    promoted.push(next);
  }

  return promoted;
}

/** Cancel, and in the same step give the freed mat to the waitlist. */
function cancel(bookings, bookingId, memberId) {
  const booking = bookings.find((b) => b.id === bookingId);

  if (!booking || booking.memberId !== memberId) throw new HttpError(404, 'Booking not found');
  if (!isActive(booking)) throw new HttpError(409, 'This booking is already cancelled');
  if (booking.checkedIn) throw new HttpError(409, 'Already checked in, cannot cancel');

  const wasConfirmed = booking.status === 'confirmed';
  booking.status = 'cancelled';

  const promoted = wasConfirmed ? promoteWaitlist(bookings, booking.sessionId) : [];
  return { booking, promoted };
}

function checkIn(bookings, code) {
  const clean = String(code || '').trim().toUpperCase();
  const booking = bookings.find((b) => b.code === clean);

  if (!booking) throw new HttpError(404, 'Code not found');
  if (booking.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled');
  if (booking.status === 'waitlisted') throw new HttpError(409, 'Still on the waitlist, no mat yet');
  if (booking.checkedIn) throw new HttpError(409, 'Already checked in');

  booking.checkedIn = true;
  booking.checkedInAt = new Date().toISOString();
  return booking;
}

module.exports = {
  CAPACITY,
  HttpError,
  confirmedCount,
  waitlistOf,
  waitlistPosition,
  book,
  cancel,
  checkIn,
};