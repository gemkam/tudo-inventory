'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { requestEditPassword, lockEdit } from '@/lib/editLock';
import { RuleTable, TextTable } from '@/components/LookEditor';
import { LOOK_KEY, LOOK_CACHE, EMPTY_LOOK, parseLook } from '@/lib/look';

/*
  🛠 Power Editor (Admin > Power Editor, Administrator only, edit password 728300).
  Edits EVERY data table of the app directly: change any cell, add, copy, delete rows, find and replace, ↶ Undo.
  Table + column list comes from RPC public.power_tables() (is_admin only). The database rules still apply; Administrator
  may write to all data tables. Not listed: activity logs (audit_log, user_events, user_sessions), per-user alert closes,
  phone push subscriptions. Logins are on Users.
  Auto lines in All Companies (exp_entries with source): they are rebuilt from where they came from, so they are NOT
  edited here; "🔗 Open source" opens the trip / salary / receipt / maintenance row and that is changed instead (Kamran 2 Nov 2026).
  Tabs 🎨 Styles, 📐 Layout, ✏️ Texts: the app's look for every user (lib/look.js, components/LookEditor.js, LookApplier.js).
  No UUIDs on screen (Kamran 2 Nov 2026): row ids and technical ids are hidden; links to other tables (driver_id,
  vehicle_id, staff_id, person_id ...) show the name and are changed with a drop-down.
*/

const NAMES = {
  items: ['Inventory', 'Items'], categories: ['Inventory', 'Categories'], stock_moves: ['Inventory', 'Stock log'],
  bill_accounts: ['Inventory', 'Bills (accounts)'], bill_payments: ['Inventory', 'Bills (payments)'],
  transport_drivers: ['Transport', 'Drivers'], transport_entries: ['Transport', 'Trips (trip sheets)'],
  transport_salaries: ['Transport', 'Driver salaries'], transport_extras: ['Transport', 'Other transport expenses'],
  transport_vehicles: ['Transport', 'Vehicles'], vehicle_maintenance: ['Transport', 'Vehicle maintenance'],
  transport_invoices: ['Transport', 'Transport invoices'], transport_profit_taken: ['Transport', 'Profit taken'],
  entry_links: ['Transport', 'Data entry share links'],
  exp_entries: ['All Companies', 'Bills / expenses'], company_docs: ['All Companies', 'Invoices and payment receipts'],
  exp_budgets: ['All Companies', 'Budgets'], exp_staff: ['Employees', 'Office / site staff'],
  exp_attendance: ['Employees', 'Attendance marks'], personnel_subcontractors: ['Employees', 'Subcontractors'],
  personnel_companies: ['Employees', 'Added companies'], salary_slips: ['Salary', 'Salary slips'],
  salary_credits: ['Salary', 'Salary credited'], doc_checklist: ['Documents', 'Documents checklist'],
  app_labels: ['Settings', 'Renamed labels'], app_settings: ['Settings', 'App settings']
};
const GROUPS = ['All Companies', 'Transport', 'Employees', 'Salary', 'Inventory', 'Documents', 'Settings', 'Other'];
const SOURCE_KIND = { trip: 'trip', salary: 'driver salary', extra: 'transport expense', maint: 'vehicle maintenance', receipt: 'payment receipt' };
const PAGE = 200;

/* technical uuid columns nobody needs to see */
const HIDE = new Set(['slip_token', 'user_id', 'updated_by', 'created_by', 'session_id', 'source_id']);
/* links to other tables: shown by name */
const FK = {
  driver_id: { t: 'transport_drivers', label: (r) => r.name },
  vehicle_id: { t: 'transport_vehicles', label: (r) => [r.name, r.plate_no].filter(Boolean).join(' · ') },
  staff_id: { t: 'exp_staff', label: (r) => r.name },
  category_id: { t: 'categories', label: (r) => r.name },
  item_id: { t: 'items', label: (r) => r.name },
  account_id: { t: 'bill_accounts', label: (r) => r.name },
  allowance_salary_id: { t: 'transport_salaries', label: (r, L) => `${L.transport_drivers?.[r.driver_id]?.label || 'Driver'} · salary ${String(r.month || '').slice(0, 7)}` },
  person_id: { t: (row) => (row?.person_kind === 'driver' ? 'transport_drivers' : 'exp_staff'), label: (r) => r.name }
};
const fkTable = (col, row) => { const f = FK[col]; return f ? (typeof f.t === 'function' ? f.t(row) : f.t) : null; };

