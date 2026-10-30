'use client';

import RangeReport from '@/components/RangeReport';
import { transportReport } from '@/lib/rangeReports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, monthKey, monthLabel, exportStamp, exportExcel, exportPdf } from '@/lib/sheet';
import { salaryPayable, vatOf } from '@/lib/transport';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import Omr from '@/components/Omr';

const COMPANY = `${COMPANY_NAME} · Transport Division`;


function TransportPage() {
  const { isAdmin } = useUser();
  const [drivers, setDrivers] = useState(null);
  const [entries, setEntries] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [extras, setExtras] = useState([]);
  const [month, setMonth] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, e, sa, ex] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_entries').select('id, driver_id, entry_date, from_place, to_place, description, payment_status, sort, rent, received, diesel, toll, maintenance, driver_allowance, allowance_status, allowance_salary_id, vat_included'),
      s.from('transport_salaries').select('*'),
      s.from('transport_extras').select('*').order('created_at')
    ]);
    setDrivers(d.data || []);
    setEntries(e.data || []);
    setSalaries(sa.data || []);
    setExtras(ex.data || []);
    setMonth((m) => {
      if (m) return m;
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      return keys[keys.length - 1] || monthKey(new Date().toISOString());
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const set = new Set([
      ...entries.map((x) => monthKey(x.entry_date)),
      ...salaries.map((x) => monthKey(x.month)),
      ...extras.map((x) => monthKey(x.month)),
      monthKey(new Date().toISOString())
    ]);
    return [...set].filter(Boolean).sort().reverse();
  }, [entries, salaries, extras]);

  const inMonth = (d) => month === 'all' || monthKey(d) === month;

  const summary = useMemo(() => {
    if (!drivers) return [];
    return drivers.map((d) => {
      const es = entries.filter((e) => e.driver_id === d.id && inMonth(e.entry_date));
      const sum = (k) => num(es.reduce((t, e) => t + Number(e[k] || 0), 0));
      const sal = salaries.filter((s) => s.driver_id === d.id && inMonth(s.month));
      const ex = extras.filter((x) => x.driver_id === d.id && inMonth(x.month));
      const r = {
        driver: d,
        trips: es.filter((e) => Number(e.rent) > 0).length,
        work: sum('rent'),
        received: sum('received'),
        diesel: sum('diesel'),
        toll: sum('toll'),
        maintenance: sum('maintenance'),
        tripAllowance: sum('driver_allowance'),
        salary: num(sal.reduce((t, s) => t + salaryPayable(s), 0)),
        other: num(ex.reduce((t, x) => t + Number(x.amount || 0), 0))
      };
      r.receivable = num(r.work - r.received);
      r.expenses = num(r.diesel + r.toll + r.maintenance + r.salary + r.other);
      r.vat = num(es.reduce((t, e) => t + vatOf(e), 0));
      // Profit: salary is NOT subtracted (client rule). VAT 5% kept aside. Driver allowance counted per trip.
      r.profit = num(r.work - r.vat - r.diesel - r.toll - r.maintenance - r.tripAllowance - r.other);
      return r;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, entries, salaries, extras, month]);

  const total = (k) => num(summary.reduce((t, r) => t + r[k], 0));

  const SUMMARY_ROWS = [
    ['trips', 'Total trips'],
    ['work', 'Total work amount'],
    ['received', 'Total received amount'],
    ['receivable', 'Receivable amount'],
    ['gap'],
    ['diesel', 'Diesel expense'],
    ['toll', 'Toll + visa exit fee'],
    ['maintenance', 'Maintenance charges'],
    ['salary', 'Total salary'],
    ['other', 'Other (trailer rent etc.)'],
    ['expenses', 'Total expenses', 'sum'],
    ['profit', 'Profit', 'profit']
  ];

  /* ---------- Export ---------- */

  function summaryTable() {
    const head = ['Description', ...summary.map((r) => `${r.driver.name} ${r.driver.vehicle_no ? r.driver.vehicle_no.split(' ')[0] : ''}`.trim()), 'Total'];
    const rows = SUMMARY_ROWS.filter(([k]) => k !== 'gap').map(([k, label]) => [label, ...summary.map((r) => r[k]), total(k)]);
    return { head, rows };
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const s = summaryTable();
      const sheets = [{ name: 'Summary', title: `Transport summary · ${monthLabel(month)}`, subtitle: `${COMPANY} · Exported ${exportStamp()} · OMR`, head: s.head, rows: s.rows, numCols: s.head.map((_, i) => i).slice(1), widths: [30, 18, 18, 14], boldRows: [s.rows.length - 2, s.rows.length - 1] }];
      await exportExcel(`Transport ${monthLabel(month)}.xlsx`, sheets);
      flash('Excel file downloaded');
    } catch {
      flash('Could not create the Excel file. Please try again.', 'err');
    }
  }

  async function doPdf() {
    try {
      flash('Preparing PDF...');
      const s = summaryTable();
      const fmt = (rows) => rows.map((r) => r.map((v, i) => (i === 0 ? v : fmtAmt(v))));
      const sections = [{ heading: 'Summary (OMR)', head: s.head, rows: fmt(s.rows), numCols: s.head.map((_, i) => i).slice(1), boldRows: [s.rows.length - 2, s.rows.length - 1], fontSize: 10 }];
      await exportPdf(`Transport ${monthLabel(month)}.pdf`, { title: `Transport Expense · ${monthLabel(month)}`, subtitle: `${COMPANY}  |  Exported ${exportStamp()}`, sections, landscape: false });
      flash('PDF downloaded');
    } catch {
      flash('Could not create the PDF. Please try again.', 'err');
    }
  }

  /* ---------- Email the full PDF report ---------- */

  const [mailing, setMailing] = useState(false);
  async function emailReport() {
    setMailing(true);
    flash('Sending the full report by email...');
    try {
      const { data } = await sb().auth.getSession();
      const res = await fetch('/api/transport-report', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) flash(out.error || 'Sending failed.', 'err');
      else flash(`Report emailed to ${(out.to || []).join(', ')}`);
    } catch {
      flash('Sending failed. Check the internet and try again.', 'err');
    }
    setMailing(false);
  }

  /* ---------- Render ---------- */

  if (!drivers || !month) return <div className="loading">Loading transport...</div>;

  const t = {
    work: total('work'), received: total('received'), receivable: total('receivable'),
    expenses: total('expenses'), profit: total('profit'), trips: total('trips')
  };

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="month">Month</label>
            <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          <Link href="/transport/drivers" className="btn">👤 Drivers</Link>
          <Link href="/transport/vehicles" className="btn">🚚 Vehicles</Link>
          <Link href="/transport/invoice" className="btn">🧾 Invoice</Link>
          <Link href="/transport/reports" className="btn report">📊 Reports</Link>
          <RangeReport title="Transport report (all drivers)" company="Modern City for Express Services LLC · Transport Division" landscape
            build={(from, to) => transportReport({ entries, drivers: drivers || [], salaries, extras, from, to })} label="🖨 Report by dates" />
          <button type="button" className="btn ghost" onClick={doExcel}>📗 Excel</button>
          <button type="button" className="btn ghost" onClick={doPdf}>📕 PDF</button>
          {isAdmin && <button type="button" className="btn ghost" onClick={emailReport} disabled={mailing}>{mailing ? 'Sending...' : '✉ Email report'}</button>}
        </div>
      </div>

      <CompanyHeader title="Transport Expense" detail={`Period: ${monthLabel(month)}  |  ${drivers.length} trucks  |  Currency: OMR`} />

      <div className="kpi-row">
        <div className="kpi"><span>Work amount</span><strong><Omr v={t.work} /></strong><small>{t.trips} trips · OMR</small></div>
        <div className="kpi"><span>Received</span><strong className="pos"><Omr v={t.received} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Receivable</span><strong className={t.receivable > 0 ? 'neg' : ''}><Omr v={t.receivable} /></strong><small>Still to collect</small></div>
        <div className="kpi"><span>Total expenses</span><strong><Omr v={t.expenses} /></strong><small>Diesel, toll, maintenance, salary</small></div>
        <div className="kpi hero"><span>Profit</span><strong><Omr v={t.profit} /></strong><small>OMR · {monthLabel(month)}</small></div>
      </div>

      <div className="driver-cards">
        {summary.map((r) => (
          <div key={r.driver.id} className="driver-card">
            <div>
              <h3>{r.driver.name}</h3>
              <div className="veh">Vehicle # {r.driver.vehicle_no || '–'}</div>
            </div>
            <dl>
              <div><dt>Trips</dt><dd>{r.trips}</dd></div>
              <div><dt>Work</dt><dd><Omr v={r.work} /></dd></div>
              <div><dt>Profit</dt><dd className={r.profit < 0 ? 'neg' : 'pos'}><Omr v={r.profit} /></dd></div>
            </dl>
            <div className="card-links">
              <Link href={`/transport/${r.driver.id}`} className="open stretch">Open trip sheet →</Link>
              <Link href={`/transport/salary-sheet/${r.driver.id}`} className="slip-link">📑 Salary sheet</Link>
            </div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Summary · {monthLabel(month)}</h2>
          <p className="note">All amounts in OMR</p>
        </div>
        <div className="table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Description</th>
                {summary.map((r) => <th key={r.driver.id} className="num">{r.driver.name}<br /><small className="muted">{r.driver.vehicle_no}</small></th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY_ROWS.map(([k, label, cls]) => (k === 'gap' ? (
                <tr key="gap" className="gap"><td colSpan={summary.length + 2} /></tr>
              ) : (
                <tr key={k} className={cls || ''}>
                  <td>{label}</td>
                  {summary.map((r) => (
                    <td key={r.driver.id} className={`num ${k === 'profit' ? (r[k] < 0 ? 'neg' : 'pos') : ''} ${k === 'receivable' && r[k] > 0 ? 'neg' : ''}`}>
                      {k === 'trips' ? r[k] : fmtAmt(r[k])}
                    </td>
                  ))}
                  <td className={`num ${k === 'profit' ? (total(k) < 0 ? 'neg' : 'pos') : ''}`}>{k === 'trips' ? total(k) : fmtAmt(total(k))}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}

    </>
  );
}

export default function Page() {
  return <AuthGate wide><TransportPage /></AuthGate>;
}
