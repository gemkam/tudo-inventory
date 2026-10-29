'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { fmtAmt, monthLabel, exportStamp, exportExcel } from '@/lib/sheet';
import { vatReturn, quarterOf, quarterLabel, cashForecast, checks, dmy } from '@/lib/groupTools';

/*
  Top of the Group Summary (29 Oct 2026): tabs 💰 Sales · 🧾 VAT return · 💵 Cash forecast · 🔍 Checks.
  Toolbar buttons send window event 'gs-tab' with the tab key (and scroll here).
*/
export const TABS = [
  ['sales', '💰 Sales'], ['vat', '🧾 VAT return'], ['cash', '💵 Cash forecast'], ['checks', '🔍 Checks']
];
export function openTab(key) {
  window.dispatchEvent(new CustomEvent('gs-tab', { detail: key }));
  const el = document.getElementById('gs-tools');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('pl-flash'); void el.offsetWidth; el.classList.add('pl-flash');
  }
}
const f3 = (v) => fmtAmt(v);
const OPEN_KEY = 'cash.opening';

export default function GroupTools({ G, data, pick, today, labelOf, driverName, isAdmin, salesSheet }) {
  const [tab, setTab] = useState('sales');
  useEffect(() => {
    const on = (e) => setTab(e.detail);
    window.addEventListener('gs-tab', on);
    return () => window.removeEventListener('gs-tab', on);
  }, []);
  const chk = useMemo(() => checks({ data, pick, today, labelOf, driverName }), [data, pick, today, labelOf, driverName]);
  return (
    <section className="panel gs-tools pl-panel" id="gs-tools">
      <div className="gs-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`gs-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {l}{k === 'checks' && chk.length ? <span className="gs-badge">{chk.length}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'sales' && salesSheet}
      {tab === 'vat' && <VatTab G={G} />}
      {tab === 'cash' && <CashTab data={data} pick={pick} today={today} labelOf={labelOf} driverName={driverName} isAdmin={isAdmin} />}
      {tab === 'checks' && <ChecksTab list={chk} />}
    </section>
  );
}

