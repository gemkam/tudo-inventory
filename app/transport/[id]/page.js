'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, fmtDay, fmtFullDate, monthKey, monthLabel, monthStart, todayISO, exportStamp, exportExcel, exportPdf } from '@/lib/sheet';
import Omr from '@/components/Omr';
import EditToggle from '@/components/EditToggle';
import SalarySlipPaper from '@/components/SalarySlip';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowancePlan } from '@/lib/transport';

const NUM_KEYS = ['rent', 'received', 'driver_allowance', 'diesel', 'toll', 'maintenance'];

/* Print / export: pick the columns (indexes into tableData().head). Saved on this device. */
const COLS_KEY = 'tudo-trip-print-cols';
const DEFAULT_COLS = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16];
const PRESETS = [
  ['All columns', null],
  ['Driver copy (no money in)', [0, 1, 2, 3, 4, 5, 11, 12, 13, 16]],
  ['Money only', [0, 1, 2, 6, 7, 8, 9, 10]],
  ['Costs only', [0, 1, 2, 3, 11, 13, 14, 15]],
  ['Standard', DEFAULT_COLS]
];

function DriverSheet() {
  const { id } = useParams();
  const { isAdmin } = useUser();
  const [driver, setDriver] = useState(null);
  const [entries, setEntries] = useState([]);
  const [salMonths, setSalMonths] = useState({}); // salary receipt id -> YYYY-MM
  const [salaries, setSalaries] = useState([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const [slipEdit, setSlipEdit] = useState(null); // form values while editing the slip
  const [slipBusy, setSlipBusy] = useState(false);
  const [month, setMonth] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [del, setDel] = useState(null);
  const [error, setError] = useState('');
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [colsOpen, setColsOpen] = useState(false);
  const toastTimer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, e, sa] = await Promise.all([
      s.from('transport_drivers').select('*').eq('id', id).single(),
      s.from('transport_entries').select('*').eq('driver_id', id).order('entry_date').order('sort').order('created_at'),
      s.from('transport_salaries').select('*').eq('driver_id', id)
    ]);
    setSalMonths(Object.fromEntries((sa.data || []).map((x) => [x.id, monthKey(x.month)])));
    setSalaries(sa.data || []);
    if (d.error) { setError('This driver was not found.'); return; }
    setDriver(d.data);
    setEntries(e.data || []);
    setMonth((m) => {
      if (m) return m;
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      return keys[keys.length - 1] || monthKey(todayISO());
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    try { const c = JSON.parse(localStorage.getItem(COLS_KEY) || 'null'); if (Array.isArray(c) && c.length) setCols(c); } catch { /* ignore */ }
  }, []);
  function saveCols(next) {
    const c = [...new Set(next)].sort((a, b) => a - b);
    setCols(c);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
  }

  const months = useMemo(() => {
    const set = new Set([...entries.map((x) => monthKey(x.entry_date)), monthKey(todayISO())]);
    return [...set].filter(Boolean).sort().reverse();
  }, [entries]);

  const rows = useMemo(
    () => entries
      .filter((e) => month === 'all' || monthKey(e.entry_date) === month)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : (a.sort || 0) - (b.sort || 0))),
    [entries, month]
  );

  const sum = (k) => num(rows.reduce((t, e) => t + Number(e[k] || 0), 0));
  const totals = {
    trips: rows.filter((e) => Number(e.rent) > 0).length,
    rent: sum('rent'), received: sum('received'), driver_allowance: sum('driver_allowance'),
    diesel: sum('diesel'), toll: sum('toll'), maintenance: sum('maintenance')
  };
  totals.balance = num(totals.rent - totals.received);
  totals.costs = num(totals.diesel + totals.toll + totals.maintenance);
  totals.net = num(totals.rent - totals.costs);

  /* Driver allowance brought forward: earlier months' allowance still not paid shows on this month's sheet.
     When it is paid (Mark paid), it shows as Paid here and on the earlier month's sheet. */
  const groupByMonth = (list) => {
    const g = {};
    list.forEach((e) => { const k = monthKey(e.entry_date); g[k] = g[k] || { month: k, amt: 0, ids: [], parts: [], paidIn: '' }; g[k].amt = num(g[k].amt + Number(e.driver_allowance || 0)); g[k].ids.push(e.id); g[k].parts.push(Number(e.driver_allowance || 0)); if (e.allowance_salary_id && salMonths[e.allowance_salary_id]) g[k].paidIn = salMonths[e.allowance_salary_id]; });
    return Object.values(g).sort((a, b) => a.month.localeCompare(b.month));
  };
  const hasAllow = (e) => Number(e.driver_allowance || 0) !== 0;
  const prevOpen = month && month !== 'all' ? groupByMonth(entries.filter((e) => hasAllow(e) && monthKey(e.entry_date) < month && e.allowance_status !== 'Paid')) : [];
  const prevPaidHere = month && month !== 'all' ? groupByMonth(entries.filter((e) => hasAllow(e) && monthKey(e.entry_date) < month && e.allowance_status === 'Paid' && e.allowance_salary_id && salMonths[e.allowance_salary_id] === month)) : [];
  const prevOpenTotal = num(prevOpen.reduce((t, g) => t + g.amt, 0));

  const calc = (parts) => (parts.length > 1 ? `${parts.map((v) => fmtAmt(v)).join(' + ')} = ` : '');
  // this month's own allowance already paid
  const thisPaid = month && month !== 'all' ? num(rows.filter((e) => hasAllow(e) && e.allowance_status === 'Paid').reduce((t, e) => t + Number(e.driver_allowance || 0), 0)) : 0;
  const prevPaidTotal = num(prevPaidHere.reduce((t, g) => t + g.amt, 0));

  async function payPrevious(ids) {
    const { error: err } = await sb().from('transport_entries').update({ allowance_status: 'Paid' }).in('id', ids);
    if (err) { flash(err.message, 'err'); return; }
    flash('Driver allowance marked Paid');
    load();
  }

  // Undo: back to Not paid (the database takes it off the salary again and fixes the amounts)
  async function undoPrevious(ids) {
    const { error: err } = await sb().from('transport_entries').update({ allowance_status: 'Not paid' }).in('id', ids);
    if (err) { flash(err.message, 'err'); return; }
    flash('Undone: back to Not paid');
    load();
  }

  /* ---------- Saving ---------- */

  async function save(row, key, value) {
    const patch = { [key]: NUM_KEYS.includes(key) ? (value ?? 0) : value };
    setEntries((list) => list.map((e) => (e.id === row.id ? { ...e, ...patch } : e)));
    const { data: fresh, error: err } = await sb().from('transport_entries').update(patch).eq('id', row.id).select().single();
    if (err) { flash(err.code === '42501' ? 'Only Administrator can edit' : err.message, 'err'); load(); return; }
    if (fresh) setEntries((list) => list.map((e) => (e.id === row.id ? fresh : e)));
    if (key === 'entry_date' && monthKey(value) !== month && month !== 'all') flash(`Moved to ${monthLabel(monthKey(value))}`);
    else flash('Saved');
  }

  async function addRow() {
    const date = month === 'all' || month === monthKey(todayISO()) ? todayISO() : monthStart(month);
    const sort = entries.reduce((m, e) => Math.max(m, e.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('transport_entries')
      .insert({ driver_id: id, entry_date: date, sort, payment_status: 'Not Received', allowance_status: 'Not paid', remarks: 'Loading' })
      .select().single();
    if (err) { flash(err.message, 'err'); return; }
    setEntries((list) => [...list, data]);
    flash('New row added. Fill in the trip details.');
  }

  async function confirmDelete() {
    const { error: err } = await sb().from('transport_entries').delete().eq('id', del.id);
    if (err) { flash(err.message, 'err'); return; }
    setEntries((list) => list.filter((e) => e.id !== del.id));
    setDel(null);
    flash('Row deleted');
  }

  /* ---------- Columns ---------- */

  const amt = (k) => (r) => (Number(r[k]) ? fmtAmt(r[k]) : <span className="muted">–</span>);
  const columns = [
    { key: 'entry_date', label: 'Date', type: 'date', width: 128, render: (r) => fmtDay(r.entry_date) },
    { key: 'from_place', label: 'From', type: 'text', width: 130 },
    { key: 'to_place', label: 'To', type: 'text', width: 170, render: (r) => r.to_place || (r.description ? <em className="muted">{r.description}</em> : '') },
    { key: 'rent', label: 'Total rent', type: 'number', min: 0, width: 104, render: amt('rent') },
    { key: 'received', label: 'Received', type: 'number', min: 0, width: 104, render: amt('received') },
    { key: 'received_date', label: 'Received on', type: 'date', width: 128, render: (r) => (r.received_date ? <span className={r.received_date !== r.entry_date ? 'late-pay' : ''}>{fmtDay(r.received_date)}</span> : <span className="muted">–</span>) },
    {
      key: 'balance', label: 'Balance', type: 'calc', width: 96,
      render: (r) => { const b = num(Number(r.rent || 0) - Number(r.received || 0)); return b ? <span className={b > 0 ? 'neg' : 'pos'}>{fmtAmt(b)}</span> : <span className="muted">0</span>; }
    },
    { key: 'payment_status', label: 'Payment', type: 'select', options: ['Received', 'Not Received', 'Partly received'], width: 132, render: (r) => r.payment_status ? <span className={`tag ${/not/i.test(r.payment_status) ? 'due' : /receiv/i.test(r.payment_status) ? 'ok' : 'info'}`}>{r.payment_status}</span> : '' },
    { key: 'driver_allowance', label: 'Driver allowance', type: 'number', min: 0, width: 118, render: amt('driver_allowance') },
    { key: 'allowance_status', label: 'Allowance', type: 'select', options: ['Paid', 'Not paid'], width: 104, render: (r) => r.allowance_status ? <span className={`tag ${/not/i.test(r.allowance_status) ? 'warn' : r.allowance_status === 'Paid' ? 'ok' : 'info'}`}>{r.allowance_status}{r.allowance_status === 'Paid' && r.allowance_salary_id && salMonths[r.allowance_salary_id] > monthKey(r.entry_date) ? ` (${monthLabel(salMonths[r.allowance_salary_id])})` : ''}</span> : '' },
    { key: 'diesel', label: 'Diesel', type: 'number', min: 0, width: 92, render: amt('diesel') },
    { key: 'toll', label: 'Toll / other', type: 'number', min: 0, width: 100, render: amt('toll') },
    { key: 'maintenance', label: 'Maintenance', type: 'number', min: 0, width: 112, render: amt('maintenance') },
    { key: 'description', label: 'Description', type: 'text', width: 200 },
    { key: 'cargo', label: 'Cargo detail', type: 'text', width: 130 },
    { key: 'consignee', label: 'Consignee', type: 'text', width: 120 },
    { key: 'remarks', label: 'Status', type: 'select', options: ['Completed', 'Loading', 'On the way', 'Done', 'Cancelled'], width: 116 },
    { key: 'credit_in', label: 'Payment credit in', type: 'text', width: 140 },
    { key: 'entered_by', label: 'Entered by', type: 'text', width: 120 }
  ];

  /* ---------- Export ---------- */

  function tableData(list = rows) {
    const head = ['Date', 'From', 'To', 'Description', 'Cargo', 'Consignee', 'Rent', 'Received', 'Received on', 'Balance', 'Payment', 'Driver allow.', 'Allowance', 'Diesel', 'Toll/other', 'Maint.', 'Status', 'Credit in', 'Entered by'];
    const data = list.map((r) => [
      fmtFullDate(r.entry_date), r.from_place || '', r.to_place || '', r.description || '', r.cargo || '', r.consignee || '',
      num(r.rent), num(r.received), r.received_date ? fmtFullDate(r.received_date) : '', num(Number(r.rent || 0) - Number(r.received || 0)), r.payment_status || '',
      num(r.driver_allowance), r.allowance_status || '', num(r.diesel), num(r.toll), num(r.maintenance), r.remarks || '', r.credit_in || '', r.entered_by || ''
    ]);
    const tot = (k) => num(list.reduce((t, e) => t + Number(e[k] || 0), 0));
    const trips = list.filter((e) => Number(e.rent) > 0).length;
    const T = { rent: tot('rent'), received: tot('received'), driver_allowance: tot('driver_allowance'), diesel: tot('diesel'), toll: tot('toll'), maintenance: tot('maintenance') };
    const totalsRow = ['Total', `${trips} trips`, '', '', '', '', T.rent, T.received, '', num(T.rent - T.received), '', T.driver_allowance, '', T.diesel, T.toll, T.maintenance, '', '', ''];
    return { head, data, totalsRow, numCols: [6, 7, 9, 11, 13, 14, 15] };
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const t = tableData();
      await exportExcel(`${driver.name} ${monthLabel(month)}.xlsx`, [{
        name: driver.name, title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''} · ${monthLabel(month)}`,
        subtitle: `${COMPANY_NAME} · Transport Division · Exported ${exportStamp()} · OMR`,
        head: t.head, rows: t.data, numCols: t.numCols, totalsRow: t.totalsRow,
        widths: [13, 14, 18, 26, 14, 14, 10, 10, 10, 14, 11, 11, 9, 10, 10, 12, 14]
      }]);
      flash('Excel file downloaded');
    } catch {
      flash('Could not create the Excel file. Please try again.', 'err');
    }
  }

  async function doPdf() {
    try {
      flash('Preparing PDF...');
      const t = tableData();
      const keep = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16];
      const pick = (r) => keep.map((i) => (t.numCols.includes(i) && typeof r[i] === 'number' ? fmtAmt(r[i]) : r[i]));
      await exportPdf(`${driver.name} ${monthLabel(month)}.pdf`, {
        title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''}`,
        subtitle: `${COMPANY_NAME} · Transport Division  |  ${monthLabel(month)}  |  Exported ${exportStamp()}  |  OMR`,
        sections: [{
          head: keep.map((i) => t.head[i]), rows: t.data.map(pick), totalsRow: pick(t.totalsRow),
          numCols: keep.map((i, j) => (t.numCols.includes(i) ? j : -1)).filter((j) => j >= 0)
        }, {
          heading: 'Totals',
          head: ['Trips', 'Work amount', 'Received', 'Balance', 'Diesel', 'Toll / other', 'Maintenance', 'Net (before salary)'],
          rows: [[totals.trips, fmtAmt(totals.rent), fmtAmt(totals.received), fmtAmt(totals.balance), fmtAmt(totals.diesel), fmtAmt(totals.toll), fmtAmt(totals.maintenance), fmtAmt(totals.net)]],
          numCols: [0, 1, 2, 3, 4, 5, 6, 7], fontSize: 10
        }]
      });
      flash('PDF downloaded');
    } catch {
      flash('Could not create the PDF. Please try again.', 'err');
    }
  }

  /* Print / PDF / Excel with chosen columns: rows with no From and no To are left out, totals follow the rows shown */
  function chosenTable() {
    const t = tableData(rows.filter((r) => String(r.from_place || '').trim() || String(r.to_place || '').trim()));
    const keep = (cols.length ? cols : DEFAULT_COLS).filter((i) => i < t.head.length);
    const pick = (r, fmt) => keep.map((i) => (fmt && t.numCols.includes(i) && typeof r[i] === 'number' ? fmtAmt(r[i]) : r[i]));
    return {
      head: keep.map((i) => t.head[i]), keep,
      rows: (fmt) => t.data.map((r) => pick(r, fmt)),
      totals: (fmt) => pick(t.totalsRow, fmt),
      numCols: keep.map((i, j) => (t.numCols.includes(i) ? j : -1)).filter((j) => j >= 0)
    };
  }
  function printChosen() {
    setColsOpen(false);
    setTimeout(() => window.print(), 120);
  }
  async function pdfChosen() {
    try {
      const c = chosenTable();
      await exportPdf(`${driver.name} ${monthLabel(month)}.pdf`, {
        title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''}`,
        subtitle: `${COMPANY_NAME} · Transport Division  |  ${monthLabel(month)}  |  Exported ${exportStamp()}  |  OMR`,
        sections: [{ head: c.head, rows: c.rows(true), totalsRow: c.totals(true), numCols: c.numCols }]
      });
      flash('PDF downloaded');
    } catch { flash('Could not create the PDF. Please try again.', 'err'); }
  }
  async function excelChosen() {
    try {
      const c = chosenTable();
      await exportExcel(`${driver.name} ${monthLabel(month)}.xlsx`, [{
        name: driver.name, title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''} · ${monthLabel(month)}`,
        subtitle: `${COMPANY_NAME} · Transport Division · Exported ${exportStamp()} · OMR`,
        head: c.head, rows: c.rows(false), numCols: c.numCols, totalsRow: c.totals(false), widths: c.head.map((h) => Math.max(10, Math.min(28, h.length + 6)))
      }]);
      flash('Excel file downloaded');
    } catch { flash('Could not create the Excel file. Please try again.', 'err'); }
  }

  /* Driver copy: only his trips, allowance and diesel. No rent, received, balance or profit. */
  async function doDriverCopy() {
    try {
      flash('Preparing driver copy...');
      const head = ['Date', 'From', 'To', 'Description', 'Cargo', 'Consignee', 'Status', 'Driver allowance', 'Allowance', 'Diesel'];
      const list = rows.filter((r) => Number(r.rent) > 0 || Number(r.driver_allowance) > 0 || Number(r.diesel) > 0 || r.to_place);
      const data = list.map((r) => [
        fmtFullDate(r.entry_date), r.from_place || '', r.to_place || '', r.description || '', r.cargo || '', r.consignee || '', r.remarks || '',
        Number(r.driver_allowance) ? fmtAmt(r.driver_allowance) : '', r.allowance_status || '', Number(r.diesel) ? fmtAmt(r.diesel) : ''
      ]);
      const allowPaid = num(list.filter((r) => r.allowance_status === 'Paid').reduce((t, r) => t + Number(r.driver_allowance || 0), 0));
      await exportPdf(`${driver.name} ${monthLabel(month)} driver copy.pdf`, {
        title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''} · Trip record`,
        subtitle: `${COMPANY_NAME} · Transport Division  |  ${monthLabel(month)}  |  Printed ${exportStamp()}  |  OMR`,
        sections: [{
          head, rows: data,
          totalsRow: ['Total', `${list.length} trips`, '', '', '', '', '', fmtAmt(totals.driver_allowance), '', fmtAmt(totals.diesel)],
          numCols: [7, 9]
        }, {
          heading: 'Allowance',
          head: ['Trips', 'Driver allowance', 'Paid', 'Still to pay', 'Diesel given'],
          rows: [[list.length, fmtAmt(totals.driver_allowance), fmtAmt(allowPaid), fmtAmt(num(totals.driver_allowance - allowPaid)), fmtAmt(totals.diesel)]],
          numCols: [0, 1, 2, 3, 4], fontSize: 10
        }]
      });
      flash('Driver copy downloaded');
    } catch {
      flash('Could not create the driver copy. Please try again.', 'err');
    }
  }

  /* ---------- Render ---------- */

  if (error) return <div className="error">{error} <Link href="/transport">Back to Transport</Link></div>;
  if (!driver || !month) return <div className="loading">Loading trip sheet...</div>;

  /* ---------- Salary slip inside the trip sheet: Print, Edit, PDF, Create ---------- */
  const slipMonth = month && month !== 'all' ? month : monthKey(todayISO());
  const slipSal = salaries.find((x) => monthKey(x.month) === slipMonth) || null;
  const EDIT_FIELDS = [...SALARY_FIELDS.filter(([k]) => k !== 'trip_allowance' && k !== 'allowance_carried'), ['advance_deduction', 'Advance deduction'], ['special_allowance', 'Special allowance']];

  async function createSlip() {
    setSlipBusy(true);
    const plan = allowancePlan(entries, id, slipMonth);
    const prev = salaries.filter((x) => monthKey(x.month) < slipMonth).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    const row = { driver_id: id, month: monthStart(slipMonth), advance_deduction: 0, special_allowance: 0, trip_allowance: plan.current, allowance_carried: plan.carried, allowance_carried_note: plan.note || null };
    ['basic', 'room_rent', 'utilities', 'mobile', 'travel_food'].forEach((k) => { row[k] = num(prev?.[k] || 0); });
    const { data, error: err } = await sb().from('transport_salaries').insert(row).select().single();
    if (err) { setSlipBusy(false); flash(err.message, 'err'); return; }
    if (plan.linkIds.length) await sb().from('transport_entries').update({ allowance_salary_id: data.id }).in('id', plan.linkIds);
    setSlipBusy(false);
    flash(`Salary created for ${monthLabel(slipMonth)}. Check the amounts with Edit.`);
    await load();
  }

  // Trips whose driver allowance can go on this salary: already on it, or not paid with any salary yet (this month and earlier)
  const allowTrips = slipSal ? entries
    .filter((e) => Number(e.driver_allowance || 0) !== 0 || e.allowance_salary_id === slipSal.id)
    .filter((e) => e.allowance_salary_id === slipSal.id || (!e.allowance_salary_id && monthKey(e.entry_date) <= slipMonth))
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date))) : [];

  const allowMonths = [...new Set(allowTrips.map((e) => monthKey(e.entry_date)))].sort();

  function openSlipEdit() {
    const v = Object.fromEntries(EDIT_FIELDS.map(([k]) => [k, Number(slipSal[k] || 0)]));
    v.trips = Object.fromEntries(allowTrips.map((e) => [e.id, { paid: e.allowance_salary_id === slipSal.id, amt: Number(e.driver_allowance || 0) }]));
    v.allowMonth = Object.fromEntries(allowMonths.map((k) => [k, num(allowTrips.filter((e) => monthKey(e.entry_date) === k && e.allowance_salary_id === slipSal.id).reduce((t, e) => t + Number(e.driver_allowance || 0), 0))]));
    setSlipEdit(v);
  }

  /* Typed driver allowance for one month -> which trips it pays (oldest first).
     Whole trips are ticked while they fit; anything left over is added to the last ticked trip
     (or, if no trip fits, the first trip is paid with the typed amount). The trip sheets get exactly this. */
  function typeAllowance(k, raw) {
    setSlipEdit((v) => {
      const A = Math.round(Number(raw || 0) * 1000) / 1000;
      const list = allowTrips.filter((e) => monthKey(e.entry_date) === k);
      const trips = { ...v.trips };
      let sum = 0;
      let last = null;
      list.forEach((e) => {
        const a = Number(e.driver_allowance || 0);
        if (A > 0 && sum + a <= A + 0.0005) { trips[e.id] = { paid: true, amt: a }; sum = num(sum + a); last = e.id; }
        else trips[e.id] = { paid: false, amt: a };
      });
      const r = num(A - sum);
      if (r > 0.0005 && list.length) {
        if (last) trips[last] = { ...trips[last], amt: num(Number(trips[last].amt) + r) };
        else trips[list[0].id] = { paid: true, amt: r };
      }
      return { ...v, trips, allowMonth: { ...v.allowMonth, [k]: raw } };
    });
  }
  const setTrip = (tid, patch) => setSlipEdit((v) => {
    const trips = { ...v.trips, [tid]: { ...v.trips[tid], ...patch } };
    const e = allowTrips.find((x) => x.id === tid);
    const k = e ? monthKey(e.entry_date) : null;
    const total = k ? num(allowTrips.filter((x) => monthKey(x.entry_date) === k).reduce((t, x) => t + (trips[x.id]?.paid ? Number(trips[x.id].amt || 0) : 0), 0)) : 0;
    return { ...v, trips, allowMonth: k ? { ...v.allowMonth, [k]: total } : v.allowMonth };
  });

  async function saveSlip() {
    const patch = {};
    for (const [k] of EDIT_FIELDS) {
      const v = Number(slipEdit[k] || 0);
      if (Number.isNaN(v) || v < 0) { flash('Amounts must be numbers, e.g. 200', 'err'); return; }
      patch[k] = Math.round(v * 1000) / 1000;
    }
    setSlipBusy(true);
    const { error: err } = await sb().from('transport_salaries').update(patch).eq('id', slipSal.id);
    if (err) { setSlipBusy(false); flash(err.message, 'err'); return; }
    // driver allowance: amount changes and paid with this salary or not (the trip sheets follow; the database recalculates the salary)
    for (const e of allowTrips) {
      const t = slipEdit.trips?.[e.id];
      if (!t) continue;
      const amt = Math.round(Number(t.amt || 0) * 1000) / 1000;
      if (Number.isNaN(amt) || amt < 0) { setSlipBusy(false); flash('Driver allowance must be a number', 'err'); return; }
      const up = {};
      if (amt !== Number(e.driver_allowance || 0)) up.driver_allowance = amt;
      const wasPaid = e.allowance_salary_id === slipSal.id;
      if (t.paid && !wasPaid) { up.allowance_status = 'Paid'; up.allowance_salary_id = slipSal.id; }
      if (!t.paid && wasPaid) { up.allowance_status = 'Not paid'; up.allowance_salary_id = null; }
      if (Object.keys(up).length) {
        const { error: e2 } = await sb().from('transport_entries').update(up).eq('id', e.id);
        if (e2) { setSlipBusy(false); flash(e2.message, 'err'); return; }
      }
    }
    setSlipBusy(false);
    setSlipEdit(null);
    flash('Salary slip saved. Trip sheets updated.');
    load();
  }

  function printSlip() {
    document.body.classList.add('slip-printing');
    const done = () => { document.body.classList.remove('slip-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 80);
  }

  async function pdfSlip() {
    const el = document.getElementById('trip-slip');
    if (!el) return;
    try {
      flash('Preparing PDF...');
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2, logging: false });
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const w = 190;
      const h = Math.min(277, (canvas.height * w) / canvas.width);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, h);
      pdf.save(`Salary slip ${driver?.name || ''} ${monthLabel(slipMonth)}.pdf`);
      flash('PDF downloaded');
    } catch {
      flash('Could not make the PDF. Use Print and choose Save as PDF.', 'err');
    }
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="month">Month</label>
            <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          {isAdmin && (
            <button type="button" className={`btn ${editMode ? 'in' : ''}`} onClick={() => setEditMode((v) => !v)} aria-pressed={editMode}>
              {editMode ? '✓ Done editing' : 'Edit'}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => setColsOpen(true)} title="Choose which columns to print or export">☑ Columns</button>
          <button type="button" className="btn ghost" onClick={printChosen} title="Print the chosen columns">🖨 Print</button>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
          <button type="button" className="btn ghost" onClick={doPdf}>Export PDF</button>
          <button type="button" className="btn in" onClick={() => { setSlipEdit(null); setSlipOpen(true); }} title="Salary slip of this month: print, edit, PDF">🧾 Salary slip</button>
          <button type="button" className="btn" onClick={doDriverCopy} title="PDF for the driver: trips, allowance and diesel only. No rent, received or profit.">🚚 Driver copy</button>
        </div>
      </div>

      <CompanyHeader title={`${driver.name} · Trip sheet`} detail={`Driver: ${driver.name}  |  Vehicle # ${driver.vehicle_no || '–'}  |  ${monthLabel(month)}`} />

      <div className="kpi-row tp-hide">
        <div className="kpi"><span>Trips</span><strong>{totals.trips}</strong><small>{monthLabel(month)}</small></div>
        <div className="kpi"><span>Work amount</span><strong><Omr v={totals.rent} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Balance to collect</span><strong className={totals.balance > 0 ? 'neg' : ''}><Omr v={totals.balance} /></strong><small>Rent − received</small></div>
        <div className="kpi"><span>Trip costs</span><strong><Omr v={totals.costs} /></strong><small>Diesel, toll, maintenance</small></div>
        <div className="kpi hero"><span>Net before salary</span><strong><Omr v={totals.net} /></strong><small>OMR</small></div>
      </div>

      <section className={`sheet tp-hide ${editMode ? 'is-editing' : ''}`}>
        <div className="sheet-title sheet-edit-bar">
          <h2>Trip sheet</h2>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>
        {editMode && (
          <div className="edit-banner">
            Edit mode is on. Click any cell to change it, then press Enter. Amounts accept maths like 25+4. Click <strong>✓ Done</strong> when finished.
          </div>
        )}
        {isAdmin && month !== 'all' && (() => {
          const open = rows.filter((e) => hasAllow(e) && e.allowance_status !== 'Paid');
          return open.length > 1 ? (
            <div className="mark-all-bar">
              <span>{open.length} trips with driver allowance not paid in {monthLabel(month)}: <b>{fmtAmt(open.reduce((t, e) => t + Number(e.driver_allowance || 0), 0))}</b></span>
              <button type="button" className="btn small in" onClick={() => payPrevious(open.map((e) => e.id))}>✓ Mark all paid</button>
            </div>
          ) : null;
        })()}
        {(prevOpen.length > 0 || prevPaidHere.length > 0) && (
          <div className="prev-allow">
            <b>Driver allowance from previous months</b>
            <ul>
              {prevOpen.map((g) => (
                <li key={`o-${g.month}`} className="bad">
                  <span>{monthLabel(g.month)} balance</span>
                  <strong>{calc(g.parts)}{fmtAmt(g.amt)}</strong>
                  <span className="tag warn">Not paid</span>
                  {isAdmin && <button type="button" className="btn small" onClick={() => payPrevious(g.ids)}>Mark paid</button>}
                </li>
              ))}
              {prevPaidHere.map((g) => (
                <li key={`p-${g.month}`} className="ok">
                  <span>{monthLabel(g.month)} balance</span>
                  <strong>{calc(g.parts)}{fmtAmt(g.amt)}</strong>
                  <span className="tag ok">Paid in {monthLabel(month)}</span>
                  {isAdmin && <button type="button" className="btn small ghost" onClick={() => undoPrevious(g.ids)} title="Set back to Not paid">↶ Undo</button>}
                </li>
              ))}
            </ul>
            {prevPaidHere.length > 0 && (
              <div className="pa-total">
                Driver allowance paid in {monthLabel(month)}:{' '}
                {prevPaidHere.map((g) => `${monthLabel(g.month).split(' ')[0]} ${fmtAmt(g.amt)}`).join(' + ')}
                {' + '}{monthLabel(month).split(' ')[0]} {fmtAmt(thisPaid)}
                {' = '}<b>{fmtAmt(prevPaidTotal + thisPaid)}</b>
              </div>
            )}
            {prevOpenTotal > 0 && <small>This month {fmtAmt(totals.driver_allowance)} + previous {fmtAmt(prevOpenTotal)} = <b>{fmtAmt(totals.driver_allowance + prevOpenTotal)}</b> driver allowance due</small>}
          </div>
        )}
        <DataGrid
          columns={columns}
          rows={rows}
          canEdit={canChange}
          onSave={save}
          onAdd={addRow}
          addLabel="+ Add trip or expense"
          onDelete={(r) => setDel(r)}
          rowClass={(r) => (Number(r.rent) === 0 && Number(r.maintenance) > 0 ? 'expense-row' : Number(r.rent) > Number(r.received) ? 'due-row' : '')}
          emptyText="No trips in this month."
          footer={{
            entry_date: `${totals.trips} trips`,
            rent: fmtAmt(totals.rent), received: fmtAmt(totals.received),
            balance: <span className={totals.balance > 0 ? 'neg' : ''}>{fmtAmt(totals.balance)}</span>,
            driver_allowance: prevOpenTotal > 0 ? <span className="fa-prev">{fmtAmt(totals.driver_allowance)}<small>+ prev. {fmtAmt(prevOpenTotal)} not paid</small></span> : fmtAmt(totals.driver_allowance), diesel: fmtAmt(totals.diesel),
            toll: fmtAmt(totals.toll), maintenance: fmtAmt(totals.maintenance)
          }}
          flash={flash}
        />
        <p className="sheet-hint">
          Red mark: money still to collect. Amber mark: maintenance or other expense without a trip. All amounts in OMR.
          {!isAdmin && ' View only.'}
        </p>
      </section>

      {(() => {
        const c = chosenTable();
        return (
          <section className="trip-print" aria-hidden="true">
            <table>
              <thead><tr>{c.head.map((h, i) => <th key={i} className={c.numCols.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
              <tbody>
                {c.rows(true).map((r, k) => <tr key={k}>{r.map((v, i) => <td key={i} className={c.numCols.includes(i) ? 'num' : ''}>{v}</td>)}</tr>)}
              </tbody>
              <tfoot><tr>{c.totals(true).map((v, i) => <td key={i} className={c.numCols.includes(i) ? 'num' : ''}>{v}</td>)}</tr></tfoot>
            </table>
            <p className="tp-foot">Printed {exportStamp()} · All amounts in OMR</p>
          </section>
        );
      })()}

      {colsOpen && (() => {
        const head = tableData().head;
        const on = new Set(cols);
        return (
          <Modal title="Choose columns to print" onClose={() => setColsOpen(false)}>
            <div className="tp-presets">
              {PRESETS.map(([label, list]) => (
                <button key={label} type="button" className="rp-chip" onClick={() => saveCols(list || head.map((_, i) => i))}>{label}</button>
              ))}
              <button type="button" className="rp-chip" onClick={() => saveCols([0])}>Clear</button>
            </div>
            <div className="tp-cols">
              {head.map((h, i) => (
                <label key={i} className={on.has(i) ? 'on' : ''}>
                  <input type="checkbox" checked={on.has(i)} disabled={i === 0} onChange={() => saveCols(on.has(i) ? cols.filter((x) => x !== i) : [...cols, i])} />
                  {h}
                </label>
              ))}
            </div>
            <p className="note" style={{ margin: '10px 0 0' }}>{cols.length} of {head.length} columns chosen. Your choice is remembered on this device.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={excelChosen}>⬇ Excel</button>
              <button type="button" className="btn ghost" onClick={pdfChosen}>⬇ PDF</button>
              <button type="button" className="btn" onClick={printChosen}>🖨 Print</button>
            </div>
          </Modal>
        );
      })()}

      {slipOpen && driver && (
        <div className="ts-slip-overlay" role="dialog" aria-modal="true" aria-label="Salary slip">
          <div className="ts-slip-box">
            <div className="ts-slip-bar">
              <b>🧾 Salary slip · {driver.name} · {monthLabel(slipMonth)}</b>
              <span className="ts-slip-actions">
                {slipSal && !slipEdit && <button type="button" className="btn in" onClick={printSlip}>🖨 Print</button>}
                {slipSal && !slipEdit && <button type="button" className="btn ghost" onClick={pdfSlip}>⬇ PDF</button>}
                {slipSal && !slipEdit && isAdmin && (
                  <button type="button" className="btn ghost" onClick={openSlipEdit}>✏️ Edit</button>
                )}
                <button type="button" className="btn ghost" onClick={() => { setSlipOpen(false); setSlipEdit(null); }}>✕ Close</button>
              </span>
            </div>

            {slipEdit && slipSal && (
              <div className="ts-slip-edit">
                <div className="dd-grid">
                  {allowMonths.map((k) => (
                    <label key={`am-${k}`} className="ts-allow-field">
                      <span>Driver allowance {monthLabel(k)}{k < slipMonth ? ' (previous balance)' : ''}</span>
                      <input type="number" inputMode="decimal" step="0.001" min="0" value={slipEdit.allowMonth?.[k] ?? 0} onChange={(e) => typeAllowance(k, e.target.value)} />
                      <small>of {fmtAmt(allowTrips.filter((e) => monthKey(e.entry_date) === k).reduce((t, e) => t + Number(e.driver_allowance || 0), 0))} open</small>
                    </label>
                  ))}
                  {EDIT_FIELDS.map(([k, label]) => (
                    <label key={k}>
                      <span>{label}</span>
                      <input type="number" inputMode="decimal" step="0.001" min="0" value={slipEdit[k]} onChange={(e) => setSlipEdit((v) => ({ ...v, [k]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                {(() => {
                  const tr = slipEdit.trips || {};
                  const groups = {};
                  allowTrips.forEach((e) => { const k = monthKey(e.entry_date); (groups[k] = groups[k] || []).push(e); });
                  const paidSum = (list) => list.reduce((t, e) => t + (tr[e.id]?.paid ? Number(tr[e.id].amt || 0) : 0), 0);
                  const curAllow = num(paidSum(allowTrips.filter((e) => monthKey(e.entry_date) === slipMonth)));
                  const prevAllow = num(paidSum(allowTrips.filter((e) => monthKey(e.entry_date) < slipMonth)));
                  const preview = { ...slipSal, ...slipEdit, trip_allowance: curAllow, allowance_carried: prevAllow };
                  return (
                    <>
                      <h3 className="ts-allow-h">Driver allowance paid with this salary</h3>
                      {!allowTrips.length && <p className="muted">No driver allowance open for {monthLabel(slipMonth)} or earlier.</p>}
                      {Object.keys(groups).sort().map((k) => {
                        const list = groups[k];
                        const allOn = list.every((e) => tr[e.id]?.paid);
                        return (
                          <div key={k} className="ts-allow-month">
                            <div className="ts-allow-mh">
                              <label><input type="checkbox" checked={allOn} onChange={() => list.forEach((e) => setTrip(e.id, { paid: !allOn }))} /> <b>{monthLabel(k)}{k < slipMonth ? ' (previous balance)' : ''}</b></label>
                              <span>Paid here: <b>{fmtAmt(paidSum(list))}</b>{list.some((e) => tr[e.id]?.paid) ? ` (${list.filter((e) => tr[e.id]?.paid).map((e) => fmtAmt(tr[e.id].amt)).join(' + ')})` : ''}</span>
                            </div>
                            <table className="ts-allow-t">
                              <tbody>
                                {list.map((e) => (
                                  <tr key={e.id} className={tr[e.id]?.paid ? 'on' : ''}>
                                    <td><input type="checkbox" checked={Boolean(tr[e.id]?.paid)} onChange={(ev) => setTrip(e.id, { paid: ev.target.checked })} aria-label="Paid with this salary" /></td>
                                    <td>{fmtDay(e.entry_date)}</td>
                                    <td>{[e.from_place, e.to_place].filter(Boolean).join(' → ') || e.description || 'Trip'}</td>
                                    <td><input type="number" inputMode="decimal" step="0.001" min="0" value={tr[e.id]?.amt ?? 0} onChange={(ev) => setTrip(e.id, { amt: ev.target.value })} aria-label="Driver allowance" /></td>
                                    <td>{tr[e.id]?.paid ? <span className="tag ok">Paid</span> : <span className="tag warn">Not paid</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                      <p className="ts-allow-sum">
                        Driver allowance: {prevAllow ? `previous ${fmtAmt(prevAllow)} + ` : ''}{monthLabel(slipMonth).split(' ')[0]} {fmtAmt(curAllow)} = <b>{fmtAmt(prevAllow + curAllow)}</b>
                        {' · '}Total salary {fmtAmt(salaryTotal(preview))} · Net <b>{fmtAmt(salaryPayable(preview))}</b>
                      </p>
                    </>
                  );
                })()}
                <div className="modal-actions">
                  <button type="button" className="btn ghost" onClick={() => setSlipEdit(null)}>Cancel</button>
                  <button type="button" className="btn in" disabled={slipBusy} onClick={saveSlip}>{slipBusy ? 'Saving...' : 'OK, save slip'}</button>
                </div>
              </div>
            )}

            {slipSal ? (
              <SalarySlipPaper driver={driver} salaries={salaries} entries={entries} month={slipMonth} paperId="trip-slip" />
            ) : (
              <div className="ts-slip-empty">
                <p>No salary saved for {driver.name} in {monthLabel(slipMonth)} yet.</p>
                {isAdmin && <button type="button" className="btn in" disabled={slipBusy} onClick={createSlip}>{slipBusy ? 'Creating...' : `＋ Create salary for ${monthLabel(slipMonth)}`}</button>}
                <p className="note">Fixed amounts are copied from the last month. Driver allowance comes from the trips marked Paid.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}

      {del && (
        <Modal title="Delete row?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>
            Delete the {fmtFullDate(del.entry_date)} row
            {del.to_place ? ` (${del.from_place || ''} → ${del.to_place})` : del.description ? ` (${del.description})` : ''}?
          </p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DriverSheet /></AuthGate>;
}
