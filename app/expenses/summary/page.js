'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import Omr from '@/components/Omr';
import { useShare } from '@/components/ShareModal';
import { sb } from '@/lib/supabase';
import { fmtAmt, monthKey, monthLabel, todayISO, exportStamp } from '@/lib/sheet';
import { COMPANIES, n, r3 } from '@/lib/expenses';
import { salaryPayable } from '@/lib/transport';
import { Donut, Bars, SERIES } from '@/components/Charts';

/* Sources the user can pick: the three companies + Transport Expense */
const SOURCES = [
  ...COMPANIES.map((c) => ({ key: c.key, label: c.short, full: c.name, kind: 'company' })),
  { key: 'transport', label: 'Transport Expense', full: 'MODERN CITY FOR EXPRESS SERVICES L.L.C (Transport Division)', kind: 'transport' }
];
const PICK_KEY = 'tudo-summary-pick';

function SummaryPage() {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(SOURCES.map((s) => s.key));
  const [period, setPeriod] = useState('');
  const [open, setOpen] = useState(false);
  const ddRef = useRef(null);
  const { open: openShare, modal } = useShare();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PICK_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) setPick(saved.filter((k) => SOURCES.some((s) => s.key === k)));
    } catch { /* ignore */ }
    (async () => {
      const s = sb();
      const [e, te, ts, tx] = await Promise.all([
        s.from('exp_entries').select('company, entry_date, head, paid, unpaid, vat'),
        s.from('transport_entries').select('entry_date, rent, received, diesel, toll, maintenance'),
        s.from('transport_salaries').select('*'),
        s.from('transport_extras').select('month, amount')
      ]);
      setData({ exp: e.data || [], te: te.data || [], ts: ts.data || [], tx: tx.data || [] });
    })();
  }, []);

  useEffect(() => {
    function close(ev) { if (ddRef.current && !ddRef.current.contains(ev.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function toggle(k) {
    setPick((p) => {
      const next = p.includes(k) ? p.filter((x) => x !== k) : [...p, k];
      try { localStorage.setItem(PICK_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  function setAll(on) {
    const next = on ? SOURCES.map((s) => s.key) : [];
    setPick(next);
    try { localStorage.setItem(PICK_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  /* One list of expense lines from every source: { src, month, head, amount, unpaid, vat } */
  const lines = useMemo(() => {
    if (!data) return [];
    const out = data.exp.map((r) => ({ src: r.company || 'sumptuosity', month: monthKey(r.entry_date), head: r.head || 'Other', amount: n(r.paid), unpaid: n(r.unpaid), vat: n(r.vat) }));
    for (const r of data.te) {
      const m = monthKey(r.entry_date);
      if (n(r.diesel)) out.push({ src: 'transport', month: m, head: 'Diesel', amount: n(r.diesel) });
      if (n(r.toll)) out.push({ src: 'transport', month: m, head: 'Toll + visa exit fee', amount: n(r.toll) });
      if (n(r.maintenance)) out.push({ src: 'transport', month: m, head: 'Vehicle Running and Maintenance', amount: n(r.maintenance) });
    }
    for (const s of data.ts) out.push({ src: 'transport', month: monthKey(s.month), head: 'Salary', amount: salaryPayable(s) });
    for (const x of data.tx) if (n(x.amount)) out.push({ src: 'transport', month: monthKey(x.month), head: 'Other (trailer rent etc.)', amount: n(x.amount) });
    return out.filter((l) => l.amount || l.unpaid || l.vat);
  }, [data]);

  const income = useMemo(() => {
    if (!data) return [];
    return data.te.map((r) => ({ month: monthKey(r.entry_date), work: n(r.rent), received: n(r.received) }));
  }, [data]);

  const months = useMemo(() => [...new Set([...lines.map((l) => l.month), ...income.map((i) => i.month)])].filter(Boolean).sort(), [lines, income]);
  const years = useMemo(() => [...new Set(months.map((m) => m.slice(0, 4)))], [months]);

  useEffect(() => { if (!period && months.length) setPeriod(months[months.length - 1]); }, [months, period]);

  const inPeriod = (m) => period === 'all' || (period.length === 4 ? m.startsWith(period) : m === period);
  const chosen = SOURCES.filter((s) => pick.includes(s.key));
  const sel = lines.filter((l) => pick.includes(l.src) && inPeriod(l.month));
  const sum = (arr, k = 'amount') => r3(arr.reduce((t, x) => t + n(x[k]), 0));

  const perSource = chosen.map((s) => {
    const ls = sel.filter((l) => l.src === s.key);
    const row = { ...s, spent: sum(ls), unpaid: sum(ls, 'unpaid'), vat: sum(ls, 'vat'), count: ls.length };
    if (s.kind === 'transport') {
      const inc = income.filter((i) => inPeriod(i.month));
      row.work = r3(inc.reduce((t, i) => t + i.work, 0));
      row.received = r3(inc.reduce((t, i) => t + i.received, 0));
      row.profit = r3(row.work - row.spent);
    }
    return row;
  });
  const grand = { spent: r3(perSource.reduce((t, s) => t + s.spent, 0)), unpaid: r3(perSource.reduce((t, s) => t + s.unpaid, 0)), vat: r3(perSource.reduce((t, s) => t + s.vat, 0)) };

  const heads = [...new Set(sel.map((l) => l.head))]
    .map((h) => ({ head: h, vals: chosen.map((s) => sum(sel.filter((l) => l.head === h && l.src === s.key))), total: sum(sel.filter((l) => l.head === h)) }))
    .sort((a, b) => b.total - a.total);

  const periodMonths = months.filter(inPeriod);
  const byMonth = periodMonths.map((m) => ({ month: m, vals: chosen.map((s) => sum(sel.filter((l) => l.month === m && l.src === s.key))), total: sum(sel.filter((l) => l.month === m)) }));

  const periodLabel = period === 'all' ? 'All months' : period.length === 4 ? `Year ${period}` : monthLabel(period);

  /* ---- report style (same as the Snooker Cafe dashboard) ---- */
  const fmtO = (v) => `${fmtAmt(v)} OMR`;
  const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);
  const thisMonth = todayISO().slice(0, 7);
  const lastMonth = (() => { const d = new Date(`${thisMonth}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const prevPeriod = period === 'all' ? null : period.length === 4 ? String(Number(period) - 1)
    : (() => { const d = new Date(`${period}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const prevSpent = prevPeriod ? sum(lines.filter((l) => pick.includes(l.src) && (prevPeriod.length === 4 ? l.month.startsWith(prevPeriod) : l.month === prevPeriod))) : null;
  const change = prevSpent ? Math.round(((grand.spent - prevSpent) / prevSpent) * 100) : null;
  const ranked = [...perSource].sort((a, b) => b.spent - a.spent);
  const topCo = ranked[0];
  const topHead = heads[0];
  const transportRow = perSource.find((s) => s.kind === 'transport');
  const coSlices = perSource.map((s, i) => ({ label: s.label, value: s.spent, color: SERIES[i % SERIES.length] }));
  const headTop = heads.slice(0, 5);
  const headRest = r3(heads.slice(5).reduce((t, h) => t + h.total, 0));
  const headSlices = [...headTop.map((h, i) => ({ label: h.head, value: h.total, color: SERIES[i] })), ...(headRest ? [{ label: 'Everything else', value: headRest, color: '#9aa5a1' }] : [])];
  const barMonths = months.slice(-12);
  const barVals = barMonths.map((m) => sum(lines.filter((l) => pick.includes(l.src) && l.month === m)));
  const shortM = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  let barHi = barMonths.indexOf(period);
  if (barHi < 0) barHi = barVals.indexOf(Math.max(...barVals));
  const maxIdx = barVals.indexOf(Math.max(...barVals));
  const paidPart = r3(grand.spent);
  const statusSlices = [
    { label: 'Paid', value: paidPart, color: SERIES[2] },
    { label: 'Unpaid', value: grand.unpaid, color: SERIES[7] }
  ];

  function share() {
    const lines2 = [
      `Group Summary · ${periodLabel}`,
      ...perSource.map((s) => `${s.label}: ${fmtAmt(s.spent)} OMR${s.kind === 'transport' ? ` (work ${fmtAmt(s.work)}, profit ${fmtAmt(s.profit)})` : ''}`),
      `Total spent: ${fmtAmt(grand.spent)} OMR`,
      grand.unpaid ? `Unpaid: ${fmtAmt(grand.unpaid)} OMR` : '',
      grand.vat ? `VAT: ${fmtAmt(grand.vat)} OMR` : '',
      '',
      'Top heads:',
      ...heads.slice(0, 6).map((h) => `${h.head}: ${fmtAmt(h.total)} OMR`)
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
    openShare({ title: `Group Summary ${periodLabel}`, text: lines2.join('\n') });
  }

  if (!data || !period) return <div className="loading">Loading summary...</div>;

  return (
    <>
      <div className="page-tools">
        <Link href="/expenses" className="crumb">← Office Expense</Link>
        <div className="tools">
          <button type="button" className="btn ghost" onClick={share}>📤 Share</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      <div className="co-switch no-print" role="tablist" aria-label="Company">
        {COMPANIES.map((c) => <Link key={c.key} href={`/expenses?co=${c.key}`} role="tab" className="co-tab">{c.short}</Link>)}
        <span className="co-tab on" role="tab" aria-selected="true">📊 Group Summary</span>
      </div>

      <div className="company-head">
        <span className="company-name">Tudo Num Group</span>
        <h1>Group Summary</h1>
        <p className="sub">{periodLabel} · {chosen.length ? chosen.map((s) => s.label).join(', ') : 'Nothing selected'} · OMR</p>
      </div>

      <div className="sum-controls no-print">
        <div className="sum-dd" ref={ddRef}>
          <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Show: {chosen.length === SOURCES.length ? 'All' : chosen.length ? chosen.map((s) => s.label).join(', ') : 'Choose...'} ▾
          </button>
          {open && (
            <div className="sum-dd-menu" role="menu">
              <label className="check"><input type="checkbox" checked={chosen.length === SOURCES.length} onChange={(e) => setAll(e.target.checked)} /> <b>All</b></label>
              {SOURCES.map((s) => (
                <label key={s.key} className="check"><input type="checkbox" checked={pick.includes(s.key)} onChange={() => toggle(s.key)} /> {s.label}</label>
              ))}
            </div>
          )}
        </div>
        <div className="sum-pills" role="group" aria-label="Quick select">
          {SOURCES.map((s) => (
            <button key={s.key} type="button" className={`rp-chip ${pick.includes(s.key) ? 'active' : ''}`} onClick={() => toggle(s.key)} aria-pressed={pick.includes(s.key)}>
              {pick.includes(s.key) ? '✓ ' : ''}{s.label}
            </button>
          ))}
        </div>
        <div className="sum-pills" role="group" aria-label="Period">
          {[[thisMonth, 'This month'], [lastMonth, 'Last month'], [thisMonth.slice(0, 4), 'This year'], ['all', 'All months']].map(([v, l]) => (
            <button key={l} type="button" className={`rp-chip ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
          ))}
        </div>
        <div className="month-select">
          <label htmlFor="sum-period">Period</label>
          <select id="sum-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {[...months].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            <option value="all">All months</option>
          </select>
        </div>
      </div>

      {chosen.length === 0 ? (
        <div className="panel"><p className="empty">Choose one or more from the list above.</p></div>
      ) : (
        <>
          <div className="sum-report">
          <div className="rp-tiles">
            <div className="rp-tile hero"><div className="rp-tile-label">💰 Total spent</div><div className="rp-tile-num"><Omr v={grand.spent} /></div>
              <div className="rp-tile-sub">{change == null ? periodLabel : `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}% vs ${prevPeriod.length === 4 ? prevPeriod : monthLabel(prevPeriod)}`}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">⏳ Unpaid</div><div className={`rp-tile-num ${grand.unpaid ? 'neg' : ''}`}><Omr v={grand.unpaid} /></div><div className="rp-tile-sub">{grand.unpaid ? 'Still to pay' : 'All bills paid'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🧾 VAT 5%</div><div className="rp-tile-num"><Omr v={grand.vat} /></div><div className="rp-tile-sub">On bills</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🏢 Spent the most</div><div className="rp-tile-num sm">{topCo?.spent ? topCo.label : '–'}</div><div className="rp-tile-sub">{topCo?.spent ? `${fmtO(topCo.spent)} · ${pct(topCo.spent, grand.spent)}%` : 'No spending'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🏆 Top expense</div><div className="rp-tile-num sm">{topHead ? topHead.head : '–'}</div><div className="rp-tile-sub">{topHead ? `${fmtO(topHead.total)} · ${pct(topHead.total, grand.spent)}%` : 'No spending'}</div></div>
            {transportRow ? (
              <div className="rp-tile"><div className="rp-tile-label">🚚 Transport profit</div><div className={`rp-tile-num ${transportRow.profit < 0 ? 'neg' : 'pos'}`}><Omr v={transportRow.profit} /></div><div className="rp-tile-sub">Work {fmtO(transportRow.work)}</div></div>
            ) : (
              <div className="rp-tile"><div className="rp-tile-label">📄 Bills</div><div className="rp-tile-num">{sel.length}</div><div className="rp-tile-sub">Lines counted</div></div>
            )}
          </div>

          <div className="rp-grid">
            <div className="rp-card">
              <div className="rp-card-title">Where the money goes</div>
              <div className="rp-takeaway">{topCo?.spent ? `${topCo.label} spent the most: ${pct(topCo.spent, grand.spent)}% of the total.` : 'Nothing spent in this period.'}</div>
              <Donut slices={coSlices} fmt={fmtO} centerBig={Math.round(grand.spent).toLocaleString("en-GB")} centerSmall="OMR spent" />
            </div>
            <div className="rp-card">
              <div className="rp-card-title">What it was spent on</div>
              <div className="rp-takeaway">{topHead ? `${topHead.head} is the biggest expense: ${pct(topHead.total, grand.spent)}%.` : 'Nothing spent in this period.'}</div>
              <Donut slices={headSlices} fmt={fmtO} centerBig={String(heads.length)} centerSmall="heads" />
            </div>
            <div className="rp-card">
              <div className="rp-card-title">Paid and unpaid</div>
              <div className="rp-takeaway">{grand.unpaid ? `${fmtO(grand.unpaid)} is still unpaid.` : 'Everything is paid.'}</div>
              <Donut slices={statusSlices} fmt={fmtO} centerBig={`${pct(grand.unpaid, grand.spent + grand.unpaid)}%`} centerSmall="unpaid" />
            </div>
            <div className="rp-card">
              <div className="rp-card-title">Company ranking</div>
              <div className="rp-takeaway">{ranked.length > 1 && ranked[1].spent ? `${ranked[0].label} spent ${fmtO(r3(ranked[0].spent - ranked[1].spent))} more than ${ranked[1].label}.` : ' '}</div>
              <table className="rp-block-table">
                <thead><tr><th>#</th><th>Company</th><th className="num">Spent</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {ranked.map((s, i) => (
                    <tr key={s.key} className={i === 0 && s.spent ? 'top' : ''}><td>{i + 1}</td><td>{s.label}</td><td className="num">{fmtAmt(s.spent)}</td><td className="num">{pct(s.spent, grand.spent)}%</td></tr>
                  ))}
                  <tr className="sum"><td /><td>Total</td><td className="num">{fmtAmt(grand.spent)}</td><td className="num">100%</td></tr>
                </tbody>
              </table>
            </div>
            <div className="rp-card rp-wide">
              <div className="rp-card-title">Money spent each month <span className="rp-card-note">(last {barMonths.length} months, chosen companies)</span></div>
              <div className="rp-takeaway">{barVals[maxIdx] ? `Highest month: ${monthLabel(barMonths[maxIdx])} with ${fmtO(barVals[maxIdx])}.` : ' '}</div>
              <Bars labels={barMonths.map(shortM)} values={barVals} fmt={(v) => fmtAmt(v)} highlight={barHi} labelAll={barMonths.length <= 8} />
            </div>
          </div>
          </div>

          <section className="panel">
            <h2>By company</h2>
            <div className="table-wrap">
              <table className="summary-table">
                <thead><tr><th>Company</th><th className="num">Spent</th><th className="num">Unpaid</th><th className="num">VAT</th><th className="num">Work amount</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {perSource.map((s) => (
                    <tr key={s.key}>
                      <td><b>{s.label}</b><div className="note">{s.full}</div></td>
                      <td className="num">{fmtAmt(s.spent)}</td>
                      <td className="num">{s.unpaid ? fmtAmt(s.unpaid) : <span className="muted">–</span>}</td>
                      <td className="num">{s.vat ? fmtAmt(s.vat) : <span className="muted">–</span>}</td>
                      <td className="num">{s.kind === 'transport' ? fmtAmt(s.work) : <span className="muted">–</span>}</td>
                      <td className={`num ${s.profit < 0 ? 'neg' : 'pos'}`}>{s.kind === 'transport' ? fmtAmt(s.profit) : <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                  <tr className="sum"><td>Total</td><td className="num">{fmtAmt(grand.spent)}</td><td className="num">{fmtAmt(grand.unpaid)}</td><td className="num">{fmtAmt(grand.vat)}</td><td /><td /></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>By head of account</h2>
            <div className="table-wrap">
              <table className="summary-table">
                <thead><tr><th>Head of account</th>{chosen.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {heads.map((h) => (
                    <tr key={h.head}><td>{h.head}</td>{h.vals.map((v, i) => <td key={i} className="num">{v ? fmtAmt(v) : <span className="muted">–</span>}</td>)}<td className="num"><b>{fmtAmt(h.total)}</b></td></tr>
                  ))}
                  <tr className="sum"><td>Total</td>{perSource.map((s) => <td key={s.key} className="num">{fmtAmt(s.spent)}</td>)}<td className="num">{fmtAmt(grand.spent)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {byMonth.length > 1 && (
            <section className="panel">
              <h2>By month</h2>
              <div className="table-wrap">
                <table className="summary-table">
                  <thead><tr><th>Month</th>{chosen.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    {byMonth.map((m) => (
                      <tr key={m.month}><td>{monthLabel(m.month)}</td>{m.vals.map((v, i) => <td key={i} className="num">{v ? fmtAmt(v) : <span className="muted">–</span>}</td>)}<td className="num"><b>{fmtAmt(m.total)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="note print-only">Printed {exportStamp()} · Tudo Num Office Systems · {todayISO()}</p>
        </>
      )}
      {modal}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><SummaryPage /></AuthGate>;
}
