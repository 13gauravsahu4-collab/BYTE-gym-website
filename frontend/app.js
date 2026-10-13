// app.js - the browser only asks. The server decides who gets a mat.

// any crash is shown at the top of the page, so nothing fails silently
function showCrash(message) {
  const node = document.getElementById('crash');
  if (node) {
    node.textContent = 'Page error: ' + message;
    node.hidden = false;
  }
}
window.addEventListener('error', (e) => showCrash(e.message));
window.addEventListener('unhandledrejection', (e) => showCrash((e.reason && e.reason.message) || String(e.reason)));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const POLL_MS = 3000;
const PAGES = ['home', 'book', 'mine', 'help', 'staff'];

/* --------------------------------------------------------- identity */

function getMemberId() {
  try {
    let id = localStorage.getItem('gym_member_id');
    if (!id) {
      id = 'm-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('gym_member_id', id);
    }
    return id;
  } catch (e) {
    return 'm-session-' + Math.random().toString(36).slice(2, 10);
  }
}

const memberId = getMemberId();

const state = {
  sessions: [],
  capacity: 20,
  mine: [],
  loaded: false,
  day: null,
  period: 'all',
  onlyOpen: false,
  updatedAt: null,
  busy: new Set(),
  pendingSession: null,
  pendingCancel: null,
};

/* -------------------------------------------------------------- api */

// The page may be opened from the Node server (same address) or from another
// tool such as VS Code Live Server. We look for the real API once, then reuse it.
let apiBase = null;

async function findApi() {
  const candidates = ['', 'http://localhost:3000', 'http://127.0.0.1:3000'];

  for (const base of candidates) {
    try {
      const res = await fetch(base + '/api/sessions');
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('json')) return base;
    } catch (e) {
      /* try the next address */
    }
  }
  return null;
}

async function api(path, { method = 'GET', body = null, headers = {} } = {}) {
  if (apiBase === null) {
    apiBase = await findApi();
    if (apiBase === null) throw new Error('Cannot reach the booking server');
  }

  let res;
  try {
    res = await fetch(apiBase + '/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    apiBase = null; // look for the server again next time
    throw new Error('Cannot reach the booking server');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }

  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------------------------------------------------------- helpers */

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtRange = (iso) => `${fmtTime(iso)} - ${fmtTime(new Date(new Date(iso).getTime() + 3600000))}`;
const dayKey = (iso) => new Date(iso).toDateString();
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });

