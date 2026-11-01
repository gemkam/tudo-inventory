'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import PrintColumns from '@/components/PrintColumns';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import DocFiles from '@/components/DocFiles';
import Modal from '@/components/Modal';
import Expiry from '@/components/Expiry';
import AttendanceSheet from '@/components/AttendanceSheet';
import SendSlipLink from '@/components/SendSlipLink';
import SlipViewer from '@/components/SlipViewer';
import PaidButton from '@/components/PaidButton';
import { loadCredits, markPaid, unmarkPaid, creditKey } from '@/lib/salaryCredit';
import { sb } from '@/lib/supabase';
import { COMPANIES, n, r3 } from '@/lib/expenses';
import { daysOfMonth, marksByStaff, personMonth } from '@/lib/attendance';
import { fmtAmt, monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';

/*
  Personnel (top bar button before Admin, 1 Nov 2026) > Employees:
    Office Employees · Drivers · Site Employees · Subcontractors · Attendance  (tabs, ?tab=office|drivers|site|sub|attendance)
  Office / Site employees = the same people as the All Companies salary sheets (exp_staff, staff_type Office / Site),
  so the Attendance sheet (Attendance tab = components/AttendanceSheet.js) and the salary sheet stay connected to them.
  Drivers = Transport drivers (transport_drivers). Subcontractors = personnel_subcontractors.
  Salary > Allowance > House rent, Utilities (+ Transport Yes/No for office and site). Changing House rent or Utilities
  also changes the Allowance total that the salary sheet uses.
  ⋯ More (same box as the Documents Checklist) for Contract, Passport, Resident card and Salary slip: private bucket
  staff-files, list in <table>.files { contract: [], passport: [], resident: [], slip: [] }.
  📤 Send To Employee: the employee's own link /s/<slip_token> (made once, never changes) shows his approved monthly slips.
  👁 Slip: his monthly slips (made in All Companies > 💰 Salary). Salary Credited: green when paid for the month
  (table salary_credits; "All ... Salary Paid" marks everyone on the tab). Marking paid approves his draft slip.
*/

const TABS = [
  ['office', '🏢 Office Employees'],
  ['drivers', '🚚 Drivers'],
  ['site', '👷 Site Employees'],
  ['sub', '🤝 Subcontractors'],
  ['attendance', '🗓 Attendance'],
  ['archives', '🗄 Archives']
];
const TICKETS = ['Yes', 'No', 'Yearly', 'Every 2 years'];
const BUCKET = 'staff-files';
const thisMonth = () => todayISO().slice(0, 7);
const shiftM = (k, d) => { const [y, m] = k.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + d, 1)); return x.toISOString().slice(0, 7); };
const filesOf = (row, doc) => (row.files && Array.isArray(row.files[doc]) ? row.files[doc] : []);

/* header rows: Salary over Basic + Allowance; Allowance over its parts */
function makeGroups(columns, defs) {
  return defs.map((def) => {
    const out = [];
    for (let i = 0; i < columns.length; i += 1) {
      const g = def.find((x) => x.keys[0] === columns[i].key);
      if (g) { out.push({ label: g.label, span: g.keys.length }); i += g.keys.length - 1; continue; }
      const last = out[out.length - 1];
      if (last && !last.label) last.span += 1; else out.push({ label: '', span: 1 });
    }
    return out;
  });
}

