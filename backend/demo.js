// demo.js - helper for the live demo. The server must be running.
//   node demo.js fill   -> books 20 fake members into the next session, so it is FULL
//   node demo.js free   -> cancels one fake member, so the waitlist moves up live
// Optional: add a session id, e.g.  node demo.js fill 20261012-18

const store = require('./store');

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;
const [, , command, wantedId] = process.argv;

async function call(path, options) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  return { status: res.status, body: await res.json() };
}

async function pickSession() {
  const { body } = await call('/sessions');
  const now = Date.now();
  const list = body.sessions.filter((s) => new Date(s.startsAt).getTime() > now);
  return wantedId ? list.find((s) => s.id === wantedId) : list[0];
}

async function main() {
  const session = await pickSession();
  if (!session) return console.log('No matching upcoming session.');
  console.log('Session:', session.id, new Date(session.startsAt).toLocaleString());

  if (command === 'fill') {
    for (let i = 1; i <= 20; i++) {
      await call('/bookings', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, memberId: `demo-${session.id}-${i}`, name: `Member ${i}` }),
      });
    }
    const after = (await call('/sessions')).body.sessions.find((s) => s.id === session.id);
    console.log(`Now ${after.taken} of 20 mats taken, ${after.waiting} waiting. Book it in the browser to join the waitlist.`);
  } else if (command === 'free') {
    const fake = store
      .read('bookings')
      .find((b) => b.sessionId === session.id && b.memberId.startsWith('demo-') && b.status === 'confirmed');
    if (!fake) return console.log('No fake member left to cancel in this session.');
    const r = await call(`/bookings/${fake.id}?memberId=${encodeURIComponent(fake.memberId)}`, { method: 'DELETE' });
    console.log(`Cancelled ${fake.name}. Promoted from waitlist: ${r.body.promoted}`);
  } else {
    console.log('Usage: node demo.js fill | node demo.js free [sessionId]');
  }
}

main();