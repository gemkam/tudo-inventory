'use client';

import RangeReport from '@/components/RangeReport';
import { groupReport } from '@/lib/rangeReports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Omr from '@/components/Omr';
import Modal from '@/components/Modal';
import { useShare } from '@/components/ShareModal';
import GroupTools, { openTab } from '@/components/GroupTools';
import { Donut, Bars, PairBars, HBars, SERIES } from '@/components/Charts';
import { sb } from '@/lib/supabase';
import { fmtAmt, monthLabel, todayISO, exportStamp, exportExcel } from '@/lib/sheet';
import { COMPANIES, HEADS, r3 } from '@/lib/expenses';
import { buildReminders, whenText } from '@/lib/reminders';
import { useRaufPage } from '@/components/RaufContext';
import { groupContext, groupGreeting } from '@/lib/groupAssistantContext';
import { attendanceSummary } from '@/lib/attendance';
import { GROUP_SOURCES as SOURCES, TRANSPORT_HEADS, buildLines, buildIncome, buildDocSales, computeGroup, computeAnalytics, periodLabelOf, shiftMonth } from '@/lib/groupSummary';

const PICK_KEY = 'tudo-summary-pick';
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const labelOf = (key) => SOURCES.find((s) => s.key === key)?.label || key;
const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);
const fmtO = (v) => `${fmtAmt(v)} OMR`;
const shortM = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

