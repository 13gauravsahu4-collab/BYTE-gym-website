// server.js - wiring only. Rules live in logic/, endpoints in routes/.

const express = require('express');
const path = require('path');

const store = require('./store');
const sessionRoutes = require('./routes/sessions');
const bookingRoutes = require('./routes/bookings');
const checkinRoutes = require('./routes/checkin');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '16kb' }));

// let the page call this API even when it was opened from another address
// (for example VS Code Live Server on 127.0.0.1:5500)
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Staff-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// never cache the frontend, so a saved change always shows up
app.use(
  express.static(path.join(__dirname, '..', 'frontend'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

// print every API call in the terminal: method, url, status
app.use('/api', (req, res, next) => {
  res.on('finish', () => console.log(req.method, req.originalUrl, res.statusCode));
  next();
});

app.use('/api/sessions', sessionRoutes.router);
app.use('/api/bookings', bookingRoutes.router);
app.use('/api/checkin', checkinRoutes.router);

app.use('/api', (req, res) => res.status(404).json({ status: 'error', error: 'Not found' }));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    status: 'error',
    error: status === 500 ? 'Something went wrong' : err.message,
  });
});

/** Make sure hourly sessions (6 AM to 9 PM start) exist for today and the next 2 days. */
function seedSessions() {
  const sessions = store.read('sessions');
  const have = new Set(sessions.map((s) => s.id));
  const pad = (n) => String(n).padStart(2, '0');

  for (let day = 0; day < 3; day++) {
    for (let hour = 6; hour <= 21; hour++) {
      const t = new Date();
      t.setDate(t.getDate() + day);
      t.setHours(hour, 0, 0, 0);

      const id = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(hour)}`;
      if (!have.has(id)) sessions.push({ id, startsAt: t.toISOString() });
    }
  }

  sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  store.write('sessions', sessions);
}

seedSessions();
app.listen(PORT, () => console.log(`Gym booking on http://localhost:${PORT}`));