/* ---------- 🧾 VAT return ---------- */
function VatTab({ G }) {
  const quarters = useMemo(() => [...new Set([...G.months, ...(G.salesAll || []).map((x) => x.month)].filter(Boolean).map(quarterOf))].sort().reverse(), [G]);
  const [q, setQ] = useState(quarters[0] || quarterOf(new Date().toISOString().slice(0, 7)));
  const V = useMemo(() => vatReturn({ salesAll: G.salesAll || [], picked: G.picked || [], quarter: q }), [G, q]);
  async function excel() {
    try {
      await exportExcel(`VAT return ${q}.xlsx`, [{
        name: 'VAT return', title: `VAT return · ${quarterLabel(q)}`, subtitle: `${G.chosen.map((s) => s.label).join(', ')} · OMR · Printed ${exportStamp()}`,
        head: ['Box', 'Amount (OMR)'], numCols: [1], widths: [52, 16],
        rows: [
          ['Sales with VAT 5% (without VAT)', V.salesTaxedNet], ['Output VAT 5% on sales', V.outputVat], ['Sales with no VAT', V.salesNoVat],
          ['Purchases and bills (all)', V.purchases], ['Input VAT paid on bills', V.inputVat], ['VAT to pay (output minus input)', V.netVat]
        ],
        boldRows: [5]
      }, {
        name: 'By month', title: 'By month', subtitle: quarterLabel(q), head: ['Month', 'Sales', 'Output VAT', 'Input VAT'], numCols: [1, 2, 3], widths: [16, 14, 13, 13],
        rows: V.byMonth.map((m) => [monthLabel(m.month), m.sales, m.outputVat, m.inputVat])
      }]);
    } catch { /* ignore */ }
  }
  return (
    <div className="gs-body">
      <div className="pl-top">
        <h2>🧾 VAT return <span className="pl-period">{quarterLabel(q)}</span></h2>
        <span className="gs-actions">
          <select value={q} onChange={(e) => setQ(e.target.value)} aria-label="Quarter">{quarters.map((x) => <option key={x} value={x}>{quarterLabel(x)}</option>)}</select>
          <button type="button" className="btn small ghost" onClick={excel}>⬇ Excel</button>
        </span>
      </div>
      <div className="pl-kpis">
        <div><span>Output VAT (on sales)</span><b>{f3(V.outputVat)}</b><small>{V.taxedCount} sales with VAT</small></div>
        <div><span>Input VAT (on bills)</span><b>{f3(V.inputVat)}</b><small>{V.billsWithVat} bills with VAT</small></div>
        <div className="hero"><span>{V.netVat >= 0 ? 'VAT to pay' : 'VAT to claim back'}</span><b>{f3(Math.abs(V.netVat))}</b><small>File and pay by {dmy(V.fileBy)}</small></div>
        <div><span>Sales without VAT</span><b>{f3(V.salesTaxedNet + V.salesNoVat)}</b><small>{f3(V.salesNoVat)} had no VAT</small></div>
      </div>
      <div className="table-wrap">
        <table className="summary-table pl-table">
          <thead><tr><th>VAT return box</th><th className="num">OMR</th></tr></thead>
          <tbody>
            <tr className="pl-head"><td colSpan={2}>Sales (output)</td></tr>
            <tr className="pl-line"><td>Standard rated sales 5% (amount without VAT)</td><td className="num">{f3(V.salesTaxedNet)}</td></tr>
            <tr className="pl-line"><td>Output VAT 5%</td><td className="num">{f3(V.outputVat)}</td></tr>
            <tr className="pl-line"><td>Sales with no VAT (button off on the trip)</td><td className="num">{f3(V.salesNoVat)}</td></tr>
            <tr className="pl-head"><td colSpan={2}>Purchases (input)</td></tr>
            <tr className="pl-line"><td>Purchases and bills of the chosen companies</td><td className="num">{f3(V.purchases)}</td></tr>
            <tr className="pl-line"><td>Input VAT paid on bills</td><td className="num">{f3(V.inputVat)}</td></tr>
            <tr className="pl-result pl-big"><td>{V.netVat >= 0 ? 'Net VAT to pay to the Tax Authority' : 'Net VAT to claim back'}</td><td className="num">{f3(Math.abs(V.netVat))}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="gs-months">
        {V.byMonth.map((m) => <div key={m.month}><b>{monthLabel(m.month)}</b><span>Sales {f3(m.sales)}</span><span>Output VAT {f3(m.outputVat)}</span><span>Input VAT {f3(m.inputVat)}</span></div>)}
      </div>
      <p className="note">Oman VAT: return and payment within 30 days after the quarter ends. Output VAT comes from trips with the "VAT 5% added" button on and company invoices with VAT. Input VAT is the VAT typed on bills. Check with your accountant before filing.</p>
    </div>
  );
}