function SummaryPage() {
  const { isAdmin } = useUser();
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(SOURCES.map((s) => s.key));
  const [period, setPeriod] = useState('');
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ddRef = useRef(null);
  const { open: openShare, modal } = useShare();

  const load = useCallback(async () => {
    const s = sb();
    const [e, te, ts, tx, dr, bu, ve, ma, st, at, docs] = await Promise.all([
      s.from('exp_entries').select('id, company, entry_date, bill_no, description, category, head, paid, unpaid, vat, department, source_kind'),
      s.from('transport_entries').select('id, entry_date, received_date, driver_id, from_place, to_place, description, rent, received, diesel, toll, maintenance, driver_allowance, vat_included'),
      s.from('transport_salaries').select('*'),
      s.from('transport_extras').select('driver_id, month, description, amount'),
      s.from('transport_drivers').select('id, name'),
      s.from('exp_budgets').select('*'),
      s.from('transport_vehicles').select('*'),
      s.from('vehicle_maintenance').select('*'),
      s.from('exp_staff').select('*'),
      s.from('exp_attendance').select('company, staff_id, day, mark'),
      s.from('company_docs').select('company, kind, doc_no, doc_date, party, items, vat_pct').eq('kind', 'invoice')
    ]);
    setData({ exp: e.data || [], te: te.data || [], ts: ts.data || [], tx: tx.data || [], drivers: dr.data || [], budgets: bu.data || [], vehicles: ve.data || [], maint: ma.data || [], staff: st.data || [], att: at.error ? [] : at.data || [], docs: docs.error ? [] : docs.data || [] });
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PICK_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) setPick(saved.filter((k) => SOURCES.some((s) => s.key === k)));
    } catch { /* ignore */ }
    load();
  }, [load]);

  useEffect(() => {
    function close(ev) { if (ddRef.current && !ddRef.current.contains(ev.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function savePick(next) {
    setPick(next);
    try { localStorage.setItem(PICK_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  const toggle = (k) => savePick(pick.includes(k) ? pick.filter((x) => x !== k) : [...pick, k]);

  const lines = useMemo(() => (data ? buildLines(data) : []), [data]);
  const income = useMemo(() => (data ? buildIncome(data) : []), [data]);
  const docSales = useMemo(() => (data ? buildDocSales(data.docs) : []), [data]);
  const driverName = useCallback((id) => (data?.drivers || []).find((d) => d.id === id)?.name || '', [data]);
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);

  const allMonths = useMemo(() => [...new Set([...lines.map((l) => l.month), ...income.map((i) => i.month)])].filter(Boolean).sort(), [lines, income]);
  useEffect(() => { if (!period && allMonths.length) setPeriod(allMonths[allMonths.length - 1]); }, [allMonths, period]);

  const G = useMemo(() => (data && period ? computeGroup({ lines, income, budgets: data.budgets, pick, period, today, docSales }) : null), [data, lines, income, pick, period, today, docSales]);

  const AN = useMemo(() => (G && data ? computeAnalytics({ G, lines, income, ts: data.ts, drivers: data.drivers, pick, period, today }) : null), [G, data, lines, income, pick, period, today]);

  // Attendance of office staff (companies only, Fri and Sat off) for the chosen period
  const ATT = useMemo(() => {
    if (!data || !period) return null;
    let months;
    if (period === 'all') months = [...new Set((data.att || []).map((a) => String(a.day).slice(0, 7)))].sort();
    else if (period.length === 4) months = Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
    else months = [period];
    return attendanceSummary({ staff: data.staff, att: data.att, pick, months, today, companies: COMPANIES });
  }, [data, period, pick, today]);
  const attAlerts = useMemo(() => (ATT && ATT.marked ? ATT.topAbsent.filter((p) => p.absent >= 3).map((p) => ({
    level: p.absent >= 5 ? 'bad' : 'warn', icon: '🗓',
    text: `${p.name} (${p.companyLabel}) was absent ${p.absent} day${p.absent === 1 ? '' : 's'}${p.half ? ` and ${p.half} half day${p.half === 1 ? '' : 's'}` : ''}.`,
    link: `/expenses/attendance?co=${p.company}${period && period.length === 7 ? `&m=${period}` : ''}`
  })) : []), [ATT, period]);

  // vehicle reminders (VOC, Mulkiya, PDC) join the alerts when Transport is chosen
  const vehicleAlerts = useMemo(() => {
    if (!data) return []; // always: Rauf and the alerts box see renewals and cheques whatever companies are picked
    return buildReminders(data.vehicles, data.maint).map((r) => ({
      level: r.urgent ? 'bad' : 'warn', icon: r.kind === 'pay' ? '💳' : r.kind === 'renew' ? '📄' : '🔧',
      text: `${r.title}: ${r.detail}, ${whenText(r.left)} (${dmy(r.date)}).`, link: '/transport/vehicles'
    }));
  }, [data]);

  // Everything on this page as text, for Noor (the AI assistant)
  const aiContext = useMemo(() => {
    if (!G || !period) return '';
    let txt = '';
    try { txt = groupContext({ G, lines, income, allMonths, pick, periodLabel: periodLabelOf(period, monthLabel), extraAlerts: [...vehicleAlerts, ...attAlerts] }); } catch { txt = ''; }
    if (ATT && ATT.marked) {
      txt += `\nATTENDANCE (office staff, Fri and Sat off, ${periodLabelOf(period, monthLabel)}):\n`
        + ATT.rows.map((r) => `${r.label}: ${r.staff} staff, present ${r.present}, absent ${r.absent}, leave ${r.leave}, half day ${r.half}, not marked ${r.unmarked}${r.rate == null ? '' : `, attendance ${r.rate}%`}`).join('\n')
        + (ATT.topAbsent.length ? `\nMost absent: ${ATT.topAbsent.map((p) => `${p.name} (${p.companyLabel}) ${p.absent} absent`).join('; ')}` : '');
    }
    return txt;
  }, [G, lines, income, allMonths, pick, period, vehicleAlerts, attAlerts, ATT]);
  const aiGreeting = useMemo(() => {
    if (!G || !period) return null;
    const pl = periodLabelOf(period, monthLabel);
    return { en: groupGreeting({ G, periodLabel: pl, extraAlerts: vehicleAlerts, lang: 'en' }), ru: groupGreeting({ G, periodLabel: pl, extraAlerts: vehicleAlerts, lang: 'ru' }) };
  }, [G, period, vehicleAlerts]);

  // Rauf (in AuthGate, on every page) gets this page's numbers too
  const aiAlerts = G ? G.alerts.filter((a) => a.level !== 'info').length + vehicleAlerts.length + attAlerts.length : 0;
  useRaufPage({ context: aiContext, greeting: aiGreeting, alertCount: aiAlerts });

  if (!data || !period || !G) return <div className="loading">Loading summary...</div>;

  const periodLabel = periodLabelOf(period, monthLabel);
  const years = [...new Set(allMonths.map((m) => m.slice(0, 4)))];
  const alerts = [...G.alerts.filter((a) => a.level !== 'info'), ...vehicleAlerts, ...attAlerts, ...G.alerts.filter((a) => a.level === 'info')];
  const ranked = [...G.perSource].sort((a, b) => b.spent - a.spent);
  const topCo = ranked[0];
  const topHead = G.heads[0];
  const tRow = G.perSource.find((s) => s.kind === 'transport');
  const coSlices = G.perSource.map((s, i) => ({ label: s.label, value: s.spent, color: SERIES[i % SERIES.length], key: s.key }));
  const headTop = G.heads.slice(0, 5);
  const headRest = r3(G.heads.slice(5).reduce((t, h) => t + h.total, 0));
  const headSlices = [...headTop.map((h, i) => ({ label: h.head, value: h.total, color: SERIES[i] })), ...(headRest ? [{ label: 'Everything else', value: headRest, color: '#9aa5a1' }] : [])];
  const barMonths = allMonths.slice(-12);
  const barVals = barMonths.map((m) => r3(lines.filter((l) => pick.includes(l.src) && !(pick.includes('transport') && l.mirror) && l.month === m).reduce((t, l) => t + l.amount, 0)));
  let barHi = barMonths.indexOf(period);
  if (barHi < 0) barHi = barVals.indexOf(Math.max(...barVals));
  const maxIdx = barVals.indexOf(Math.max(...barVals));
  const bt = G.budgetTotal;
  const cashNetIdx = G.cash.net.length - 1;

  /* drill down: list of bills behind a number */
  function openDrill(title, filter, from = G.sel) {
    const ls = from.filter(filter).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    setDrill({ title, lines: ls });
  }
  const drillHead = (head) => openDrill(`${head} · ${periodLabel}`, (l) => l.head === head);
  const drillCompany = (key) => openDrill(`${labelOf(key)} · ${periodLabel}`, (l) => l.src === key);
  const drillMonth = (m) => openDrill(`${monthLabel(m)} · all chosen`, (l) => l.month === m, lines.filter((l) => pick.includes(l.src) && !(pick.includes('transport') && l.mirror)));
  function drillAlert(a) {
    if (a.link) { window.location.href = a.link; return; }
    if (a.pick?.head) drillHead(a.pick.head);
    else if (a.pick?.unpaidOld) setDrill({ title: 'Unpaid bills older than 30 days', lines: G.unpaidBills.filter((l) => l.age > 30), unpaid: true });
  }

  function share() {
    const t = [
      `Group Summary · ${periodLabel}`,
      ...G.perSource.map((s) => `${s.label}: ${fmtAmt(s.spent)} OMR${s.kind === 'transport' ? ` (work ${fmtAmt(s.work)}, profit ${fmtAmt(s.profit)})` : ''}`),
      `Total spent: ${fmtAmt(G.grand.spent)} OMR`,
      G.grand.unpaid ? `Unpaid: ${fmtAmt(G.grand.unpaid)} OMR` : '',
      bt.budget ? `Budget used: ${pct(bt.actual, bt.budget)}% (${fmtAmt(bt.actual)} of ${fmtAmt(bt.budget)})` : '',
      '',
      ...(alerts.length ? ['Alerts:', ...alerts.slice(0, 5).map((a) => `- ${a.text}`), ''] : []),
      'Top heads:',
      ...G.heads.slice(0, 6).map((h) => `${h.head}: ${fmtAmt(h.total)} OMR`)
    ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
    openShare({ title: `Group Summary ${periodLabel}`, text: t.join('\n') });
  }

  async function downloadPdf() {
    setBusy(true);
    try {
      const { buildGroupPdf } = await import('@/lib/groupSummaryPdf');
      let logo = null;
      try {
        const blob = await (await fetch('/tudonum-group.png')).blob();
        logo = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      } catch { /* no logo */ }
      const doc = buildGroupPdf(G, { periodLabel, monthLabel, logo, extraAlerts: [...vehicleAlerts, ...attAlerts], att: ATT });
      doc.save(`Group Summary ${periodLabel}.pdf`);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/expenses" className="crumb">← Office Expense</Link>
        <div className="tools">
          <button type="button" className="btn in" onClick={() => openTab('sales')} title="Sales: everything earned">💰 Sales</button>
          <button type="button" className="btn in" onClick={() => {
            const el = document.getElementById('pl-statement');
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.remove('pl-flash'); void el.offsetWidth; el.classList.add('pl-flash');
          }} title="Go to the Profit and Loss statement">📑 Profit and Loss</button>
          <button type="button" className="btn in" onClick={() => openTab('vat')}>🧾 VAT return</button>
          <button type="button" className="btn in" onClick={() => openTab('cash')}>💵 Cash forecast</button>
          <button type="button" className="btn in" onClick={() => openTab('checks')}>🔍 Checks</button>
          {isAdmin && <button type="button" className="btn ghost" onClick={() => setBudgetOpen(true)}>🎯 Budgets</button>}
          <button type="button" className="btn ghost" onClick={downloadPdf} disabled={busy}>{busy ? 'Making PDF...' : '⬇ PDF'}</button>
          <button type="button" className="btn ghost" onClick={share}>📤 Share</button>
          <RangeReport title="Group expense report" company="Tudo Num Group" landscape
            build={(from, to) => groupReport({ lines, pick, labelOf, from, to })} label="🖨 Report by dates" />
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
        <p className="sub">{periodLabel} · {G.chosen.length ? G.chosen.map((s) => s.label).join(', ') : 'Nothing selected'} · OMR</p>
      </div>

      <div className="sum-controls no-print">
        <div className="sum-dd" ref={ddRef}>
          <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Show: {G.chosen.length === SOURCES.length ? 'All' : G.chosen.length ? G.chosen.map((s) => s.label).join(', ') : 'Choose...'} ▾
          </button>
          {open && (
            <div className="sum-dd-menu" role="menu">
              <label className="check"><input type="checkbox" checked={G.chosen.length === SOURCES.length} onChange={(e) => savePick(e.target.checked ? SOURCES.map((s) => s.key) : [])} /> <b>All</b></label>
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
            {[...allMonths].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
            <option value="all">All months</option>
          </select>
        </div>
      </div>

      {G.chosen.length === 0 ? (
        <div className="panel"><p className="empty">Choose one or more from the list above.</p></div>
      ) : (
        <div className="sum-report">
          <GroupTools G={G} data={data} pick={pick} today={today} labelOf={labelOf} driverName={driverName} isAdmin={isAdmin}
            salesSheet={<SalesSheet G={G} periodLabel={periodLabel} />} />

          {alerts.length > 0 && (
            <section className="sum-alerts" aria-label="Alerts">
              <div className="sum-alerts-title">🔔 Needs attention <span>({alerts.length})</span></div>
              {alerts.map((a, i) => (
                <button type="button" key={i} className={`sum-alert ${a.level}`} onClick={() => drillAlert(a)} disabled={!a.pick && !a.link}>
                  <span className="sum-alert-icon">{a.icon}</span><span>{a.text}</span>{(a.pick || a.link) && <span className="sum-alert-go no-print">View ›</span>}
                </button>
              ))}
            </section>
          )}

          <div className="rp-tiles">
            <div className="rp-tile hero"><div className="rp-tile-label">💰 Total spent</div><div className="rp-tile-num"><Omr v={G.grand.spent} /></div>
              <div className="rp-tile-sub">{G.change == null ? periodLabel : `${G.change > 0 ? '▲' : G.change < 0 ? '▼' : '='} ${Math.abs(G.change)}% vs ${G.prevPeriod.length === 4 ? G.prevPeriod : monthLabel(G.prevPeriod)}`}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🎯 Budget used</div>
              <div className={`rp-tile-num ${bt.budget && bt.actual > bt.budget ? 'neg' : ''}`}>{bt.budget ? `${pct(bt.actual, bt.budget)}%` : '–'}</div>
              <div className="rp-tile-sub">{bt.budget ? `${fmtO(bt.actual)} of ${fmtO(bt.budget)}` : isAdmin ? 'Press 🎯 Budgets to set' : 'No budgets set yet'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">⏳ Unpaid</div><div className={`rp-tile-num ${G.grand.unpaid ? 'neg' : ''}`}><Omr v={G.grand.unpaid} /></div><div className="rp-tile-sub">{G.grand.unpaid ? 'Still to pay' : 'All bills paid'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🧾 VAT 5%</div><div className="rp-tile-num"><Omr v={G.grand.vat} /></div><div className="rp-tile-sub">On bills (paid)</div></div>
            {tRow && <div className="rp-tile"><div className="rp-tile-label">🧾 VAT 5% on transport</div><div className="rp-tile-num"><Omr v={tRow.vatIn} /></div><div className="rp-tile-sub">{tRow.vatIn ? `Inside work amount · without VAT ${fmtO(tRow.workNet)}` : 'No trip with VAT 5% added'}</div></div>}
            <div className="rp-tile"><div className="rp-tile-label">🏢 Spent the most</div><div className="rp-tile-num sm">{topCo?.spent ? topCo.label : '–'}</div><div className="rp-tile-sub">{topCo?.spent ? `${fmtO(topCo.spent)} · ${pct(topCo.spent, G.grand.spent)}%` : 'No spending'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">🏆 Top expense</div><div className="rp-tile-num sm">{topHead ? topHead.head : '–'}</div><div className="rp-tile-sub">{topHead ? `${fmtO(topHead.total)} · ${pct(topHead.total, G.grand.spent)}%` : 'No spending'}</div></div>
            <div className="rp-tile"><div className="rp-tile-label">💵 Cash in minus out</div><div className={`rp-tile-num ${G.cash.totalNet < 0 ? 'neg' : 'pos'}`}><Omr v={G.cash.totalNet} /></div><div className="rp-tile-sub">In {fmtAmt(G.cash.totalIn)} · Out {fmtAmt(G.cash.totalOut)}</div></div>
            {tRow ? (
              <div className="rp-tile"><div className="rp-tile-label">🚚 Transport profit</div><div className={`rp-tile-num ${tRow.profit < 0 ? 'neg' : 'pos'}`}><Omr v={tRow.profit} /></div><div className="rp-tile-sub">Work {fmtO(tRow.work)}{tRow.vatIn ? ` − VAT ${fmtO(tRow.vatIn)}` : ''}</div></div>
            ) : (
              <div className="rp-tile"><div className="rp-tile-label">📄 Bills</div><div className="rp-tile-num">{G.sel.length}</div><div className="rp-tile-sub">Lines counted</div></div>
            )}
          </div>

          <p className="note no-print sum-hint">Tip: click any chart, row or alert to see the bills behind it.</p>

          <div className="rp-grid">
            <div className="rp-card">
              <div className="rp-card-title">Where the money goes</div>
              <div className="rp-takeaway">{topCo?.spent ? `${topCo.label} spent the most: ${pct(topCo.spent, G.grand.spent)}% of the total.` : 'Nothing spent in this period.'}</div>
              <Donut slices={coSlices} fmt={fmtO} centerBig={Math.round(G.grand.spent).toLocaleString('en-GB')} centerSmall="OMR spent" onPick={(i) => drillCompany(coSlices[i].key)} />
            </div>
            <div className="rp-card">
              <div className="rp-card-title">What it was spent on</div>
              <div className="rp-takeaway">{topHead ? `${topHead.head} is the biggest expense: ${pct(topHead.total, G.grand.spent)}%.` : 'Nothing spent in this period.'}</div>
              <Donut slices={headSlices} fmt={fmtO} centerBig={String(G.heads.length)} centerSmall="heads"
                onPick={(i, s) => (s.label === 'Everything else' ? openDrill(`Other heads · ${periodLabel}`, (l) => !headTop.some((h) => h.head === l.head)) : drillHead(s.label))} />
            </div>

            <div className="rp-card rp-wide">
              <div className="rp-card-title">🎯 Budget vs actual <span className="rp-card-note">({G.nMonths} month{G.nMonths === 1 ? '' : 's'} of budget)</span></div>
              {G.budgetHeads.length ? (
                <>
                  <div className="rp-takeaway">{G.overBudget.length ? `${G.overBudget.length} head${G.overBudget.length === 1 ? ' is' : 's are'} over budget.` : `All heads within budget. ${fmtO(r3(bt.budget - bt.actual))} left.`}</div>
                  <div className="bva">
                    {G.budgetHeads.map((b) => {
                      const max = Math.max(b.budget, b.actual);
                      const cls = b.actual > b.budget ? 'over' : b.pct >= 85 ? 'near' : 'ok';
                      return (
                        <button type="button" className="bva-row" key={b.head} onClick={() => drillHead(b.head)}>
                          <span className="bva-name">{b.head}</span>
                          <span className="bva-track">
                            <span className={`bva-fill ${cls}`} style={{ width: `${Math.max(1, (b.actual / max) * 100)}%` }} />
                            <span className="bva-mark" style={{ left: `${(b.budget / max) * 100}%` }} title={`Budget ${fmtO(b.budget)}`} />
                          </span>
                          <span className={`bva-val ${cls}`}><b>{b.pct}%</b> {fmtAmt(b.actual)} / {fmtAmt(b.budget)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="rp-mini-legend bva-legend"><span><i className="ok" />Under 85%</span><span><i className="near" />85% to 100%</span><span><i className="over" />Over budget</span><span><i className="mark" />Budget line</span></div>
                </>
              ) : (
                <div className="rp-empty">No budgets yet. {isAdmin ? <button type="button" className="btn" onClick={() => setBudgetOpen(true)}>🎯 Set monthly budgets</button> : 'Ask the Administrator to set monthly budgets.'}</div>
              )}
            </div>

            <div className="rp-card rp-wide">
              <div className="rp-card-title">💵 Cash flow <span className="rp-card-note">(money in from transport vs money spent, by month)</span></div>
              <div className="rp-takeaway">
                {G.cash.months.length ? `${G.cash.totalNet >= 0 ? 'More came in than went out' : 'More went out than came in'}: ${fmtO(Math.abs(G.cash.totalNet))} over ${G.cash.months.length} month${G.cash.months.length === 1 ? '' : 's'}.${cashNetIdx >= 0 ? ` ${monthLabel(G.cash.months[cashNetIdx])}: ${G.cash.net[cashNetIdx] >= 0 ? '+' : ''}${fmtAmt(G.cash.net[cashNetIdx])}.` : ''}` : ' '}
                {!pick.includes('transport') && ' Choose Transport Expense to see money in.'}
              </div>
              <PairBars labels={G.cash.months.map(shortM)} a={G.cash.in} b={G.cash.out} aLabel="Money in (received)" bLabel="Money spent" aColor={SERIES[2]} bColor={SERIES[1]} fmt={fmtO} onPick={(i) => drillMonth(G.cash.months[i])} />
              {G.owed > 0 && <p className="note">Still to receive from transport work: <b>{fmtO(G.owed)}</b></p>}
            </div>

            {ATT && ATT.rows.length > 0 && (
              <div className="rp-card rp-wide">
                <div className="rp-card-title">🗓 Attendance <span className="rp-card-note">(office staff Fri + Sat off · site staff Fri off · {periodLabel})</span></div>
                {ATT.marked ? (() => {
                  const tot = ATT.rows.reduce((t, r) => { ['staff', 'present', 'absent', 'leave', 'half', 'unmarked'].forEach((k) => { t[k] += r[k]; }); return t; }, { staff: 0, present: 0, absent: 0, leave: 0, half: 0, unmarked: 0 });
                  const counted = tot.present + tot.absent + tot.leave + tot.half;
                  return (
                    <>
                      <div className="rp-takeaway">
                        {counted ? `Attendance ${Math.round(((tot.present + tot.half * 0.5) / counted) * 100)}% across ${tot.staff} staff.` : ''}
                        {tot.absent ? ` ${tot.absent} absent day${tot.absent === 1 ? '' : 's'}.` : ' No absences.'}
                        {tot.unmarked ? ` ${tot.unmarked} working days not marked yet.` : ''}
                      </div>
                      <table className="rp-block-table sum-att">
                        <thead><tr><th>Company</th><th className="num">Staff</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">Half day</th><th className="num">Not marked</th><th className="num">Attendance</th><th className="no-print" /></tr></thead>
                        <tbody>
                          {ATT.rows.map((r) => (
                            <tr key={r.key}>
                              <td>{r.label}</td><td className="num">{r.staff}</td><td className="num">{r.present}</td>
                              <td className={`num ${r.absent ? 'neg' : ''}`}>{r.absent}</td><td className="num">{r.leave}</td><td className="num">{r.half}</td>
                              <td className="num">{r.unmarked}</td><td className="num"><b>{r.rate == null ? '–' : `${r.rate}%`}</b></td>
                              <td className="no-print"><Link href={`/expenses/attendance?co=${r.key}${period.length === 7 ? `&m=${period}` : ''}`}>Open ›</Link></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {Object.keys(ATT.leaveWhy || {}).length > 0 && (
                        <p className="note">Leave (paid): {Object.entries(ATT.leaveWhy).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
                      )}
                      {ATT.topAbsent.length > 0 && (
                        <p className="note">Most absent: {ATT.topAbsent.map((p) => `${p.name} (${p.companyLabel}) ${p.absent}${p.half ? ` + ${p.half} half` : ''}`).join(' · ')}</p>
                      )}
                    </>
                  );
                })() : (
                  <div className="rp-empty">No attendance marked for {periodLabel}. Open {ATT.rows.map((r, i) => <span key={r.key}>{i ? ', ' : ''}<Link href={`/expenses/attendance?co=${r.key}`}>{r.label}</Link></span>)} to mark it.</div>
                )}
              </div>
            )}

            <div className="rp-card">
              <div className="rp-card-title">⏳ Unpaid bills by age</div>
              <div className="rp-takeaway">{G.unpaidBills.length ? `${G.unpaidBills.length} unpaid bill${G.unpaidBills.length === 1 ? '' : 's'}: ${fmtO(G.unpaidAll)}. Pay the oldest first.` : 'No unpaid bills. 👍'}</div>
              <div className="age-bars">
                {G.ageing.map((a, i) => (
                  <button type="button" key={a.label} className={`age-row a${i}`} onClick={() => a.count && setDrill({ title: `Unpaid bills ${a.label}`, lines: a.lines, unpaid: true })} disabled={!a.count}>
                    <span className="age-name">{a.label}</span>
                    <span className="rp-hbar-track"><span className="rp-hbar-fill" style={{ width: `${G.unpaidAll ? Math.max(a.amount ? 3 : 0, (a.amount / G.unpaidAll) * 100) : 0}%` }} /></span>
                    <span className="age-val"><b>{fmtAmt(a.amount)}</b> <small>{a.count} bill{a.count === 1 ? '' : 's'}</small></span>
                  </button>
                ))}
              </div>
              {G.unpaidBills.length > 0 && (
                <table className="rp-block-table age-list">
                  <thead><tr><th>Oldest</th><th>Company</th><th className="num">Unpaid</th><th className="num">Days</th></tr></thead>
                  <tbody>{G.unpaidBills.slice(0, 5).map((l, i) => <tr key={i}><td>{dmy(l.date)} {l.desc ? <small className="muted">{l.desc.slice(0, 28)}</small> : null}</td><td>{labelOf(l.src)}</td><td className="num">{fmtAmt(l.unpaid)}</td><td className="num">{l.age}</td></tr>)}</tbody>
                </table>
              )}
            </div>

            <div className="rp-card">
              <div className="rp-card-title">Company ranking</div>
              <div className="rp-takeaway">{ranked.length > 1 && ranked[1].spent ? `${ranked[0].label} spent ${fmtO(r3(ranked[0].spent - ranked[1].spent))} more than ${ranked[1].label}.` : ' '}</div>
              <table className="rp-block-table">
                <thead><tr><th>#</th><th>Company</th><th className="num">Spent</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {ranked.map((s, i) => (
                    <tr key={s.key} className={`pickable ${i === 0 && s.spent ? 'top' : ''}`} onClick={() => drillCompany(s.key)}><td>{i + 1}</td><td>{s.label}</td><td className="num">{fmtAmt(s.spent)}</td><td className="num">{pct(s.spent, G.grand.spent)}%</td></tr>
                  ))}
                  <tr className="sum"><td /><td>Total</td><td className="num">{fmtAmt(G.grand.spent)}</td><td className="num">100%</td></tr>
                </tbody>
              </table>
            </div>

            <div className="rp-card rp-wide">
              <div className="rp-card-title">Money spent each month <span className="rp-card-note">(last {barMonths.length} months, chosen companies)</span></div>
              <div className="rp-takeaway">{barVals[maxIdx] ? `Highest month: ${monthLabel(barMonths[maxIdx])} with ${fmtO(barVals[maxIdx])}.` : ' '}</div>
              <Bars labels={barMonths.map(shortM)} values={barVals} fmt={(v) => fmtAmt(v)} highlight={barHi} labelAll={barMonths.length <= 8} onPick={(i) => drillMonth(barMonths[i])} />
            </div>

            <div className="rp-card rp-wide">
              <div className="rp-card-title">📅 Year on year <span className="rp-card-note">({G.yoy.prevYear} vs {G.yoy.year}, same months)</span></div>
              <div className="rp-takeaway">
                {G.yoy.hasPrev
                  ? `${G.yoy.year} so far: ${fmtO(G.yoy.curTotal)} vs ${fmtO(G.yoy.prevTotal)} in ${G.yoy.prevYear} (${G.yoy.curTotal >= G.yoy.prevTotal ? '▲' : '▼'} ${Math.abs(pct(G.yoy.curTotal - G.yoy.prevTotal, G.yoy.prevTotal))}%).`
                  : `No ${G.yoy.prevYear} data yet. This comparison fills in by itself from next year.`}
              </div>
              <PairBars labels={G.yoy.labels} a={G.yoy.prev} b={G.yoy.cur} aLabel={G.yoy.prevYear} bLabel={G.yoy.year} aColor="#9aa5a1" bColor={SERIES[0]} fmt={fmtO}
                onPick={(i) => drillMonth(`${G.yoy.year}-${String(i + 1).padStart(2, '0')}`)} />
            </div>
          </div>

          {AN && (
            <>
              <h2 className="an-h2">📊 Analytics <span>{periodLabel}</span></h2>
              <div className="rp-grid">
                <div className="rp-card">
                  <div className="rp-card-title">⏱ Spending pace <span className="rp-card-note">({monthLabel(AN.pace.thisMonth)})</span></div>
                  <div className="rp-takeaway">
                    {AN.pace.avg
                      ? AN.pace.vsAvg > 10 ? `On track to spend ${AN.pace.vsAvg}% MORE than an average month.` : AN.pace.vsAvg < -10 ? `On track to spend ${Math.abs(AN.pace.vsAvg)}% less than an average month.` : 'Spending is close to an average month.'
                      : 'Not enough past months to compare yet.'}
                  </div>
                  <dl className="an-kv">
                    <div><dt>Average month</dt><dd>{AN.pace.avg ? fmtO(AN.pace.avg) : '–'}<small>{AN.pace.months ? `last ${AN.pace.months} month${AN.pace.months === 1 ? '' : 's'}` : ''}</small></dd></div>
                    <div><dt>Spent so far</dt><dd>{fmtO(AN.pace.soFar)}<small>day {AN.pace.day} of {AN.pace.dim}</small></dd></div>
                    <div className={AN.pace.vsAvg > 10 ? 'bad' : ''}><dt>Forecast month end</dt><dd>{fmtO(AN.pace.forecast)}<small>{AN.pace.vsAvg == null ? 'at this daily rate' : `${AN.pace.vsAvg > 0 ? '▲' : '▼'} ${Math.abs(AN.pace.vsAvg)}% vs average`}</small></dd></div>
                  </dl>
                </div>

                <div className="rp-card">
                  <div className="rp-card-title">↕ Biggest changes <span className="rp-card-note">({G.prevPeriod ? `vs ${G.prevPeriod.length === 4 ? G.prevPeriod : monthLabel(G.prevPeriod)}` : 'pick a month or year'})</span></div>
                  {AN.movers.length ? (
                    <table className="rp-block-table an-move">
                      <thead><tr><th>Head</th><th className="num">Before</th><th className="num">Now</th><th className="num">Change</th></tr></thead>
                      <tbody>
                        {AN.movers.map((m) => (
                          <tr key={m.head} className="pickable" onClick={() => setDrill({ title: `${m.head} · ${periodLabel}`, lines: G.sel.filter((l) => l.head === m.head) })}>
                            <td>{m.head}</td><td className="num">{fmtAmt(m.before)}</td><td className="num">{fmtAmt(m.now)}</td>
                            <td className={`num ${m.diff > 0 ? 'neg' : 'pos'}`}>{m.diff > 0 ? '▲' : '▼'} {fmtAmt(Math.abs(m.diff))}{m.pct != null ? ` (${Math.abs(m.pct)}%)` : ' (new)'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div className="rp-empty">No previous period to compare.</div>}
                </div>

                <div className="rp-card">
                  <div className="rp-card-title">🏷 By department</div>
                  <div className="rp-takeaway">{AN.depts[0] ? `${AN.depts[0].dept} spent the most: ${pct(AN.depts[0].total, G.grand.spent)}%.` : ' '}</div>
                  <HBars rows={AN.depts.slice(0, 8).map((d) => ({ label: d.dept, value: d.total, sub: `${pct(d.total, G.grand.spent)}%` }))} fmt={(v) => fmtAmt(v)}
                    onPick={(i, r) => setDrill({ title: `${r.label} · ${periodLabel}`, lines: G.sel.filter((l) => (l.dept || 'No department') === r.label) })} />
                </div>

                <div className="rp-card">
                  <div className="rp-card-title">💸 10 biggest bills</div>
                  {AN.biggest.length ? (
                    <table className="rp-block-table an-big">
                      <tbody>
                        {AN.biggest.map((l, i) => (
                          <tr key={i}>
                            <td className="an-rank">{i + 1}</td>
                            <td><b>{l.desc || l.head}</b><small>{dmy(l.date)} · {labelOf(l.src)} · {l.head}</small></td>
                            <td className="num">{fmtAmt(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div className="rp-empty">No bills in this period.</div>}
                </div>

                {AN.transport && (
                  <div className="rp-card rp-wide">
                    <div className="rp-card-title">🚚 Transport analytics</div>
                    <div className="rp-takeaway">
                      {AN.transport.trips
                        ? `${AN.transport.trips} trips. Each trip brings ${fmtO(AN.transport.avgRent)} and costs ${fmtO(AN.transport.avgCost)} (diesel, toll, maintenance), so ${fmtO(AN.transport.avgMargin)} is left per trip before salary.`
                        : 'No trips in this period.'}
                    </div>
                    <div className="an-tiles">
                      <div><span>Trips</span><b>{AN.transport.trips}</b></div>
                      <div><span>Avg rent / trip</span><b>{fmtAmt(AN.transport.avgRent)}</b></div>
                      <div><span>Avg cost / trip</span><b>{fmtAmt(AN.transport.avgCost)}</b></div>
                      <div><span>Margin / trip</span><b className={AN.transport.avgMargin < 0 ? 'neg' : 'pos'}>{fmtAmt(AN.transport.avgMargin)}</b></div>
                      <div><span>Money collected</span><b className={AN.transport.collectRate != null && AN.transport.collectRate < 80 ? 'neg' : ''}>{AN.transport.collectRate == null ? '–' : `${AN.transport.collectRate}%`}</b></div>
                      <div><span>Days to collect</span><b>{AN.transport.avgDays == null ? '–' : AN.transport.avgDays}</b>{AN.transport.slowest ? <small>slowest {AN.transport.slowest}</small> : null}</div>
                    </div>
                    {AN.transport.perDriver.length > 0 && (
                      <div className="table-wrap">
                        <table className="rp-block-table an-drv">
                          <thead><tr><th>Driver</th><th className="num">Trips</th><th className="num">Work</th><th className="num">Received</th><th className="num">To collect</th><th className="num">Trip costs</th><th className="num">Salary</th><th className="num">Profit</th></tr></thead>
                          <tbody>
                            {AN.transport.perDriver.map((d) => (
                              <tr key={d.id}>
                                <td><Link href={`/transport/${d.id}`}><b>{d.name}</b></Link></td>
                                <td className="num">{d.trips}</td><td className="num">{fmtAmt(d.work)}</td><td className="num">{fmtAmt(d.received)}</td>
                                <td className={`num ${d.toCollect > 0 ? 'neg' : ''}`}>{fmtAmt(d.toCollect)}</td>
                                <td className="num">{fmtAmt(d.costs)}</td><td className="num">{fmtAmt(d.salary)}</td>
                                <td className={`num ${d.profit < 0 ? 'neg' : 'pos'}`}><b>{fmtAmt(d.profit)}</b></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {AN.transport.routes.length > 0 && (
                      <p className="an-routes"><b>Most used routes:</b> {AN.transport.routes.map((r) => `${r.route} (${r.trips} trip${r.trips === 1 ? '' : 's'}, ${fmtAmt(r.work)})`).join(' · ')}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <PLStatement G={G} periodLabel={periodLabel} />

          <section className="panel">
            <h2>By company</h2>
            <div className="table-wrap">
              <table className="summary-table">
                <thead><tr><th>Company</th><th className="num">Spent</th><th className="num">Unpaid</th><th className="num">VAT on bills</th><th className="num">Work amount</th><th className="num">VAT 5% on work</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {G.perSource.map((s) => (
                    <tr key={s.key} className="pickable" onClick={() => drillCompany(s.key)}>
                      <td><b>{s.label}</b><div className="note">{s.full}</div></td>
                      <td className="num">{fmtAmt(s.spent)}</td>
                      <td className="num">{s.unpaid ? fmtAmt(s.unpaid) : <span className="muted">–</span>}</td>
                      <td className="num">{s.vat ? fmtAmt(s.vat) : <span className="muted">–</span>}</td>
                      <td className="num">{s.kind === 'transport' ? fmtAmt(s.work) : <span className="muted">–</span>}</td>
                      <td className="num">{s.kind === 'transport' && s.vatIn ? fmtAmt(s.vatIn) : <span className="muted">–</span>}</td>
                      <td className={`num ${s.profit < 0 ? 'neg' : 'pos'}`}>{s.kind === 'transport' ? fmtAmt(s.profit) : <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                  <tr className="sum"><td>Total</td><td className="num">{fmtAmt(G.grand.spent)}</td><td className="num">{fmtAmt(G.grand.unpaid)}</td><td className="num">{fmtAmt(G.grand.vat)}</td><td /><td className="num">{G.grand.vatIn ? fmtAmt(G.grand.vatIn) : ''}</td><td /></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>By head of account</h2>
            <div className="table-wrap">
              <table className="summary-table">
                <thead><tr><th>Head of account</th>{G.chosen.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {G.heads.map((h) => (
                    <tr key={h.head} className="pickable" onClick={() => drillHead(h.head)}><td>{h.head}</td>{h.vals.map((v, i) => <td key={i} className="num">{v ? fmtAmt(v) : <span className="muted">–</span>}</td>)}<td className="num"><b>{fmtAmt(h.total)}</b></td></tr>
                  ))}
                  <tr className="sum"><td>Total</td>{G.perSource.map((s) => <td key={s.key} className="num">{fmtAmt(s.spent)}</td>)}<td className="num">{fmtAmt(G.grand.spent)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {G.byMonth.length > 1 && (
            <section className="panel">
              <h2>By month</h2>
              <div className="table-wrap">
                <table className="summary-table">
                  <thead><tr><th>Month</th>{G.chosen.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    {G.byMonth.map((m) => (
                      <tr key={m.month} className="pickable" onClick={() => drillMonth(m.month)}><td>{monthLabel(m.month)}</td>{m.vals.map((v, i) => <td key={i} className="num">{v ? fmtAmt(v) : <span className="muted">–</span>}</td>)}<td className="num"><b>{fmtAmt(m.total)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="note print-only">Printed {exportStamp()} · Tudo Num Office Systems</p>
        </div>
      )}

      {drill && <DrillModal drill={drill} onClose={() => setDrill(null)} />}

      {budgetOpen && <BudgetModal budgets={data.budgets} onClose={() => setBudgetOpen(false)} onSaved={load} />}
      {modal}
    </>
  );
}

function DrillModal({ drill, onClose }) {
  const total = r3(drill.lines.reduce((t, l) => t + (drill.unpaid ? l.unpaid : l.amount), 0));
  return (
    <Modal title={drill.title} onClose={onClose}>
      <div className="drill">
        <p className="note" style={{ margin: 0 }}>{drill.lines.length} line{drill.lines.length === 1 ? '' : 's'} · Total <b>{fmtAmt(total)} OMR</b></p>
        <div className="table-wrap drill-wrap">
          <table className="summary-table drill-table">
            <thead><tr><th>Date</th><th>Company</th><th>Head</th><th>Details</th><th className="num">{drill.unpaid ? 'Unpaid' : 'Amount'}</th>{drill.unpaid && <th className="num">Days</th>}</tr></thead>
            <tbody>
              {drill.lines.map((l, i) => (
                <tr key={i}>
                  <td>{dmy(l.date)}</td><td>{labelOf(l.src)}</td><td>{l.head}</td>
                  <td>{l.ref ? <b>#{l.ref} </b> : null}{l.desc || <span className="muted">–</span>}</td>
                  <td className="num">{fmtAmt(drill.unpaid ? l.unpaid : l.amount)}</td>{drill.unpaid && <td className="num">{l.age}</td>}
                </tr>
              ))}
              {!drill.lines.length && <tr><td colSpan={6} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

function BudgetModal({ budgets, onClose, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(budgets.map((b) => [`${b.source}|${b.head}`, String(Number(b.monthly) || '')])));
  const [msg, setMsg] = useState('');
  const rows = [...new Set([...HEADS, ...TRANSPORT_HEADS, ...budgets.map((b) => b.head)])];
  // companies use the office heads; transport uses its own heads (Salary and Maintenance are shared)
  const applies = (src, head) => (src === 'transport' ? TRANSPORT_HEADS.includes(head) : HEADS.includes(head));

  async function save(src, head) {
    const key = `${src}|${head}`;
    const v = Number(vals[key] || 0);
    const before = Number(budgets.find((b) => b.source === src && b.head === head)?.monthly || 0);
    if (v === before) return;
    const s = sb();
    const { error } = v > 0
      ? await s.from('exp_budgets').upsert({ source: src, head, monthly: r3(v), updated_at: new Date().toISOString() }, { onConflict: 'source,head' })
      : await s.from('exp_budgets').delete().eq('source', src).eq('head', head);
    setMsg(error ? error.message : `Saved: ${labelOf(src)} · ${head}`);
    if (!error) onSaved();
  }
  const colTotal = (src) => r3(rows.reduce((t, h) => t + Number(vals[`${src}|${h}`] || 0), 0));

  return (
    <Modal title="🎯 Monthly budgets (OMR)" onClose={onClose}>
      <div className="drill">
        <p className="note" style={{ margin: 0 }}>Type the budget for one month. It saves when you leave the box. Leave it empty for no budget. For a year or all months it is multiplied by the number of months.</p>
        <div className="table-wrap drill-wrap">
          <table className="summary-table budget-table">
            <thead><tr><th>Head of account</th>{SOURCES.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h}>
                  <td>{h}</td>
                  {SOURCES.map((s) => (
                    <td key={s.key} className="num">
                      {applies(s.key, h) ? (
                        <input className="budget-in" inputMode="decimal" value={vals[`${s.key}|${h}`] || ''} placeholder="–"
                          onChange={(e) => setVals((o) => ({ ...o, [`${s.key}|${h}`]: e.target.value.replace(/[^\d.]/g, '') }))}
                          onBlur={() => save(s.key, h)} aria-label={`${s.label} ${h} monthly budget`} />
                      ) : <span className="muted">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="sum"><td>Total per month</td>{SOURCES.map((s) => <td key={s.key} className="num">{fmtAmt(colTotal(s.key))}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="modal-actions"><span className="note" style={{ marginRight: 'auto' }}>{msg}</span><button type="button" className="btn" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

/* Scroll to a section and flash it */
function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('pl-flash'); void el.offsetWidth; el.classList.add('pl-flash');
}

/* 💰 Sales sheet: everything earned (Transport trips + company invoices) for the chosen companies and period */
function SalesSheet({ G, periodLabel }) {
  const S = G.sales;
  const [all, setAll] = useState(false);
  if (!S) return null;
  const many = S.cols.length > 1;
  const shown = all ? S.list : S.list.slice(0, 15);
  const srcLabel = (k) => (S.rows.find((r) => r.key === k) || { label: k }).label;
  async function excel() {
    try {
      const sub = `${G.chosen.map((s) => s.label).join(', ')} · ${periodLabel} · OMR · Printed ${exportStamp()}`;
      await exportExcel(`Sales ${periodLabel}.xlsx`, [
        { name: 'Sales', title: `Sales · ${periodLabel}`, subtitle: sub, head: ['Source', 'Sales', 'VAT 5%', 'Without VAT', 'Received', 'To collect', 'Count'],
          rows: S.rows.map((r) => [r.label, r.amount, r.vat, r.net, r.tracked ? r.received : '', r.tracked ? r.toCollect : '', r.count]),
          totalsRow: ['Total', S.T.amount, S.T.vat, S.T.net, S.T.received, S.T.toCollect, S.T.count], numCols: [1, 2, 3, 4, 5, 6], widths: [28, 13, 11, 13, 13, 13, 8] },
        ...(many ? [{ name: 'By month', title: 'Sales by month', subtitle: sub, head: ['Month', ...S.rows.map((r) => r.label), 'Total'],
          rows: S.byMonth.map((m) => [monthLabel(m.month), ...m.vals, m.total]), numCols: S.rows.map((_, i) => i + 1).concat(S.rows.length + 1), widths: [16, ...S.rows.map(() => 18), 13] }] : []),
        { name: 'All sales', title: `All sales · ${periodLabel}`, subtitle: sub, head: ['Date', 'Source', 'Ref', 'Customer / route', 'Sales', 'VAT 5%', 'Received'],
          rows: S.list.map((x) => [x.date ? String(x.date).slice(0, 10).split('-').reverse().join('/') : '', srcLabel(x.src), x.ref || '', x.party || '', x.amount, x.vat, x.received == null ? '' : x.received]),
          numCols: [4, 5, 6], widths: [12, 22, 14, 36, 12, 10, 12] }
      ]);
    } catch { /* ignore */ }
  }
  return (
    <section className="sales-panel" id="sales-sheet">
      <div className="pl-top">
        <h2>💰 Sales <span className="pl-period">{periodLabel}</span></h2>
        <button type="button" className="btn small ghost" onClick={excel}>⬇ Excel</button>
      </div>
      <div className="pl-kpis sales-kpis">
        <div className="hero"><span>Total sales</span><b>{fmtAmt(S.T.amount)}</b><small>{S.T.count} {S.T.count === 1 ? 'sale' : 'sales'}</small></div>
        <div><span>VAT 5% inside</span><b>{fmtAmt(S.T.vat)}</b><small>Kept aside</small></div>
        <div><span>Sales without VAT</span><b>{fmtAmt(S.T.net)}</b><small>Real income</small></div>
        <div><span>Received</span><b className="pos">{fmtAmt(S.T.received)}</b><small>Transport trips</small></div>
        <div><span>Still to collect</span><b className={S.T.toCollect > 0 ? 'neg' : ''}>{fmtAmt(S.T.toCollect)}</b><small>Transport trips</small></div>
      </div>
      <div className="table-wrap">
        <table className="summary-table">
          <thead><tr><th>Source</th>{many && S.cols.map((m) => <th key={m} className="num">{plShort(m)}</th>)}<th className="num">Sales</th><th className="num">VAT 5%</th><th className="num">Without VAT</th><th className="num">To collect</th></tr></thead>
          <tbody>
            {S.rows.map((r, i) => (
              <tr key={r.key}>
                <td><b>{r.label}</b><div className="note">{r.count} {r.count === 1 ? 'sale' : 'sales'}</div></td>
                {many && S.byMonth.map((m) => <td key={m.month} className="num">{m.vals[i] ? fmtAmt(m.vals[i]) : <span className="muted">–</span>}</td>)}
                <td className="num"><b>{r.amount ? fmtAmt(r.amount) : <span className="muted">–</span>}</b></td>
                <td className="num">{r.vat ? fmtAmt(r.vat) : <span className="muted">–</span>}</td>
                <td className="num">{r.net ? fmtAmt(r.net) : <span className="muted">–</span>}</td>
                <td className={`num ${r.toCollect > 0 ? 'neg' : ''}`}>{r.tracked ? (r.toCollect ? fmtAmt(r.toCollect) : '–') : <span className="muted">not tracked</span>}</td>
              </tr>
            ))}
            <tr className="sum"><td>Total</td>{many && S.byMonth.map((m) => <td key={m.month} className="num">{fmtAmt(m.total)}</td>)}<td className="num">{fmtAmt(S.T.amount)}</td><td className="num">{fmtAmt(S.T.vat)}</td><td className="num">{fmtAmt(S.T.net)}</td><td className="num">{fmtAmt(S.T.toCollect)}</td></tr>
          </tbody>
        </table>
      </div>
      {S.list.length > 0 && (
        <>
          <h3 className="sales-h3">Sales list {S.list.length > 15 && !all ? `(latest 15 of ${S.list.length})` : `(${S.list.length})`}</h3>
          <div className="table-wrap">
            <table className="summary-table">
              <thead><tr><th>Date</th><th>Source</th><th>Customer / route</th><th className="num">Sales</th><th className="num">VAT 5%</th><th className="num">Received</th></tr></thead>
              <tbody>
                {shown.map((x, i) => (
                  <tr key={i}>
                    <td>{String(x.date).slice(0, 10).split('-').reverse().join('/')}</td>
                    <td>{srcLabel(x.src)}{x.ref ? <div className="note">{x.ref}</div> : null}</td>
                    <td>{x.party || '–'}</td>
                    <td className="num"><b>{fmtAmt(x.amount)}</b></td>
                    <td className="num">{x.vat ? fmtAmt(x.vat) : <span className="muted">–</span>}</td>
                    <td className={`num ${x.received != null && x.received < x.amount ? 'neg' : ''}`}>{x.received == null ? <span className="muted">–</span> : fmtAmt(x.received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {S.list.length > 15 && <button type="button" className="btn small ghost" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${S.list.length}`}</button>}
        </>
      )}
      <p className="note" style={{ margin: '8px 0 0' }}>Sales = Transport trips (work amount) + invoices made in 🧾 Invoice / Receipt for the 3 companies. VAT 5% is inside the amount and kept aside. Transport invoices are not added again (they bill the same trips).</p>
    </section>
  );
}

/* 📑 Profit and Loss statement (lib/groupSummary.js computePL). Negative amounts in brackets. */
const plFmt = (v) => (v == null ? '' : Math.abs(v) < 0.0005 ? '–' : v < 0 ? `(${fmtAmt(-v)})` : fmtAmt(v));
const plShort = (m) => monthLabel(m).replace(/ (\d{4})$/, (y) => ` '${y.trim().slice(2)}`);
function PLStatement({ G, periodLabel }) {
  const P = G.pl;
  if (!P || !P.cols.length) return null;
  const many = P.cols.length > 1;
  async function excel() {
    const head = ['Profit and Loss', ...(many ? P.cols.map((m) => monthLabel(m)) : []), 'Total'];
    const rows = P.rows.map((r) => [r.kind === 'line' || r.kind === 'memo' ? `   ${r.label}` : r.label, ...(many ? r.vals.map((v) => (v == null ? '' : v)) : []), r.total == null ? '' : r.total]);
    const bold = P.rows.map((r, i) => (r.kind !== 'line' && r.kind !== 'memo' ? i : -1)).filter((i) => i >= 0);
    try {
      await exportExcel(`Profit and Loss ${periodLabel}.xlsx`, [{
        name: 'Profit and Loss', title: `Profit and Loss statement · ${periodLabel}`,
        subtitle: `${G.chosen.map((s) => s.label).join(', ')} · OMR · Salary is not subtracted from gross profit · Printed ${exportStamp()}`,
        head, rows, numCols: head.map((_, i) => i).slice(1), widths: [46, ...head.slice(1).map(() => 13)], boldRows: bold
      }]);
    } catch { /* ignore */ }
  }
  return (
    <section className="panel pl-panel" id="pl-statement">
      <div className="pl-top">
        <h2>📑 Profit and Loss statement <span className="pl-period">{periodLabel}</span></h2>
        <button type="button" className="btn small ghost" onClick={excel}>⬇ Excel</button>
      </div>
      <div className="pl-kpis">
        <div><span>Gross profit</span><b className={P.gross < 0 ? 'neg' : 'pos'}>{plFmt(P.gross)}</b><small>Salary not subtracted</small></div>
        <div><span>Net before tax</span><b className={P.before < 0 ? 'neg' : 'pos'}>{plFmt(P.before)}</b><small>After salaries and bills</small></div>
        <div><span>Tax 15% (estimate)</span><b>{plFmt(P.tax)}</b><small>Only on profit</small></div>
        <div className="hero"><span>Net after tax</span><b>{plFmt(P.after)}</b><small>{G.chosen.map((s) => s.label).join(', ')}</small></div>
      </div>
      <div className="table-wrap">
        <table className="summary-table pl-table">
          <thead><tr><th>OMR</th>{many && P.cols.map((m) => <th key={m} className="num">{plShort(m)}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {P.rows.map((r, i) => (
              <tr key={i} className={`pl-${r.kind} ${r.big ? 'pl-big' : ''}`}>
                <td>{r.note ? <span className="muted">{r.label}</span> : r.label}</td>
                {many && r.vals.map((v, j) => <td key={j} className={`num ${r.kind === 'result' && v < 0 ? 'neg' : ''}`}>{r.kind === 'head' ? '' : plFmt(v)}</td>)}
                <td className={`num ${r.kind === 'result' ? (r.total < 0 ? 'neg' : 'pos') : ''}`}>{r.kind === 'head' ? '' : plFmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ margin: '8px 0 0' }}>
        Income is the Transport work amount (the 3 companies have no income in the system). VAT 5% is kept aside, not income.
        Gross profit does not subtract salary. Company bills count when entered (paid + unpaid). Tax 15% is an estimate; the real tax is on the yearly profit.
      </p>
    </section>
  );
}

export default function Page() {
  return <AuthGate wide><SummaryPage /></AuthGate>;
}
