'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { vatOf } from '@/lib/transport';
import { fmtAmt, monthLabel, exportStamp, exportExcel, exportPdf } from '@/lib/sheet';
import { quarterOf, quarterMonths, quarterLabel, addDays, dmy } from '@/lib/groupTools';

/*
  VAT return only (/expenses/vat): opened by the 🧾 VAT return tab next to 📋 Checklist and the Office Expense side menu.
  Per source: Modern City, Abu Wasif, Sumptuosity, Transport (Modern City Transport Division).
  Output VAT = VAT inside sales: trips with "VAT 5% added" (Transport) and company invoices with VAT (company_docs kind invoice).
  Input VAT  = VAT typed on company bills (exp_entries.vat). Auto rows copied from Transport trips/salary/extras are left out
  (they are Transport costs, not company purchases). Quarter or one month. 🖨 Print options chooses the parts and columns
  (saved on this device, localStorage tudo-vat-print). The Group Summary keeps its own VAT return tab unchanged.
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const mk = (d) => String(d || '').slice(0, 7);
const SOURCES = [...COMPANIES.map((c) => ({ key: c.key, label: c.short })), { key: 'transport', label: 'Transport' }];
const labelOf = (k) => SOURCES.find((s) => s.key === k)?.label || k;
const SKIP_KINDS = ['trip', 'salary', 'extra'];

const SUM_COLS = [
  ['taxedNet', 'Sales with VAT (without VAT)'],
  ['outputVat', 'Output VAT 5%'],
  ['noVat', 'Sales with no VAT'],
  ['purchases', 'Purchases and bills'],
  ['inputVat', 'Input VAT'],
  ['net', 'Net VAT (pay + / claim −)']
];
const PRINT_KEY = 'tudo-vat-print';
const DEFAULT_PRINT = { summary: true, months: true, lines: true, cols: SUM_COLS.map((c) => c[0]) };

function VatReturnPage() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState(null); // '2026-Q4' or '2026-10'
  const [pick, setPick] = useState(SOURCES.map((s) => s.key));
  const [opt, setOpt] = useState(DEFAULT_PRINT);
  const [optOpen, setOptOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(PRINT_KEY) || 'null'); if (s && Array.isArray(s.cols)) setOpt({ ...DEFAULT_PRINT, ...s }); } catch { /* ignore */ }
    (async () => {
      const s = sb();
      const [e, t, d, dr] = await Promise.all([
        s.from('exp_entries').select('id, company, entry_date, bill_no, description, paid, unpaid, vat, vat_reg_no, source_kind'),
        s.from('transport_entries').select('id, driver_id, entry_date, from_place, to_place, rent, vat_included'),
        s.from('company_docs').select('id, company, kind, doc_no, doc_date, party, items, vat_pct').eq('kind', 'invoice'),
        s.from('transport_drivers').select('id, name')
      ]);
      const drv = Object.fromEntries((dr.data || []).map((x) => [x.id, x.name]));
      const sales = [
        ...(t.data || []).filter((r) => n(r.rent) > 0).map((r) => ({
          src: 'transport', date: r.entry_date, month: mk(r.entry_date), ref: drv[r.driver_id] || 'Trip',
          text: [r.from_place, r.to_place].filter(Boolean).join(' → ') || 'Trip', amount: r3(r.rent), vat: vatOf(r)
        })),
        ...(d.data || []).map((x) => {
          const sub = r3((Array.isArray(x.items) ? x.items : []).reduce((a, it) => a + n(it.amount), 0));
          const vat = r3((sub * n(x.vat_pct)) / 100);
          return { src: x.company || 'modern-city', date: x.doc_date, month: mk(x.doc_date), ref: x.doc_no || 'Invoice', text: x.party || '', amount: r3(sub + vat), vat };
        }).filter((x) => x.amount && x.date)
      ];
      const bills = (e.data || []).filter((b) => b.entry_date && !SKIP_KINDS.includes(b.source_kind)).map((b) => ({
        src: b.company, date: b.entry_date, month: mk(b.entry_date), ref: b.bill_no || '', text: b.description || '',
        amount: r3(n(b.paid) + n(b.unpaid)), vat: r3(b.vat), vatNo: b.vat_reg_no || ''
      }));
      const months = [...new Set([...sales, ...bills].map((x) => x.month).filter(Boolean))].sort();
      setData({ sales, bills, months });
      const nowQ = quarterOf(new Date().toISOString().slice(0, 7));
      const withVat = [...sales, ...bills].filter((x) => x.vat > 0).map((x) => quarterOf(x.month)).sort();
      setPeriod(withVat[withVat.length - 1] || nowQ);
    })();
  }, []);

  const periods = useMemo(() => {
    if (!data) return [];
    const qs = [...new Set([...data.months.map(quarterOf), quarterOf(new Date().toISOString().slice(0, 7))])].sort().reverse();
    return qs;
  }, [data]);

  if (!data || !period) return <div className="loading">Loading VAT return...</div>;

  const isQ = period.includes('-Q');
  const months = isQ ? quarterMonths(period) : [period];
  const pLabel = isQ ? quarterLabel(period) : monthLabel(period);
  const periodEnd = new Date(Date.UTC(Number(months[months.length - 1].slice(0, 4)), Number(months[months.length - 1].slice(5, 7)), 0)).toISOString().slice(0, 10);
  const fileBy = addDays(periodEnd, 30);
  const inP = (x) => months.includes(x.month) && pick.includes(x.src);
  const S = data.sales.filter(inP);
  const B = data.bills.filter(inP);
  const sum = (arr, f) => r3(arr.reduce((a, x) => a + f(x), 0));

  const rowFor = (src, mon) => {
    const s = S.filter((x) => x.src === src && (!mon || x.month === mon));
    const b = B.filter((x) => x.src === src && (!mon || x.month === mon));
    const taxed = s.filter((x) => x.vat > 0);
    const r = {
      taxedNet: sum(taxed, (x) => x.amount - x.vat), outputVat: sum(taxed, (x) => x.vat), noVat: sum(s.filter((x) => !(x.vat > 0)), (x) => x.amount),
      purchases: sum(b, (x) => x.amount), inputVat: sum(b, (x) => x.vat)
    };
    r.net = r3(r.outputVat - r.inputVat);
    return r;
  };
  const shownSrc = SOURCES.filter((s) => pick.includes(s.key));
  const rows = shownSrc.map((s) => ({ s, r: rowFor(s.key) }));
  const T = SUM_COLS.reduce((t, [k]) => ({ ...t, [k]: r3(rows.reduce((a, x) => a + x.r[k], 0)) }), {});
  const byMonth = months.flatMap((m) => shownSrc.map((s) => ({ m, s, r: rowFor(s.key, m) })));
  const lines = [
    ...S.filter((x) => x.vat > 0).map((x) => ({ ...x, type: 'Output (sale)' })),
    ...B.filter((x) => x.vat > 0).map((x) => ({ ...x, type: 'Input (bill)' }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cols = SUM_COLS.filter(([k]) => opt.cols.includes(k));
  const saveOpt = (o) => { setOpt(o); try { localStorage.setItem(PRINT_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
  const netText = (v) => `${v >= 0 ? 'Pay' : 'Claim'} ${fmtAmt(Math.abs(v))}`;

  async function doExcel() {
    try {
      const sub = `${shownSrc.map((s) => s.label).join(', ')} · ${pLabel} · OMR · Exported ${exportStamp()}`;
      const sheets = [];
      if (opt.summary) sheets.push({ name: 'VAT return', title: `VAT return · ${pLabel}`, subtitle: sub, head: ['Company', ...cols.map((c) => c[1])],
        rows: rows.map(({ s, r }) => [s.label, ...cols.map(([k]) => r[k])]), totalsRow: ['Total', ...cols.map(([k]) => T[k])], numCols: cols.map((_, i) => i + 1), widths: [18, ...cols.map(() => 18)] });
      if (opt.months) sheets.push({ name: 'By month', title: `VAT by month · ${pLabel}`, subtitle: sub, head: ['Month', 'Company', ...cols.map((c) => c[1])],
        rows: byMonth.map(({ m, s, r }) => [monthLabel(m), s.label, ...cols.map(([k]) => r[k])]), numCols: cols.map((_, i) => i + 2), widths: [16, 16, ...cols.map(() => 18)] });
      if (opt.lines) sheets.push({ name: 'VAT lines', title: `Sales and bills with VAT · ${pLabel}`, subtitle: sub, head: ['Date', 'Company', 'Type', 'Ref / Bill no.', 'Details', 'Amount', 'VAT'],
        rows: lines.map((x) => [dmy(x.date), labelOf(x.src), x.type, x.ref, x.text, x.amount, x.vat]), numCols: [5, 6], widths: [12, 14, 14, 16, 34, 12, 10] });
      if (!sheets.length) { flash('Pick at least one part in Print options', 'err'); return; }
      await exportExcel(`VAT return ${period}.xlsx`, sheets);
      flash('Excel file downloaded');
    } catch { flash('Could not create the Excel file.', 'err'); }
  }

  async function doPdf() {
    try {
      const sections = [];
      if (opt.summary) sections.push({ heading: 'VAT return by company', head: ['Company', ...cols.map((c) => c[1])],
        rows: rows.map(({ s, r }) => [s.label, ...cols.map(([k]) => (k === 'net' ? netText(r[k]) : fmtAmt(r[k])))]),
        totalsRow: ['Total', ...cols.map(([k]) => (k === 'net' ? netText(T[k]) : fmtAmt(T[k])))], numCols: cols.map((_, i) => i + 1) });
      if (opt.months) sections.push({ heading: 'By month', head: ['Month', 'Company', ...cols.map((c) => c[1])],
        rows: byMonth.map(({ m, s, r }) => [monthLabel(m), s.label, ...cols.map(([k]) => fmtAmt(r[k]))]), numCols: cols.map((_, i) => i + 2), fontSize: 9 });
      if (opt.lines) sections.push({ heading: 'Sales and bills with VAT', head: ['Date', 'Company', 'Type', 'Ref / Bill no.', 'Details', 'Amount', 'VAT'],
        rows: lines.length ? lines.map((x) => [dmy(x.date), labelOf(x.src), x.type, x.ref, x.text, fmtAmt(x.amount), fmtAmt(x.vat)]) : [['', '', '', '', 'No sales or bills with VAT in this period', '', '']], numCols: [5, 6], fontSize: 9 });
      if (!sections.length) { flash('Pick at least one part in Print options', 'err'); return; }
      await exportPdf(`VAT return ${period}.pdf`, { title: `VAT return · ${pLabel}`, subtitle: `${shownSrc.map((s) => s.label).join(', ')}  |  File and pay by ${dmy(fileBy)}  |  Exported ${exportStamp()}  |  OMR`, sections });
      flash('PDF downloaded');
    } catch { flash('Could not create the PDF.', 'err'); }
  }

  function doPrint() { setOptOpen(false); setTimeout(() => window.print(), 150); }

  return (
    <>
      <div className="page-tools">
        <Link href="/expenses/summary" className="crumb">← Group Summary</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="vat-p">Period</label>
            <select id="vat-p" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <optgroup label="Quarter (VAT return)">{periods.map((q) => <option key={q} value={q}>{quarterLabel(q)}</option>)}</optgroup>
              <optgroup label="One month">{[...data.months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</optgroup>
            </select>
          </div>
          <button type="button" className="btn" onClick={() => setOptOpen(true)}>☑ Print options</button>
          <button type="button" className="btn" onClick={doPrint}>🖨 Print</button>
          <button type="button" className="btn" onClick={doPdf}>📕 PDF</button>
          <button type="button" className="btn" onClick={doExcel}>📗 Excel</button>
        </div>
      </div>

      <header className="vat-head">
        <span>Tudo Num Group</span>
        <h1>🧾 VAT return</h1>
        <p>{pLabel} · {shownSrc.map((s) => s.label).join(', ')} · File and pay by <b>{dmy(fileBy)}</b></p>
      </header>

      <div className="ats-chips no-print" role="group" aria-label="Companies">
        {SOURCES.map((s) => (
          <button key={s.key} type="button" className={`rp-chip ${pick.includes(s.key) ? 'active' : ''}`}
            onClick={() => setPick((p) => (p.includes(s.key) ? (p.length > 1 ? p.filter((x) => x !== s.key) : p) : [...p, s.key]))}>
            {pick.includes(s.key) ? '✓ ' : ''}{s.label}
          </button>
        ))}
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Output VAT (sales)</span><strong>{fmtAmt(T.outputVat)}</strong><small>OMR</small></div>
        <div className="kpi"><span>Input VAT (bills)</span><strong>{fmtAmt(T.inputVat)}</strong><small>OMR</small></div>
        <div className="kpi hero"><span>{T.net >= 0 ? 'VAT to pay' : 'VAT to claim back'}</span><strong>{fmtAmt(Math.abs(T.net))}</strong><small>by {dmy(fileBy)}</small></div>
      </div>

      {opt.summary && (
        <section className="panel">
          <div className="section-head"><h2>VAT return by company</h2></div>
          <div className="table-wrap">
            <table className="ats-table">
              <thead><tr><th>Company</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
              <tbody>{rows.map(({ s, r }) => <tr key={s.key}><td><b>{s.label}</b></td>{cols.map(([k]) => <td key={k} className={`num${k === 'net' ? (r.net >= 0 ? ' vat-pay' : ' vat-claim') : ''}`}>{k === 'net' ? netText(r[k]) : fmtAmt(r[k])}</td>)}</tr>)}</tbody>
              <tfoot><tr><td>Total</td>{cols.map(([k]) => <td key={k} className="num">{k === 'net' ? netText(T[k]) : fmtAmt(T[k])}</td>)}</tr></tfoot>
            </table>
          </div>
        </section>
      )}

      {opt.months && (
        <section className="panel">
          <div className="section-head"><h2>By month</h2></div>
          <div className="table-wrap">
            <table className="ats-table">
              <thead><tr><th>Month</th><th>Company</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
              <tbody>{byMonth.map(({ m, s, r }) => <tr key={`${m}-${s.key}`}><td>{monthLabel(m)}</td><td>{s.label}</td>{cols.map(([k]) => <td key={k} className="num">{fmtAmt(r[k])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {opt.lines && (
        <section className="panel">
          <div className="section-head"><h2>Sales and bills with VAT ({lines.length})</h2></div>
          {lines.length === 0 ? <p className="muted" style={{ margin: 0 }}>No sales or bills with VAT in {pLabel}. Trips count only when "VAT 5% added" is on.</p> : (
            <div className="table-wrap">
              <table className="ats-table">
                <thead><tr><th>Date</th><th>Company</th><th>Type</th><th>Ref / Bill no.</th><th>Details</th><th className="num">Amount</th><th className="num">VAT</th></tr></thead>
                <tbody>{lines.map((x, i) => <tr key={i}><td>{dmy(x.date)}</td><td>{labelOf(x.src)}</td><td>{x.type}</td><td>{x.ref}</td><td>{x.text}</td><td className="num">{fmtAmt(x.amount)}</td><td className="num">{fmtAmt(x.vat)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <p className="note">Oman VAT: return and payment within 30 days after the period ends. Transport is the Transport Division of Modern City, so on the real return its figures go together with Modern City (same VAT number). Check with your accountant before filing.</p>

      {optOpen && (
        <Modal title="Print options" onClose={() => setOptOpen(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Parts to print (also used by PDF and Excel):</p>
          <div className="ats-cols">
            {[['summary', 'VAT return by company'], ['months', 'By month'], ['lines', 'Sales and bills with VAT']].map(([k, l]) => (
              <label key={k} className="ats-col"><input type="checkbox" checked={!!opt[k]} onChange={(e) => saveOpt({ ...opt, [k]: e.target.checked })} />{l}</label>
            ))}
          </div>
          <p className="muted">Columns:</p>
          <div className="ats-cols">
            {SUM_COLS.map(([k, l]) => (
              <label key={k} className="ats-col"><input type="checkbox" checked={opt.cols.includes(k)}
                onChange={(e) => saveOpt({ ...opt, cols: e.target.checked ? SUM_COLS.map((c) => c[0]).filter((x) => x === k || opt.cols.includes(x)) : opt.cols.filter((x) => x !== k) })} />{l}</label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => saveOpt(DEFAULT_PRINT)}>Reset</button>
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
  return <AuthGate wide><VatReturnPage /></AuthGate>;
}
