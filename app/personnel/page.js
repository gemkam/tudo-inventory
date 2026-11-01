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
  ['attendance', '🗓 Attendance']
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
    setStaff(st.data || []);
    setDrivers(dr.data || []);
    setSubs(sc.data || []);
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

  async function confirmDelete() {
    const { table, row } = del;
    setDel(null);
    const { error: err } = await sb().from(table).delete().eq('id', row.id);
    if (err) { flash(err.message, 'err'); return; }
    setterOf(table)((l) => (l || []).filter((x) => x.id !== row.id));
    remember({ type: 'delete', table, id: row.id, row, label: row.name });
    flash('Deleted. ↶ Undo brings it back');
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
      if (!err) setterOf(step.table)((l) => (l || []).map((x) => (x.id === step.id ? { ...x, ...step.before } : x)));
    } else if (step.type === 'add') {
      ({ error: err } = await s.from(step.table).delete().eq('id', step.id));
      if (!err) setterOf(step.table)((l) => (l || []).filter((x) => x.id !== step.id));
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
  const companyCol = { key: 'company', label: 'Company', type: 'select', width: 135, options: allCos.map((c) => c.short), raw: (r) => CO_SHORT[r.company] || r.company || '', render: (r) => CO_SHORT[r.company] || r.company || <span className="muted">–</span> };
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
      companyCol,
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
    companyCol,
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
    { ...companyCol, label: 'Works for' },
    { key: 'company_name', label: 'Company name', type: 'text', width: 220 },
    { key: 'contract', label: 'Contract', type: 'text', width: 240, placeholder: 'Work / period / amount', render: docCell('personnel_subcontractors', 'contract', 'Contract', (r) => r.contract) },
    { key: 'contact', label: 'Contact', type: 'text', width: 170, placeholder: 'Mobile / email' }
  ];

  const salaryGroups = (cols) => makeGroups(cols, [
    [{ label: 'Salary', keys: cols.map((c) => c.key).filter((k) => ['basic', 'salary', 'allowances', 'house_rent', 'utilities', 'transport_allow'].includes(k)) }],
    [{ label: 'Allowance', keys: cols.map((c) => c.key).filter((k) => ['allowances', 'house_rent', 'utilities', 'transport_allow'].includes(k)) }]
  ]);

  /* ---------- rows for the tab ---------- */
  const match = (r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [r.name, r.designation, r.department, r.passport, r.mobile, r.phone, r.company_name, r.contact, CO_SHORT[r.company]].some((v) => String(v || '').toLowerCase().includes(s));
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
  const own = tab === 'attendance'; // tab with its own toolbar
  const canDel = isAdmin && canDelete;
  let grid = null;
  if (tab === 'office' || tab === 'site') {
    const cols = staffColumns(tab);
    const rows = tab === 'office' ? officeRows : siteRows;
    grid = (
      <DataGrid columns={cols} groups={salaryGroups(cols)} rows={rows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('exp_staff', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel={`+ Add ${tab === 'site' ? 'site' : 'office'} employee${co ? ` (${CO_SHORT[co]})` : ' (Sumptuosity)'}`}
        onDelete={delMode && canDel ? (row) => setDel({ table: 'exp_staff', row }) : undefined}
        footer={sumFoot(rows, 'basic')}
        emptyText={tab === 'site' ? 'No site employees yet. Press ✏️ Edit, then ＋ Add new, or change a person to Site on the Attendance page.' : 'No office employees yet.'} />
    );
  } else if (tab === 'drivers') {
    grid = (
      <DataGrid columns={driverColumns} groups={salaryGroups(driverColumns)} rows={driverRows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('transport_drivers', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel="+ Add driver"
        footer={sumFoot(driverRows, 'salary')} />
    );
  } else if (tab === 'sub') {
    grid = (
      <DataGrid columns={subColumns} rows={subRows} canEdit={edit && isAdmin} flash={flash}
        onSave={(row, key, value) => onSave('personnel_subcontractors', row, key, value)}
        onAdd={edit && isAdmin ? addRow : undefined} addLabel="+ Add subcontractor"
        onDelete={delMode && canDel ? (row) => setDel({ table: 'personnel_subcontractors', row }) : undefined}
        emptyText="No subcontractors yet. Press ✏️ Edit, then ＋ Add new." />
    );
  }

  return (
    <>
      <div className="page-tools no-print">
        <h1 className="pn-title">👥 Personnel <small>Employees</small></h1>
        <div className="tools">
          {tab === 'office' || tab === 'site' || tab === 'drivers' ? (
            <div className="month-select at-month">
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, -1))} aria-label="Previous month">‹</button>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, 1))} aria-label="Next month">›</button>
            </div>
          ) : null}
          {!own && <input className="pn-search" type="search" placeholder="Search name, passport, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />}
          {!own && <button type="button" className="btn ghost" onClick={doExcel}>📗 Excel</button>}
        </div>
      </div>

      <div className="co-switch pn-tabs no-print" role="tablist" aria-label="Employees">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>
            {label}
            <small className="pn-count">{k === 'office' ? (staff || []).filter((r) => (r.staff_type || 'Office') !== 'Site' && r.active !== false && coOk(r)).length : k === 'site' ? (staff || []).filter((r) => r.staff_type === 'Site' && r.active !== false && coOk(r)).length : k === 'drivers' ? (drivers || []).filter(coOk).length : k === 'sub' ? (subs || []).filter(coOk).length : ''}</small>
          </button>
        ))}
      </div>

      {showCo && (
        <div className="pn-chips no-print">
          <CompanyList companies={allCos} staff={staff || []} drivers={drivers || []} active={!co}
            onAll={() => setCo('')}
            onPick={(k) => setCo(k)}
            onPerson={(k, tabKey, name) => { setCo(k); goTab(tabKey); setQ(name); }} />
          {allCos.map((c) => <button key={c.key} type="button" className={co === c.key ? 'on' : ''} onClick={() => setCo(c.key)} title={c.name || c.short}>{c.short}</button>)}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {(tab === 'office' || tab === 'site') && (
        <p className="muted pn-note no-print">
          Same people as the salary sheet in All Companies. The Attendance column comes from the Attendance tab ({monthLabel(month)}); tap it to open the sheet.
          {edit ? ' Changing House rent or Utilities also changes the Allowance total.' : ''}
        </p>
      )}
      {tab === 'drivers' && <p className="muted pn-note no-print">Same drivers as Transport &gt; Drivers. Monthly driver salaries stay in the Transport salary sheets.</p>}

      {/* Two buttons just above the table: ✏️ Edit (menu: Edit cells, Add new, Delete, Undo) and 🖨 Print */}
      {!own && <div className="pn-bar no-print">
        {tab !== 'attendance' && isAdmin && (
          <EditMenu
            edit={edit} delMode={delMode} undoCount={undo.length}
            canDel={canDel && tab !== 'drivers'}
            delNote={tab === 'drivers' ? 'Drivers are deleted from Transport > Drivers' : !canDel ? 'Only Full access and Administrator can delete' : ''}
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
        {(edit || delMode) && <span className="pn-mode">{[edit && '✏️ Editing: tap a box to change it', delMode && '🗑 Delete buttons are on'].filter(Boolean).join(' · ')}</span>}
      </div>}

      {tab === 'attendance' ? <AttendanceSheet /> : grid}

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
        <Modal title="Delete?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.row.name}</b>?{del.table === 'exp_staff' ? ' This person is also removed from the All Companies salary sheet and attendance.' : ''}</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
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

/* "All companies ▾": every company with its employees (Office, Site, Drivers). Subcontractors are left out:
   their visa is not with our companies. Tap a company to filter, tap a name to open him. */
function CompanyList({ companies, staff, drivers, active, onAll, onPick, onPerson }) {
  const [open, setOpen] = useState(false);
  const [shut, setShut] = useState({});
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const people = (k) => [
    ...staff.filter((p) => p.company === k && p.active !== false).map((p) => ({ id: p.id, name: p.name, type: p.staff_type === 'Site' ? 'Site' : 'Office', tab: p.staff_type === 'Site' ? 'site' : 'office', job: p.designation || p.department || '' })),
    ...drivers.filter((p) => (p.company || 'modern-city') === k).map((p) => ({ id: p.id, name: p.name, type: 'Driver', tab: 'drivers', job: p.vehicle_no || '' }))
  ];
  const total = companies.reduce((t, c) => t + people(c.key).length, 0);
  return (
    <div className="cl" ref={box}>
      <button type="button" className={active ? 'on' : ''} aria-haspopup="listbox" aria-expanded={open} onClick={() => { onAll(); setOpen((v) => !v); }}>
        All companies <small className="cl-n">{total}</small> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cl-menu" role="listbox">
          <div className="cl-note">Employees on our companies' visa (subcontractors not included)</div>
          {companies.map((c) => {
            const list = people(c.key);
            const n = (t) => list.filter((x) => x.type === t).length;
            return (
              <div key={c.key} className="cl-co">
                <div className="cl-head">
                  <button type="button" className="cl-name" onClick={() => { onPick(c.key); setOpen(false); }} title={c.name}>
                    <b>{c.short}</b><small>{list.length} · Office {n('Office')} · Site {n('Site')} · Drivers {n('Driver')}</small>
                  </button>
                  {list.length > 0 && <button type="button" className="cl-tog" aria-label={shut[c.key] ? 'Show names' : 'Hide names'} onClick={() => setShut((x) => ({ ...x, [c.key]: !x[c.key] }))}>{shut[c.key] ? '▸' : '▾'}</button>}
                </div>
                {!shut[c.key] && (
                  <div className="cl-people">
                    {list.map((p) => (
                      <button key={p.id} type="button" className="cl-p" onClick={() => { onPerson(c.key, p.tab, p.name); setOpen(false); }}>
                        <span>{p.name}</span><small>{[p.type, p.job].filter(Boolean).join(' · ')}</small>
                      </button>
                    ))}
                    {!list.length && <small className="muted">No employees yet</small>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <AuthGate wide><PersonnelPage /></AuthGate>;
}
