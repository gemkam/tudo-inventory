'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate, { ROLES, useUser } from '@/components/AuthGate';
import DateInput from '@/components/DateInput';
import { sb } from '@/lib/supabase';
import { pageName } from '@/lib/activity';
import { exportExcel, exportPdf, exportStamp } from '@/lib/sheet';

/*
  User activity (Administrator only)
  - Online now: who is in the app and on which page
  - Logins: from / to / how long, pages visited with time on each, buttons pressed, changes made
  - Changes: every add / edit / delete in the data (old value -> new value)
*/

const ONLINE_MS = 150000; // seen in the last 2.5 minutes = online

const TABLES = {
  transport_entries: 'Trip sheet',
  transport_salaries: 'Driver salary',
  transport_extras: 'Transport other expense',
  transport_drivers: 'Driver',
  transport_vehicles: 'Vehicle',
  transport_invoices: 'Transport invoice',
  vehicle_maintenance: 'Vehicle maintenance',
  exp_entries: 'Office Expense bill',
  exp_staff: 'Office staff salary',
  exp_budgets: 'Budget',
  company_docs: 'Company invoice / receipt',
  doc_checklist: 'Documents Checklist',
  items: 'Inventory item',
  stock_moves: 'Stock movement',
  categories: 'Inventory section',
  bill_accounts: 'Bill account',
  bill_payments: 'Bill payment',
  entry_links: 'Data entry share link',
  app_labels: 'Row name'
};

const FIELD = {
  entry_date: 'Date', doc_date: 'Date', received_date: 'Received on', driver_allowance: 'Driver allowance',
  allowance_status: 'Allowance status', allowance_salary_id: 'Allowance paid with salary', trip_allowance: 'Driver allowance',
  rent: 'Rent', received: 'Received', diesel: 'Diesel', toll: 'Toll', maintenance: 'Maintenance', qty: 'Quantity',
  quantity: 'Quantity', min_qty: 'Minimum qty', unit_price: 'Price', price: 'Price', basic: 'Basic', paid: 'Paid', unpaid: 'Unpaid',
  vat: 'VAT', bill_no: 'Bill No.', head: 'Head', category: 'Category', department: 'Department', description: 'Description',
  route: 'Route', consignee: 'Consignee', cargo: 'Cargo', status: 'Status', name: 'Name', notes: 'Notes', expiry_date: 'Expiry date',
  issue_date: 'Issue date', doc_no: 'Document No.', party: 'Party', items: 'Lines', payable: 'Payable', advance_deduction: 'Advance deduction',
  special_allowance: 'Special allowance', room_rent: 'Room rent', month: 'Month', amount: 'Amount', charges: 'Charges', work: 'Work',
  payment_status: 'Payment', voc_expiry: 'VOC expiry', mulkiya_expiry: 'Mulkiya expiry', resident_card_expiry: 'Resident Card expiry',
  visa_expiry: 'Visa expiry', active: 'Active', value: 'Value', labels: 'Labels', monthly: 'Monthly budget', enabled: 'Turned on'
};

const HIDE_FIELDS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'entered_by', 'user_id', 'sort', 'source', 'source_id', 'source_kind']);