const isNum = (t) => /integer|numeric|double|real|bigint|smallint/.test(t);
const isText = (t) => /text|character/.test(t);
const isJson = (t) => /json|ARRAY/.test(t);
const nameOf = (t) => NAMES[t]?.[1] || t;
const groupOf = (t) => NAMES[t]?.[0] || 'Other';

function show(v) {
  if (v === null || v === undefined) return <span className="muted">–</span>;
  if (typeof v === 'boolean') return v ? '✓ yes' : '✗ no';
  if (typeof v === 'object') { const s = JSON.stringify(v); return <span className="pw-json" title={s}>{s.length > 80 ? `${s.slice(0, 80)}…` : s}</span>; }
  const s = String(v);
  return s.length > 90 ? <span title={s}>{s.slice(0, 90)}…</span> : s;
}

function toInput(v, type) {
  if (v === null || v === undefined) return '';
  if (isJson(type)) return JSON.stringify(v, null, 2);
  return String(v);
}

/* text from the box -> value for the database; throws a plain message when it does not fit the column */
function parse(text, col) {
  const t = col.type;
  const s = String(text ?? '');
  if (s.trim() === '') return null;
  if (isNum(t)) { const n = Number(s.replace(/,/g, '')); if (!Number.isFinite(n)) throw new Error(`${col.name}: type a number`); return n; }
  if (t === 'boolean') return /^(true|yes|1|✓)/i.test(s.trim());
  if (isJson(t)) { try { return JSON.parse(s); } catch { throw new Error(`${col.name}: not valid JSON`); } }
  if (t === 'date') {
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/mm/yyyy too
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.trim();
  }
  return s;
}