function PersonnelPage() {
  const { isAdmin, canDelete, name: me } = useUser();
  const [tab, setTab] = useState('office');
  const [co, setCo] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(false); // cells can be changed
  const [delMode, setDelMode] = useState(false); // Delete buttons on each row
  const [extraCos, setExtraCos] = useState([]); // companies added with ＋ Add company (personnel_companies)
  const [addCo, setAddCo] = useState(null); // { short, name }
  const allCos = useMemo(() => [...COMPANIES, ...extraCos.filter((e) => !COMPANIES.some((c) => c.key === e.key))], [extraCos]);
  const CO_SHORT = useMemo(() => Object.fromEntries(allCos.map((c) => [c.key, c.short])), [allCos]);
  const CO_KEY = useMemo(() => Object.fromEntries(allCos.map((c) => [c.short, c.key])), [allCos]);
  const [undo, setUndo] = useState([]); // [{ type: 'patch'|'add'|'delete', table, id, before | row, label }]
  const [staff, setStaff] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [subs, setSubs] = useState(null);
  const [att, setAtt] = useState([]);
  const [month, setMonth] = useState(thisMonth());
  const [send, setSend] = useState(null); // { table, row }
  const [archived, setArchived] = useState([]); // [{ table, row }]
  const [coDetail, setCoDetail] = useState(''); // company shown as a full table (from All companies ▾)
  const [viewArch, setViewArch] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [slipsAll, setSlipsAll] = useState([]);
  const [credits, setCredits] = useState({});
  const [viewSlip, setViewSlip] = useState(null); // { name, kind, id }
  const [payAll, setPayAll] = useState(false);
  const [del, setDel] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'slips') { window.location.replace('/expenses/salary'); return; } // moved to All Companies > Salary
      if (TABS.some(([k]) => k === t)) setTab(t);
    } catch { /* ignore */ }
  }, []);
  function openAttendance(company) {
    try { window.history.replaceState(null, '', `/personnel?tab=attendance&co=${company}&m=${month}`); } catch { /* ignore */ }
    setTab('attendance'); setEdit(false); setDelMode(false);
  }
  function goTab(k) {
    if (k === 'attendance') { openAttendance(co || (staff || [])[0]?.company || 'sumptuosity'); return; }
    setTab(k); setEdit(false); setDelMode(false);
    try { window.history.replaceState(null, '', `/personnel?tab=${k}`); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    const s = sb();
    const days = daysOfMonth(month);
    const [st, dr, sc, a, pc] = await Promise.all([
      s.from('exp_staff').select('*').order('company').order('sort').order('name'),
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('personnel_subcontractors').select('*').order('sort').order('created_at'),
      s.from('exp_attendance').select('staff_id, day, mark').gte('day', days[0].iso).lte('day', days[days.length - 1].iso),
      s.from('personnel_companies').select('*').order('sort').order('created_at')
    ]);
    setExtraCos(pc.data || []);
    const err = st.error || dr.error || sc.error;
    if (err) setError(err.message);
    // 🗄 Archives: deleted people stay in the database (archived_at) but are hidden everywhere
    const live = (l) => (l || []).filter((x) => !x.archived_at);
    setStaff(live(st.data));
    setDrivers(live(dr.data));
    setSubs(live(sc.data));
    setArchived([
      ...(st.data || []).filter((x) => x.archived_at).map((row) => ({ table: 'exp_staff', row })),
      ...(dr.data || []).filter((x) => x.archived_at).map((row) => ({ table: 'transport_drivers', row })),
      ...(sc.data || []).filter((x) => x.archived_at).map((row) => ({ table: 'personnel_subcontractors', row }))
    ].sort((a, b) => String(b.row.archived_at).localeCompare(String(a.row.archived_at))));
    setAtt(a.data || []);
    const sl = await s.from('salary_slips').select('*').order('month', { ascending: false });
    setSlipsAll(sl.data || []);
    setCredits(await loadCredits(month));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const marks = useMemo(() => marksByStaff(att), [att]);
  const today = todayISO();
  const statOf = useCallback((p) => personMonth(month, marks[p.id], today, p.staff_type || 'Office'), [month, marks, today]);

  /* ---------- saving ---------- */
  const TABLE = { office: 'exp_staff', site: 'exp_staff', drivers: 'transport_drivers', sub: 'personnel_subcontractors' };
  const setterOf = (table) => (table === 'exp_staff' ? setStaff : table === 'transport_drivers' ? setDrivers : setSubs);

  const remember = (step) => setUndo((u) => [...u.slice(-49), step]);
  async function patchRow(table, row, patch, record = false) {
    const { error: err } = await sb().from(table).update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); return false; }
    if (record) remember({ type: 'patch', table, id: row.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, row[k] ?? null])), label: row.name });
    setterOf(table)((list) => (list || []).map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    return true;
  }

  async function onSave(table, row, key, value) {
    let patch = { [key]: value };
    if (key === 'company') patch = { company: CO_KEY[value] || value || null };
    if (key === 'transport_allow') patch = { transport_allow: value === 'Yes' };
    if (key === 'name') patch = { name: String(value || '').trim() || row.name };
    if (key === 'house_rent' || key === 'utilities') {
      const v = n(value);
      // the Allowance total follows its parts (the salary sheet uses the total)
      patch = { [key]: v, allowances: r3(Math.max(0, n(row.allowances) - n(row[key]) + v)) };
    }
    if (key === 'allowances') patch = { allowances: Math.max(n(value), n(row.house_rent) + n(row.utilities)) };
    if (await patchRow(table, row, patch, true)) flash('Saved');
  }

  async function saveFiles(table, row, doc, list) {
    const cur = (table === 'exp_staff' ? staff : table === 'transport_drivers' ? drivers : subs) || [];
    const fresh = cur.find((x) => x.id === row.id) || row;
    await patchRow(table, row, { files: { ...(fresh.files || {}), [doc]: list } });
  }

  async function addRow() {
    const s = sb();
    let res;
    if (tab === 'office' || tab === 'site') {
      const company = co || 'sumptuosity';
      const sort = (staff || []).filter((x) => x.company === company).length + 1;
      res = await s.from('exp_staff').insert({ company, name: 'New employee', staff_type: tab === 'site' ? 'Site' : 'Office', working_days: 30, basic: 0, sort }).select().single();
      if (!res.error) setStaff((l) => [...(l || []), res.data]);
    } else if (tab === 'drivers') {
      res = await s.from('transport_drivers').insert({ name: 'New driver', company: co || 'modern-city', status: 'Active', sort: (drivers || []).length + 1 }).select().single();
      if (!res.error) setDrivers((l) => [...(l || []), res.data]);
    } else {
      res = await s.from('personnel_subcontractors').insert({ name: 'New subcontractor', company: co || null, sort: (subs || []).length + 1 }).select().single();
      if (!res.error) setSubs((l) => [...(l || []), res.data]);
    }
    if (res.error) { flash(res.error.message, 'err'); return; }
    remember({ type: 'add', table: TABLE[tab], id: res.data.id, label: res.data.name });
    setEdit(true);
    flash('Added at the bottom: type the name in the first box');
  }

  /* Delete = move to 🗄 Archives: hidden from every table, list, salary, attendance and alert; his salary link stops.
     Nothing is removed from the database. Restore brings him back as he was. */
  const archPatch = (table, on, reason = '') => ({
    archived_at: on ? new Date().toISOString() : null, archived_by: on ? me || null : null, archive_reason: on ? reason || null : null,
    slip_link_on: table === 'personnel_subcontractors' ? undefined : !on,
    ...(table === 'exp_staff' ? { active: !on } : {})
  });
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  async function confirmDelete() {
    const { table, row } = del;
    const patch = clean(archPatch(table, true, delReason.trim()));
    setDel(null); setDelReason('');
    const { error: err } = await sb().from(table).update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); return; }
    setterOf(table)((l) => (l || []).filter((x) => x.id !== row.id));
    setArchived((a) => [{ table, row: { ...row, ...patch } }, ...a]);
    remember({ type: 'archive', table, id: row.id, row, label: row.name });
    flash(`${row.name} moved to 🗄 Archives. ↶ Undo brings him back`);
  }
  async function restore(table, row) {
    const patch = clean(archPatch(table, false));
    const { error: err } = await sb().from(table).update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); return false; }
    setArchived((a) => a.filter((x) => x.row.id !== row.id));
    setterOf(table)((l) => [...(l || []), { ...row, ...patch }]);
    return true;
  }
  /* ＋ Add company: a new pill next to the others (Personnel only; Office Expense keeps its 3 companies) */
  async function saveCompany() {
    const short = (addCo.short || '').trim();
    const name = (addCo.name || '').trim() || short;
    if (!short) { flash('Type the company name', 'err'); return; }
    if (allCos.some((c) => c.short.toLowerCase() === short.toLowerCase())) { flash('This company is already there', 'err'); return; }
    const key = `${short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'}-${Date.now().toString(36).slice(-4)}`;
    const { data, error: err } = await sb().from('personnel_companies').insert({ key, short, name, sort: extraCos.length + 1 }).select().single();
    if (err) { flash(err.message, 'err'); return; }
    setExtraCos((l) => [...l, data]);
    setAddCo(null);
    setCo(data.key);
    flash(`${short} added`);
  }

  /* ↶ Undo: last change, add or delete (up to 50 steps) */
  async function doUndo() {
    const step = undo[undo.length - 1];
    if (!step) { flash('Nothing to undo'); return; }
    const s = sb();
    let err = null;
    if (step.type === 'patch') {
      ({ error: err } = await s.from(step.table).update(step.before).eq('id', step.id));
      if (!err && step.table === 'exp_staff' && step.before.company) await s.from('exp_attendance').update({ company: step.before.company }).eq('staff_id', step.id);
      if (!err) setterOf(step.table)((l) => (l || []).map((x) => (x.id === step.id ? { ...x, ...step.before } : x)));
    } else if (step.type === 'add') {
      ({ error: err } = await s.from(step.table).delete().eq('id', step.id));
      if (!err) setterOf(step.table)((l) => (l || []).filter((x) => x.id !== step.id));
    } else if (step.type === 'archive') {
      if (!(await restore(step.table, step.row))) return;
    } else if (step.type === 'delete') {
      ({ error: err } = await s.from(step.table).insert(step.row));
      if (!err) setterOf(step.table)((l) => [...(l || []), step.row]);
    }
    if (err) { flash(`Could not undo: ${err.message}`, 'err'); return; }
    setUndo((u) => u.slice(0, -1));
    flash(step.type === 'patch' ? `Undone: change of ${step.label}` : step.type === 'add' ? `Undone: ${step.label} removed again` : `Undone: ${step.label} is back${step.table === 'exp_staff' ? ' (attendance marks of that person were deleted with him)' : ''}`);
  }


  /* ---------- cells ---------- */
  const docCell = (table, doc, label, text) => (row) => (
    <div className="pn-cell">
      {text && <span className="pn-text">{text(row) || <span className="muted">–</span>}</span>}
      <DocFiles
        compact
        label={label}
        bucket={BUCKET}
        row={{ id: doc === 'slip' ? `slip/${row.slip_token}` : `${table}/${row.id}/${doc}`, files: filesOf(row, doc), owner: row.name, doc_name: label }}
        canEdit={isAdmin}
        userName={me}
        flash={flash}
        onSave={(list) => saveFiles(table, row, doc, list)}
      />
    </div>
  );
  const kindOf = (table) => (table === 'exp_staff' ? 'staff' : 'driver');
  const slipsOf = (table, row) => slipsAll.filter((x) => x.person_kind === kindOf(table) && x.person_id === row.id);
  const slipCell = (table) => (row) => (
    <div className="pn-cell">
      <button type="button" className="dfl-more" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setViewSlip({ name: row.name, kind: kindOf(table), id: row.id }); }}>
        👁 Slip{slipsOf(table, row).length ? ` (${slipsOf(table, row).length})` : ''}
      </button>
      {isAdmin && <button type="button" className="dfl-more pn-send" onClick={(e) => { e.stopPropagation(); setSend({ table, row }); }} onMouseDown={(e) => e.stopPropagation()}>📤 Send To Employee</button>}
    </div>
  );
  const paidCol = (table) => ({
    key: 'paid', label: `Salary Credited · ${monthLabel(month)}`, type: 'calc', width: 175,
    render: (row) => (
      <PaidButton credit={credits[creditKey(kindOf(table), row.id)]} canEdit={isAdmin}
        onPay={() => payPeople([{ kind: kindOf(table), id: row.id, name: row.name }])}
        onUndo={async () => { const e = await unmarkPaid(kindOf(table), row.id, month); if (e) flash(e, 'err'); else { flash(`${row.name}: not paid`); setCredits(await loadCredits(month)); } }} />
    )
  });
  async function payPeople(list) {
    const withNet = list.map((p) => ({ ...p, amount: slipsAll.find((x) => x.person_kind === p.kind && x.person_id === p.id && x.month === month)?.net ?? null }));
    const r = await markPaid(withNet, month, me);
    setPayAll(false);
    if (r.error) { flash(r.error, 'err'); return; }
    flash(`Salary paid: ${list.length}${r.approved ? ` · ${r.approved} slip${r.approved === 1 ? '' : 's'} approved` : ''}${r.sent ? ` · ${r.sent} phone${r.sent === 1 ? '' : 's'} told` : ''}`);
    load();
  }
  const money = (k) => ({ key: k, label: '', type: 'number', width: 105, render: (r) => (n(r[k]) ? fmtAmt(r[k]) : <span className="muted">–</span>) });
  /* Company: a drop-down in every row (no need to press Edit), so someone put in the wrong company is moved at once */
  async function moveCompany(table, row, key) {
    if (!key || key === row.company) return;
    if (!(await patchRow(table, row, { company: key }, true))) return;
    // his attendance marks move with him (the attendance sheet is per company)
    if (table === 'exp_staff') await sb().from('exp_attendance').update({ company: key }).eq('staff_id', row.id);
    flash(`${row.name} moved to ${CO_SHORT[key] || key}`);
  }
  const companyColFor = (table, label = 'Company') => ({
    key: 'company', label, type: 'calc', width: 150,
    render: (r) => (isAdmin ? (
      <select className="pn-co-sel" value={r.company || ''} aria-label={`Company of ${r.name}`}
        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => moveCompany(table, r, e.target.value)}>
        {!r.company && <option value="">– choose –</option>}
        {allCos.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}
      </select>
    ) : (CO_SHORT[r.company] || r.company || <span className="muted">–</span>))
  });
  const attCol = {
    key: 'att', label: `Attendance · ${monthLabel(month)}`, type: 'calc', width: 190,
    render: (r) => {
      const x = statOf(r);
      return (
        <Link className="pn-att" href={`/personnel?tab=attendance&co=${r.company}&m=${month}`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); openAttendance(r.company); }} title="Open the attendance sheet">
          <b className="ok">P {x.present}</b> <b className="bad">A {x.absent}</b> <b>L {x.leave}</b> <b>H {x.half}</b>
        </Link>
      );
    }
  };

  function staffColumns(kind) {
    const T = 'exp_staff';
    return [
      { key: 'name', label: 'Name', type: 'text', width: 200 },
      companyColFor('exp_staff'),
      { key: 'designation', label: 'Designation', type: 'text', width: 160, raw: (r) => r.designation || r.department || '', render: (r) => r.designation || r.department || <span className="muted">–</span> },
      { key: 'contract', label: 'Contract', type: 'text', width: 210, placeholder: 'e.g. 2 years, ends 03/2027', render: docCell(T, 'contract', 'Contract', (r) => r.contract) },
      { key: 'resident_card_expiry', label: 'Resident Card Expiry', type: 'date', width: 210, render: docCell(T, 'resident', 'Resident card', (r) => (r.resident_card_expiry ? <Expiry date={r.resident_card_expiry} /> : '')) },
      { key: 'passport', label: 'Passport', type: 'text', width: 190, placeholder: 'Passport No.', render: docCell(T, 'passport', 'Passport', (r) => r.passport) },
      { ...money('basic'), label: 'Basic' },
      { ...money('allowances'), label: 'Total' },
      { ...money('house_rent'), label: 'House rent' },
      { ...money('utilities'), label: 'Utilities' },
      { key: 'transport_allow', label: 'Transport', type: 'select', width: 100, options: ['Yes', 'No'], raw: (r) => (r.transport_allow ? 'Yes' : 'No'), render: (r) => (r.transport_allow ? <b className="pn-yes">Yes</b> : <span className="muted">No</span>) },
      ...(kind === 'site' ? [] : [{ key: 'mobile', label: 'Contact (Mobile)', type: 'text', width: 140, placeholder: '9xxxxxxx' }]),
      { key: 'ticket', label: 'Ticket', type: 'combo', width: 120, options: TICKETS },
      attCol,
      ...(kind === 'site' ? [{ key: 'mobile', label: 'Contact Number', type: 'text', width: 140, placeholder: '9xxxxxxx' }] : []),
      paidCol(T),
      { key: 'slip', label: 'Salary slip', type: 'calc', width: 300, render: slipCell(T) }
    ];
  }
  const driverColumns = [
    { key: 'name', label: 'Name', type: 'text', width: 180 },
    companyColFor('transport_drivers'),
    { key: 'contract', label: 'Contract', type: 'text', width: 210, placeholder: 'e.g. 2 years, ends 03/2027', render: docCell('transport_drivers', 'contract', 'Contract', (r) => r.contract) },
    { key: 'resident_card_expiry', label: 'Resident Card Expiry', type: 'date', width: 210, render: docCell('transport_drivers', 'resident', 'Resident card', (r) => (r.resident_card_expiry ? <Expiry date={r.resident_card_expiry} /> : '')) },
    { key: 'passport', label: 'Passport', type: 'text', width: 190, placeholder: 'Passport No.', render: docCell('transport_drivers', 'passport', 'Passport', (r) => r.passport) },
    { ...money('salary'), label: 'Basic' },
    { ...money('allowances'), label: 'Total' },
    { ...money('house_rent'), label: 'House rent' },
    { ...money('utilities'), label: 'Utilities' },
    { key: 'ticket', label: 'Ticket', type: 'combo', width: 120, options: TICKETS },
    paidCol('transport_drivers'),
    { key: 'slip', label: 'Salary slip', type: 'calc', width: 300, render: slipCell('transport_drivers') }
  ];
  const subColumns = [
    { key: 'name', label: 'Name', type: 'text', width: 200 },
    companyColFor('personnel_subcontractors', 'Works for'),
    { key: 'company_name', label: 'Company name', type: 'text', width: 220 },
    { key: 'contract', label: 'Contract', type: 'text', width: 240, placeholder: 'Work / period / amount', render: docCell('personnel_subcontractors', 'contract', 'Contract', (r) => r.contract) },
    { key: 'contact', label: 'Contact', type: 'text', width: 170, placeholder: 'Mobile / email' }
  ];

  const salaryGroups = (cols) => makeGroups(cols, [
    [{ label: 'Salary', keys: cols.map((c) => c.key).filter((k) => ['basic', 'salary', 'allowances', 'house_rent', 'utilities', 'transport_allow'].includes(k)) }],
    [{ label: 'Allowance', keys: cols.map((c) => c.key).filter((k) => ['allowances', 'house_rent', 'utilities', 'transport_allow'].includes(k)) }]
  ]);

  /* ---------- rows for the tab ---------- */
  /* 🔍 Search looks in every box of a person (name, company, designation, passport, resident card, mobile, contract,
     ticket, vehicle, salary figures, file names, archive reason...) */
  const hay = (r) => {
    const bits = [];
    const walk = (v) => {
      if (v == null || v === '') return;
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!/^(path|type|size|at|id)$/.test(k)) walk(x); });
      else bits.push(String(v));
    };
    Object.entries(r).forEach(([k, v]) => { if (!/(^id$|_id$|token|sort|created_at|^user_id$)/.test(k)) walk(v); });
    bits.push(CO_SHORT[r.company] || '', r.staff_type || '', r.transport_allow ? 'transport yes' : '');
    if (r.resident_card_expiry) bits.push(String(r.resident_card_expiry).split('-').reverse().join('/'));
    return bits.join(' ').toLowerCase();
  };
  const match = (r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return s.split(/\s+/).every((w) => hay(r).includes(w));
  };
  const coOk = (r) => !co || r.company === co;
  const officeRows = (staff || []).filter((r) => (r.staff_type || 'Office') !== 'Site' && r.active !== false && coOk(r) && match(r));
  const siteRows = (staff || []).filter((r) => r.staff_type === 'Site' && r.active !== false && coOk(r) && match(r));
  const driverRows = (drivers || []).filter((r) => coOk(r) && match(r));
  const subRows = (subs || []).filter((r) => coOk(r) && match(r));

  const sumFoot = (rows, basicKey) => ({
    name: `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`,
    [basicKey]: fmtAmt(rows.reduce((t, r) => t + n(r[basicKey]), 0)),
    allowances: fmtAmt(rows.reduce((t, r) => t + n(r.allowances), 0)),
    house_rent: fmtAmt(rows.reduce((t, r) => t + n(r.house_rent), 0)),
    utilities: fmtAmt(rows.reduce((t, r) => t + n(r.utilities), 0))
  });

  function doExcel() {
    const tCo = (r) => CO_SHORT[r.company] || r.company || '';
    const staffSheet = (name, rows) => ({
      name, title: `${name} · Tudo Num`, subtitle: exportStamp(),
      head: ['Name', 'Company', 'Designation', 'Contract', 'Resident card expiry', 'Passport', 'Basic', 'Allowance total', 'House rent', 'Utilities', 'Transport', 'Contact', 'Ticket', `Present ${monthLabel(month)}`, 'Absent', 'Leave', 'Half'],
      rows: rows.map((r) => { const x = statOf(r); return [r.name, tCo(r), r.designation || r.department || '', r.contract || '', r.resident_card_expiry || '', r.passport || '', n(r.basic), n(r.allowances), n(r.house_rent), n(r.utilities), r.transport_allow ? 'Yes' : 'No', r.mobile || '', r.ticket || '', x.present, x.absent, x.leave, x.half]; }),
      numCols: [6, 7, 8, 9]
    });
    exportExcel(`Personnel ${todayISO()}.xlsx`, [
      staffSheet('Office Employees', officeRows),
      { name: 'Drivers', title: 'Drivers · Tudo Num', subtitle: exportStamp(), head: ['Name', 'Company', 'Contract', 'Resident card expiry', 'Passport', 'Basic', 'Allowance total', 'House rent', 'Utilities', 'Ticket'], rows: driverRows.map((r) => [r.name, tCo(r), r.contract || '', r.resident_card_expiry || '', r.passport || '', n(r.salary), n(r.allowances), n(r.house_rent), n(r.utilities), r.ticket || '']), numCols: [5, 6, 7, 8] },
      staffSheet('Site Employees', siteRows),
      { name: 'Subcontractors', title: 'Subcontractors · Tudo Num', subtitle: exportStamp(), head: ['Name', 'Works for', 'Company name', 'Contract', 'Contact'], rows: subRows.map((r) => [r.name, tCo(r), r.company_name || '', r.contract || '', r.contact || '']), numCols: [] }
    ]);
  }

  if (staff === null) return <div className="loading">Loading...</div>;

  const showCo = tab !== 'attendance';
  const own = tab === 'attendance' || tab === 'archives'; // tabs with their own toolbar
  const canDel = isAdmin && canDelete;
  let grid = null;
  if (tab === 'office' || tab === 'site') {
    const cols = staffColumns(tab);
    const rows = tab === 'office' ? officeRows : siteRows;
    grid = (
      <DataGrid columns={cols} groups={salaryGroups(cols)} rows={rows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('exp_staff', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel={`+ Add ${tab === 'site' ? 'site' : 'office'} employee${co ? ` (${CO_SHORT[co]})` : ' (Sumptuosity)'}`}
        onDelete={delMode && canDel ? (row) => setDel({ table: 'exp_staff', row }) : undefined} deleting={delMode && canDel}
        footer={sumFoot(rows, 'basic')}
        emptyText={q.trim() ? `Nothing here matches "${q.trim()}". Look at the 🔍 search list for other tabs.` : tab === 'site' ? 'No site employees yet. Press ✏️ Edit, then ＋ Add new, or change a person to Site on the Attendance page.' : 'No office employees yet.'} />
    );
  } else if (tab === 'drivers') {
    grid = (
      <DataGrid columns={driverColumns} groups={salaryGroups(driverColumns)} rows={driverRows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('transport_drivers', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel="+ Add driver"
        onDelete={delMode && canDel ? (row) => setDel({ table: 'transport_drivers', row }) : undefined} deleting={delMode && canDel}
        footer={sumFoot(driverRows, 'salary')} />
    );
  } else if (tab === 'sub') {
    grid = (
      <DataGrid columns={subColumns} rows={subRows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('personnel_subcontractors', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel="+ Add subcontractor"
        onDelete={delMode && canDel ? (row) => setDel({ table: 'personnel_subcontractors', row }) : undefined} deleting={delMode && canDel}
        emptyText="No subcontractors yet. Press ✏️ Edit, then ＋ Add new." />
    );
  }

  return (
    <>
      <div className="pn-wrap">
      <div className="company-head ch-top pn-head">
        <div className="pn-head-txt">
          <span className="company-name">Tudo Num Group</span>
          <h1>👥 Personnel</h1>
          <p className="sub">Employees · {(staff || []).length + (drivers || []).length + (subs || []).length} people · {monthLabel(month)}</p>
        </div>
        <PeopleSearch q={q} setQ={setQ} hay={hay} coShort={CO_SHORT}
          groups={[
            ['office', '🏢 Office', (staff || []).filter((r) => r.staff_type !== 'Site')],
            ['site', '👷 Site', (staff || []).filter((r) => r.staff_type === 'Site')],
            ['drivers', '🚚 Drivers', drivers || []],
            ['sub', '🤝 Subcontractors', subs || []],
            ['archives', '🗄 Archives', archived.map((a) => a.row)]
          ]}
          onOpen={(t) => { setCo(''); setCoDetail(''); goTab(t); }} />
      </div>

      <div className="co-switch pn-tabs no-print" role="tablist" aria-label="Employees">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>
            {label}
            <small className="pn-count">{k === 'office' ? (staff || []).filter((r) => (r.staff_type || 'Office') !== 'Site' && r.active !== false && coOk(r)).length : k === 'site' ? (staff || []).filter((r) => r.staff_type === 'Site' && r.active !== false && coOk(r)).length : k === 'drivers' ? (drivers || []).filter(coOk).length : k === 'sub' ? (subs || []).filter(coOk).length : k === 'archives' ? archived.filter((x) => coOk(x.row)).length : ''}</small>
          </button>
        ))}
      </div>


      {showCo && (
        <div className="pn-row no-print">
          <div className="pn-chips">
          <CompanyList companies={allCos} staff={staff || []} drivers={drivers || []} active={!co}
            onAll={() => { setCo(''); setCoDetail(''); }}
            onPick={(k) => { setCo(k); setCoDetail(k); }} />
          {allCos.map((c) => <button key={c.key} type="button" className={co === c.key ? 'on' : ''} onClick={() => { setCo(c.key); setCoDetail(''); }} title={c.name || c.short}>{c.short}</button>)}
          </div>
          {(tab === 'office' || tab === 'site' || tab === 'drivers') && (
            <div className="month-select at-month pn-month">
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, -1))} aria-label="Previous month">‹</button>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, 1))} aria-label="Next month">›</button>
            </div>
          )}
        </div>
      )}

      {coDetail && allCos.find((c) => c.key === coDetail) && (
        <CompanyDetail company={allCos.find((c) => c.key === coDetail)} staff={staff || []} drivers={drivers || []} credits={credits} month={month}
          onClose={() => setCoDetail('')} onOpen={(t, name) => { setCo(coDetail); goTab(t); setQ(name); setCoDetail(''); }} />
      )}
      {error && <div className="error">{error}</div>}

      {!own && <div className="pn-bar no-print">
        {tab !== 'attendance' && isAdmin && (
          <EditMenu
            edit={edit} delMode={delMode} undoCount={undo.length}
            canDel={canDel}
            delNote={!canDel ? 'Only Full access and Administrator can delete' : 'moves him to 🗄 Archives (hidden everywhere, kept in the database)'}
            onEdit={() => setEdit((v) => !v)}
            onAdd={addRow}
            onDelete={() => setDelMode((v) => !v)}
            onUndo={doUndo}
            onDone={() => { setEdit(false); setDelMode(false); }}
          />
        )}
        {isAdmin && (tab === 'office' || tab === 'site' || tab === 'drivers') && (
          <button type="button" className="btn" onClick={() => setPayAll(true)}>💵 All {tab === 'office' ? 'Office Employees' : tab === 'site' ? 'Site Employees' : 'Drivers'} Salary Paid</button>
        )}
        <PrintColumns className="btn" />
        {!own && <button type="button" className="btn" onClick={doExcel}>📗 Excel</button>}
        {(edit || delMode) && <span className="pn-mode">{[edit && '✏️ Editing: tap a box to change it', delMode && '🗑 Tap the red 🗑 at the start of a row to delete (moves to Archives)'].filter(Boolean).join(' · ')}</span>}
      </div>}


      {(tab === 'office' || tab === 'site') && <p className="muted pn-note no-print">Same people as the All Companies salary sheet · Attendance column from the Attendance tab{edit ? ' · House rent and Utilities also change the Allowance total' : ''}</p>}
      {tab === 'drivers' && <p className="muted pn-note no-print">Same drivers as Transport › Drivers · monthly driver salaries stay in the Transport salary sheets</p>}
      </div>

      {tab === 'attendance' ? <AttendanceSheet /> : tab === 'archives' ? (
        <section className="panel arch">
          <div className="section-head"><h2>🗄 Archives <small className="muted">{archived.filter((a) => coOk(a.row) && match(a.row)).length}</small></h2></div>
          <p className="muted" style={{ marginTop: 0 }}>Previous employees, drivers and subcontractors. They are hidden from every table, salary, attendance and alert and get no updates. Their data stays here as it was. Deleted someone by mistake? Press <b>↶ Undo delete</b> and he is back everywhere, exactly as before.</p>
          {!archived.length && <p className="muted">Nothing in the Archives.</p>}
          <div className="arch-list">
            {archived.filter((a) => coOk(a.row) && match(a.row)).map(({ table, row }) => (
              <div key={row.id} className="arch-item">
                <div className="arch-who">
                  <b>{row.name}</b>
                  <small>{[table === 'transport_drivers' ? 'Driver' : table === 'personnel_subcontractors' ? 'Subcontractor' : `${row.staff_type || 'Office'} employee`, CO_SHORT[row.company] || row.company, row.designation || row.department || row.vehicle_no || row.company_name].filter(Boolean).join(' · ')}</small>
                  <small className="arch-when">Archived {new Date(row.archived_at).toLocaleDateString('en-GB')}{row.archived_by ? ` by ${row.archived_by}` : ''}{row.archive_reason ? ` · ${row.archive_reason}` : ''}</small>
                </div>
                <span className="arch-btns">
                  <button type="button" className="dfl-btn" onClick={() => setViewArch({ table, row })}>👁 View</button>
                  {isAdmin && <button type="button" className="dfl-btn arch-undo" title="Deleted by mistake? Bring him back exactly as he was" onClick={async () => { if (await restore(table, row)) flash(`Undone: ${row.name} is back in ${table === 'transport_drivers' ? 'Drivers' : table === 'personnel_subcontractors' ? 'Subcontractors' : row.staff_type === 'Site' ? 'Site Employees' : 'Office Employees'}, with all his data`); }}>↶ Undo delete</button>}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : grid}

      {send && (
        <SendSlipLink table={send.table} row={(send.table === 'exp_staff' ? staff : drivers).find((x) => x.id === send.row.id) || send.row} flash={flash} onClose={() => setSend(null)}
          onChanged={(row) => setterOf(send.table)((l) => (l || []).map((x) => (x.id === row.id ? row : x)))} />
      )}
      {viewSlip && <SlipViewer name={viewSlip.name} slips={slipsAll.filter((x) => x.person_kind === viewSlip.kind && x.person_id === viewSlip.id)} onClose={() => setViewSlip(null)} />}
      {payAll && (() => {
        const list = tab === 'office' ? officeRows : tab === 'site' ? siteRows : driverRows;
        const kind = tab === 'drivers' ? 'driver' : 'staff';
        const todo = list.filter((r) => !credits[creditKey(kind, r.id)]);
        return (
          <Modal title="⚠ Are you sure?" onClose={() => setPayAll(false)}>
            <p style={{ marginTop: 0 }}>Mark <b>{todo.length}</b> {tab === 'office' ? 'office employee' : tab === 'site' ? 'site employee' : 'driver'}{todo.length === 1 ? '' : 's'}{co ? ` of ${CO_SHORT[co]}` : ''} as <b>salary paid</b> for <b>{monthLabel(month)}</b>?</p>
            {todo.length > 0 && <div className="sure-warn">📱 Every one of them gets a notification on his mobile: <b>“Salary slip ready”</b>, and his slip shows in his app. This cannot be taken back from their phones.</div>}
            {todo.length > 0 && <p className="muted sure-names">{todo.map((r) => r.name).join(' · ')}</p>}
            {!todo.length && <p className="ok">Everyone here is already paid.</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" autoFocus onClick={() => setPayAll(false)}>No, cancel</button>
              <button type="button" className="btn in" disabled={!todo.length} onClick={() => payPeople(todo.map((r) => ({ kind, id: r.id, name: r.name })))}>Yes, I am sure</button>
            </div>
          </Modal>
        );
      })()}

      {addCo && (
        <Modal title="＋ Add company" onClose={() => setAddCo(null)}>
          <label className="dfl-label">Short name (on the button)
            <input className="drv-input" autoFocus value={addCo.short} placeholder="e.g. Tudo Tech" onChange={(e) => setAddCo({ ...addCo, short: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveCompany(); }} />
          </label>
          <label className="dfl-label" style={{ marginTop: 10 }}>Full company name (optional)
            <input className="drv-input" value={addCo.name} placeholder="e.g. TUDO TECH L.L.C" onChange={(e) => setAddCo({ ...addCo, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveCompany(); }} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setAddCo(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={saveCompany}>Add company</button>
          </div>
        </Modal>
      )}
      {del && (
        <Modal title="Delete?" onClose={() => { setDel(null); setDelReason(''); }}>
          <p style={{ margin: 0 }}>Delete <b>{del.row.name}</b>? He disappears from every table, list, salary, attendance and alert{del.table !== 'personnel_subcontractors' ? ' and his salary slip link stops working' : ''}. Nothing is lost: he is kept in <b>🗄 Archives</b> and can be restored.</p>
          <label className="dfl-label" style={{ marginTop: 10 }}>Reason (optional)
            <input className="drv-input" value={delReason} placeholder="e.g. Left the company, visa cancelled" onChange={(e) => setDelReason(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => { setDel(null); setDelReason(''); }}>Cancel</button>
            <button type="button" className="btn danger" onClick={confirmDelete}>Delete (move to Archives)</button>
          </div>
        </Modal>
      )}
      {viewArch && (() => {
        const r = viewArch.row;
        const rows = [
          ['Name', r.name], ['Company', CO_SHORT[r.company] || r.company], ['Designation', r.designation || r.department], ['Type', viewArch.table === 'transport_drivers' ? 'Driver' : viewArch.table === 'personnel_subcontractors' ? 'Subcontractor' : r.staff_type],
          ['Company name', r.company_name], ['Vehicle', r.vehicle_no], ['Contract', r.contract], ['Passport', r.passport], ['Resident card', r.resident_card], ['Resident card expiry', r.resident_card_expiry], ['Visa expiry', r.visa_expiry],
          ['Basic salary', viewArch.table === 'transport_drivers' ? r.salary : r.basic], ['Allowance total', r.allowances], ['House rent', r.house_rent], ['Utilities', r.utilities], ['Ticket', r.ticket],
          ['Mobile', r.mobile || r.phone || r.contact], ['Archived', `${new Date(r.archived_at).toLocaleString('en-GB')}${r.archived_by ? ` by ${r.archived_by}` : ''}`], ['Reason', r.archive_reason]
        ].filter(([, v]) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !v) && v !== '0');
        return (
          <Modal title={`🗄 ${r.name}`} onClose={() => setViewArch(null)}>
            <dl className="arch-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setViewArch(null)}>Close</button>
              {isAdmin && <button type="button" className="btn in" onClick={async () => { if (await restore(viewArch.table, r)) { flash(`Undone: ${r.name} is back, with all his data`); setViewArch(null); } }}>↶ Undo delete</button>}
            </div>
          </Modal>
        );
      })()}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

/* ✏️ Edit button with its menu: Edit cells, ＋ Add new, 🗑 Delete, ↶ Undo, ✓ Done */
function EditMenu({ edit, delMode, undoCount, canDel, delNote, onEdit, onAdd, onDelete, onUndo, onDone }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const act = (fn) => () => { setOpen(false); fn(); };
  const on = edit || delMode;
  return (
    <div className="pn-edit" ref={box}>
      <button type="button" className={`btn${on ? ' in' : ''}`} aria-pressed={on} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ✏️ Edit <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pn-menu" role="menu">
          <button type="button" role="menuitem" className={edit ? 'on' : ''} onClick={act(onEdit)}>✏️ {edit ? 'Stop editing' : 'Edit table'}<small>tap a box to change it</small></button>
          <button type="button" role="menuitem" onClick={act(onAdd)}>＋ Add new<small>new row at the bottom</small></button>
          <button type="button" role="menuitem" className={delMode ? 'on' : ''} onClick={act(onDelete)} disabled={!canDel}>🗑 {delMode ? 'Hide Delete buttons' : 'Delete'}<small>{delNote || 'shows a Delete button on each row'}</small></button>
          <button type="button" role="menuitem" onClick={act(onUndo)} disabled={!undoCount}>↶ Undo{undoCount ? ` (${undoCount})` : ''}<small>last change, add or delete</small></button>
          {on && <button type="button" role="menuitem" className="done" onClick={act(onDone)}>✓ Done</button>}
        </div>
      )}
    </div>
  );
}

/* "All companies ▾": every company with how many employees it has (Office, Site, Drivers). Subcontractors are left
   out: their visa is not with our companies. Tap a company = filter + detailed table of all its employees. */
function CompanyList({ companies, staff, drivers, active, onAll, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const count = (k) => {
    const st = staff.filter((p) => p.company === k && p.active !== false);
    const site = st.filter((p) => p.staff_type === 'Site').length;
    const drv = drivers.filter((p) => (p.company || 'modern-city') === k).length;
    return { office: st.length - site, site, drv, all: st.length + drv };
  };
  const total = companies.reduce((t, c) => t + count(c.key).all, 0);
  return (
    <div className="cl" ref={box}>
      <button type="button" className={active ? 'on' : ''} aria-haspopup="listbox" aria-expanded={open} onClick={() => { onAll(); setOpen((v) => !v); }}>
        All companies <small className="cl-n">{total}</small> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cl-menu" role="listbox">
          <div className="cl-note">Employees on our companies' visa (subcontractors not included). Tap a company for its full table.</div>
          {companies.map((c) => {
            const n = count(c.key);
            return (
              <button key={c.key} type="button" role="option" aria-selected={false} className="cl-name cl-co" onClick={() => { onPick(c.key); setOpen(false); }} title={c.name}>
                <b>{c.short} <span className="cl-n">{n.all}</span></b><small>Office {n.office} · Site {n.site} · Drivers {n.drv}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Detailed table of one company's employees (from "All companies ▾") */
function CompanyDetail({ company, staff, drivers, credits, month, onClose, onOpen }) {
  const list = [
    ...staff.filter((p) => p.company === company.key && p.active !== false).map((p) => ({ ...p, kind: 'staff', type: p.staff_type === 'Site' ? 'Site' : 'Office', job: p.designation || p.department || '', pay: Number(p.basic || 0), tab: p.staff_type === 'Site' ? 'site' : 'office' })),
    ...drivers.filter((p) => (p.company || 'modern-city') === company.key).map((p) => ({ ...p, kind: 'driver', type: 'Driver', job: p.vehicle_no || '', pay: Number(p.salary || 0), tab: 'drivers' }))
  ];
  const sum = (k) => list.reduce((t, p) => t + Number(p[k] || 0), 0);
  return (
    <section className="panel cd">
      <div className="section-head">
        <h2>🏢 {company.short} <small className="muted">{company.name} · {list.length} employee{list.length === 1 ? '' : 's'}</small></h2>
        <button type="button" className="btn ghost small no-print" onClick={onClose}>✕ Close</button>
      </div>
      <div className="grid-wrap">
        <table className="summary-table cd-table">
          <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Designation / Vehicle</th><th>Mobile</th><th>Passport</th><th>Resident card expiry</th><th className="num">Basic</th><th className="num">Allowance</th><th className="num">Monthly</th><th>Salary · {monthLabel(month)}</th></tr></thead>
          <tbody>
            {list.map((p, i) => {
              const paid = credits[creditKey(p.kind, p.id)];
              return (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <td><button type="button" className="al-link" onClick={() => onOpen(p.tab, p.name)}>{p.name}</button></td>
                  <td>{p.type}</td>
                  <td>{p.job || '–'}</td>
                  <td>{p.mobile || p.phone || <span className="bad">missing</span>}</td>
                  <td>{p.passport || '–'}</td>
                  <td>{p.resident_card_expiry ? <Expiry date={p.resident_card_expiry} /> : '–'}</td>
                  <td className="num">{fmtAmt(p.pay)}</td>
                  <td className="num">{fmtAmt(p.allowances)}</td>
                  <td className="num"><b>{fmtAmt(p.pay + Number(p.allowances || 0))}</b></td>
                  <td>{paid ? <span className="ssl-st ok">✓ Paid</span> : <span className="ssl-st draft">Not paid</span>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={11} className="muted">No employees in this company yet.</td></tr>}
          </tbody>
          {list.length > 0 && (
            <tfoot><tr><td /><td><b>Total</b></td><td colSpan={5}>Office {list.filter((p) => p.type === 'Office').length} · Site {list.filter((p) => p.type === 'Site').length} · Drivers {list.filter((p) => p.type === 'Driver').length}</td>
              <td className="num"><b>{fmtAmt(list.reduce((t, p) => t + p.pay, 0))}</b></td><td className="num"><b>{fmtAmt(sum('allowances'))}</b></td><td className="num"><b>{fmtAmt(list.reduce((t, p) => t + p.pay + Number(p.allowances || 0), 0))}</b></td><td /></tr></tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

/* 🔍 Search in the Personnel heading: looks through every person (all tabs, Archives too) in every box.
   Shows how many found per tab and the first names; tap one to open that tab filtered by the search. */
function PeopleSearch({ q, setQ, hay, groups, coShort, onOpen }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? groups.map(([k, label, list]) => [k, label, list.filter((r) => words.every((w) => hay(r).includes(w)))]) : [];
  const total = found.reduce((t, g) => t + g[2].length, 0);
  return (
    <div className="ps" ref={box}>
      <span className="ps-ico" aria-hidden="true">🔍</span>
      <input type="search" value={q} placeholder="Search everything in Personnel" aria-label="Search Personnel"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); } if (e.key === 'Enter') { const g = found.find((x) => x[2].length); if (g) { onOpen(g[0]); setOpen(false); } } }} />
      {open && words.length > 0 && (
        <div className="ps-menu">
          <div className="ps-sum">{total ? `${total} found` : 'Nothing found'}{total ? <span> · {found.filter((g) => g[2].length).map((g) => `${g[1].split(' ').slice(1).join(' ')} ${g[2].length}`).join(' · ')}</span> : null}</div>
          {found.filter((g) => g[2].length).map(([k, label, list]) => (
            <div key={k} className="ps-grp">
              <button type="button" className="ps-head" onClick={() => { onOpen(k); setOpen(false); }}>{label} <b>{list.length}</b><span>Open ›</span></button>
              {list.slice(0, 6).map((r) => (
                <button key={r.id} type="button" className="ps-item" onClick={() => { setQ(r.name); onOpen(k); setOpen(false); }}>
                  <span>{r.name}</span><small>{[coShort[r.company] || r.company_name, r.designation || r.department || r.vehicle_no, r.passport, r.mobile || r.phone || r.contact].filter(Boolean).join(' · ')}</small>
                </button>
              ))}
              {list.length > 6 && <small className="ps-more">+ {list.length - 6} more: tap {label.split(' ').slice(1).join(' ')}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <AuthGate wide><PersonnelPage /></AuthGate>;
}
