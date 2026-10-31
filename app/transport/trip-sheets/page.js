'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import Modal from '@/components/Modal';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, fmtFullDate, monthKey, monthLabel, exportStamp, exportExcel, exportPdf } from '@/lib/sheet';
import { vatOf } from '@/lib/transport';

/*
  All Drivers Trip Sheets (/transport/trip-sheets, opened from Drivers page and the Transport side menu).
  Every driver's trips for one month (or all months), one table per driver with its own totals, then grand totals.
  Driver chips choose who is shown (?d=<driver id> opens one driver). Built from the drivers table, so a new driver appears by himself.
  ☑ Columns chooser (saved on this device, localStorage tudo-all-trips-cols) is used by Print, PDF and Excel.
*/

const COLS_KEY = 'tudo-all-trips-cols';
const amtOrBlank = (v) => (Number(v) ? Number(v) : '');

// [key, label, value(row), isNumber]
const COLUMNS = [
  ['date', 'Date', (r) => fmtFullDate(r.entry_date)],
  ['from', 'From', (r) => r.from_place || ''],
  ['to', 'To', (r) => r.to_place || ''],
  ['desc', 'Description', (r) => r.description || ''],
  ['rent', 'Total rent', (r) => num(r.rent), true],
  ['vat', 'VAT 5%', (r) => vatOf(r), true],
  ['received', 'Received', (r) => num(r.received), true],
  ['recv_on', 'Received on', (r) => (r.received_date ? fmtFullDate(r.received_date) : '')],
  ['balance', 'Balance', (r) => num(Number(r.rent || 0) - Number(r.received || 0)), true],
  ['payment', 'Payment', (r) => r.payment_status || ''],
  ['allow', 'Driver allowance', (r) => num(r.driver_allowance), true],
  ['allow_st', 'Allowance', (r) => r.allowance_status || ''],
  ['diesel', 'Diesel', (r) => num(r.diesel), true],
  ['toll', 'Toll / other', (r) => num(r.toll), true],
  ['maint', 'Maintenance', (r) => num(r.maintenance), true],
  ['status', 'Status', (r) => r.remarks || ''],
  ['credit', 'Payment credit in', (r) => r.credit_in || ''],
  ['by', 'Entered by', (r) => r.entered_by || '']
];
const ALL_KEYS = COLUMNS.map((c) => c[0]);
const STANDARD = ['date', 'from', 'to', 'desc', 'rent', 'received', 'balance', 'payment', 'allow', 'allow_st', 'diesel', 'toll', 'maint', 'status'];
const PRESETS = [
  ['All columns', ALL_KEYS],
  ['Standard', STANDARD],
  ['Driver copy (no money in)', ['date', 'from', 'to', 'desc', 'allow', 'allow_st', 'diesel', 'status']],
  ['Money only', ['date', 'from', 'to', 'rent', 'vat', 'received', 'recv_on', 'balance', 'payment']],
  ['Costs only', ['date', 'from', 'to', 'desc', 'allow', 'diesel', 'toll', 'maint']]
];

