'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import PrintColumns from '@/components/PrintColumns';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import DocFiles from '@/components/DocFiles';
import Modal from '@/components/Modal';
import Expiry from '@/components/Expiry';
import { sb } from '@/lib/supabase';
import { COMPANIES, n, r3 } from '@/lib/expenses';
import { daysOfMonth, marksByStaff, personMonth } from '@/lib/attendance';
import { fmtAmt, monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';

/*
  Personnel (top bar button before Admin, 1 Nov 2026) > Employees:
    Office Employees · Drivers · Site Employees · Subcontractors · Attendance  (tabs, ?tab=office|drivers|site|sub|attendance)
  Office / Site employees = the same people as the All Companies salary sheets (exp_staff, staff_type Office / Site),
  so the Attendance sheet (/expenses/attendance) and the salary sheet stay connected to them.
  Drivers = Transport drivers (transport_drivers). Subcontractors = personnel_subcontractors.
  Salary > Allowance > House rent, Utilities (+ Transport Yes/No for office and site). Changing House rent or Utilities
  also changes the Allowance total that the salary sheet uses.
  ⋯ More (same box as the Documents Checklist) for Contract, Passport, Resident card and Salary slip: private bucket
  staff-files, list in <table>.files { contract: [], passport: [], resident: [], slip: [] }.
  📤 Send To Employee: the employee's own link /s/<slip_token> (no login) shows his salary slips (files under slip/<token>/).
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
  const allCos = useMemo(() => [...COMPANIES, ...extraCos], [extraCos]);
  const CO_SHORT = useMemo(() => Object.fromEntries(allCos.map((c) => [c.key, c.short])), [allCos]);
  const CO_KEY = useMemo(() => Object.fromEntries(allCos.map((c) => [c.short, c.key])), [allCos]);
  const [undo, setUndo] = useState([]); // [{ type: 'patch'|'add'|'delete', table, id, before | row, label }]
  const [staff, setStaff] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [subs, setSubs] = useState(null);
  const [att, setAtt] = useState([]);
  const [month, setMonth] = useState(thisMonth());
  const [send, setSend] = useState(null); // { table, row }
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
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (TABS.some(([k]) => k === t)) setTab(t); } catch { /* ignore */ }
  }, []);
  function goTab(k) {
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
      res = await s.from('personnel_subcontractors').insert({ name: 'New subcontractor', sort: (subs || []).length + 1 }).select().single();
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
  const slipCell = (table) => (row) => (
    <div className="pn-cell">
      {docCell(table, 'slip', 'Salary slip')(row)}
      {isAdmin && <button type="button" className="dfl-more pn-send" onClick={(e) => { e.stopPropagation(); setSend({ table, row }); }} onMouseDown={(e) => e.stopPropagation()}>📤 Send To Employee</button>}
    </div>
  );
  const money = (k) => ({ key: k, label: '', type: 'number', width: 105, render: (r) => (n(r[k]) ? fmtAmt(r[k]) : <span className="muted">–</span>) });
  const companyCol = { key: 'company', label: 'Company', type: 'select', width: 135, options: allCos.map((c) => c.short), raw: (r) => CO_SHORT[r.company] || r.company || '', render: (r) => CO_SHORT[r.company] || r.company || <span className="muted">–</span> };
  const attCol = {
    key: 'att', label: `Attendance · ${monthLabel(month)}`, type: 'calc', width: 190,
    render: (r) => {
      const x = statOf(r);
      return (
        <Link className="pn-att" href={`/expenses/attendance?co=${r.company}&m=${month}`} onClick={(e) => e.stopPropagation()} title="Open the attendance sheet">
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
    { key: 'slip', label: 'Salary slip', type: 'calc', width: 300, render: slipCell('transport_drivers') }
  ];
  const subColumns = [
    { key: 'name', label: 'Name', type: 'text', width: 200 },
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
  const subRows = (subs || []).filter(match);

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
      { name: 'Subcontractors', title: 'Subcontractors · Tudo Num', subtitle: exportStamp(), head: ['Name', 'Company name', 'Contract', 'Contact'], rows: subRows.map((r) => [r.name, r.company_name || '', r.contract || '', r.contact || '']), numCols: [] }
    ]);
  }

  if (staff === null) return <div className="loading">Loading...</div>;

  const showCo = tab !== 'sub' && tab !== 'attendance';
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
          {tab === 'attendance' || tab === 'office' || tab === 'site' ? (
            <div className="month-select at-month">
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, -1))} aria-label="Previous month">‹</button>
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
              <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, 1))} aria-label="Next month">›</button>
            </div>
          ) : null}
          {tab !== 'attendance' && <input className="pn-search" type="search" placeholder="Search name, passport, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />}
          <button type="button" className="btn ghost" onClick={doExcel}>📗 Excel</button>
        </div>
      </div>

      <div className="co-switch pn-tabs no-print" role="tablist" aria-label="Employees">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>
            {label}
            <small className="pn-count">{k === 'office' ? (staff || []).filter((r) => (r.staff_type || 'Office') !== 'Site' && r.active !== false).length : k === 'site' ? (staff || []).filter((r) => r.staff_type === 'Site' && r.active !== false).length : k === 'drivers' ? (drivers || []).length : k === 'sub' ? (subs || []).length : ''}</small>
          </button>
        ))}
      </div>

      {showCo && (
        <div className="pn-chips no-print">
          <button type="button" className={!co ? 'on' : ''} onClick={() => setCo('')}>All companies</button>
          {allCos.map((c) => <button key={c.key} type="button" className={co === c.key ? 'on' : ''} onClick={() => setCo(c.key)} title={c.name || c.short}>{c.short}</button>)}
          {isAdmin && <button type="button" className="pn-addco" onClick={() => setAddCo({ short: '', name: '' })}>＋ Add company</button>}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {(tab === 'office' || tab === 'site') && (
        <p className="muted pn-note no-print">
          Same people as the salary sheet in All Companies. The Attendance column comes from the attendance sheet ({monthLabel(month)}); tap it to open the sheet.
          {edit ? ' Changing House rent or Utilities also changes the Allowance total.' : ''}
        </p>
      )}
      {tab === 'drivers' && <p className="muted pn-note no-print">Same drivers as Transport &gt; Drivers. Monthly driver salaries stay in the Transport salary sheets.</p>}

      {/* Two buttons just above the table: ✏️ Edit (menu: Edit cells, Add new, Delete, Undo) and 🖨 Print */}
      <div className="pn-bar no-print">
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
        <PrintColumns className="btn" />
        {(edit || delMode) && <span className="pn-mode">{[edit && '✏️ Editing: tap a box to change it', delMode && '🗑 Delete buttons are on'].filter(Boolean).join(' · ')}</span>}
      </div>

      {tab === 'attendance' ? (
        <AttendanceTab companies={allCos} staff={(staff || []).filter((r) => r.active !== false)} statOf={statOf} month={month} />
      ) : grid}

      {send && <SendModal table={send.table} row={(send.table === 'exp_staff' ? staff : drivers).find((x) => x.id === send.row.id) || send.row} onClose={() => setSend(null)} onToggle={(row, on) => patchRow(send.table, row, { slip_link_on: on })} flash={flash} />}

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

/* Attendance tab: every office and site employee for the month, straight from the attendance sheets */
function AttendanceTab({ companies, staff, statOf, month }) {
  return (
    <>
      <div className="pn-att-open no-print">
        {COMPANIES.map((c) => <Link key={c.key} className="btn" href={`/expenses/attendance?co=${c.key}&m=${month}`}>🗓 {c.short} attendance sheet</Link>)}
      </div>
      {companies.map((c) => {
        const list = staff.filter((p) => p.company === c.key);
        if (!list.length) return null;
        return (
          <section key={c.key} className="pn-att-sec">
            <h2>{c.short} <small>{monthLabel(month)}</small></h2>
            <div className="grid-wrap">
              <table className="summary-table pn-att-table">
                <thead><tr><th>Name</th><th>Type</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half day</th><th>Pay days</th></tr></thead>
                <tbody>
                  {list.map((p) => {
                    const x = statOf(p);
                    return (
                      <tr key={p.id}>
                        <td><Link href={`/expenses/attendance?co=${c.key}&m=${month}`}>{p.name}</Link><small className="muted"> {p.designation || p.department || ''}</small></td>
                        <td>{p.staff_type || 'Office'}</td>
                        <td className="ok">{x.present}</td><td className="bad">{x.absent}</td><td>{x.leave}</td><td>{x.half}</td><td><b>{x.payDays}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

/* 📤 Send To Employee: his own salary slip link (no login), by WhatsApp or Copy; can be turned off */
function SendModal({ row, onClose, onToggle, flash }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/s/${row.slip_token}` : '';
  const digits = String(row.mobile || row.phone || '').replace(/\D/g, '');
  const wa = digits ? (digits.length === 8 ? `968${digits}` : digits) : '';
  const count = filesOf(row, 'slip').length;
  const text = `Salam ${row.name}\n\nThis is your salary slip link\n${url}\n\nOpen it any time to see and download your salary slips`;
  return (
    <Modal title={`Send To Employee · ${row.name}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        His own link. It opens only his salary slips ({count} uploaded), no login needed. Upload slips with ⋯ More · Salary slip.
      </p>
      <div className="pn-link">
        <code>{url}</code>
        <span className={`pn-state ${row.slip_link_on ? 'ok' : 'bad'}`}>{row.slip_link_on ? 'Link is on' : 'Link is off'}</span>
      </div>
      <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
        <a className="btn in" href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">📤 WhatsApp{wa ? ` ${row.mobile || row.phone}` : ''}</a>
        <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(url); flash('Link copied'); }}>📋 Copy link</button>
        <a className="btn ghost" href={url} target="_blank" rel="noreferrer">👁 Open</a>
        <button type="button" className="btn ghost" onClick={() => onToggle(row, !row.slip_link_on)}>{row.slip_link_on ? '⛔ Turn link off' : '✅ Turn link on'}</button>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export default function Page() {
  return <AuthGate wide><PersonnelPage /></AuthGate>;
}
