'use client';

import RangeReport from '@/components/RangeReport';
import { expenseReport, groupReport } from '@/lib/rangeReports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import Omr from '@/components/Omr';
import EditToggle from '@/components/EditToggle';
import { HBars } from '@/components/Charts';
import { useShare } from '@/components/ShareModal';
import { sb } from '@/lib/supabase';
import StaffPayCards from '@/components/StaffPayCards';
import { expiryCol } from '@/components/Expiry';
import { useViewMode } from '@/lib/viewMode';
import { hasPaidCols, staffBalance } from '@/lib/payBalance';
import { num, fmtAmt, monthKey, monthLabel, todayISO, exportExcel, exportPdf, exportStamp, fmtFullDate } from '@/lib/sheet';
import { HEADS, CATEGORIES, COMPANIES, DEPARTMENTS, SOURCE_LABEL, companyOf, n, r3, staffGross, staffNet } from '@/lib/expenses';

const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const monthName = (k) => new Date(`${k}-01T00:00:00`).toLocaleString('en-GB', { month: 'short' });

function ExpensesPage() {
  const { isAdmin, name: me } = useUser();
  const [co, setCo] = useState(null);
  const [rows, setRows] = useState(null);
  const [staff, setStaff] = useState([]);
  const [month, setMonth] = useState(null);
  const [head, setHead] = useState('');
  const [dept, setDept] = useState('');
  const [editRows, setEditRows] = useState(false);
  const [editStaff, setEditStaff] = useState(false);
  const [view] = useViewMode('cards');
  const [del, setDel] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const { open: openShare, modal: shareModal } = useShare();

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    let k = '';
    try { k = new URLSearchParams(window.location.search).get('co') || localStorage.getItem('tudo-exp-co') || ''; } catch { /* ignore */ }
    setCo(COMPANIES.some((c) => c.key === k) ? k : 'sumptuosity');
  }, []);

  function switchCo(k) {
    if (k === co) return;
    setCo(k); setRows(null); setStaff([]); setMonth(null); setHead(''); setDept(''); setEditRows(false); setEditStaff(false);
    try { localStorage.setItem('tudo-exp-co', k); window.history.replaceState(null, '', `/expenses?co=${k}`); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    if (!co) return;
    const s = sb();
    const [e, st] = await Promise.all([
      s.from('exp_entries').select('*').eq('company', co).order('entry_date').order('sort').order('created_at'),
      s.from('exp_staff').select('*').eq('company', co).order('sort').order('name')
    ]);
    if (e.error) { setError(e.error.message); setRows([]); return; }
    setRows(e.data || []);
    setStaff(st.data || []);
  }, [co]);
  useEffect(() => { load(); }, [load]);

  const EXP_COMPANY = companyOf(co).name;

  const months = useMemo(() => {
    const set = new Set((rows || []).map((r) => monthKey(r.entry_date)));
    set.add(monthKey(todayISO()));
    return [...set].sort();
  }, [rows]);

  useEffect(() => {
    if (!month && rows) {
      const withData = [...new Set(rows.map((r) => monthKey(r.entry_date)))].sort();
      setMonth(withData[withData.length - 1] || monthKey(todayISO()));
    }
  }, [rows, month]);

  const inMonth = useCallback((r) => month === 'all' || monthKey(r.entry_date) === month, [month]);
  const monthRows = useMemo(() => (rows || []).filter(inMonth), [rows, inMonth]);
  const deptRows = useMemo(() => monthRows.filter((r) => !dept || (r.department || 'No department') === dept), [monthRows, dept]);
  const shown = useMemo(() => deptRows.filter((r) => !head || r.head === head), [deptRows, head]);
  const byDept = useMemo(() => {
    const m = {};
    for (const r of monthRows) { const d = r.department || 'No department'; m[d] = r3((m[d] || 0) + n(r.paid)); }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [monthRows]);

  const total = (list, k) => r3(list.reduce((t, r) => t + n(r[k]), 0));
  const byHead = useMemo(() => {
    const m = {};
    for (const r of deptRows) { const h = r.head || 'Other'; m[h] = r3((m[h] || 0) + n(r.paid)); }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [deptRows]);

  /* Year summary: heads x months (like the "1st Quarter Summary" sheet) */
  const year = (month && month !== 'all' ? month : monthKey(todayISO())).slice(0, 4);
  const yearMonths = useMemo(() => [...new Set((rows || []).map((r) => monthKey(r.entry_date)).filter((k) => k.startsWith(year)))].sort(), [rows, year]);
  const matrix = useMemo(() => {
    const heads = [...new Set([...HEADS, ...(rows || []).map((r) => r.head).filter(Boolean)])];
    return heads.map((h) => {
      const vals = yearMonths.map((k) => r3((rows || []).filter((r) => r.head === h && monthKey(r.entry_date) === k).reduce((t, r) => t + n(r.paid), 0)));
      return { head: h, vals, sum: r3(vals.reduce((t, v) => t + v, 0)) };
    }).filter((x) => x.sum > 0);
  }, [rows, yearMonths]);
  const colTotals = yearMonths.map((_, i) => r3(matrix.reduce((t, x) => t + x.vals[i], 0)));
  const vatByMonth = yearMonths.map((k) => r3((rows || []).filter((r) => monthKey(r.entry_date) === k).reduce((t, r) => t + n(r.vat), 0)));

  /* ---------- Saving ---------- */
  const lockedMsg = (r) => `This line comes from ${SOURCE_LABEL[r.source] || 'another page'}. Change it there and it updates here by itself.`;

  async function save(row, key, value) {
    if (row.source) { flash(lockedMsg(row), 'err'); return; }
    const patch = { [key]: ['paid', 'unpaid', 'vat'].includes(key) ? (value === null || value === '' ? null : value) : (value === '' ? null : value) };
    if (key === 'paid' && patch.paid === null) patch.paid = 0;
    setRows((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error: err } = await sb().from('exp_entries').update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); load(); return; }
    flash(key === 'entry_date' && month !== 'all' && monthKey(value) !== month ? `Moved to ${monthLabel(monthKey(value))}` : 'Saved');
  }

  async function addRow() {
    const date = month === 'all' || month === monthKey(todayISO()) ? todayISO() : `${month}-01`;
    const sort = (rows || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('exp_entries')
      .insert({ company: co, entry_date: date, head: head || HEADS[5], department: dept && dept !== 'No department' ? dept : (DEPARTMENTS[co] || [])[co === 'modern-city' ? 4 : 0] || null, category: '', description: '', paid: 0, sort, account: 'P & L', entered_by: me || null })
      .select().single();
    if (err) { flash(err.message, 'err'); return; }
    setRows((list) => [...list, data]);
    flash('New bill added. Fill in the details.');
  }

  async function confirmDelete() {
    const { error: err } = await sb().from('exp_entries').delete().eq('id', del.id);
    if (err) { flash(err.message, 'err'); return; }
    setRows((list) => list.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Deleted');
  }

  async function saveStaff(row, key, value) {
    const patch = { [key]: value === '' ? null : value };
    setStaff((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error: err } = await sb().from('exp_staff').update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); load(); return; }
    flash('Saved');
  }
  async function addStaff() {
    const sort = staff.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('exp_staff').insert({ company: co, name: 'New staff', department: '', basic: 0, working_days: 30, sort }).select().single();
    if (err) { flash(err.message, 'err'); return; }
    setStaff((list) => [...list, data]);
  }
  async function deleteStaff(s) {
    const { error: err } = await sb().from('exp_staff').delete().eq('id', s.id);
    if (err) { flash(err.message, 'err'); return; }
    setStaff((list) => list.filter((x) => x.id !== s.id));
    flash('Deleted');
  }

  if (error) return <div className="error">Could not load expenses: {error}</div>;
  const switcher = (
    <div className="co-switch" role="tablist" aria-label="Company">
      {COMPANIES.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={co === c.key} className={co === c.key ? 'on' : ''} onClick={() => switchCo(c.key)}>{c.short}</button>
      ))}
      <Link href="/expenses/summary" className="co-tab co-sum">📊 Group Summary</Link>
    </div>
  );
  if (!co || !rows || !month) return <>{co && switcher}<div className="loading">Loading expenses...</div></>;

  const headList = [...new Set([...HEADS, ...rows.map((r) => r.head).filter(Boolean)])];
  const deptList = [...new Set([...(DEPARTMENTS[co] || []), ...rows.map((r) => r.department).filter(Boolean)])];
  const catList = [...new Set([...CATEGORIES, ...rows.map((r) => r.category).filter(Boolean)])];
  const amt = (k) => (r) => (r[k] === null || r[k] === undefined || r[k] === '' ? <span className="muted">–</span> : fmtAmt(r[k]));

  const columns = [
    { key: 'entry_date', label: 'Date', type: 'date', width: 128, render: (r) => fmtD(r.entry_date) },
    { key: 'bill_no', label: 'Bill No', type: 'text', width: 150 },
    { key: 'description', label: 'Description', type: 'text', width: 280, render: (r) => (r.source ? <span title={lockedMsg(r)}><span className="auto-tag">🔗 Auto</span> {r.description}</span> : r.description) },
    { key: 'department', label: 'Department', type: 'combo', options: deptList, width: 150 },
    { key: 'category', label: 'Bill category', type: 'combo', options: catList, width: 140 },
    { key: 'head', label: 'Head of account', type: 'combo', options: headList, width: 230 },
    { key: 'paid', label: 'Paid OMR', type: 'number', min: 0, width: 110, render: amt('paid') },
    { key: 'unpaid', label: 'Unpaid OMR', type: 'number', min: 0, width: 110, render: amt('unpaid') },
    { key: 'vat', label: 'VAT 5%', type: 'number', min: 0, width: 95, render: amt('vat') },
    { key: 'vat_reg_no', label: 'VAT Reg No', type: 'text', width: 140 }
  ];

  const staffPaidCols = staff.some(hasPaidCols);
  const staffCols = [
    { key: 'name', label: 'Name', type: 'text', width: 220, render: (r) => <b>{r.name}</b> },
    { key: 'department', label: 'Department', type: 'text', width: 170 },
    { key: 'resident_card', label: 'Resident Card No.', type: 'text', width: 140 },
    expiryCol('resident_card_expiry', 'Resident Card expiry'),
    expiryCol('visa_expiry', 'Visa expiry'),
    { key: 'basic', label: 'Basic pay', type: 'number', min: 0, width: 110, render: amt('basic') },
    { key: 'allowances', label: 'Allowances', type: 'number', min: 0, width: 110, render: amt('allowances') },
    ...(staff.some((x) => Object.prototype.hasOwnProperty.call(x, 'staff_type')) ? [{ key: 'staff_type', label: 'Type', type: 'select', options: ['Office', 'Site'], width: 100, render: (r) => r.staff_type || 'Office' }] : []),
    { key: 'working_days', label: 'Working days', type: 'number', min: 0, width: 120, render: (r) => <span title={r.attendance_month ? `From attendance ${monthLabel(r.attendance_month)}` : undefined}>{num(r.working_days)}{r.attendance_month ? ' 🗓' : ''}</span> },
    { key: 'gross', label: 'Total gross', type: 'calc', width: 120, render: (r) => fmtAmt(staffGross(r)) },
    { key: 'deductions', label: 'Deductions / advances', type: 'number', min: 0, width: 150, render: amt('deductions') },
    { key: 'net', label: 'Net pay', type: 'calc', width: 120, render: (r) => <b>{fmtAmt(staffNet(r))}</b> },
    ...(staffPaidCols ? [
      { key: 'prev_balance', label: 'Previous unpaid', type: 'number', min: 0, width: 130, render: amt('prev_balance') },
      { key: 'paid_amount', label: 'Paid', type: 'number', min: 0, width: 110, render: amt('paid_amount') },
      { key: 'unpaid_bal', label: 'Unpaid balance', type: 'calc', width: 130, render: (r) => { const b = Math.max(0, staffBalance(r, staffNet(r))); return b ? <b className="neg">{fmtAmt(b)}</b> : <span className="pos">Nil</span>; } }
    ] : [])
  ];
  const staffAttMonth = staff.map((x) => x.attendance_month).filter(Boolean).sort().pop() || '';
  const staffNetTotal = r3(staff.reduce((t, s) => t + staffNet(s), 0));

  const TD = total(deptRows, 'paid');
  const T = { paid: total(shown, 'paid'), unpaid: total(shown, 'unpaid'), vat: total(shown, 'vat') };
  const TM = { paid: total(monthRows, 'paid'), unpaid: total(monthRows, 'unpaid'), vat: total(monthRows, 'vat') };

  /* ---------- Export ---------- */
  function entryTable(list) {
    return {
      head: ['SR#', 'Bill No', 'Date', 'Description', 'Department', 'Bill category', 'Head of account', 'Paid OMR', 'Unpaid OMR', 'VAT 5%', 'VAT Reg No'],
      rows: list.map((r, i) => [i + 1, r.bill_no || '', fmtD(r.entry_date), r.description || '', r.department || '', r.category || '', r.head || '', num(r.paid), r.unpaid === null ? '' : num(r.unpaid), r.vat === null ? 'NA' : num(r.vat), r.vat_reg_no || 'NA']),
      totalsRow: ['Total', '', '', `${list.length} bills`, '', '', '', total(list, 'paid'), total(list, 'unpaid'), total(list, 'vat'), ''],
      numCols: [7, 8, 9]
    };
  }
  function shareIt() {
    const label = month === 'all' ? 'All months' : monthLabel(month);
    const text = [
      `${companyOf(co).short} · Office Expense · ${label}`,
      `Total paid: ${fmtAmt(TM.paid)} OMR (${monthRows.length} bills)`,
      TM.unpaid ? `Unpaid: ${fmtAmt(TM.unpaid)} OMR` : '',
      TM.vat ? `VAT: ${fmtAmt(TM.vat)} OMR` : '',
      '',
      ...byHead.map(([h, v]) => `${h}: ${fmtAmt(v)} OMR`)
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
    openShare({ title: `${companyOf(co).short} expenses ${label}`, text });
  }

  async function doExcel() {
    try {
      const sheets = [];
      const t = entryTable(shown);
      sheets.push({ name: month === 'all' ? 'All bills' : monthLabel(month), title: `${month === 'all' ? 'All' : monthLabel(month)} EXPENSE (BILLS) ENTRIES`, subtitle: EXP_COMPANY, ...t, widths: [6, 18, 12, 40, 18, 16, 32, 12, 12, 10, 16] });
      sheets.push({
        name: `${year} Summary`, title: `${year} EXPENSE SUMMARY`, subtitle: EXP_COMPANY,
        head: ['Head of account', ...yearMonths.map(monthName), 'Total'],
        rows: [...matrix.map((x) => [x.head, ...x.vals, x.sum]), ['Total VAT', ...vatByMonth, r3(vatByMonth.reduce((a, b) => a + b, 0))]],
        totalsRow: ['Total', ...colTotals, r3(colTotals.reduce((a, b) => a + b, 0))],
        numCols: [...yearMonths.map((_, i) => i + 1), yearMonths.length + 1], widths: [34, ...yearMonths.map(() => 12), 14]
      });
      if (staff.length) {
        sheets.push({
          name: 'Salary sheet', title: 'SALARY SHEET', subtitle: EXP_COMPANY,
          head: ['Name', 'Department', 'Basic pay', 'Allowances', 'Working days', 'Total gross', 'Deductions', 'Net pay', 'Previous unpaid', 'Paid', 'Unpaid balance'],
          rows: staff.map((s) => [s.name, s.department || '', num(s.basic), num(s.allowances), num(s.working_days), staffGross(s), num(s.deductions), staffNet(s), num(s.prev_balance), num(s.paid_amount), hasPaidCols(s) ? Math.max(0, staffBalance(s, staffNet(s))) : '']),
          totalsRow: ['Total', '', '', '', '', r3(staff.reduce((a, s) => a + staffGross(s), 0)), '', staffNetTotal, r3(staff.reduce((a, s) => a + n(s.prev_balance), 0)), r3(staff.reduce((a, s) => a + n(s.paid_amount), 0)), r3(staff.reduce((a, s) => a + (hasPaidCols(s) ? Math.max(0, staffBalance(s, staffNet(s))) : 0), 0))],
          numCols: [2, 3, 4, 5, 6, 7, 8, 9, 10], widths: [30, 20, 12, 12, 12, 14, 14, 14, 14, 12, 14]
        });
      }
      await exportExcel(`Office Expense ${month === 'all' ? 'All' : monthLabel(month)}.xlsx`, sheets);
      flash('Excel file downloaded');
    } catch { flash('Could not create the Excel file.', 'err'); }
  }
  async function doPdf() {
    try {
      const t = entryTable(shown);
      const f = (row) => row.map((v, i) => (t.numCols.includes(i) && typeof v === 'number' ? fmtAmt(v) : v));
      await exportPdf(`Office Expense ${month === 'all' ? 'All' : monthLabel(month)}.pdf`, {
        title: `${month === 'all' ? 'All months' : monthLabel(month)} · Expense (bills) entries${dept ? ` · ${dept}` : ''}${head ? ` · ${head}` : ''}`,
        subtitle: `${EXP_COMPANY}  |  Exported ${exportStamp()}  |  OMR`,
        sections: [
          { head: t.head, rows: t.rows.map(f), totalsRow: f(t.totalsRow), numCols: t.numCols },
          { heading: 'By head of account', head: ['Head of account', 'Paid OMR'], rows: byHead.map(([h, v]) => [h, fmtAmt(v)]), totalsRow: ['Total', fmtAmt(total(deptRows, 'paid'))], numCols: [1] },
          { heading: 'By department', head: ['Department', 'Paid OMR'], rows: byDept.map(([h, v]) => [h, fmtAmt(v)]), totalsRow: ['Total', fmtAmt(TM.paid)], numCols: [1] }
        ]
      });
      flash('PDF downloaded');
    } catch { flash('Could not create the PDF.', 'err'); }
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="month">Month</label>
            <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          <Link href={`/expenses/attendance?co=${co}`} className="btn">🗓 Attendance</Link>
          <Link href={`/expenses/docs?co=${co}`} className="btn">🧾 Invoice / Receipt</Link>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
          <button type="button" className="btn ghost" onClick={doPdf}>Export PDF</button>
          <button type="button" className="btn ghost" onClick={shareIt}>📤 Share</button>
          <RangeReport title={`Office expense report · ${companyOf(co).short || ''}`} company={EXP_COMPANY} landscape
            build={(from, to) => expenseReport({ rows: rows || [], from, to })} label="🖨 Report by dates" />
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {switcher}

      {companyOf(co).logo && (
        <div className="print-letterhead print-only">
          <img src={companyOf(co).logo} alt={companyOf(co).short} />
          <div>
            <b>{companyOf(co).name}</b>
            <span>{companyOf(co).cr}</span>
            <span>{companyOf(co).address}</span>
          </div>
        </div>
      )}

      <div className="company-head">
        <span className="company-name">{EXP_COMPANY}</span>
        <h1>Office Expense</h1>
        <p className="sub">{month === 'all' ? 'All months' : monthLabel(month)} · Expense (bills) entries · Currency: OMR</p>
      </div>

      <div className="kpi-row">
        <div className="kpi hero"><span>Total paid</span><strong><Omr v={TM.paid} /></strong><small>{monthRows.length} bills</small></div>
        <div className="kpi"><span>Unpaid</span><strong className={TM.unpaid > 0 ? 'neg' : ''}><Omr v={TM.unpaid} /></strong><small>Still to pay</small></div>
        <div className="kpi"><span>VAT 5%</span><strong><Omr v={TM.vat} /></strong><small>Input VAT on bills</small></div>
        <div className="kpi"><span>Biggest head</span><strong style={{ fontSize: 18 }}>{byHead[0]?.[0] || '–'}</strong><small>{byHead[0] ? `${fmtAmt(byHead[0][1])} OMR` : ''}</small></div>
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>By department · {month === 'all' ? 'All months' : monthLabel(month)}</h2>
          <p className="note">{co === 'modern-city' ? 'Transport costs come in by themselves from the Transport pages (🔗 Auto). ' : ''}Click a department to show only its bills</p>
        </div>
        <div className="head-chips">
          <button type="button" className={`rp-chip ${!dept ? 'active' : ''}`} onClick={() => { setDept(''); setHead(''); }}>All departments · {fmtAmt(TM.paid)}</button>
          {byDept.map(([d, v]) => <button type="button" key={d} className={`rp-chip ${dept === d ? 'active' : ''}`} onClick={() => { setDept(d); setHead(''); }}>{d} · {fmtAmt(v)}</button>)}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>By head of account · {month === 'all' ? 'All months' : monthLabel(month)}</h2>
          <p className="note">Click a head to show only its bills</p>
        </div>
        <HBars rows={byHead.map(([h, v]) => ({ label: h, value: v, sub: TD ? `${Math.round((v / TD) * 100)}%` : '' }))} fmt={(v) => fmtAmt(v)} />
        <div className="head-chips">
          <button type="button" className={`rp-chip ${!head ? 'active' : ''}`} onClick={() => setHead('')}>All heads</button>
          {byHead.map(([h]) => <button type="button" key={h} className={`rp-chip ${head === h ? 'active' : ''}`} onClick={() => setHead(h)}>{h}</button>)}
        </div>
      </section>

      <section className={`sheet ${editRows ? 'is-editing' : ''}`}>
        <div className="sheet-title sheet-edit-bar">
          <h2>Bills{dept ? ` · ${dept}` : ''}{head ? ` · ${head}` : ''}</h2>
          <EditToggle show={isAdmin} on={editRows} onClick={() => setEditRows((v) => !v)} />
        </div>
        {editRows && <div className="edit-banner">Edit mode is on. Click any cell to change it, then press Enter. Amounts accept maths like 4+2.5. Click <strong>✓ Done</strong> when finished.</div>}
        <DataGrid
          columns={columns}
          rows={shown}
          canEdit={isAdmin && editRows}
          onSave={save}
          onAdd={addRow}
          addLabel="+ Add bill"
          onDelete={(r) => (r.source ? flash(lockedMsg(r), 'err') : setDel(r))}
          rowClass={(r) => [n(r.unpaid) > 0 ? 'due-row' : '', r.source ? 'auto-row' : ''].join(' ')}
          emptyText={rows.length ? 'No bills in this month.' : 'No bills yet for this company. Press ✏️ Edit, then + Add bill.'}
          footer={{ description: `${shown.length} bills`, paid: <Omr v={T.paid} />, unpaid: fmtAmt(T.unpaid), vat: fmtAmt(T.vat) }}
          flash={flash}
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>{year} summary by month</h2>
          <p className="note">Paid amounts in OMR, same as the "1st Quarter Summary" sheet</p>
        </div>
        <div className="table-wrap">
          <table className="summary-table">
            <thead><tr><th>Head of account</th>{yearMonths.map((k) => <th key={k} className="num">{monthName(k)}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {matrix.map((x) => (
                <tr key={x.head}><td>{x.head}</td>{x.vals.map((v, i) => <td key={i} className="num">{v ? fmtAmt(v) : <span className="muted">–</span>}</td>)}<td className="num"><b>{fmtAmt(x.sum)}</b></td></tr>
              ))}
              <tr className="sum"><td>Total</td>{colTotals.map((v, i) => <td key={i} className="num">{fmtAmt(v)}</td>)}<td className="num">{fmtAmt(colTotals.reduce((a, b) => a + b, 0))}</td></tr>
              <tr><td>Total VAT</td>{vatByMonth.map((v, i) => <td key={i} className="num">{fmtAmt(v)}</td>)}<td className="num">{fmtAmt(vatByMonth.reduce((a, b) => a + b, 0))}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={`sheet ${editStaff ? 'is-editing' : ''}`}>
        <div className="sheet-title sheet-edit-bar">
          <h2>Salary sheet</h2>
          <EditToggle show={isAdmin} on={editStaff} onClick={() => setEditStaff((v) => !v)} />
        </div>
        <p className="note" style={{ margin: '0 0 10px' }}>
          Total gross = (Basic + Allowances) ÷ 30 × Working days. Net pay = Gross − Deductions. Unpaid balance = Previous unpaid + Net pay − Paid.
          {' '}Working days are filled from <Link href={`/expenses/attendance?co=${co}${staffAttMonth ? `&m=${staffAttMonth}` : ''}`}>🗓 Attendance</Link>
          {staffAttMonth ? ` (${monthLabel(staffAttMonth)})` : ''} when it is marked; you can still change them here.
        </p>
        {view === 'cards' ? (
          <StaffPayCards staff={staff} canEdit={isAdmin && editStaff} canPay={isAdmin} onSave={saveStaff} onAdd={addStaff} onDelete={deleteStaff} />
        ) : (
          <DataGrid
            columns={staffCols}
            rows={staff}
            canEdit={isAdmin && editStaff}
            onSave={(row, key, value) => { saveStaff(row, key, value); if (key === 'paid_amount') saveStaff(row, 'paid_on', value ? (row.paid_on || todayISO()) : null); }}
            onAdd={addStaff}
            addLabel="+ Add staff"
            onDelete={deleteStaff}
            emptyText="No staff yet. Press ✏️ Edit, then + Add staff."
            footer={{ net: <Omr v={staffNetTotal} />, ...(staffPaidCols ? { paid_amount: fmtAmt(r3(staff.reduce((a, x) => a + n(x.paid_amount), 0))), unpaid_bal: fmtAmt(r3(staff.reduce((a, x) => a + Math.max(0, staffBalance(x, staffNet(x))), 0))) } : {}) }}
            flash={flash}
          />
        )}
      </section>

      {del && (
        <Modal title="Delete bill?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.description || 'this bill'}</b> ({fmtAmt(del.paid)} OMR) on {fmtFullDate(del.entry_date)}?</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      {shareModal}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><ExpensesPage /></AuthGate>;
}