function AllTripSheets() {
  const [drivers, setDrivers] = useState(null);
  const [entries, setEntries] = useState([]);
  const [month, setMonth] = useState(null);
  const [pick, setPick] = useState('all'); // 'all' or driver id
  const [cols, setCols] = useState(STANDARD);
  const [colsOpen, setColsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null'); if (Array.isArray(saved) && saved.length) setCols(saved.filter((k) => ALL_KEYS.includes(k))); } catch { /* ignore */ }
    try { const d = new URLSearchParams(window.location.search).get('d'); if (d) setPick(d); } catch { /* ignore */ }
  }, []);
  const saveCols = (list) => { setCols(list); try { localStorage.setItem(COLS_KEY, JSON.stringify(list)); } catch { /* ignore */ } };

  useEffect(() => {
    (async () => {
      const s = sb();
      const [d, e] = await Promise.all([
        s.from('transport_drivers').select('id, name, status, vehicle_no, sort').order('sort').order('name'),
        s.from('transport_entries').select('*').order('entry_date').order('sort').order('created_at')
      ]);
      const list = (d.data || []).sort((a, b) => (a.status === 'Inactive') - (b.status === 'Inactive') || String(a.name).localeCompare(String(b.name)));
      setDrivers(list);
      setEntries(e.data || []);
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      setMonth(keys[keys.length - 1] || monthKey(new Date().toISOString()));
    })();
  }, []);

  const months = useMemo(() => [...new Set([...entries.map((x) => monthKey(x.entry_date)), monthKey(new Date().toISOString())])].sort().reverse(), [entries]);

  if (!drivers || !month) return <div className="loading">Loading trip sheets...</div>;

  const inMonth = (e) => month === 'all' || monthKey(e.entry_date) === month;
  const shown = drivers.filter((d) => pick === 'all' || d.id === pick);
  const chosen = COLUMNS.filter((c) => cols.includes(c[0]));
  const period = month === 'all' ? 'All months' : monthLabel(month);

  const sheetOf = (d) => {
    const rows = entries.filter((e) => e.driver_id === d.id && inMonth(e));
    const tot = (k) => num(rows.reduce((t, e) => t + Number(e[k] || 0), 0));
    const T = {
      trips: rows.filter((e) => Number(e.rent) > 0).length, rent: tot('rent'), received: tot('received'), allow: tot('driver_allowance'),
      diesel: tot('diesel'), toll: tot('toll'), maint: tot('maintenance'), vat: num(rows.reduce((t, e) => t + vatOf(e), 0))
    };
    T.balance = num(T.rent - T.received);
    T.costs = num(T.diesel + T.toll + T.maint);
    T.net = num(T.rent - T.costs - T.allow);
    return { d, rows, T };
  };
  const sheets = shown.map(sheetOf);
  const G = sheets.reduce((g, s) => { Object.keys(s.T).forEach((k) => { g[k] = num((g[k] || 0) + s.T[k]); }); return g; }, {});

  const totalCell = (key, T) => ({ rent: T.rent, vat: T.vat, received: T.received, balance: T.balance, allow: T.allow, diesel: T.diesel, toll: T.toll, maint: T.maint }[key]);
  const totalsRow = (T, fmt) => chosen.map(([k], i) => {
    if (i === 0) return 'Total';
    if (i === 1) return `${T.trips} trips`;
    const v = totalCell(k, T);
    return v === undefined ? '' : fmt ? fmtAmt(v) : v;
  });
  const rowCells = (r, fmt) => chosen.map(([, , fn, isNum]) => { const v = fn(r); return isNum ? (fmt ? (Number(v) ? fmtAmt(v) : '') : amtOrBlank(v)) : v; });
  const numIdx = chosen.map((c, i) => (c[3] ? i : -1)).filter((i) => i >= 0);
  const fileBase = `${pick === 'all' ? 'All drivers' : shown[0]?.name || 'Driver'} trip sheets ${period}`;

  async function doPdf() {
    try {
      flash('Preparing PDF...');
      const sections = sheets.map((s) => ({
        heading: `${s.d.name}${s.d.vehicle_no ? ` · Vehicle # ${s.d.vehicle_no}` : ''}`,
        head: chosen.map((c) => c[1]), rows: s.rows.map((r) => rowCells(r, true)), totalsRow: totalsRow(s.T, true), numCols: numIdx
      }));
      sections.push({
        heading: 'All drivers totals',
        head: ['Driver', 'Trips', 'Work amount', 'Received', 'Balance', 'Driver allowance', 'Diesel', 'Toll / other', 'Maintenance', 'Net before salary'],
        rows: sheets.map((s) => [s.d.name, s.T.trips, fmtAmt(s.T.rent), fmtAmt(s.T.received), fmtAmt(s.T.balance), fmtAmt(s.T.allow), fmtAmt(s.T.diesel), fmtAmt(s.T.toll), fmtAmt(s.T.maint), fmtAmt(s.T.net)]),
        totalsRow: ['Total', G.trips || 0, fmtAmt(G.rent || 0), fmtAmt(G.received || 0), fmtAmt(G.balance || 0), fmtAmt(G.allow || 0), fmtAmt(G.diesel || 0), fmtAmt(G.toll || 0), fmtAmt(G.maint || 0), fmtAmt(G.net || 0)],
        numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9], fontSize: 9
      });
      await exportPdf(`${fileBase}.pdf`, { title: 'All Drivers Trip Sheets', subtitle: `${COMPANY_NAME} · Transport Division  |  ${period}  |  Exported ${exportStamp()}  |  OMR`, sections });
      flash('PDF downloaded');
    } catch { flash('Could not create the PDF. Please try again.', 'err'); }
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const widths = chosen.map((c) => Math.max(10, Math.min(28, c[1].length + 6)));
      const out = sheets.map((s) => ({
        name: s.d.name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31), title: `${s.d.name} · Vehicle # ${s.d.vehicle_no || ''} · ${period}`,
        subtitle: `${COMPANY_NAME} · Transport Division · Exported ${exportStamp()} · OMR`,
        head: chosen.map((c) => c[1]), rows: s.rows.map((r) => rowCells(r, false)), totalsRow: totalsRow(s.T, false), numCols: numIdx, widths
      }));
      out.push({
        name: 'All drivers totals', title: `All drivers · ${period}`, subtitle: `${COMPANY_NAME} · Transport Division · OMR`,
        head: ['Driver', 'Trips', 'Work amount', 'Received', 'Balance', 'Driver allowance', 'Diesel', 'Toll / other', 'Maintenance', 'Net before salary'],
        rows: sheets.map((s) => [s.d.name, s.T.trips, s.T.rent, s.T.received, s.T.balance, s.T.allow, s.T.diesel, s.T.toll, s.T.maint, s.T.net]),
        totalsRow: ['Total', G.trips || 0, G.rent || 0, G.received || 0, G.balance || 0, G.allow || 0, G.diesel || 0, G.toll || 0, G.maint || 0, G.net || 0],
        numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9], widths: [22, 8, 14, 14, 14, 16, 12, 12, 13, 16]
      });
      await exportExcel(`${fileBase}.xlsx`, out);
      flash('Excel file downloaded');
    } catch { flash('Could not create the Excel file. Please try again.', 'err'); }
  }

  function doPrint() {
    setColsOpen(false);
    setTimeout(() => window.print(), 150);
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/transport/drivers" className="crumb">← Drivers</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="ats-month">Month</label>
            <select id="ats-month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setColsOpen(true)}>☑ Columns</button>
          <button type="button" className="btn" onClick={doPrint}>🖨 Print</button>
          <button type="button" className="btn" onClick={doPdf}>📕 PDF</button>
          <button type="button" className="btn" onClick={doExcel}>📗 Excel</button>
          <Link href="/transport/salary-sheet" className="btn">📑 Salary sheet</Link>
        </div>
      </div>

      <CompanyHeader title="All Drivers Trip Sheets" detail={`Period: ${period}  |  ${shown.length} driver${shown.length === 1 ? '' : 's'}  |  Currency: OMR`} />

      <div className="ats-chips no-print" role="group" aria-label="Choose driver">
        <button type="button" className={`rp-chip ${pick === 'all' ? 'active' : ''}`} onClick={() => setPick('all')}>All drivers</button>
        {drivers.map((d) => (
          <button key={d.id} type="button" className={`rp-chip ${pick === d.id ? 'active' : ''}`} onClick={() => setPick(d.id)}>
            {d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}
          </button>
        ))}
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Trips</span><strong>{G.trips || 0}</strong><small>{period}</small></div>
        <div className="kpi"><span>Work amount</span><strong><Omr v={G.rent || 0} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Balance to collect</span><strong className="neg"><Omr v={G.balance || 0} /></strong><small>Rent − received</small></div>
        <div className="kpi"><span>Driver allowance</span><strong><Omr v={G.allow || 0} /></strong><small>OMR</small></div>
        <div className="kpi hero"><span>Net before salary</span><strong><Omr v={G.net || 0} /></strong><small>Rent − costs − allowance</small></div>
      </div>

      {sheets.map((s) => (
        <section key={s.d.id} className="panel ats-sheet">
          <div className="section-head">
            <h2>📄 {s.d.name}{s.d.vehicle_no ? <small className="muted"> · Vehicle # {s.d.vehicle_no}</small> : null}</h2>
            <Link href={`/transport/${s.d.id}`} className="btn small no-print">Open trip sheet →</Link>
          </div>
          {s.rows.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No trips in {period}.</p>
          ) : (
            <div className="table-wrap">
              <table className="data ats-table">
                <thead><tr>{chosen.map((c, i) => <th key={c[0]} className={`${numIdx.includes(i) ? 'num' : ''} col-${c[0]}`}>{c[1]}</th>)}</tr></thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.id}>{rowCells(r, true).map((v, i) => <td key={chosen[i][0]} className={`${numIdx.includes(i) ? 'num' : ''} col-${chosen[i][0]}`}>{v}</td>)}</tr>
                  ))}
                </tbody>
                <tfoot><tr>{totalsRow(s.T, true).map((v, i) => <td key={chosen[i][0]} className={numIdx.includes(i) ? 'num' : ''}>{v}</td>)}</tr></tfoot>
              </table>
            </div>
          )}
        </section>
      ))}

      {sheets.length > 1 && (
        <section className="panel ats-sheet">
          <div className="section-head"><h2>Σ All drivers totals</h2></div>
          <div className="table-wrap">
            <table className="data ats-table">
              <thead><tr><th>Driver</th><th className="num">Trips</th><th className="num">Work amount</th><th className="num">Received</th><th className="num">Balance</th><th className="num">Driver allowance</th><th className="num">Diesel</th><th className="num">Toll / other</th><th className="num">Maintenance</th><th className="num">Net before salary</th></tr></thead>
              <tbody>
                {sheets.map((s) => (
                  <tr key={s.d.id}><td>{s.d.name}</td><td className="num">{s.T.trips}</td><td className="num">{fmtAmt(s.T.rent)}</td><td className="num">{fmtAmt(s.T.received)}</td><td className="num">{fmtAmt(s.T.balance)}</td><td className="num">{fmtAmt(s.T.allow)}</td><td className="num">{fmtAmt(s.T.diesel)}</td><td className="num">{fmtAmt(s.T.toll)}</td><td className="num">{fmtAmt(s.T.maint)}</td><td className="num">{fmtAmt(s.T.net)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="num">{G.trips || 0}</td><td className="num">{fmtAmt(G.rent || 0)}</td><td className="num">{fmtAmt(G.received || 0)}</td><td className="num">{fmtAmt(G.balance || 0)}</td><td className="num">{fmtAmt(G.allow || 0)}</td><td className="num">{fmtAmt(G.diesel || 0)}</td><td className="num">{fmtAmt(G.toll || 0)}</td><td className="num">{fmtAmt(G.maint || 0)}</td><td className="num">{fmtAmt(G.net || 0)}</td></tr></tfoot>
            </table>
          </div>
        </section>
      )}

      {colsOpen && (
        <Modal title="Columns for Print, PDF and Excel" onClose={() => setColsOpen(false)}>
          <div className="ats-presets">
            {PRESETS.map(([label, list]) => <button key={label} type="button" className="rp-chip" onClick={() => saveCols(list)}>{label}</button>)}
          </div>
          <div className="ats-cols">
            {COLUMNS.map(([k, label]) => (
              <label key={k} className="ats-col">
                <input type="checkbox" checked={cols.includes(k)} disabled={k === 'date'}
                  onChange={(e) => saveCols(e.target.checked ? ALL_KEYS.filter((x) => x === k || cols.includes(x)) : cols.filter((x) => x !== k))} />
                {label}
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setColsOpen(false)}>Close</button>
            <button type="button" className="btn ghost" onClick={doExcel}>📗 Excel</button>
            <button type="button" className="btn ghost" onClick={doPdf}>📕 PDF</button>
            <button type="button" className="btn in" onClick={doPrint}>🖨 Print</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><AllTripSheets /></AuthGate>;
}
