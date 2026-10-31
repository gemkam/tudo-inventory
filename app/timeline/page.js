'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { TIMELINE, countItems } from '@/lib/timeline';

/* Timeline: chronological hierarchy of the site (Day > Module > what was built).
   Hand-written days in lib/timeline.js + live updates from GitHub (/api/timeline), so new days appear on their own.
   Also (31 Oct 2026): what the Administrator users (kamran, administrator) did in the app, as a "👤 <user> (Administrator)"
   group on each day: logins and every add / edit / delete from audit_log (same data as the User activity page).
   audit_log can only be read by an Administrator, so other users simply do not see these groups.
   CSS tl-* + sm-* in globals.css */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const showDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const muscatToday = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const plain = (mod) => mod.replace(/^[^A-Za-z]+/, '');


/* ---------- What the Administrator users did in the app (audit_log + user_sessions) ---------- */
const TBL = {
  transport_entries: ['Trip sheet', '/transport'], transport_salaries: ['Driver salary', '/transport/salary-sheet'], transport_extras: ['Transport other expense', '/transport'],
  transport_drivers: ['Driver', '/transport/drivers'], transport_vehicles: ['Vehicle', '/transport/vehicles'], transport_invoices: ['Transport invoice', '/transport/invoice'],
  vehicle_maintenance: ['Vehicle maintenance', '/transport/vehicles'], transport_profit_taken: ['Profit taken', '/transport'], exp_entries: ['Office Expense bill', '/expenses'],
  exp_staff: ['Office staff salary', '/expenses'], exp_budgets: ['Budget', '/expenses/summary'], exp_attendance: ['Attendance', '/expenses/attendance'],
  company_docs: ['Company invoice / receipt', '/expenses/docs'], doc_checklist: ['Documents Checklist', '/docs'], items: ['Inventory item', '/inventory'],
  stock_moves: ['Stock movement', '/log'], categories: ['Inventory section', '/inventory'], bill_accounts: ['Bill account', '/bills'], bill_payments: ['Bill payment', '/bills'],
  entry_links: ['Data entry share link', '/entry'], app_labels: ['Row name', ''], app_settings: ['Setting', '/settings']
};
const ACT = { INSERT: 'Added', UPDATE: 'Edited', DELETE: 'Deleted' };
const HIDE = new Set(['id', 'created_at', 'updated_at', 'created_by', 'entered_by', 'user_id', 'sort', 'source', 'source_id', 'source_kind']);
const muscat = (iso) => { const d = new Date(new Date(iso).getTime() + 4 * 3600000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16), ms: new Date(iso).getTime() }; };
function rowName(a) {
  const r = a.new_data || a.old_data || {};
  const main = r.name || r.owner || r.description || r.doc_name || r.title || r.doc_no || r.work || r.party || r.head || r.key || r.bill_no
    || [r.from_place, r.to_place].filter(Boolean).join(' → ');
  const date = r.entry_date || r.doc_date || r.month || r.day;
  return [date ? String(date).slice(0, 10).split('-').reverse().join('/') : '', main ? String(main).slice(0, 50) : ''].filter(Boolean).join(' · ');
}
function fieldsOf(a) {
  if (a.action !== 'UPDATE') return '';
  const f = (a.changed || []).filter((k) => !HIDE.has(k)).map((k) => k.replace(/_/g, ' '));
  return f.length ? ` (${f.slice(0, 4).join(', ')}${f.length > 4 ? '…' : ''})` : '';
}
/* -> [{ date, user, items: [[time, what, path]] }], nearby same changes joined ("×3") */
function buildPeople(audit, sessions) {
  const ev = [];
  for (const s of sessions) { const m = muscat(s.started_at); ev.push({ ...m, user: s.username || 'user', key: `login`, what: '🔑 Logged in', path: '' }); }
  for (const a of audit) {
    const m = muscat(a.at);
    const [label, path] = TBL[a.table_name] || [a.table_name, ''];
    const name = rowName(a);
    ev.push({ ...m, user: a.username || 'user', key: `${a.action}|${a.table_name}|${name}`, what: `${ACT[a.action] || a.action} ${label}${name ? `: ${name}` : ''}${fieldsOf(a)}`, path });
  }
  ev.sort((x, y) => x.ms - y.ms);
  const out = new Map();
  let last = null;
  for (const e of ev) {
    if (last && last.user === e.user && last.key === e.key && last.date === e.date && e.ms - last.ms < 15 * 60000) { last.n += 1; last.ms = e.ms; continue; }
    last = { ...e, n: 1 };
    const k = `${e.date}|${e.user}`;
    if (!out.has(k)) out.set(k, { date: e.date, user: e.user, list: [] });
    out.get(k).list.push(last);
  }
  return [...out.values()].map((g) => ({ date: g.date, user: g.user, items: g.list.map((x) => [x.time, x.n > 1 ? `${x.what} ×${x.n}` : x.what, x.path]) }));
}

/* Join hand-written days with live updates.
   Hand-written day: keeps its own list, plus live updates made after its last written time.
   Any other day: built from the live updates, grouped by module. */
