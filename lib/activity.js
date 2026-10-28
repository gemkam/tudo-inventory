'use client';

/*
  User activity tracker (read by Administrator on /activity).
  One "session" per browser tab login. Records pages opened, buttons pressed,
  and a heartbeat every 60 s so the Administrator sees who is online.
  Data changes are recorded separately by the database (audit_log trigger).
*/
import { sb } from '@/lib/supabase';

const KEY = 'tudo-activity';
const BEAT_MS = 60000;

let state = { id: null, uid: null, starting: null, lastPath: '', lastClick: '', lastClickAt: 0, beat: null, listeners: false, token: '' };

function load() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(v) {
  try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

function deviceName() {
  const ua = navigator.userAgent || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

async function newSession() {
  const { data, error } = await sb().rpc('activity_start', { p_device: deviceName(), p_agent: navigator.userAgent || '' });
  if (error || !data) return null;
  state.id = data;
  save({ id: data, uid: state.uid });
  return data;
}

async function ensure() {
  if (state.id) return state.id;
  if (state.starting) return state.starting;
  state.starting = (async () => {
    const saved = load();
    if (saved?.id && saved.uid === state.uid) {
      const { data } = await sb().rpc('activity_ping', { p_session: saved.id });
      if (data === true) { state.id = saved.id; return saved.id; }
    }
    return newSession();
  })();
  const id = await state.starting;
  state.starting = null;
  return id;
}

async function send(kind, path, label, detail) {
  try {
    let id = await ensure();
    if (!id) return;
    const { data } = await sb().rpc('activity_ping', { p_session: id, p_kind: kind || null, p_path: path || null, p_label: label || null, p_detail: detail || null });
    if (data === false) {
      // session closed long ago (tab left open overnight): start a new one
      state.id = null; save(null);
      id = await newSession();
      if (id && kind) await sb().rpc('activity_ping', { p_session: id, p_kind: kind, p_path: path || null, p_label: label || null, p_detail: detail || null });
    }
  } catch { /* tracking must never break the app */ }
}

function clickLabel(el) {
  const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 80);
}

function onClick(e) {
  const el = e.target?.closest?.('button, a, [role="button"], input[type="checkbox"], input[type="submit"], select');
  if (!el || el.closest('[data-no-track]')) return;
  if (el.tagName === 'SELECT') return; // selects logged on change
  let label = clickLabel(el);
  if (el.tagName === 'INPUT' && el.type === 'checkbox') {
    const lab = el.closest('label');
    label = `${el.checked ? 'Ticked' : 'Unticked'} ${lab ? clickLabel(lab) : ''}`.trim();
  }
  if (!label) return;
  const href = el.tagName === 'A' ? el.getAttribute('href') : null;
  const now = Date.now();
  if (label === state.lastClick && now - state.lastClickAt < 1500) return;
  state.lastClick = label; state.lastClickAt = now;
  send('click', window.location.pathname + window.location.search, label, href ? { href } : null);
}

function onChange(e) {
  const el = e.target;
  if (!el || el.tagName !== 'SELECT' || el.closest('[data-no-track]')) return;
  const opt = el.options[el.selectedIndex];
  const name = el.getAttribute('aria-label') || el.id || el.name || 'list';
  send('click', window.location.pathname + window.location.search, `Picked "${(opt?.text || el.value || '').trim().slice(0, 60)}" in ${name}`);
}

function endBeacon(reason) {
  const id = state.id;
  if (!id || !state.token) return;
  try {
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/activity_end`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ p_session: id, p_reason: reason })
    });
  } catch { /* ignore */ }
}

/* Called by AuthGate once the user is known. */
export function startActivity(user) {
  if (typeof window === 'undefined' || !user?.id) return;
  if (state.uid && state.uid !== user.id) { state.id = null; save(null); }
  state.uid = user.id;
  sb().auth.getSession().then(({ data }) => { state.token = data.session?.access_token || ''; });
  ensure();
  if (!state.listeners) {
    state.listeners = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    sb().auth.onAuthStateChange((_e, session) => { state.token = session?.access_token || ''; });
    window.addEventListener('pagehide', () => endBeacon('closed'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.uid) send(null);
    });
  }
  if (!state.beat) {
    state.beat = setInterval(() => {
      if (document.visibilityState === 'visible' && state.uid) send(null);
    }, BEAT_MS);
  }
}

/* Called by AuthGate on every page change. */
export function logPage(path, title) {
  if (typeof window === 'undefined' || !state.uid) return;
  const full = path + (window.location.search || '');
  if (full === state.lastPath) return;
  state.lastPath = full;
  send('page', full, title || pageName(full));
}

/* Any page can log a named action, e.g. logAction('Created user rashid'). */
export function logAction(label, detail) {
  if (typeof window === 'undefined' || !state.uid) return;
  send('action', window.location.pathname + window.location.search, label, detail || null);
}

/* Called by Switch user before signing out. */
export async function endActivity(reason = 'logout') {
  const id = state.id;
  if (id) { try { await sb().rpc('activity_end', { p_session: id, p_reason: reason }); } catch { /* ignore */ } }
  state.id = null; state.uid = null; state.lastPath = '';
  save(null);
  if (state.beat) { clearInterval(state.beat); state.beat = null; }
}

/* Friendly page names (also used by the Activity page). */
const NAMES = [
  [/^\/$/, 'Home'],
  [/^\/inventory\/reports/, 'Inventory Reports'],
  [/^\/inventory/, 'Inventory'],
  [/^\/bills/, 'Bills'],
  [/^\/log/, 'Stock log'],
  [/^\/settings/, 'Settings'],
  [/^\/users/, 'Users'],
  [/^\/activity/, 'User activity'],
  [/^\/docs/, 'Documents Checklist'],
  [/^\/entry/, 'Data entry'],
  [/^\/expenses\/summary/, 'Group Summary'],
  [/^\/expenses\/docs/, 'Company Invoice / Receipt'],
  [/^\/expenses/, 'Office Expense'],
  [/^\/transport\/drivers/, 'Drivers'],
  [/^\/transport\/vehicles/, 'Vehicles'],
  [/^\/transport\/invoice/, 'Transport Invoice'],
  [/^\/transport\/reports/, 'Transport Reports'],
  [/^\/transport\/salary-sheet\/[^/?]+/, 'Driver salary sheet'],
  [/^\/transport\/salary-sheet/, 'All Drivers Salary Sheet'],
  [/^\/transport\/salary\//, 'Salary slip'],
  [/^\/transport\/[^/?]+/, 'Trip sheet'],
  [/^\/transport/, 'Transport Expense'],
  [/^\/c\//, 'Company page']
];

export function pageName(path) {
  const p = String(path || '');
  const hit = NAMES.find(([re]) => re.test(p));
  let name = hit ? hit[1] : p;
  const co = p.match(/[?&]co=([^&]+)/);
  if (co) name += ` (${decodeURIComponent(co[1]).replace(/-/g, ' ')})`;
  const m = p.match(/[?&]m=(\d{4}-\d{2})/);
  if (m) name += ` · ${m[1]}`;
  return name;
}