/* ---------- 💵 Cash forecast ---------- */
function CashTab({ data, pick, today, labelOf, driverName, isAdmin }) {
  const [opening, setOpening] = useState(0);
  const [openText, setOpenText] = useState('');
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(null);
  useEffect(() => {
    (async () => {
      let v = null;
      try { const { data: r } = await sb().from('app_settings').select('value').eq('key', OPEN_KEY).maybeSingle(); if (r?.value) v = JSON.parse(r.value); } catch { /* ignore */ }
      if (!v) { try { v = JSON.parse(localStorage.getItem('tudo-cash-opening') || 'null'); } catch { /* ignore */ } }
      if (v) { setOpening(Number(v.amount || 0)); setOpenText(String(v.amount || '')); }
    })();
  }, []);
  async function saveOpening() {
    const amount = Math.round(Number(openText || 0) * 1000) / 1000;
    if (Number.isNaN(amount)) { setMsg('Type a number, e.g. 2500'); return; }
    setOpening(amount);
    const value = JSON.stringify({ amount, date: today });
    const { error } = await sb().from('app_settings').upsert({ key: OPEN_KEY, value, updated_at: new Date().toISOString() });
    try { localStorage.setItem('tudo-cash-opening', value); } catch { /* ignore */ }
    setMsg(error ? 'Saved on this device' : 'Saved for everyone');
    setTimeout(() => setMsg(''), 2500);
  }
  const F = useMemo(() => cashForecast({ data, pick, today, opening, labelOf, driverName }), [data, pick, today, opening, labelOf, driverName]);
  const max = Math.max(1, ...F.weeks.map((w) => Math.max(w.in, w.out)));
  return (
    <div className="gs-body">
      <div className="pl-top">
        <h2>💵 Cash forecast <span className="pl-period">next 30 days from {dmy(today)}</span></h2>
        <span className="gs-actions">
          <label className="gs-open">Cash and bank now
            <input type="number" inputMode="decimal" step="0.001" value={openText} onChange={(e) => setOpenText(e.target.value)} onBlur={saveOpening} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} placeholder="0.000" disabled={!isAdmin} />
          </label>
          {msg && <small className="muted">{msg}</small>}
        </span>
      </div>
      <div className="pl-kpis">
        <div><span>Coming in</span><b className="pos">{f3(F.T.in)}</b><small>Trips to collect</small></div>
        <div><span>Going out</span><b className="neg">{f3(F.T.out)}</b><small>{F.overdueOut ? `${f3(F.overdueOut)} already overdue` : 'Cheques, bills, salaries'}</small></div>
        <div><span>Lowest point</span><b className={F.lowest.balance < 0 ? 'neg' : ''}>{f3(F.lowest.balance)}</b><small>{F.lowest.label}</small></div>
        <div className="hero"><span>In 30 days</span><b>{f3(F.end)}</b><small>Starting from {f3(F.opening)}</small></div>
      </div>
      <div className="gs-weeks">
        {F.weeks.map((w, i) => (
          <button type="button" key={w.label} className={`gs-week ${show === i ? 'on' : ''}`} onClick={() => setShow(show === i ? null : i)}>
            <b>{w.label}</b><small>{dmy(w.from)} to {dmy(w.to)}</small>
            <span className="gs-bar"><i className="in" style={{ width: `${(w.in / max) * 100}%` }} /></span>
            <span className="gs-bar"><i className="out" style={{ width: `${(w.out / max) * 100}%` }} /></span>
            <span className="gs-wl"><em>In {f3(w.in)}</em><em>Out {f3(w.out)}</em></span>
            <strong className={w.balance < 0 ? 'neg' : ''}>Balance {f3(w.balance)}</strong>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="summary-table">
          <thead><tr><th>Date</th><th>What</th><th>Details</th><th className="num">In</th><th className="num">Out</th></tr></thead>
          <tbody>
            {(show == null ? F.items : F.weeks[show].items).map((x, i) => (
              <tr key={i}>
                <td>{dmy(x.wasDue)}{x.overdue ? <div className="note neg">overdue</div> : null}</td>
                <td>{x.kind}</td>
                <td>{x.text}</td>
                <td className="num pos">{x.dir === 'in' ? f3(x.amount) : ''}</td>
                <td className="num neg">{x.dir === 'out' ? f3(x.amount) : ''}</td>
              </tr>
            ))}
            {!F.items.length && <tr><td colSpan={5} className="muted">Nothing coming in or going out in the next 30 days.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="note">Trips are expected to be paid 30 days after the trip. Unpaid bills are due 30 days after the bill. PDC cheques on their cheque date. Salaries on the 5th of the next month. {F.later.length ? `${F.later.length} more after 30 days.` : ''} Type "Cash and bank now" to see the real balance each week.</p>
    </div>
  );
}

/* ---------- 🔍 Checks ---------- */
function ChecksTab({ list }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="gs-body">
      <div className="pl-top"><h2>🔍 Checks <span className="pl-period">{list.length ? `${list.length} to look at` : 'all clear'}</span></h2></div>
      {!list.length && <p className="muted">No double entries or odd amounts found. 👍</p>}
      <div className="gs-checks">
        {list.map((c, i) => (
          <div key={i} className={`gs-check ${c.level}`}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)}><span>{c.icon}</span><b>{c.title}</b><em>{open === i ? '▲' : '▼'}</em></button>
            {open === i && <ul>{c.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}
          </div>
        ))}
      </div>
      <p className="note">Checks: same bill number twice, same amount on the same day, maintenance on a trip sheet and on the Vehicles page, high diesel, received more than rent, trips not paid after 60 days, trips with no diesel.</p>
    </div>
  );
}
