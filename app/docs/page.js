'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import Expiry from '@/components/Expiry';
import { sb } from '@/lib/supabase';
import { exportExcel, exportStamp } from '@/lib/sheet';
import { fmtD } from '@/lib/reminders';
import { SECTIONS, SECTION, STATES, docStatus } from '@/lib/docChecklist';

/*
  Documents Checklist (/docs): issue date and expiry of
  Employee Docs, Cars Docs, Heavy Vehicles, Govt License, Company Docs.
  Table doc_checklist. Status is worked out from the expiry date; alerts on Home 30 days before.
  - AI Search: typing filters at once; Enter or "✨ Ask AI" asks the AI across ALL sections (app/api/doc-search).
  - Company / vehicle / employee dropdown (names from the list), Sort.
  - ☑ Columns: choose columns for the screen, Print and Excel (remembered on this device).
  - 🗑 on the far right of every row deletes at once, with Undo for 10 seconds.
  Employee tab: "Company Sponsor" column (doc_checklist.sponsor, one value per employee, saved on all his lines).
  Below the grid "All employees" = one row per person from THREE places, joined by name:
    1. every employee typed in the checklist above (Resident Card / Visa lines),
    2. Drivers page (transport_drivers), sponsor Modern City,
    3. Office Expense staff sheet (exp_staff), sponsor = their company.
  Columns: Employee, Company Sponsor, Resident Card No., Resident Card expiry, Visa expiry, Status, Change on.
*/

const CO = { 'modern-city': 'Modern City', 'abu-wasif': 'Abu Wasif', sumptuosity: 'Sumptuosity' };
const FILTERS = [['all', 'All'], ['bad', 'Expired'], ['soon', 'Renew in 30 days'], ['ok', 'Active'], ['none', 'No expiry date'], ['off', 'Cancelled / Transferred']];
const TAG = { ok: 'ok', soon: 'warn', bad: 'due', none: 'info', off: 'info' };
const COLS_KEY = 'tudo-doc-cols';
const ALL_COLS = ['owner', 'doc_name', 'doc_no', 'issue_date', 'expiry_date', 'status', 'state', 'notes'];
const COL_LABEL = { owner: 'Name', doc_name: 'Document', doc_no: 'Document No.', issue_date: 'Issue date', expiry_date: 'Expiry date', status: 'Status', state: 'Stop alerts', notes: 'Notes' };
const PRESETS = [
  ['All columns', ALL_COLS],
  ['Standard', ['owner', 'doc_name', 'issue_date', 'expiry_date', 'status']],
  ['Dates only', ['owner', 'doc_name', 'expiry_date', 'status']],
  ['With numbers', ['owner', 'doc_name', 'doc_no', 'issue_date', 'expiry_date', 'status']]
];
const SPONSORS = ['Modern City', 'Abu Wasif', 'Sumptuosity'];
const RC_RE = /resident|civil|\bid card|\brc\b|bataqa/i;
const VISA_RE = /visa/i;
const nameKey = (n) => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9\u0600-\u06ff ]/g, ' ').replace(/\s+/g, ' ').trim();
const STATUS_RANK = { bad: 0, soon: 1, none: 2, ok: 3, off: 4 };
/* Keep the paper with the newest expiry date; fill a missing number from the other one */
function pickDoc(cur, cand) {
  if (!cand || (!cand.expiry_date && !cand.no)) return cur;
  if (!cur) return cand;
  if (!cur.expiry_date) return { ...cand, no: cand.no || cur.no };
  if (!cand.expiry_date) return { ...cur, no: cur.no || cand.no };
  return cand.expiry_date > cur.expiry_date ? { ...cand, no: cand.no || cur.no } : { ...cur, no: cur.no || cand.no };
}
const firstWord = (s) => String(s || '').split(' ')[0];

function StatusTag({ r }) {
  const st = docStatus(r);
  return <span className={`tag ${TAG[st.key]}`}>{st.label}</span>;
}