function dayLabel(key) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (key === today.toDateString()) return 'Today';
  if (key === tomorrow.toDateString()) return 'Tomorrow';
  return new Date(key).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function periodOf(iso) {
  const hour = new Date(iso).getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** "Starts in 2h 15m", "In progress" or "Finished" */
function untilText(iso) {
  const start = new Date(iso).getTime();
  const now = Date.now();

  if (now >= start + 3600000) return 'Finished';
  if (now >= start) return 'In progress';

  const minutes = Math.ceil((start - now) / 60000);
  if (minutes < 60) return `Starts in ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Starts in ${hours}h ${minutes % 60}m`;

  return `Starts in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const setText = (selector, text) => {
  const node = $(selector);
  if (node) node.textContent = text;
};

let toastTimer = null;
function toast(message, kind = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 4000);
}

const myBookingFor = (sessionId) => state.mine.find((b) => b.sessionId === sessionId);

/* ---------------------------------------------------------- routing */

function showPage() {
  const wanted = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  const page = PAGES.includes(wanted) ? wanted : 'home';

  $$('.page').forEach((p) => (p.hidden = p.dataset.page !== page));
  $$('.nav-link').forEach((link) => {
    const on = link.dataset.page === page;
    link.classList.toggle('active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const label = $('.nav-link[data-page="' + page + '"]').firstChild.textContent.trim();
  document.title = (page === 'home' ? 'Pulse Fitness Club' : label + ' - Pulse Fitness Club');

  closeNav();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', showPage);

/* mobile menu + header shadow */
function closeNav() {
  $('#nav').classList.remove('open');
  $('#navToggle').setAttribute('aria-expanded', 'false');
}

$('#navToggle').addEventListener('click', () => {
  const open = $('#nav').classList.toggle('open');
  $('#navToggle').setAttribute('aria-expanded', String(open));
});

window.addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 8));

/* -------------------------------------------------------- rendering */

function renderHome() {
  const today = new Date().toDateString();
  const openToday = state.sessions.filter((s) => dayKey(s.startsAt) === today && s.matsLeft > 0).length;
  const next = state.sessions.find((s) => s.matsLeft > 0);

  setText('#statToday', state.loaded ? String(openToday) : '-');
  setText('#statNext', next ? fmtTime(next.startsAt) : state.loaded ? 'None' : '-');
  setText('#statMats', String(state.capacity));
}

function daysList() {
  const map = new Map();
  state.sessions.forEach((s) => {
    const key = dayKey(s.startsAt);
    if (!map.has(key)) map.set(key, { key, open: 0 });
    if (s.matsLeft > 0) map.get(key).open += 1;
  });
  return [...map.values()];
}

function renderDays() {
  const days = daysList();
  if (days.length === 0) {
    $('#dayTabs').innerHTML = '';
    return;
  }

  if (!days.some((d) => d.key === state.day)) state.day = days[0].key;

  $('#dayTabs').innerHTML = days
    .map(
      (d) => `<button class="day-tab ${d.key === state.day ? 'active' : ''}" role="tab"
                aria-selected="${d.key === state.day}" data-day="${esc(d.key)}">
                ${esc(dayLabel(d.key))}<small>${d.open} open</small></button>`
    )
    .join('');
}

function renderLive() {
  setText(
    '#liveStamp',
    state.updatedAt ? `Live \u00B7 updated ${state.updatedAt.toLocaleTimeString()}` : 'Connecting...'
  );
}

function renderSessions() {
  const box = $('#sessions');

  if (!state.loaded) {
    box.innerHTML = '<p class="empty">Loading sessions...</p>';
    return;
  }

  const list = state.sessions
    .filter((s) => dayKey(s.startsAt) === state.day)
    .filter((s) => state.period === 'all' || periodOf(s.startsAt) === state.period)
    .filter((s) => !state.onlyOpen || s.matsLeft > 0);

  if (list.length === 0) {
    box.innerHTML = '<p class="empty">No sessions match these filters.</p>';
    return;
  }

  const now = Date.now();

  box.innerHTML = list
    .map((s) => {
      const mine = myBookingFor(s.id);
      const full = s.matsLeft <= 0;
      const low = !full && s.matsLeft <= 3;
      const pct = Math.min(100, Math.round((s.taken / state.capacity) * 100));
      const started = new Date(s.startsAt).getTime() <= now;

      const info = full
        ? `Full &middot; ${s.waiting} on the waitlist`
        : `${s.matsLeft} of ${state.capacity} mats left`;

      let action;
      if (mine && mine.status === 'confirmed') {
        action = '<a class="pill ok" href="#/mine">Booked &#10003;</a>';
      } else if (mine && mine.status === 'waitlisted') {
        action = `<a class="pill wait" href="#/mine">Waitlist #${mine.position}</a>`;
      } else {
        action = `<button class="btn ${full ? 'wait' : ''}" data-book="${esc(s.id)}"
                    ${state.busy.has(s.id) ? 'disabled' : ''}>${full ? 'Join waitlist' : 'Book'}</button>`;
      }

      return `<article class="slot">
        <div class="slot-main">
          <div class="slot-time">${esc(fmtRange(s.startsAt))}${started ? '<span class="tag">In progress</span>' : ''}</div>
          <div class="slot-info ${full ? 'full' : low ? 'low' : ''}">${info}</div>
          <div class="bar ${full ? 'full' : low ? 'low' : ''}"><span style="width:${pct}%"></span></div>
        </div>
        ${action}
      </article>`;
    })
    .join('');
}