function dmy(d) {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function hm(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function hms(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function dur(ms) {
  if (!ms || ms < 0) return '0 s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}
function ago(d) {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000) return 'just now';
  return `${dur(ms)} ago`;
}
function isoDay(dt) {
  const d = new Date(dt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fieldName(k) {
  return FIELD[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
function showVal(v) {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return dmy(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `${dmy(v)} ${hm(v)}`;
    if (/^-?\d+(\.\d+)?$/.test(v) && v.includes('.')) return Number(v).toFixed(3);
    return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  const j = JSON.stringify(v);
  return j.length > 80 ? `${j.slice(0, 80)}…` : j;
}

/* Short name of the row that was changed, e.g. "19/10/2026 · Jabal Ali" */
function rowTitle(row, drivers) {
  const r = row.new_data || row.old_data || {};
  const bits = [];
  const date = r.entry_date || r.doc_date || r.date || r.month || r.expiry_date;
  if (date) bits.push(showVal(date));
  if (r.driver_id && drivers[r.driver_id]) bits.push(drivers[r.driver_id]);
  const main = r.name || r.description || r.route || r.title || r.doc_no || r.work || r.party || r.document || r.head || r.key || r.bill_no;
  if (main) bits.push(String(main).slice(0, 60));
  if (r.company) bits.push(String(r.company).replace(/-/g, ' '));
  return bits.join(' · ') || (row.row_id ? `#${String(row.row_id).slice(0, 8)}` : '');
}

function changeLines(row) {
  if (row.action === 'UPDATE') {
    return (row.changed || []).filter((k) => !HIDE_FIELDS.has(k) || k === 'updated_at').filter((k) => k !== 'updated_at')
      .map((k) => ({ field: fieldName(k), from: showVal(row.old_data?.[k]), to: showVal(row.new_data?.[k]) }));
  }
  const data = row.action === 'INSERT' ? row.new_data : row.old_data;
  return Object.entries(data || {})
    .filter(([k, v]) => !HIDE_FIELDS.has(k) && v !== null && v !== '' && v !== 0 && !(Array.isArray(v) && !v.length))
    .slice(0, 14)
    .map(([k, v]) => ({ field: fieldName(k), from: '', to: showVal(v) }));
}

const ACTION = { INSERT: ['Added', 'in'], UPDATE: ['Edited', 'neutral'], DELETE: ['Deleted', 'out'] };

function ActivityPage() {
  const me = useUser();
  const today = isoDay(new Date());
  const weekAgo = isoDay(Date.now() - 6 * 86400000);
  const [tab, setTab] = useState('online');
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [who, setWho] = useState('');
  const [tableF, setTableF] = useState('');
  const [hideMe, setHideMe] = useState(false);
  const [users, setUsers] = useState([]);
  const [drivers, setDrivers] = useState({});
  const [sessions, setSessions] = useState(null);
  const [events, setEvents] = useState([]);
  const [audit, setAudit] = useState([]);
  const [online, setOnline] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  // Opened from Users page: /activity?u=<user id> shows that user's logins
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('u');
    if (u) { setWho(u); setTab('logins'); setFrom(isoDay(Date.now() - 29 * 86400000)); }
  }, []);

  // Users and drivers (for names)
  useEffect(() => {
    sb().rpc('admin_list_users').then(({ data }) => setUsers(data || []));
    sb().from('transport_drivers').select('id, name').then(({ data }) => {
      const m = {};
      (data || []).forEach((d) => { m[d.id] = d.name; });
      setDrivers(m);
    });
  }, []);

  const load = useCallback(async () => {
    setError('');
    const start = new Date(`${from || weekAgo}T00:00:00`).toISOString();
    const end = new Date(`${to || today}T23:59:59.999`).toISOString();
    let sq = sb().from('user_sessions').select('*').lte('started_at', end).gte('last_seen', start).order('started_at', { ascending: false }).limit(1000);
    let aq = sb().from('audit_log').select('*').gte('at', start).lte('at', end).order('at', { ascending: false }).limit(3000);
    if (who) { sq = sq.eq('user_id', who); aq = aq.eq('user_id', who); }
    const [s, a] = await Promise.all([sq, aq]);
    if (s.error) { setError(s.error.message.includes('does not exist') ? 'The activity tables are not set up yet. Run supabase/activity.sql in Supabase first.' : s.error.message); setSessions([]); return; }
    const ss = s.data || [];
    const ids = ss.map((x) => x.id);
    let ev = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await sb().from('user_events').select('*').in('session_id', ids.slice(i, i + 150)).order('at').limit(10000);
      ev = ev.concat(data || []);
    }
    setSessions(ss);
    setEvents(ev);
    setAudit(a.data || []);
  }, [from, to, who, weekAgo, today]);

  const loadOnline = useCallback(async () => {
    const since = new Date(Date.now() - ONLINE_MS).toISOString();
    const { data } = await sb().from('user_sessions').select('*').is('ended_at', null).gte('last_seen', since).order('started_at');
    const list = data || [];
    if (!list.length) { setOnline([]); return; }
    const { data: ev } = await sb().from('user_events').select('*').in('session_id', list.map((x) => x.id)).order('at', { ascending: false }).limit(500);
    setOnline(list.map((s) => {
      const mine = (ev || []).filter((e) => e.session_id === s.id);
      const lastPage = mine.find((e) => e.kind === 'page');
      return { ...s, lastPage, lastEvent: mine[0], pages: mine.filter((e) => e.kind === 'page').length };
    }));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadOnline();
    const t = setInterval(() => { loadOnline(); setTick((x) => x + 1); }, 30000);
    return () => clearInterval(t);
  }, [loadOnline]);

  const userName = useCallback((id, fallback) => {
    const u = users.find((x) => x.id === id);
    return u ? (u.display_name || u.username) : (fallback || 'Unknown');
  }, [users]);

  const nicePage = useCallback((path) => {
    let n = pageName(path);
    const m = String(path || '').match(/^\/transport\/(?:salary-sheet\/|salary\/)?([0-9a-f-]{36})/);
    if (m && drivers[m[1]]) n += ` (${drivers[m[1]]})`;
    return n;
  }, [drivers]);

  const visibleSessions = useMemo(() => (sessions || []).filter((s) => !(hideMe && s.user_id === me.id)), [sessions, hideMe, me.id]);
  const visibleAudit = useMemo(() => audit.filter((a) => !(hideMe && a.user_id === me.id) && (!tableF || a.table_name === tableF)), [audit, hideMe, me.id, tableF]);

  // Build each session: end time, duration, pages with time spent, clicks, changes
  const built = useMemo(() => visibleSessions.map((s) => {
    const isOnline = !s.ended_at && Date.now() - new Date(s.last_seen).getTime() < ONLINE_MS;
    const endAt = isOnline ? new Date() : new Date(s.ended_at || s.last_seen);
    const evs = events.filter((e) => e.session_id === s.id);
    const pages = [];
    evs.forEach((e) => {
      if (e.kind === 'page') pages.push({ ...e, clicks: [] });
      else if (pages.length) pages[pages.length - 1].clicks.push(e);
      else pages.push({ at: e.at, path: e.path, label: '', clicks: [e] });
    });
    pages.forEach((p, i) => {
      const next = pages[i + 1] ? new Date(pages[i + 1].at) : endAt;
      p.ms = next - new Date(p.at);
    });
    const startT = new Date(s.started_at).getTime();
    const changes = audit.filter((a) => a.user_id === s.user_id && new Date(a.at).getTime() >= startT - 5000 && new Date(a.at).getTime() <= endAt.getTime() + 60000);
    return {
      ...s, isOnline, endAt, ms: endAt - new Date(s.started_at), pages,
      clicks: evs.filter((e) => e.kind !== 'page').length, changes
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visibleSessions, events, audit, tick]);

  // Per-user totals for the period
  const perUser = useMemo(() => {
    const m = {};
    built.forEach((s) => {
      const k = s.user_id;
      if (!m[k]) m[k] = { id: k, name: userName(k, s.display_name), role: s.role, logins: 0, ms: 0, pages: 0, changes: 0, last: s.last_seen };
      m[k].logins += 1; m[k].ms += s.ms; m[k].pages += s.pages.length;
      if (new Date(s.last_seen) > new Date(m[k].last)) m[k].last = s.last_seen;
    });
    visibleAudit.forEach((a) => { if (a.user_id && m[a.user_id]) m[a.user_id].changes += 1; });
    return Object.values(m).sort((a, b) => b.ms - a.ms);
  }, [built, visibleAudit, userName]);

  const changeCount = visibleAudit.length;
  const byOthers = visibleAudit.filter((a) => a.user_id !== me.id).length;

  async function doExcel() {
    await exportExcel(`User activity ${exportStamp()}.xlsx`, [
      {
        name: 'Logins', title: 'User activity: logins', subtitle: `${dmy(from)} to ${dmy(to)}`,
        head: ['User', 'Access', 'Device', 'Date', 'From', 'To', 'Time stayed', 'Pages', 'Buttons', 'Changes'],
        widths: [18, 14, 18, 12, 9, 12, 13, 8, 9, 9],
        rows: built.map((s) => [userName(s.user_id, s.display_name), ROLES[s.role]?.label || s.role, s.device || '', dmy(s.started_at), hm(s.started_at), s.isOnline ? 'Online now' : hm(s.endAt), dur(s.ms), s.pages.length, s.clicks, s.changes.length])
      },
      {
        name: 'Pages', title: 'User activity: pages and buttons', subtitle: `${dmy(from)} to ${dmy(to)}`,
        head: ['User', 'Date', 'Time', 'Page', 'Time on page', 'Buttons pressed'],
        widths: [18, 12, 9, 34, 13, 70],
        rows: built.flatMap((s) => s.pages.map((p) => [userName(s.user_id, s.display_name), dmy(p.at), hm(p.at), nicePage(p.path), dur(p.ms), p.clicks.map((c) => c.label).join(' | ')]))
      },
      {
        name: 'Changes', title: 'User activity: data changes', subtitle: `${dmy(from)} to ${dmy(to)}`,
        head: ['User', 'Date', 'Time', 'Action', 'Where', 'Record', 'What changed'],
        widths: [18, 12, 9, 10, 24, 34, 80],
        rows: visibleAudit.map((a) => [a.username || userName(a.user_id), dmy(a.at), hms(a.at), ACTION[a.action]?.[0] || a.action, TABLES[a.table_name] || a.table_name, rowTitle(a, drivers),
          changeLines(a).map((l) => (l.from ? `${l.field}: ${l.from} → ${l.to}` : `${l.field}: ${l.to}`)).join(' | ')])
      }
    ]);
  }

  async function doPdf() {
    await exportPdf(`User activity ${exportStamp()}.pdf`, {
      title: 'User activity',
      subtitle: `${dmy(from)} to ${dmy(to)}${who ? ` · ${userName(who)}` : ''}`,
      sections: [
        { heading: 'Summary by user', head: ['User', 'Access', 'Logins', 'Time in app', 'Pages', 'Changes', 'Last seen'],
          rows: perUser.map((u) => [u.name, ROLES[u.role]?.label || u.role, u.logins, dur(u.ms), u.pages, u.changes, `${dmy(u.last)} ${hm(u.last)}`]) },
        { heading: 'Logins', head: ['User', 'Date', 'From', 'To', 'Time stayed', 'Pages visited'],
          rows: built.map((s) => [userName(s.user_id, s.display_name), dmy(s.started_at), hm(s.started_at), s.isOnline ? 'Online' : hm(s.endAt), dur(s.ms),
            s.pages.map((p) => `${nicePage(p.path)} (${dur(p.ms)})`).join(', ').slice(0, 400)]) },
        { heading: 'Data changes', head: ['User', 'Date', 'Time', 'Action', 'Where', 'Record', 'What changed'],
          rows: visibleAudit.map((a) => [a.username || userName(a.user_id), dmy(a.at), hm(a.at), ACTION[a.action]?.[0] || a.action, TABLES[a.table_name] || a.table_name, rowTitle(a, drivers),
            changeLines(a).slice(0, 6).map((l) => (l.from ? `${l.field}: ${l.from} → ${l.to}` : `${l.field}: ${l.to}`)).join('; ')]) }
      ]
    });
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <Link href="/users" className="crumb">👥 Users</Link>
      </div>
      <div>
        <h1>{who ? `Activity of ${userName(who)}` : 'User activity'}</h1>
        <p className="sub">Who is online, when they came and left, which pages they opened, what they pressed and every change they made.</p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="kpi-row">
        <div className="kpi"><span>Online now</span><strong>{online.length}</strong><small>{online.map((o) => userName(o.user_id, o.display_name)).join(', ') || 'Nobody'}</small></div>
        <div className="kpi"><span>Logins in period</span><strong>{built.length}</strong><small>{perUser.length} users</small></div>
        <div className="kpi"><span>Data changes</span><strong>{changeCount}</strong><small>{byOthers} by other users</small></div>
        <div className="kpi"><span>Time in app</span><strong>{dur(built.reduce((t, s) => t + s.ms, 0))}</strong><small>all users together</small></div>
      </div>

      <section className="panel act-filters">
        <div className="field">
          <label htmlFor="act-user">User</label>
          <select id="act-user" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username} ({ROLES[u.role]?.short || u.role})</option>)}
          </select>
        </div>
        <div className="field"><label>From</label><DateInput value={from} onChange={setFrom} /></div>
        <div className="field"><label>To</label><DateInput value={to} onChange={setTo} /></div>
        <div className="act-quick">
          <button type="button" className="btn small ghost" onClick={() => { setFrom(today); setTo(today); }}>Today</button>
          <button type="button" className="btn small ghost" onClick={() => { setFrom(weekAgo); setTo(today); }}>7 days</button>
          <button type="button" className="btn small ghost" onClick={() => { setFrom(isoDay(Date.now() - 29 * 86400000)); setTo(today); }}>30 days</button>
        </div>
        <label className="check"><input type="checkbox" checked={hideMe} onChange={(e) => setHideMe(e.target.checked)} /> Hide my own activity</label>
        <div className="toolbar-actions">
          <button type="button" className="btn small" onClick={() => { load(); loadOnline(); }}>↻ Refresh</button>
          <button type="button" className="btn small" onClick={doExcel}>📗 Excel</button>
          <button type="button" className="btn small" onClick={doPdf}>📕 PDF</button>
        </div>
      </section>

      <div className="act-tabs" role="tablist">
        {[['online', `🟢 Online now (${online.length})`], ['logins', `🕘 Logins (${built.length})`], ['users', `👤 By user (${perUser.length})`], ['changes', `✏️ Changes (${changeCount})`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`act-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'online' && (
        <section className="panel">
          <h2>Online now <span className="note">(updates every 30 seconds)</span></h2>
          {!online.length ? <p className="empty">Nobody is online right now.</p> : (
            <div className="act-online">
              {online.map((o) => (
                <div key={o.id} className="act-card">
                  <div className="act-card-top"><span className="act-dot" /> <b>{userName(o.user_id, o.display_name)}</b> <span className={`role-badge r-${o.role}`}>{ROLES[o.role]?.short || o.role}</span>{o.user_id === me.id && <span className="pill neutral">You</span>}</div>
                  <div>On: <b>{o.lastPage ? nicePage(o.lastPage.path) : 'Opening...'}</b></div>
                  <div className="muted">Since {hm(o.started_at)} ({dur(Date.now() - new Date(o.started_at))}) · {o.pages} pages · {o.device}</div>
                  {o.lastEvent && o.lastEvent.kind !== 'page' && <div className="muted">Last pressed: {o.lastEvent.label} ({ago(o.lastEvent.at)})</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'users' && (
        <section className="panel">
          <h2>By user</h2>
          {!perUser.length ? <p className="empty">No activity in this period.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>User</th><th>Access</th><th className="num">Logins</th><th className="num">Time in app</th><th className="num">Pages</th><th className="num">Changes</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {perUser.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b></td>
                    <td><span className={`role-badge r-${u.role}`}>{ROLES[u.role]?.label || u.role}</span></td>
                    <td className="num">{u.logins}</td><td className="num">{dur(u.ms)}</td><td className="num">{u.pages}</td>
                    <td className="num">{u.changes ? <b>{u.changes}</b> : 0}</td>
                    <td>{dmy(u.last)} {hm(u.last)}</td>
                    <td><button type="button" className="mini" onClick={() => { setWho(u.id); setTab('logins'); }}>Show logins</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'logins' && (
        <section className="panel">
          <h2>Logins <span className="note">(tap a row to see pages, buttons and changes)</span></h2>
          {sessions === null ? <p className="empty">Loading...</p> : !built.length ? <p className="empty">No logins in this period.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>User</th><th>Date</th><th>From</th><th>To</th><th className="num">Time stayed</th><th className="num">Pages</th><th className="num">Buttons</th><th className="num">Changes</th><th>Device</th></tr></thead>
              <tbody>
                {built.map((s) => (
                  <Fragment key={s.id}>
                    <tr className={`act-row${open === s.id ? ' open' : ''}`} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      <td><b>{userName(s.user_id, s.display_name)}</b> <span className={`role-badge r-${s.role}`}>{ROLES[s.role]?.short || s.role}</span></td>
                      <td>{dmy(s.started_at)}</td>
                      <td>{hm(s.started_at)}</td>
                      <td>{s.isOnline ? <span className="pill in">🟢 Online</span> : <>{hm(s.endAt)} <small className="muted">{s.end_reason === 'logout' ? 'logged out' : 'closed'}</small></>}</td>
                      <td className="num">{dur(s.ms)}</td>
                      <td className="num">{s.pages.length}</td>
                      <td className="num">{s.clicks}</td>
                      <td className="num">{s.changes.length ? <span className="pill out">{s.changes.length}</span> : 0}</td>
                      <td className="muted">{s.device}</td>
                    </tr>
                    {open === s.id && (
                      <tr className="act-detail"><td colSpan={9}>
                        <div className="act-timeline">
                          <div className="act-tl-item start">🔑 Logged in at {hms(s.started_at)} on {s.device}</div>
                          {s.pages.map((p, i) => {
                            const pStart = new Date(p.at).getTime();
                            const pEnd = pStart + p.ms;
                            const pChanges = s.changes.filter((c) => { const t = new Date(c.at).getTime(); return t >= pStart && (t < pEnd || i === s.pages.length - 1); });
                            return (
                              <div key={p.id || i} className="act-tl-item">
                                <div><b>{hm(p.at)}</b> 📄 {nicePage(p.path)} <span className="muted">· {dur(p.ms)}</span></div>
                                {p.clicks.map((c) => <div key={c.id} className="act-tl-sub">{hms(c.at)} · {c.kind === 'action' ? '⭐' : '👆'} {c.label}</div>)}
                                {pChanges.map((c) => (
                                  <div key={`a${c.id}`} className="act-tl-sub change">{hms(c.at)} · ✏️ {ACTION[c.action]?.[0]} {TABLES[c.table_name] || c.table_name}: {rowTitle(c, drivers)}
                                    {c.action === 'UPDATE' && <span className="muted"> ({changeLines(c).map((l) => `${l.field}: ${l.from} → ${l.to}`).join('; ')})</span>}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                          <div className="act-tl-item end">{s.isOnline ? '🟢 Still online' : `🚪 ${s.end_reason === 'logout' ? 'Logged out' : 'Left'} at ${hms(s.endAt)}`} · stayed {dur(s.ms)}</div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'changes' && (
        <section className="panel">
          <h2>Data changes</h2>
          <div className="act-filters inline">
            <div className="field">
              <label htmlFor="act-table">Where</label>
              <select id="act-table" value={tableF} onChange={(e) => setTableF(e.target.value)}>
                <option value="">Everywhere</option>
                {Object.entries(TABLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          {!visibleAudit.length ? <p className="empty">No changes in this period.</p> : (
            <div className="act-changes">
              {visibleAudit.map((a) => {
                const lines = changeLines(a);
                return (
                  <div key={a.id} className={`act-change a-${a.action.toLowerCase()}`}>
                    <div className="act-change-top">
                      <span className={`pill ${ACTION[a.action]?.[1]}`}>{ACTION[a.action]?.[0]}</span>
                      <b>{TABLES[a.table_name] || a.table_name}</b>
                      <span>{rowTitle(a, drivers)}</span>
                      <span className="act-change-who">{a.username || userName(a.user_id)} {a.role && <span className={`role-badge r-${a.role}`}>{ROLES[a.role]?.short || a.role}</span>} · {dmy(a.at)} {hms(a.at)}</span>
                    </div>
                    {lines.length > 0 && (
                      <table className="act-diff"><tbody>
                        {lines.map((l) => (
                          <tr key={l.field}><th>{l.field}</th>{a.action === 'UPDATE' ? <><td className="old">{l.from}</td><td>→</td><td className="new">{l.to}</td></> : <td colSpan={3} className={a.action === 'DELETE' ? 'old' : 'new'}>{l.to}</td>}</tr>
                        ))}
                      </tbody></table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {audit.length >= 3000 && <p className="note">Showing the latest 3,000 changes. Pick fewer days or one user to see older ones.</p>}
        </section>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate ownerOnly wide><ActivityPage /></AuthGate>;
}