function DocsPage() {
  const { isAdmin, name } = useUser();
  const [rows, setRows] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tab, setTab] = useState('company');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [sortBy, setSortBy] = useState('owner');
  const [cols, setCols] = useState(ALL_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const [ai, setAi] = useState(null); // { query, ids, answer } or { busy } or { error }
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null); // { row, timer }
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && SECTION[t]) setTab(t);
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) setCols(['owner', ...saved.filter((c) => ALL_COLS.includes(c) && c !== 'owner')]);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const q = (p) => p.then((r) => r.data || []).catch(() => []);
    const [d, drv, staff] = await Promise.all([
      s.from('doc_checklist').select('*').order('sort'),
      q(s.from('transport_drivers').select('id, name, status, resident_card, resident_card_expiry, visa_expiry')),
      q(s.from('exp_staff').select('id, name, company, active, resident_card, resident_card_expiry, visa_expiry'))
    ]);
    if (d.error) { flash(d.error.message, 'err'); setRows([]); return; }
    setRows(d.data || []);
    setDrivers(drv.filter((x) => x.status !== 'Inactive'));
    setStaff(staff.filter((x) => x.active !== false));
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  function pickTab(k) {
    setTab(k);
    setFilter('all');
    setOwner('');
    setAi(null);
    try { window.history.replaceState(null, '', `/docs?tab=${k}`); } catch { /* ignore */ }
  }

  function saveCols(list) {
    const next = ALL_COLS.filter((c) => c === 'owner' || list.includes(c));
    setCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  /* ---------- AI Search ---------- */
  async function askAi(e) {
    e?.preventDefault();
    const query = search.trim();
    if (!query) return;
    setAi({ busy: true, query });
    try {
      const { data } = await sb().auth.getSession();
      const res = await fetch('/api/doc-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify({ query })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setAi({ error: out.error || 'AI Search could not answer.', query }); return; }
      setAi({ query, ids: out.ids || [], answer: out.answer || `${(out.ids || []).length} found` });
    } catch {
      setAi({ error: 'No connection. Showing normal search instead.', query });
    }
  }
  function clearAi() { setAi(null); setSearch(''); }

  const counts = useMemo(() => {
    const c = {};
    for (const s of SECTIONS) {
      const list = (rows || []).filter((r) => r.section === s.key);
      c[s.key] = { all: list.length, bad: list.filter((r) => docStatus(r).key === 'bad').length, soon: list.filter((r) => docStatus(r).key === 'soon').length };
    }
    return c;
  }, [rows]);

  const sec = SECTION[tab];
  const aiMode = Boolean(ai && ai.ids);
  const owners = useMemo(() => [...new Set((rows || []).filter((r) => r.section === tab).map((r) => r.owner).filter(Boolean))].sort(), [rows, tab]);
  const docNames = useMemo(() => [...new Set([...(sec?.docs || []), ...(rows || []).filter((r) => r.section === tab).map((r) => r.doc_name).filter(Boolean)])], [rows, tab, sec]);

  const hasSponsor = useMemo(() => (rows || []).some((r) => Object.prototype.hasOwnProperty.call(r, 'sponsor')), [rows]);
  const sponsorOptions = useMemo(() => [...new Set([...SPONSORS, ...(rows || []).map((r) => r.sponsor).filter(Boolean)])], [rows]);

  /* All employees: one row per person from the checklist, Drivers page and Office staff sheet */
  const people = useMemo(() => {
    const map = new Map();
    const get = (name) => {
      const k = nameKey(name);
      if (!k) return null;
      if (!map.has(k)) map.set(k, { key: k, name: String(name).trim(), owner: null, sponsor: '', rc: null, visa: null, from: [] });
      return map.get(k);
    };
    (rows || []).filter((r) => r.section === 'employee' && r.owner).forEach((r) => {
      const p = get(r.owner);
      if (!p) return;
      if (!p.owner) { p.owner = r.owner; p.name = r.owner; }
      if (!p.from.some((f) => f.kind === 'docs')) p.from.push({ kind: 'docs', label: 'Checklist above' });
      if (r.sponsor && !p.sponsor) p.sponsor = r.sponsor;
      if (r.state) return;
      const doc = r.doc_name || '';
      const slot = VISA_RE.test(doc) ? 'visa' : RC_RE.test(doc) ? 'rc' : null;
      if (slot) p[slot] = pickDoc(p[slot], { no: r.doc_no, expiry_date: r.expiry_date });
    });
    drivers.forEach((x) => {
      const p = get(x.name);
      if (!p) return;
      p.from.push({ kind: 'driver', label: 'Drivers page', href: '/transport/drivers' });
      if (!p.sponsor) p.sponsor = 'Modern City';
      p.rc = pickDoc(p.rc, { no: x.resident_card, expiry_date: x.resident_card_expiry });
      p.visa = pickDoc(p.visa, { expiry_date: x.visa_expiry });
    });
    staff.forEach((x) => {
      const p = get(x.name);
      if (!p) return;
      p.from.push({ kind: 'staff', label: 'Office staff sheet', href: `/expenses?co=${x.company}` });
      if (!p.sponsor) p.sponsor = CO[x.company] || x.company || '';
      p.rc = pickDoc(p.rc, { no: x.resident_card, expiry_date: x.resident_card_expiry });
      p.visa = pickDoc(p.visa, { expiry_date: x.visa_expiry });
    });
    const out = [...map.values()].map((p) => {
      const sts = [p.rc, p.visa].map((d) => docStatus({ expiry_date: d?.expiry_date }));
      const dated = sts.filter((x) => x.key !== 'none').sort((x, y) => STATUS_RANK[x.key] - STATUS_RANK[y.key]);
      let status = dated[0] || { key: 'none', label: 'No dates', left: null };
      if (status.key === 'ok' && dated.length < 2) status = { key: 'none', label: 'Date missing', left: null };
      return { ...p, status };
    });
    return out.sort((a, b) => STATUS_RANK[a.status.key] - STATUS_RANK[b.status.key] || a.name.localeCompare(b.name));
  }, [rows, drivers, staff]);

  const shown = useMemo(() => {
    let list;
    if (aiMode) {
      const want = new Set(ai.ids);
      list = (rows || []).filter((r) => want.has(r.id));
    } else {
      const q = search.trim().toLowerCase();
      list = (rows || []).filter((r) => r.section === tab);
      if (owner) list = list.filter((r) => r.owner === owner);
      if (filter !== 'all') list = list.filter((r) => docStatus(r).key === filter);
      if (q) {
        const words = q.split(/\s+/);
        list = list.filter((r) => {
          const hay = [r.owner, r.sponsor, r.doc_name, r.doc_no, r.notes, docStatus(r).label, fmtD(r.expiry_date)].join(' ').toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      }
    }
    const exp = (r) => (r.state ? '9999' : r.expiry_date || '9998');
    if (sortBy === 'expiry') return [...list].sort((a, b) => exp(a).localeCompare(exp(b)));
    return [...list].sort((a, b) => String(a.owner || '').localeCompare(String(b.owner || '')) || (a.sort || 0) - (b.sort || 0));
  }, [rows, tab, filter, search, owner, sortBy, ai, aiMode]);

  async function save(row, key, value) {
    if (key === 'sponsor' && row.section === 'employee' && row.owner) { saveSponsor(row.owner, value); return; }
    const patch = { [key]: value === '' ? null : value };
    setRows((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('doc_checklist').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }

  /* Company Sponsor belongs to the person, so it is saved on all his lines */
  async function saveSponsor(owner, value) {
    const sponsor = String(value || '').trim() || null;
    setRows((list) => list.map((x) => (x.section === 'employee' && x.owner === owner ? { ...x, sponsor } : x)));
    const { error } = await sb().from('doc_checklist').update({ sponsor }).eq('section', 'employee').eq('owner', owner);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash(`Sponsor saved for ${owner}`);
  }

  /* Add a Resident Card or Visa line for an employee from the summary table */
  async function addPersonDoc(p, docName) {
    const sort = (rows || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const row = { section: 'employee', owner: p.owner || p.name, doc_name: docName, sort, entered_by: name || null };
    if (hasSponsor && p.sponsor) row.sponsor = p.sponsor;
    const { data, error } = await sb().from('doc_checklist').insert(row).select().single();
    if (error) { flash(error.message, 'err'); return; }
    setRows((list) => [...list, data]);
    setOwner(row.owner);
    setFilter('all');
    flash(`${docName} line added for ${row.owner}. Type the number and expiry date above.`);
  }

  async function addRow() {
    const sort = (rows || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const last = shown[shown.length - 1];
    const { data, error } = await sb().from('doc_checklist')
      .insert({ section: tab, owner: owner || last?.owner || null, doc_name: null, sort, entered_by: name || null, ...(tab === 'employee' && hasSponsor && (owner || last?.owner) ? { sponsor: (rows || []).find((x) => x.section === 'employee' && x.owner === (owner || last?.owner) && x.sponsor)?.sponsor || null } : {}) })
      .select().single();
    if (error) { flash(error.message, 'err'); return; }
    setRows((list) => [...list, data]);
    setFilter('all');
    flash('New line added. Type the document and dates.');
  }

  /* ---------- Delete with Undo ---------- */
  async function removeRow(row) {
    setRows((list) => list.filter((x) => x.id !== row.id));
    const { error } = await sb().from('doc_checklist').delete().eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    if (undo?.timer) clearTimeout(undo.timer);
    const t = setTimeout(() => setUndo(null), 10000);
    setUndo({ row, timer: t });
  }
  async function undoDelete() {
    if (!undo) return;
    clearTimeout(undo.timer);
    const { row } = undo;
    setUndo(null);
    const { data, error } = await sb().from('doc_checklist').insert(row).select().single();
    if (error) { flash(`Could not bring it back: ${error.message}`, 'err'); return; }
    setRows((list) => [...list, data]);
    flash('Brought back');
  }

  /* ---------- Table for Print and Excel (chosen columns) ---------- */
  function cellText(r, c) {
    if (c === 'status') { const st = docStatus(r); return st.left !== null && st.key !== 'ok' ? `${st.label} (${st.left < 0 ? `${-st.left}d ago` : `${st.left}d left`})` : st.label; }
    if (c === 'issue_date' || c === 'expiry_date') return fmtD(r[c]);
    return r[c] || '';
  }

  async function doExcel() {
    const pick = cols;
    const sheets = SECTIONS.map((s) => {
      const p2 = s.key === 'employee' && hasSponsor ? ['owner', 'sponsor', ...pick.filter((c) => c !== 'owner')] : pick;
      return {
        name: s.label,
        title: `Documents Checklist: ${s.label}`,
        subtitle: `Tudo Num Group · status on ${fmtD(new Date().toISOString())}`,
        head: ['S.No', ...p2.map((c) => (c === 'owner' ? s.owner : c === 'sponsor' ? 'Company Sponsor' : COL_LABEL[c]))],
        rows: (rows || []).filter((r) => r.section === s.key)
          .sort((a, b) => String(a.owner || '').localeCompare(String(b.owner || '')) || (a.sort || 0) - (b.sort || 0))
          .map((r, i) => [i + 1, ...p2.map((c) => cellText(r, c))]),
        numCols: [], widths: [6, ...p2.map((c) => ({ owner: 40, sponsor: 20, doc_name: 34, notes: 28, status: 22 }[c] || 14))]
      };
    });
    sheets.splice(1, 0, {
      name: 'All employees',
      title: 'All employees: Resident Card and Visa',
      subtitle: `Checklist, Drivers and Office staff · status on ${fmtD(new Date().toISOString())}`,
      head: ['S.No', 'Employee', 'Company Sponsor', 'Resident Card No.', 'Resident Card expiry', 'Visa expiry', 'Status', 'Kept on'],
      rows: people.map((p, i) => [i + 1, p.name, p.sponsor || '', p.rc?.no || '', fmtD(p.rc?.expiry_date), fmtD(p.visa?.expiry_date), p.status.label, p.from.map((f) => f.label).join(', ')]),
      numCols: [], widths: [6, 30, 18, 18, 18, 14, 16, 30]
    });
    await exportExcel(`Documents Checklist ${exportStamp()}.xlsx`, sheets);
    flash('Excel file downloaded');
  }

  if (!rows) return <div className="loading">Loading documents...</div>;

  const ownerWord = firstWord(sec.owner);
  const allColumns = {
    section: { key: 'section', label: 'Section', type: 'calc', align: 'left', width: 140, render: (r) => <span className="tag info">{SECTION[r.section]?.label}</span> },
    owner: { key: 'owner', label: aiMode ? 'Name' : sec.owner, type: 'combo', options: owners, width: 300, render: (r) => <b>{r.owner || <span className="muted">–</span>}</b> },
    sponsor: { key: 'sponsor', label: 'Company Sponsor', type: 'combo', options: sponsorOptions, width: 170, render: (r) => r.sponsor || <span className="muted">–</span> },
    doc_name: { key: 'doc_name', label: 'Document', type: 'combo', options: docNames, width: 270 },
    doc_no: { key: 'doc_no', label: 'Document No.', type: 'text', width: 140 },
    issue_date: { key: 'issue_date', label: 'Issue date', type: 'date', width: 120 },
    expiry_date: { key: 'expiry_date', label: 'Expiry date', type: 'date', width: 150, render: (r) => (r.state ? <span className="muted">{fmtD(r.expiry_date) || '–'}</span> : <Expiry date={r.expiry_date} />) },
    status: { key: 'status', label: 'Status', type: 'calc', width: 130, render: (r) => <StatusTag r={r} /> },
    state: { key: 'state', label: 'Stop alerts', type: 'select', options: STATES, width: 120, render: (r) => r.state || <span className="muted">–</span> },
    notes: { key: 'notes', label: 'Notes', type: 'text', width: 220 }
  };
  const withSponsor = hasSponsor && (tab === 'employee' || aiMode);
  const columns = [...(aiMode ? [allColumns.section] : []), ...cols.flatMap((c) => (c === 'owner' && withSponsor ? [allColumns.owner, allColumns.sponsor] : [allColumns[c]]))];
  if (isAdmin) {
    columns.push({
      key: 'del', label: '', type: 'calc', width: 56,
      render: (r) => (
        <button type="button" className="dc-del" title="Delete this line" aria-label={`Delete ${r.doc_name || 'line'}`}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeRow(r); }}>🗑</button>
      )
    });
  }

  const tot = { bad: 0, soon: 0, ok: 0, none: 0 };
  rows.forEach((r) => { const k = docStatus(r).key; if (k in tot) tot[k] += 1; });
  const empMissing = people.reduce((n, p) => n + (p.rc?.expiry_date ? 0 : 1) + (p.visa?.expiry_date ? 0 : 1), 0);
  const empAlert = people.filter((p) => p.status.key === 'bad' || p.status.key === 'soon').length;
  const docCell = (p, slot, label) => {
    const d = p[slot];
    if (d?.expiry_date) return <Expiry date={d.expiry_date} />;
    if (canChange && p.from.some((f) => f.kind === 'docs') && !p.from.some((f) => f.kind !== 'docs')) {
      return <button type="button" className="btn ghost sm" onClick={() => addPersonDoc(p, label)}>＋ Add {label}</button>;
    }
    return <span className="muted">Not entered</span>;
  };

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <button type="button" className="btn ghost" onClick={() => setColsOpen(true)} title="Choose which columns to show, print and export">☑ Columns</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
        </div>
      </div>
      <div>
        <h1>📋 Documents Checklist</h1>
        <p className="sub">Issue date and expiry of every document. Status is worked out from the expiry date. Alerts show on Home 30 days before.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Documents</span><strong>{rows.length}</strong><small>{SECTIONS.length} sections</small></div>
        <div className={`kpi ${tot.bad ? 'kpi-bad' : ''}`}><span>Expired</span><strong>{tot.bad}</strong><small>renew now</small></div>
        <div className="kpi"><span>Renew in 30 days</span><strong>{tot.soon}</strong><small>coming up</small></div>
        <div className="kpi"><span>Active</span><strong>{tot.ok}</strong><small>{tot.none ? `${tot.none} with no expiry date` : 'all dated'}</small></div>
      </div>

      <form className="dc-ai" onSubmit={askAi} role="search">
        <span className="dc-ai-ico" aria-hidden="true">✨</span>
        <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (ai) setAi(null); }}
          placeholder="AI Search: e.g. expired licenses of Modern City, what expires in December, Rauf car mulkiya"
          aria-label="AI Search" />
        <button type="submit" className="btn in" disabled={!search.trim() || ai?.busy}>{ai?.busy ? 'Searching...' : 'Ask AI'}</button>
      </form>
      {ai && !ai.busy && (
        <div className={`dc-ai-answer ${ai.error ? 'err' : ''}`} role="status">
          <span>{ai.error ? `⚠️ ${ai.error}` : <>✨ {ai.answer}</>}</span>
          <button type="button" className="al-link" onClick={clearAi}>✕ Clear</button>
        </div>
      )}

      {!aiMode && (
        <div className="dc-tabs co-switch" role="tablist" aria-label="Document sections">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" role="tab" aria-selected={tab === s.key} className={tab === s.key ? 'on' : ''} onClick={() => pickTab(s.key)}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
              <small className="dc-n">{counts[s.key].all}</small>
              {counts[s.key].bad > 0 && <small className="dc-bad" title="Expired">{counts[s.key].bad}</small>}
              {counts[s.key].soon > 0 && <small className="dc-soon" title="Renew in 30 days">{counts[s.key].soon}</small>}
            </button>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="section-head">
          <h2>{aiMode ? `✨ AI Search: ${shown.length} found` : <>{sec.icon} {sec.label}{owner ? ` · ${owner}` : ''}</>}</h2>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>

        {!aiMode && (
          <div className="dc-bar">
            <div className="head-chips">
              {FILTERS.map(([k, label]) => {
                const base = (rows || []).filter((r) => r.section === tab && (!owner || r.owner === owner));
                const n = k === 'all' ? base.length : base.filter((r) => docStatus(r).key === k).length;
                if (k !== 'all' && !n) return null;
                return <button key={k} type="button" className={`rp-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label} · {n}</button>;
              })}
            </div>
            <div className="dc-right">
              <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={`Choose ${ownerWord}`}>
                <option value="">All {ownerWord === 'Company' ? 'companies' : ownerWord === 'Employee' ? 'employees' : ownerWord === 'Car' ? 'cars' : 'vehicles'} ({owners.length})</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
                <option value="owner">Sort: A to Z</option>
                <option value="expiry">Sort: Expiry first</option>
              </select>
            </div>
          </div>
        )}

        <DataGrid
          columns={columns}
          rows={shown}
          canEdit={canChange}
          onSave={save}
          onAdd={aiMode ? undefined : addRow}
          addLabel={`+ Add ${sec.label.replace(/s$/, '').toLowerCase()} line`}
          rowClass={(r) => { const k = docStatus(r).key; return k === 'bad' ? 'dc-row-bad' : k === 'off' ? 'muted-row' : ''; }}
          emptyText={aiMode ? 'AI Search found nothing. Try other words.' : filter === 'all' && !search && !owner ? 'Nothing here yet. Press Edit, then + Add.' : 'No documents match.'}
          flash={flash}
        />

        {!aiMode && tab === 'employee' && people.length > 0 && (
          <div className="dc-linked">
            <h3>🪪 All employees: Resident Card and Visa ({people.length})</h3>
            <p className="muted">
              Everyone typed in the checklist above, on the Drivers page and on the Office staff sheet, one row each.
              {empAlert ? ` ${empAlert} need renewal.` : ''}{empMissing ? ` ${empMissing} expiry dates not entered yet.` : ''}
              {!hasSponsor ? ' Company Sponsor can be typed once the database update is done.' : ''}
            </p>
            <div className="table-wrap">
              <table className="dc-table">
                <thead><tr><th>Employee</th><th>Company Sponsor</th><th>Resident Card No.</th><th>Resident Card expiry</th><th>Visa expiry</th><th>Status</th><th>Change on</th></tr></thead>
                <tbody>
                  {people.map((p) => {
                    const fromDocs = p.from.some((f) => f.kind === 'docs');
                    return (
                      <tr key={p.key}>
                        <td><b>{p.name}</b></td>
                        <td>
                          {canChange && hasSponsor && fromDocs ? (
                            <input className="dc-sponsor" list="dc-sponsor-list" defaultValue={p.sponsor} placeholder="Choose or type"
                              aria-label={`Company Sponsor of ${p.name}`}
                              onBlur={(e) => { if (e.target.value.trim() !== (p.sponsor || '')) saveSponsor(p.owner, e.target.value); }} />
                          ) : (p.sponsor || <span className="muted">–</span>)}
                        </td>
                        <td>{p.rc?.no || <span className="muted">–</span>}</td>
                        <td>{docCell(p, 'rc', 'Resident Card')}</td>
                        <td>{docCell(p, 'visa', 'Visa')}</td>
                        <td><span className={`tag ${TAG[p.status.key]}`}>{p.status.label}</span></td>
                        <td className="dc-from">
                          {p.from.map((f) => (f.kind === 'docs'
                            ? <button key="docs" type="button" className="al-link" onClick={() => { setOwner(p.owner); setFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{f.label}</button>
                            : <Link key={f.kind} href={f.href}>{f.label}</Link>))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="dc-sponsor-list">{sponsorOptions.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
          </div>
        )}
      </section>

      {colsOpen && (
        <Modal title="Choose columns" onClose={() => setColsOpen(false)}>
          <div className="tp-presets">
            {PRESETS.map(([label, list]) => (
              <button key={label} type="button" className="rp-chip" onClick={() => saveCols(list)}>{label}</button>
            ))}
          </div>
          <div className="tp-cols">
            {ALL_COLS.map((c) => (
              <label key={c} className={cols.includes(c) ? 'on' : ''}>
                <input type="checkbox" checked={cols.includes(c)} disabled={c === 'owner'}
                  onChange={() => saveCols(cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c])} />
                {c === 'owner' ? 'Name (Company / Vehicle / Employee)' : COL_LABEL[c]}
              </label>
            ))}
          </div>
          <p className="note" style={{ margin: '10px 0 0' }}>{cols.length} of {ALL_COLS.length} columns. Used on screen, Print and Excel. Remembered on this device.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={doExcel}>⬇ Excel</button>
            <button type="button" className="btn ghost" onClick={() => { setColsOpen(false); setTimeout(() => window.print(), 150); }}>🖨 Print</button>
            <button type="button" className="btn" onClick={() => setColsOpen(false)}>Done</button>
          </div>
        </Modal>
      )}

      {undo && (
        <div className="toast dc-undo" role="status">
          <span>Deleted <b>{undo.row.doc_name || 'line'}</b>{undo.row.owner ? ` · ${undo.row.owner}` : ''}</span>
          <button type="button" onClick={undoDelete}>↶ Undo</button>
        </div>
      )}
      {!undo && toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DocsPage /></AuthGate>;
}