function renderMine() {
  setText('#mineCount', String(state.mine.length));
  const box = $('#mine');

  if (state.mine.length === 0) {
    box.innerHTML = '<p class="empty">You have no bookings yet.<br /><br /><a class="btn" href="#/book">Book a session</a></p>';
    return;
  }

  box.innerHTML = [...state.mine]
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
    .map((b) => {
      const when = b.startsAt ? `${fmtDay(b.startsAt)}, ${fmtRange(b.startsAt)}` : 'Session';
      const confirmed = b.status === 'confirmed';

      const detail = confirmed
        ? `<div class="code">${esc(b.code)}</div>
           <div class="hint">${b.checkedIn ? 'Checked in. Enjoy your session.' : 'Show this code at the door'}</div>
           ${b.startsAt ? `<span class="countdown">${esc(untilText(b.startsAt))}</span>` : ''}`
        : `<div class="wait-pos">Waitlist position #${b.position}</div>
           <div class="hint">You are booked automatically if a mat frees up</div>`;

      const actions = [
        confirmed ? `<button class="btn ghost small" data-copy="${esc(b.code)}">Copy code</button>` : '',
        confirmed && b.startsAt ? `<button class="btn ghost small" data-ics="${esc(b.id)}">Add to calendar</button>` : '',
        b.checkedIn ? '' : `<button class="btn ghost small" data-cancel="${esc(b.id)}">Cancel</button>`,
      ].join('');

      return `<article class="ticket">
        <div>
          <div class="slot-time">${esc(when)}</div>
          ${detail}
        </div>
        <div class="ticket-actions">${actions}</div>
      </article>`;
    })
    .join('');
}

function render() {
  renderHome();
  renderDays();
  renderLive();
  renderSessions();
  renderMine();
}

function showResult(booking, session, title) {
  const ok = booking.status === 'confirmed';

  setText('#resultIcon', ok ? '\u2713' : '\u23F3');
  $('#resultIcon').className = 'result-icon ' + (ok ? '' : 'wait');
  setText('#resultTitle', title || (ok ? 'You are booked!' : 'Session full: you are on the waitlist'));
  setText('#resultSlot', session ? `${fmtDay(session.startsAt)}, ${fmtRange(session.startsAt)}` : '');

  const code = $('#resultCode');
  code.hidden = !ok;
  code.textContent = ok ? booking.code : '';

  setText(
    '#resultNote',
    ok ? 'Show this code at the door.' : `Your position is #${booking.position}. You are booked automatically if a mat frees up.`
  );
  openModal('resultModal');
}

/* ---------------------------------------------------------- loading */

let refreshId = 0;

function notifyPromotions(before, after) {
  after.forEach((b) => {
    const old = before.find((x) => x.id === b.id);
    if (old && old.status === 'waitlisted' && b.status === 'confirmed') {
      showResult(b, state.sessions.find((x) => x.id === b.sessionId), 'You got a mat!');
    }
  });
}

async function refresh() {
  const mine = ++refreshId;

  try {
    const [sessionData, bookingData] = await Promise.all([
      api('/sessions'),
      api('/bookings?memberId=' + encodeURIComponent(memberId)),
    ]);

    if (mine !== refreshId) return; // a newer refresh already won

    notifyPromotions(state.mine, bookingData.bookings);
    state.sessions = sessionData.sessions;
    state.capacity = sessionData.capacity;
    state.mine = bookingData.bookings;
    state.loaded = true;
    state.updatedAt = new Date();

    $('#banner').hidden = true;
    render();
  } catch (err) {
    if (mine === refreshId) $('#banner').hidden = false;
  }
}

/* ----------------------------------------------------------- modals */

function openModal(id) {
  const node = $('#' + id);
  node.hidden = false;
  return node;
}