function mergeTimeline(live, people = []) {
  const map = new Map(TIMELINE.map((d) => [d.date, { ...d, groups: d.groups.map(([m, items]) => [m, [...items]]) }]));
  for (const { date, items } of live) {
    const day = map.get(date);
    if (day) {
      const lastTime = day.groups.flatMap(([, it]) => it.map(([t]) => t)).filter(Boolean).sort().pop() || '';
      const extra = items.filter(([t]) => t > lastTime);
      if (extra.length) day.groups.push(['🔄 Later updates', extra.map(([t, w, p]) => [t, w, p])]);
    } else {
      const groups = [];
      for (const [t, w, p, mod] of items) {
        let g = groups.find(([m]) => m === mod);
        if (!g) { g = [mod, []]; groups.push(g); }
        g[1].push([t, w, p]);
      }
      const names = groups.map(([m]) => plain(m));
      map.set(date, { date, auto: true, title: names.slice(0, 3).join(', ') + (names.length > 3 ? ' and more' : ''), groups });
    }
  }
  // what the Administrator users did that day, one group per user, after the build steps
  for (const { date, user, items } of people) {
    if (!map.has(date)) map.set(date, { date, auto: true, title: 'Work in the app', groups: [] });
    map.get(date).groups.push([`👤 ${user} (Administrator)`, items]);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function TimelinePage() {
  const [query, setQuery] = useState('');
  const [newest, setNewest] = useState(true);
  const [openKey, setOpenKey] = useState(1); // changes force all <details> open / closed
  const [allOpen, setAllOpen] = useState(true);
  const q = query.trim().toLowerCase();
  const [live, setLive] = useState(null); // null = loading
  const today = muscatToday();

  useEffect(() => {
    let stop = false;
    const load = () => fetch('/api/timeline').then((r) => r.json()).then((j) => { if (!stop) setLive(j.days || []); }).catch(() => { if (!stop) setLive([]); });
    load();
    const id = setInterval(load, 15 * 60 * 1000); // keep fresh while the page stays open
    return () => { stop = true; clearInterval(id); };
  }, []);

  // Administrator users' own work in the app (audit_log is readable by Administrators only)
  const { isOwner } = useUser() || {};
  const [people, setPeople] = useState([]);
  useEffect(() => {
    if (!isOwner) return undefined;
    let stop = false;
    (async () => {
      const s = sb();
      const [a, se] = await Promise.all([
        s.from('audit_log').select('at, username, role, table_name, action, changed, old_data, new_data').eq('role', 'admin').gte('at', '2026-10-21').order('at').limit(5000),
        s.from('user_sessions').select('username, role, started_at').eq('role', 'admin').gte('started_at', '2026-10-21').order('started_at').limit(2000)
      ]);
      if (!stop) setPeople(buildPeople(a.data || [], se.data || []));
    })();
    return () => { stop = true; };
  }, [isOwner]);

  const all = useMemo(() => mergeTimeline(live || [], people), [live, people]);
  const total = useMemo(() => all.reduce((n, d) => n + countItems(d), 0), [all]);

  // Day number counted from the first day (21 Oct = Day 1)
  const days = useMemo(() => {
    const list = all.map((d, i) => ({ ...d, n: i + 1 }))
      .map((d) => ({
        ...d,
        groups: d.groups
          .map(([mod, items]) => [mod, items.filter(([t, what, p]) => !q || `${d.title} ${mod} ${t} ${what} ${p} ${d.date} ${shortDate(d.date)}`.toLowerCase().includes(q))])
          .filter(([, items]) => items.length)
      }))
      .filter((d) => d.groups.length);
    return newest ? list.reverse() : list;
  }, [q, newest, all]);

  const first = all[0].date;
  const last = all[all.length - 1].date;
  const toggleAll = () => { setAllOpen((v) => !v); setOpenKey((k) => k + 1); };

  return (
    <div className="sm-page tl-page">
      <div className="sm-head">
        <h1>🕒 Timeline</h1>
        <p>How Tudo Num Office Systems was built, day by day: from the notebook plan on {shortDate(first)} to {shortDate(last)}. {all.length} days, {total} steps.
          <span className="tl-live">{live === null ? ' Checking for new updates...' : ' 🔄 Updates itself every day'}</span></p>
        <div className="tl-tools">
          <input type="search" className="sm-search" placeholder="Find, e.g. salary, Rauf, invoice, 28 Oct" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn small" onClick={() => setNewest((v) => !v)}>{newest ? '⬆ Oldest first' : '⬇ Newest first'}</button>
          <button className="btn small" onClick={toggleAll}>{allOpen ? '⊟ Fold all' : '⊞ Open all'}</button>
          <Link href="/sitemap" className="btn small">🗺 Sitemap</Link>
        </div>
      </div>

      {days.length ? (
        <ol className="tl-days" key={openKey}>
          {days.map((d) => (
            <li key={d.date} className="tl-day">
              <span className="tl-dot" aria-hidden="true">{d.n}</span>
              <details open={allOpen}>
                <summary className="tl-dayhead">
                  <b className="tl-dayno">Day {d.n}</b>
                  <span className="tl-date">{showDate(d.date)}</span>
                  <span className="tl-title">{d.title}</span>
                  {d.date === today && <em className="tl-badge today">Today</em>}
                  {d.auto && <em className="tl-badge">Auto</em>}
                  <i className="tl-count">{countItems(d)} {countItems(d) === 1 ? 'step' : 'steps'}</i>
                </summary>
                <ul className="sm-kids tl-groups">
                  {d.groups.map(([mod, items]) => (
                    <li key={mod} className="sm-branch">
                      <details open={allOpen}>
                        <summary><span className="sm-row"><span className="sm-name tl-mod">{mod}</span><i className="tl-count">{items.length}</i></span></summary>
                        <ul className="sm-kids">
                          {items.map(([t, what, p]) => (
                            <li key={`${t}${what}`} className="sm-leaf">
                              <span className={`sm-row${q ? ' hit' : ''}`}>
                                {t && <code className="tl-time">{t}</code>}
                                {p ? <Link href={p} className="sm-name tl-what">{what}</Link> : <span className="tl-what">{what}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Nothing matches that.</p>}
    </div>
  );
}

export default function Page() {
  return <AuthGate><TimelinePage /></AuthGate>;
}
