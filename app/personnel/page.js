'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import DocFiles from '@/components/DocFiles';
import EditToggle from '@/components/EditToggle';
import Modal from '@/components/Modal';
import Expiry from '@/components/Expiry';
import { sb } from '@/lib/supabase';
import { COMPANIES, n, r3 } from '@/lib/expenses';
import { daysOfMonth, marksByStaff, personMonth } from '@/lib/attendance';
import { fmtAmt, monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';

/*
  Personnel (top bar button before Admin, 1 Nov 2026) > Employees:
    Office Employees · Drivers · Site Employees · Subcontractors · Attendance  (tabs, ?tab=office|drivers|site|sub|attendance)
  Office / Site employees = the same people as the Office Expense salary sheets (exp_staff, staff_type Office / Site),
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
const CO_SHORT = Object.fromEntries(COMPANIES.map((c) => [c.key, c.short]));
const CO_KEY = Object.fromEntries(COMPANIES.map((c) => [c.short, c.key]));
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
  const [edit, setEdit] = useState(false);
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
    setTab(k); setEdit(false);
    try { window.history.replaceState(null, '', `/personnel?tab=${k}`); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    const s = sb();
    const days = daysOfMonth(month);
    const [st, dr, sc, a] = await Promise.all([
      s.from('exp_staff').select('*').order('company').order('sort').order('name'),
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('personnel_subcontractors').select('*').order('sort').order('created_at'),
      s.from('exp_attendance').select('staff_id, day, mark').gte('day', days[0].iso).lte('day', days[days.length - 1].iso)
    ]);
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

  async function patchRow(table, row, patch) {
    const { error: err } = await sb().from(table).update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); return false; }
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
    if (await patchRow(table, row, patch)) flash('Saved');
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
    if (res.error) flash(res.error.message, 'err'); else flash('Added: type the name in the first box');
  }

  async function confirmDelete() {
    const { table, row } = del;
    setDel(null);
    const { error: err } = await sb().from(table).delete().eq('id', row.id);
    if (err) { flash(err.message, 'err'); return; }
    setterOf(table)((l) => (l || []).filter((x) => x.id !== row.id));
    flash('Deleted');
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
  const companyCol = { key: 'company', label: 'Company', type: 'select', width: 135, options: COMPANIES.map((c) => c.short), raw: (r) => CO_SHORT[r.company] || r.company || '', render: (r) => CO_SHORT[r.company] || r.company || <span className="muted">–</span> };
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
        onDelete={edit && canDel ? (row) => setDel({ table: 'exp_staff', row }) : undefined}
        footer={sumFoot(rows, 'basic')}
        emptyText={tab === 'site' ? 'No site employees yet. Press ✏️ Edit, then + Add, or change a person to Site on the Attendance page.' : 'No office employees yet.'} />
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
        onDelete={edit && canDel ? (row) => setDel({ table: 'personnel_subcontractors', row }) : undefined}
        emptyText="No subcontractors yet. Press ✏️ Edit, then + Add subcontractor." />
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
          {tab !== 'attendance' && <EditToggle on={edit} onClick={() => setEdit((v) => !v)} show={isAdmin} />}
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
          {COMPANIES.map((c) => <button key={c.key} type="button" className={co === c.key ? 'on' : ''} onClick={() => setCo(c.key)}>{c.short}</button>)}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {(tab === 'office' || tab === 'site') && (
        <p className="muted pn-note no-print">
          Same people as the salary sheet in Office Expense. The Attendance column comes from the attendance sheet ({monthLabel(month)}); tap it to open the sheet.
          {edit ? ' Changing House rent or Utilities also changes the Allowance total.' : ''}
        </p>
      )}
      {tab === 'drivers' && <p className="muted pn-note no-print">Same drivers as Transport &gt; Drivers. Monthly driver salaries stay in the Transport salary sheets.</p>}

      {tab === 'attendance' ? (
        <AttendanceTab staff={(staff || []).filter((r) => r.active !== false)} statOf={statOf} month={month} />
      ) : grid}

      {send && <SendModal table={send.table} row={(send.table === 'exp_staff' ? staff : drivers).find((x) => x.id === send.row.id) || send.row} onClose={() => setSend(null)} onToggle={(row, on) => patchRow(send.table, row, { slip_link_on: on })} flash={flash} />}

      {del && (
        <Modal title="Delete?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.row.name}</b>?{del.table === 'exp_staff' ? ' This person is also removed from the Office Expense salary sheet and attendance.' : ''}</p>
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

/* Attendance tab: every office and site employee for the month, straight from the attendance sheets */
function AttendanceTab({ staff, statOf, month }) {
  return (
    <>
      <div className="pn-att-open no-print">
        {COMPANIES.map((c) => <Link key={c.key} className="btn" href={`/expenses/attendance?co=${c.key}&m=${month}`}>🗓 {c.short} attendance sheet</Link>)}
      </div>
      {COMPANIES.map((c) => {
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