function closeModals() {
  $$('.modal').forEach((m) => (m.hidden = true));
  state.pendingSession = null;
  state.pendingCancel = null;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModals();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

/* ------------------------------------------------------ interactions */

$('#sessions').addEventListener('click', (e) => {
  const button = e.target.closest('[data-book]');
  if (!button) return;

  const session = state.sessions.find((s) => s.id === button.dataset.book);
  if (!session) return;

  state.pendingSession = session.id;
  setText('#nameSlot', `${fmtDay(session.startsAt)}, ${fmtRange(session.startsAt)}`);
  $('#nameError').hidden = true;

  let saved = '';
  try {
    saved = localStorage.getItem('gym_name') || '';
  } catch (err) {
    /* storage blocked */
  }

  $('#nameInput').value = saved;
  setText('#nameSubmit', session.matsLeft <= 0 ? 'Join waitlist' : 'Confirm booking');
  openModal('nameModal');
  $('#nameInput').focus();
});

$('#nameForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = $('#nameInput').value.trim();
  if (!name) {
    $('#nameError').hidden = false;
    $('#nameInput').focus();
    return;
  }

  const sessionId = state.pendingSession;
  try {
    localStorage.setItem('gym_name', name);
  } catch (err) {
    /* storage blocked */
  }

  closeModals();
  await book(sessionId, name);
});

async function book(sessionId, name) {
  if (!sessionId || state.busy.has(sessionId)) return; // ignore double clicks

  const session = state.sessions.find((s) => s.id === sessionId);
  state.busy.add(sessionId);
  renderSessions();

  try {
    const booking = await api('/bookings', { method: 'POST', body: { sessionId, memberId, name } });
    showResult(booking, session);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    state.busy.delete(sessionId);
    await refresh();
  }
}

/* filters */
$('#periodChips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-period]');
  if (!chip) return;
  state.period = chip.dataset.period;
  $$('#periodChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
  renderSessions();
});

$('#onlyOpen').addEventListener('change', (e) => {
  state.onlyOpen = e.target.checked;
  renderSessions();
});

$('#dayTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-day]');
  if (!tab) return;
  state.day = tab.dataset.day;
  renderDays();
  renderSessions();
});

/* my bookings: cancel, copy code, calendar file */
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
  } catch (e) {
    const box = document.createElement('textarea');
    box.value = code;
    document.body.appendChild(box);
    box.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      /* nothing else to try */
    }
    box.remove();
  }
  toast('Code copied', 'ok');
}

function buildIcs(booking) {
  const start = new Date(booking.startsAt);
  const end = new Date(start.getTime() + 3600000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pulse Fitness Club//Gym Slots//EN',
    'BEGIN:VEVENT',
    `UID:${booking.id}@gym-slots`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:Gym session',
    `DESCRIPTION:Booking code ${booking.code}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadIcs(booking) {
  const url = URL.createObjectURL(new Blob([buildIcs(booking)], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gym-session.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#mine').addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) return copyCode(copy.dataset.copy);

  const ics = e.target.closest('[data-ics]');
  if (ics) {
    const found = state.mine.find((b) => b.id === ics.dataset.ics);
    if (found) downloadIcs(found);
    return;
  }

  const button = e.target.closest('[data-cancel]');
  if (!button) return;

  const booking = state.mine.find((b) => b.id === button.dataset.cancel);
  if (!booking) return;

  state.pendingCancel = booking.id;
  setText('#cancelSlot', booking.startsAt ? `${fmtDay(booking.startsAt)}, ${fmtRange(booking.startsAt)}` : '');
  openModal('cancelModal');
});

$('#cancelYes').addEventListener('click', async () => {
  const id = state.pendingCancel;
  closeModals();
  if (!id) return;

  try {
    await api(`/bookings/${encodeURIComponent(id)}?memberId=${encodeURIComponent(memberId)}`, { method: 'DELETE' });
    toast('Booking cancelled', 'ok');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    await refresh();
  }
});

/* ------------------------------------------------------------ staff */

$('#checkinForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const code = $('#codeInput').value.trim().toUpperCase();
  const key = $('#keyInput').value;
  const result = $('#checkinResult');

  if (!code) {
    result.textContent = 'Enter a member code first.';
    result.className = 'result bad';
    result.hidden = false;
    return;
  }

  try {
    const data = await api('/checkin', { method: 'POST', body: { code }, headers: { 'X-Staff-Key': key } });
    result.textContent = `Checked in: ${data.name} (${data.code})`;
    result.className = 'result ok';
    $('#codeInput').value = '';
  } catch (err) {
    result.textContent = err.message;
    result.className = 'result bad';
  }

  result.hidden = false;
  refresh();
});

/* ------------------------------------------------------------ start */

showPage();
render();
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, POLL_MS);