function PowerEditor() {
  const { isOwner } = useUser();
  const [ok, setOk] = useState(false);
  const [meta, setMeta] = useState(null);
  const [counts, setCounts] = useState({});
  const [tname, setTname] = useState('');
  const [rows, setRows] = useState(null);
  const [only, setOnly] = useState(null); // { col, val, why } filter after "Open source"
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(null); // { col, dir }
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState([]);
  const [cell, setCell] = useState(null); // { row, col, text }
  const [form, setForm] = useState(null); // add / copy row: { vals }
  const [rep, setRep] = useState(null); // find & replace: { col, find, to, cases }
  const [del, setDel] = useState(false);
  const [undo, setUndo] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('data'); // data | styles | layout | texts
  const [look, setLook] = useState(EMPTY_LOOK);
  const [lookSaved, setLookSaved] = useState(JSON.stringify(EMPTY_LOOK));
  const [lookUndo, setLookUndo] = useState([]);
  const [lookups, setLookups] = useState({}); // { table: { id: { label, row } } }
  const timer = useRef(null);

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // password first, every visit
  useEffect(() => {
    let live = true;
    // wait one tick so the password box (rendered after the page by AuthGate) is listening
    const t = setTimeout(() => requestEditPassword().then((yes) => { if (live) setOk(!!yes); }), 50);
    return () => { live = false; clearTimeout(t); lockEdit(); };
  }, []);

  useEffect(() => {
    if (!ok) return;
    sb().from('app_settings').select('value').eq('key', LOOK_KEY).maybeSingle().then(({ data }) => {
      const L = parseLook(data?.value || '{}');
      setLook(L); setLookSaved(JSON.stringify(L));
    });
  }, [ok]);

  /* names for the link columns of every table */
  useEffect(() => {
    if (!ok) return;
    const L = {};
    const need = [
      ['transport_drivers', 'id, name', (r) => r.name], ['transport_vehicles', 'id, name, plate_no', FK.vehicle_id.label],
      ['exp_staff', 'id, name', (r) => r.name], ['categories', 'id, name', (r) => r.name], ['items', 'id, name', (r) => r.name],
      ['bill_accounts', 'id, name', (r) => r.name], ['transport_salaries', 'id, driver_id, month', null]
    ];
    Promise.all(need.map(([t, sel]) => sb().from(t).select(sel).limit(5000))).then((res) => {
      res.forEach((r, i) => { const [t] = need[i]; L[t] = {}; (r.data || []).forEach((x) => { L[t][x.id] = { row: x }; }); });
      need.forEach(([t, , fn]) => { Object.values(L[t]).forEach((v) => { v.label = fn ? fn(v.row) : FK.allowance_salary_id.label(v.row, L); }); });
      setLookups(L);
    });
  }, [ok, undo.length]);

  useEffect(() => {
    if (!ok) return;
    sb().rpc('power_tables').then(async ({ data, error }) => {
      if (error) { flash(error.message, 'err'); setMeta([]); return; }
      const list = (data || []).filter((t) => (t.pk || []).length);
      setMeta(list);
      const c = {};
      await Promise.all(list.map(async (t) => {
        const r = await sb().from(t.name).select('*', { count: 'exact', head: true });
        c[t.name] = r.count ?? '?';
      }));
      setCounts(c);
      let start = '';
      try { start = new URLSearchParams(window.location.search).get('t') || localStorage.getItem('tudo-power-table') || ''; } catch { /* ignore */ }
      setTname(list.some((t) => t.name === start) ? start : 'exp_entries');
    });
  }, [ok, flash]);

  const T = useMemo(() => (meta || []).find((t) => t.name === tname), [meta, tname]);
  const pk = T?.pk || [];
  const allCols = T?.cols || [];
  const hiddenCol = (c) => c.type === 'uuid' && !FK[c.name]; // row ids, tokens, user ids (HIDE) are never shown
  const cols = allCols.filter((c) => !hiddenCol(c));
  const fkLabel = (col, row) => {
    const t = fkTable(col, row); const v = row[col];
    if (v === null || v === undefined || v === '') return null;
    return lookups[t]?.[v]?.label || '(not found)';
  };
  const fkOptions = (col, row) => Object.entries(lookups[fkTable(col, row)] || {}).map(([id, x]) => [id, x.label]).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const colOf = (name) => allCols.find((c) => c.name === name);
  const keyOf = (r) => pk.map((k) => String(r[k])).join('|');
  const isAuto = (r) => tname === 'exp_entries' && !!r.source;

  const load = useCallback(async () => {
    if (!T) return;
    const has = (c) => T.cols.some((x) => x.name === c);
    let qy = sb().from(T.name).select('*');
    if (only) qy = qy.eq(only.col, only.val);
    qy = has('created_at') ? qy.order('created_at', { ascending: false }) : qy.order(T.pk[0]);
    const { data, error } = await qy.limit(10000);
    if (error) { flash(error.message, 'err'); setRows([]); return; }
    setRows(data || []);
  }, [T, only, flash]);

  useEffect(() => { setRows(null); setPicked([]); setLimit(PAGE); load(); }, [load]);
  useEffect(() => { if (tname) { try { localStorage.setItem('tudo-power-table', tname); window.history.replaceState(null, '', `/admin/power?t=${tname}`); } catch { /* ignore */ } } }, [tname]);

  function pickTable(name) { setOnly(null); setSort(null); setQ(''); setTname(name); }

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    let list = rows || [];
    if (words.length) list = list.filter((r) => { const h = `${JSON.stringify(r)} ${cols.filter((c) => FK[c.name]).map((c) => fkLabel(c.name, r) || '').join(' ')}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    if (sort) {
      const c = colOf(sort.col);
      list = [...list].sort((a, b) => {
        const x = FK[sort.col] ? fkLabel(sort.col, a) : a[sort.col]; const y = FK[sort.col] ? fkLabel(sort.col, b) : b[sort.col];
        if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
        const d = c && isNum(c.type) ? Number(x) - Number(y) : String(typeof x === 'object' ? JSON.stringify(x) : x).localeCompare(String(typeof y === 'object' ? JSON.stringify(y) : y));
        return sort.dir === 'asc' ? d : -d;
      });
    }
    return list;
  }, [rows, q, sort, T, lookups]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushUndo = (label, run) => setUndo((u) => [...u.slice(-49), { label, run, table: tname }]);
  const match = (qy, r) => { let x = qy; for (const k of pk) x = x.eq(k, r[k]); return x; };

  async function doUndo() {
    const step = undo[undo.length - 1];
    if (!step || busy) return;
    setBusy(true);
    const err = await step.run().then(() => '').catch((e) => e.message);
    setBusy(false);
    if (err) { flash(`Undo failed: ${err}`, 'err'); return; }
    setUndo((u) => u.slice(0, -1));
    if (step.table !== tname) pickTable(step.table); else load();
    flash(`↶ Undone: ${step.label}`);
  }

  /* ---------- change one cell ---------- */
  async function saveCell(asNull = false) {
    const { row, col } = cell;
    const c = colOf(col);
    let val;
    try { val = asNull ? null : FK[col] ? (cell.text || null) : parse(cell.text, c); } catch (e) { flash(e.message, 'err'); return; }
    setBusy(true);
    const { data, error } = await match(sb().from(tname).update({ [col]: val }), row).select();
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    if (!data || !data.length) { flash('Nothing changed (row not found or not allowed).', 'err'); return; }
    const old = row[col]; const t = tname; const keys = Object.fromEntries(pk.map((k) => [k, row[k]]));
    pushUndo(`${nameOf(t)} · ${col}`, async () => {
      let x = sb().from(t).update({ [col]: old }); for (const k of Object.keys(keys)) x = x.eq(k, keys[k]);
      const { error: e } = await x; if (e) throw new Error(e.message);
    });
    setCell(null); load();
    flash(`Saved ${col}`);
  }

  /* ---------- add / copy ---------- */
  function openAdd(copyFrom = null) {
    const vals = {};
    for (const c of allCols) {
      if (copyFrom && !pk.includes(c.name) && !['created_at', 'updated_at'].includes(c.name)) vals[c.name] = toInput(copyFrom[c.name], c.type);
      else vals[c.name] = '';
    }
    if (copyFrom && pk.some((k) => !colOf(k)?.def)) pk.forEach((k) => { vals[k] = toInput(copyFrom[k], colOf(k)?.type); });
    setForm({ vals, copy: !!copyFrom });
  }
  async function saveAdd() {
    const row = {};
    try {
      for (const c of allCols) { const s = form.vals[c.name]; if (s !== '' && s !== undefined) row[c.name] = parse(s, c); }
    } catch (e) { flash(e.message, 'err'); return; }
    setBusy(true);
    const { data, error } = await sb().from(tname).insert(row).select();
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    const made = data?.[0]; const t = tname; const keys = made ? Object.fromEntries(pk.map((k) => [k, made[k]])) : null;
    if (keys) pushUndo(`add row in ${nameOf(t)}`, async () => {
      let x = sb().from(t).delete(); for (const k of Object.keys(keys)) x = x.eq(k, keys[k]);
      const { error: e } = await x; if (e) throw new Error(e.message);
    });
    setForm(null); load(); setCounts((c) => ({ ...c, [t]: (Number(c[t]) || 0) + 1 }));
    flash('Row added');
  }

  /* ---------- delete ---------- */
  async function doDelete() {
    const list = (rows || []).filter((r) => picked.includes(keyOf(r)));
    const autos = list.filter(isAuto);
    if (autos.length) { flash(`${autos.length} Auto line(s) cannot be deleted here: delete them at their source (🔗 Open source).`, 'err'); return; }
    setBusy(true);
    let done = []; let err = '';
    for (const r of list) {
      const { error } = await match(sb().from(tname).delete(), r);
      if (error) { err = error.message; break; }
      done.push(r);
    }
    setBusy(false);
    const t = tname; const back = done;
    if (back.length) pushUndo(`delete ${back.length} in ${nameOf(t)}`, async () => {
      const { error: e } = await sb().from(t).insert(back); if (e) throw new Error(e.message);
    });
    setDel(false); setPicked([]); load(); setCounts((c) => ({ ...c, [t]: Math.max(0, (Number(c[t]) || 0) - back.length) }));
    if (err) flash(`${back.length} deleted. Stopped: ${err}`, 'err'); else flash(`${back.length} deleted`);
  }

  /* ---------- find and replace (text columns) ---------- */
  const textCols = cols.filter((c) => isText(c.type) && !pk.includes(c.name));
  const repPlan = useMemo(() => {
    if (!rep || !rep.find) return [];
    const targets = rep.col === '*' ? textCols.map((c) => c.name) : [rep.col];
    const esc = rep.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, rep.cases ? 'g' : 'gi');
    const base = rep.onlyShown ? shown : rows || [];
    const plan = [];
    for (const r of base) {
      if (isAuto(r)) continue;
      const change = {};
      for (const k of targets) { const v = r[k]; if (typeof v === 'string' && re.test(v)) { re.lastIndex = 0; change[k] = v.replace(re, rep.to); } re.lastIndex = 0; }
      if (Object.keys(change).length) plan.push({ r, change });
    }
    return plan;
  }, [rep, rows, shown, T]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doReplace() {
    setBusy(true);
    const done = []; let err = '';
    for (const { r, change } of repPlan) {
      const { error } = await match(sb().from(tname).update(change), r);
      if (error) { err = error.message; break; }
      done.push({ keys: Object.fromEntries(pk.map((k) => [k, r[k]])), old: Object.fromEntries(Object.keys(change).map((k) => [k, r[k]])) });
    }
    setBusy(false);
    const t = tname;
    if (done.length) pushUndo(`replace in ${done.length} rows of ${nameOf(t)}`, async () => {
      for (const d of done) {
        let x = sb().from(t).update(d.old); for (const k of Object.keys(d.keys)) x = x.eq(k, d.keys[k]);
        const { error: e } = await x; if (e) throw new Error(e.message);
      }
    });
    setRep(null); load();
    if (err) flash(`${done.length} rows changed. Stopped: ${err}`, 'err'); else flash(`Replaced in ${done.length} rows`);
  }

  /* ---------- look: styles, layout, texts ---------- */
  const preview = (L) => window.dispatchEvent(new CustomEvent('tudo-look-preview', { detail: L }));
  function changeLook(kind, list) {
    setLookUndo((u) => [...u.slice(-49), look]);
    const next = { ...look, [kind]: list };
    setLook(next); preview(next);
  }
  function undoLook() {
    const prev = lookUndo[lookUndo.length - 1];
    if (!prev) return;
    setLookUndo((u) => u.slice(0, -1));
    setLook(prev); preview(prev);
    flash('↶ Undone');
  }
  function discardLook() {
    const L = parseLook(lookSaved);
    setLookUndo((u) => [...u.slice(-49), look]);
    setLook(L); preview(L);
  }
  async function saveLook() {
    setBusy(true);
    const value = JSON.stringify(look);
    const { error } = await sb().from('app_settings').upsert({ key: LOOK_KEY, value, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    setLookSaved(value);
    try { localStorage.setItem(LOOK_CACHE, value); } catch { /* ignore */ }
    flash('Saved. Everyone sees it on their next page.');
  }
  const lookDirty = JSON.stringify(look) !== lookSaved;

  function openSource(r) {
    const t = r.source;
    if (!(meta || []).some((x) => x.name === t)) { flash(`Source table ${t} is not editable here.`, 'err'); return; }
    setSort(null); setQ(''); setTname(t);
    setOnly({ col: 'id', val: r.source_id, why: `Source of the All Companies line "${r.description || r.bill_no || ''}" (${SOURCE_KIND[r.source_kind] || r.source_kind})` });
  }

  if (!isOwner) return <p>Administrator only.</p>;
  if (!ok) return (
    <div className="pw-lock">
      <h1>🛠 Power Editor</h1>
      <p className="sub">Type the edit password to open it.</p>
      <button type="button" className="btn" onClick={async () => setOk(await requestEditPassword())}>🔑 Enter password</button>
    </div>
  );
  if (!meta) return <div className="loading">Loading tables...</div>;

  const grouped = GROUPS.map((g) => [g, meta.filter((t) => groupOf(t.name) === g)]).filter(([, l]) => l.length);
  const allPicked = shown.length > 0 && shown.slice(0, limit).every((r) => picked.includes(keyOf(r)));

  return (
    <>
      <div className="company-head ch-top">
        <span className="company-name">Admin · Administrator only</span>
        <h1>🛠 Power Editor</h1>
        <p className="sub">Edit, change, replace and delete anything in the app. Every change can be undone with ↶ Undo until you leave this page.</p>
      </div>

      <div className="pw-tabs" role="tablist">
        {[['data', '📋 Data'], ['styles', `🎨 Styles${look.styles.length ? ` (${look.styles.length})` : ''}`], ['layout', `📐 Layout${look.layout.length ? ` (${look.layout.length})` : ''}`], ['texts', `✏️ Texts and intro${look.texts.length ? ` (${look.texts.length})` : ''}`]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rp-chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab !== 'data' && (
        <div className="pw-look pw-noreplace">
          <div className="pw-bar">
            <b className="pw-title">{tab === 'styles' ? '🎨 Styles' : tab === 'layout' ? '📐 Layout' : '✏️ Texts and intro'} <small>for every user</small></b>
            <button type="button" className="btn ghost" disabled={!lookUndo.length} onClick={undoLook}>↶ Undo{lookUndo.length ? ` (${lookUndo.length})` : ''}</button>
            <button type="button" className="btn ghost" disabled={!lookDirty} onClick={discardLook}>✕ Back to saved</button>
            <button type="button" className="btn" disabled={!lookDirty || busy} onClick={saveLook}>{busy ? 'Saving...' : lookDirty ? '💾 Save for everyone' : '✓ Saved'}</button>
          </div>
          {lookDirty && <p className="di-warn" style={{ margin: 0 }}>You see the changes now. Others see them after 💾 Save. Leaving the page without saving drops them.</p>}
          {tab === 'texts'
            ? <TextTable list={look.texts} onChange={(l) => changeLook('texts', l)} />
            : <RuleTable kind={tab} list={look[tab]} onChange={(l) => changeLook(tab, l)} />}
        </div>
      )}

      {tab === 'data' && (
      <div className="pw-layout">
        <aside className="pw-tables">
          {grouped.map(([g, list]) => (
            <div key={g} className="pw-group">
              <div className="pw-gcap">{g}</div>
              {list.map((t) => (
                <button key={t.name} type="button" className={`pw-t${t.name === tname ? ' on' : ''}`} onClick={() => pickTable(t.name)}>
                  <span>{nameOf(t.name)}<small>{t.name}</small></span><em>{counts[t.name] ?? '…'}</em>
                </button>
              ))}
            </div>
          ))}
          <Link href="/users" className="pw-t pw-link"><span>👥 Users and logins<small>on the Users page</small></span><em>›</em></Link>
        </aside>

        <section className="pw-main">
          <div className="pw-bar">
            <b className="pw-title">{nameOf(tname)} <small>{tname}</small></b>
            <input type="search" className="iv-search" placeholder="Search every column" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
            <button type="button" className="btn" onClick={() => openAdd()}>＋ Add row</button>
            <button type="button" className="btn ghost" disabled={picked.length !== 1} onClick={() => openAdd((rows || []).find((r) => keyOf(r) === picked[0]))}>⧉ Copy row</button>
            <button type="button" className="btn ghost" disabled={!textCols.length} onClick={() => setRep({ col: '*', find: '', to: '', cases: false, onlyShown: !!q })}>🔁 Find and replace</button>
            <button type="button" className="btn ghost danger-text" disabled={!picked.length} onClick={() => setDel(true)}>🗑 Delete{picked.length ? ` (${picked.length})` : ''}</button>
            <button type="button" className="btn ghost" disabled={!undo.length || busy} onClick={doUndo} title={undo.length ? undo[undo.length - 1].label : 'Nothing to undo'}>↶ Undo{undo.length ? ` (${undo.length})` : ''}</button>
          </div>
          {only && <p className="di-warn pw-only">🔗 {only.why}. Change it here and the All Companies line follows. <button type="button" className="btn small ghost" onClick={() => setOnly(null)}>Show all rows</button></p>}
          {tname === 'exp_entries' && !only && <p className="muted pw-note">Lines marked 🔗 Auto are made from trips, salaries, receipts and maintenance: press 🔗 Open source to change them there.</p>}

          {rows === null ? <div className="loading">Loading...</div> : (
            <>
              <div className="pw-count muted">{shown.length} row{shown.length === 1 ? '' : 's'}{q ? ' found' : ''}{picked.length ? ` · ${picked.length} selected` : ''} · tap a cell to change it</div>
              <div className="pw-wrap">
                <table className="pw-grid">
                  <thead>
                    <tr>
                      <th className="pw-c"><input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setPicked(allPicked ? [] : shown.slice(0, limit).map(keyOf))} /></th>
                      {tname === 'exp_entries' && <th />}
                      {cols.map((c) => (
                        <th key={c.name} onClick={() => setSort((s) => (s?.col === c.name ? (s.dir === 'asc' ? { col: c.name, dir: 'desc' } : null) : { col: c.name, dir: 'asc' }))}>
                          {FK[c.name] ? c.name.replace(/_id$/, '').replace(/_/g, ' ') : c.name}{pk.includes(c.name) ? ' 🔑' : ''}{sort?.col === c.name ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          <small>{FK[c.name] ? 'name' : c.type.replace('timestamp with time zone', 'timestamp').replace('character varying', 'text')}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, limit).map((r) => {
                      const k = keyOf(r); const auto = isAuto(r);
                      return (
                        <tr key={k} className={`${picked.includes(k) ? 'on' : ''}${auto ? ' auto' : ''}`}>
                          <td className="pw-c"><input type="checkbox" aria-label="Select row" checked={picked.includes(k)} onChange={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} /></td>
                          {tname === 'exp_entries' && <td>{auto ? <button type="button" className="btn small ghost" onClick={() => openSource(r)}>🔗 Open source</button> : null}</td>}
                          {cols.map((c) => {
                            const lock = pk.includes(c.name) || auto;
                            if (FK[c.name]) {
                              const name = fkLabel(c.name, r);
                              return (
                                <td key={c.name} className={lock ? 'lock' : 'ed'} onClick={() => !lock && setCell({ row: r, col: c.name, text: r[c.name] || '' })} title={lock ? '' : 'Tap to change'}>
                                  {name === null ? <span className="muted">–</span> : name}
                                </td>
                              );
                            }
                            return (
                              <td key={c.name} className={lock ? 'lock' : 'ed'} onClick={() => !lock && setCell({ row: r, col: c.name, text: toInput(r[c.name], c.type) })}
                                title={auto ? 'Auto line: change it at its source' : pk.includes(c.name) ? 'Row key: cannot be changed' : 'Tap to change'}>
                                {show(r[c.name])}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {shown.length > limit && <button type="button" className="btn ghost pw-more" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button>}
            </>
          )}
        </section>
      </div>
      )}

      {cell && (() => {
        const c = colOf(cell.col);
        return (
          <Modal title={`Change ${cell.col}`} onClose={() => !busy && setCell(null)}>
            <p className="muted" style={{ margin: 0 }}>{nameOf(tname)} · {FK[cell.col] ? 'pick a name' : c.type}{c.null ? '' : ' · cannot be empty'}</p>
            {FK[cell.col] ? (
              <select className="pw-in" value={cell.text} onChange={(e) => setCell({ ...cell, text: e.target.value })}>
                <option value="">(none)</option>
                {fkOptions(cell.col, cell.row).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            ) : isJson(c.type) ? <textarea className="pw-in" rows={10} value={cell.text} onChange={(e) => setCell({ ...cell, text: e.target.value })} />
              : c.type === 'boolean' ? (
                <select className="pw-in" value={cell.text === '' ? '' : String(/^(true|yes|1)/i.test(cell.text))} onChange={(e) => setCell({ ...cell, text: e.target.value })}>
                  <option value="">(empty)</option><option value="true">✓ yes</option><option value="false">✗ no</option>
                </select>
              ) : c.type === 'date' ? <input className="pw-in" type="date" value={cell.text} onChange={(e) => setCell({ ...cell, text: e.target.value })} />
                : String(cell.text).length > 60 || (isText(c.type) && /\n/.test(cell.text))
                  ? <textarea className="pw-in" rows={5} value={cell.text} onChange={(e) => setCell({ ...cell, text: e.target.value })} />
                  : <input className="pw-in" autoFocus inputMode={isNum(c.type) ? 'decimal' : undefined} value={cell.text} onChange={(e) => setCell({ ...cell, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveCell()} />}
            <div className="modal-actions">
              {c.null && <button className="btn ghost" onClick={() => saveCell(true)} disabled={busy}>Make empty</button>}
              <button className="btn ghost" onClick={() => setCell(null)} disabled={busy}>Cancel</button>
              <button className="btn" onClick={() => saveCell()} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
            </div>
          </Modal>
        );
      })()}

      {form && (
        <Modal title={`${form.copy ? 'Copy row' : 'Add row'} · ${nameOf(tname)}`} onClose={() => !busy && setForm(null)}>
          <p className="muted" style={{ margin: 0 }}>Leave a box empty to use the normal value. JSON columns take JSON.</p>
          <div className="pw-form">
            {cols.map((c) => (
              <label key={c.name}>
                <span>{FK[c.name] ? c.name.replace(/_id$/, '').replace(/_/g, ' ') : c.name}{pk.includes(c.name) ? ' 🔑' : ''}{!c.null && !c.def ? ' *' : ''} <small>{FK[c.name] ? 'pick a name' : c.type}</small></span>
                {FK[c.name] ? (
                  <select value={form.vals[c.name]} onChange={(e) => setForm({ ...form, vals: { ...form.vals, [c.name]: e.target.value } })}>
                    <option value="">(none)</option>
                    {fkOptions(c.name, { person_kind: form.vals.person_kind }).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                ) : isJson(c.type)
                  ? <textarea rows={3} value={form.vals[c.name]} onChange={(e) => setForm({ ...form, vals: { ...form.vals, [c.name]: e.target.value } })} />
                  : <input type={c.type === 'date' ? 'date' : 'text'} value={form.vals[c.name]} onChange={(e) => setForm({ ...form, vals: { ...form.vals, [c.name]: e.target.value } })} />}
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={saveAdd} disabled={busy}>{busy ? 'Saving...' : '＋ Add'}</button>
          </div>
        </Modal>
      )}

      {rep && (
        <Modal title={`Find and replace · ${nameOf(tname)}`} onClose={() => !busy && setRep(null)}>
          <label className="dx-to"><span>Column</span>
            <select value={rep.col} onChange={(e) => setRep({ ...rep, col: e.target.value })}>
              <option value="*">All text columns</option>
              {textCols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="dx-to"><span>Find</span><input value={rep.find} onChange={(e) => setRep({ ...rep, find: e.target.value })} autoFocus /></label>
          <label className="dx-to"><span>Replace with</span><input value={rep.to} onChange={(e) => setRep({ ...rep, to: e.target.value })} placeholder="(leave empty to remove)" /></label>
          <label className="di-tick"><input type="checkbox" checked={rep.cases} onChange={(e) => setRep({ ...rep, cases: e.target.checked })} /> Match capital letters exactly</label>
          {q && <label className="di-tick"><input type="checkbox" checked={rep.onlyShown} onChange={(e) => setRep({ ...rep, onlyShown: e.target.checked })} /> Only the {shown.length} rows found by the search</label>}
          <p className="muted" style={{ margin: 0 }}>{rep.find ? `${repPlan.length} row${repPlan.length === 1 ? '' : 's'} will change.` : 'Type what to find.'}{tname === 'exp_entries' ? ' Auto lines are skipped.' : ''}</p>
          {repPlan.length > 0 && (
            <ul className="dx-list pw-prev">
              {repPlan.slice(0, 5).map(({ r, change }) => Object.entries(change).map(([k, v]) => <li key={keyOf(r) + k}><b>{k}</b>: {String(r[k]).slice(0, 60)} → {String(v).slice(0, 60)}</li>))}
              {repPlan.length > 5 && <li>... and {repPlan.length - 5} more rows</li>}
            </ul>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setRep(null)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={doReplace} disabled={busy || !repPlan.length}>{busy ? 'Replacing...' : `🔁 Replace in ${repPlan.length}`}</button>
          </div>
        </Modal>
      )}

      {del && (
        <Modal title={`Delete ${picked.length} row${picked.length === 1 ? '' : 's'}?`} onClose={() => !busy && setDel(false)}>
          <p style={{ margin: 0 }}>From <b>{nameOf(tname)}</b>. Anything made from these rows (All Companies lines, salary notes) changes too. ↶ Undo can bring them back while you stay on this page.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(false)} disabled={busy}>Cancel</button>
            <button className="btn danger" onClick={doDelete} disabled={busy}>{busy ? 'Deleting...' : '🗑 Delete'}</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate ownerOnly wide><PowerEditor /></AuthGate>;
}
