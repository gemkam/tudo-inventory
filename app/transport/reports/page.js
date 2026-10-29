'use client';

import RangeReport from '@/components/RangeReport';
import { transportReport } from '@/lib/rangeReports';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { Donut, Bars, PairBars, HBars, SERIES } from '@/components/Charts';
import { COMPANY_NAME } from '@/components/CompanyHeader';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, fmtFullDate, monthKey, monthLabel, exportExcel, exportReportPdf } from '@/lib/sheet';
import { salaryPayable } from '@/lib/transport';
import { RANGES, rangeBounds, inRange, rangeNote, localDate } from '@/lib/ranges';

const RANGE_KEYS = ['week', 'month', 'lastmonth', 'quarter', 'all'];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* Salary cell in Drivers compared: total, then fixed part and driver allowance with paid / not paid */
function SalaryCell({ salary, allowance, open }) {
  const paid = num(allowance - open);
  return (
    <span className="rp-sal">
      <b>{fmtAmt(num(salary + allowance))}</b>
      <small>Fixed {fmtAmt(salary)}</small>
      {allowance > 0 && <small>Allowance {fmtAmt(allowance)}</small>}
      {paid > 0 && <small className="pos">✓ {fmtAmt(paid)} paid</small>}
      {open > 0 && <small className="neg">✗ {fmtAmt(open)} not paid</small>}
    </span>
  );
}

function TransportReports() {
  const [drivers, setDrivers] = useState(null);
  const [entries, setEntries] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [extras, setExtras] = useState([]);
  const [range, setRange] = useState('month');
  const [busy, setBusy] = useState('');
  const areaRef = useRef(null);

  useEffect(() => {
    (async () => {
      const s = sb();
      const [d, e, sa, ex] = await Promise.all([
        s.from('transport_drivers').select('*').order('sort').order('name'),
        s.from('transport_entries').select('*').order('entry_date'),
        s.from('transport_salaries').select('*'),
        s.from('transport_extras').select('*')
      ]);
      setDrivers(d.data || []);
      setEntries(e.data || []);
      setSalaries(sa.data || []);
      setExtras(ex.data || []);
    })();
  }, []);

  const r = useMemo(() => {
    if (!drivers) return null;
    const bounds = rangeBounds(range);
    const wholeMonths = range !== 'week';
    const es = entries.filter((e) => inRange(e.entry_date, bounds));
    const trips = es.filter((e) => Number(e.rent) > 0);
    const monthIn = (m) => wholeMonths && localDate(m) >= new Date(bounds[0].getFullYear(), bounds[0].getMonth(), 1) && localDate(m) < bounds[1];
    const sal = salaries.filter((s) => monthIn(s.month));
    const ex = extras.filter((x) => monthIn(x.month));
    const sum = (list, k) => num(list.reduce((t, x) => t + Number(x[k] || 0), 0));

    const perDriver = drivers.map((d, i) => {
      const de = es.filter((e) => e.driver_id === d.id);
      const dt = de.filter((e) => Number(e.rent) > 0);
      const o = {
        d, color: SERIES[i % SERIES.length], trips: dt.length,
        work: sum(de, 'rent'), received: sum(de, 'received'), diesel: sum(de, 'diesel'), toll: sum(de, 'toll'), maintenance: sum(de, 'maintenance'),
        // salary without the driver allowance part (that is counted per trip below, by trip date, paid or not)
        salary: num(sal.filter((s) => s.driver_id === d.id).reduce((t, s) => t + salaryPayable(s) - Number(s.trip_allowance || 0) - Number(s.allowance_carried || 0), 0)),
        allowance: sum(de, 'driver_allowance'),
        allowanceOpen: sum(de.filter((e) => e.allowance_status !== 'Paid'), 'driver_allowance'),
        other: sum(ex.filter((x) => x.driver_id === d.id), 'amount')
      };
      o.expenses = num(o.diesel + o.toll + o.maintenance + o.salary + o.allowance + o.other);
      o.profit = num(o.work - o.expenses);
      o.dieselPerTrip = o.trips ? num(o.diesel / o.trips) : 0;
      return o;
    });
    const tot = (k) => num(perDriver.reduce((t, x) => t + x[k], 0));
    const T = { trips: trips.length, work: tot('work'), received: tot('received'), diesel: tot('diesel'), toll: tot('toll'), maintenance: tot('maintenance'), salary: tot('salary'), allowance: tot('allowance'), allowanceOpen: tot('allowanceOpen'), other: tot('other'), expenses: tot('expenses'), profit: tot('profit') };
    T.receivable = num(T.work - T.received);

    const routes = {};
    trips.forEach((e) => {
      const k = `${clean(e.from_place) || '?'} → ${clean(e.to_place) || '?'}`;
      routes[k] = routes[k] || { label: k, trips: 0, rent: 0 };
      routes[k].trips += 1;
      routes[k].rent = num(routes[k].rent + Number(e.rent));
    });
    const topRoutes = Object.values(routes).sort((a, b) => b.rent - a.rent);

    // month by month (always all months, like the "money each day" chart in the club report)
    const months = [...new Set(entries.map((e) => monthKey(e.entry_date)))].sort();
    const byMonth = months.map((m) => {
      const me = entries.filter((e) => monthKey(e.entry_date) === m);
      const work = sum(me, 'rent');
      const cost = num(sum(me, 'diesel') + sum(me, 'toll') + sum(me, 'maintenance') + sum(me, 'driver_allowance')
        + salaries.filter((s) => monthKey(s.month) === m).reduce((t, s) => t + salaryPayable(s) - Number(s.trip_allowance || 0) - Number(s.allowance_carried || 0), 0)
        + sum(extras.filter((x) => monthKey(x.month) === m), 'amount'));
      return { m, label: monthLabel(m).replace(/ \d{4}$/, (y) => ` '${y.trim().slice(2)}`), work, cost, profit: num(work - cost) };
    });

    const toCollect = es.filter((e) => Number(e.rent) > Number(e.received)).map((e) => ({ ...e, due: num(Number(e.rent) - Number(e.received)) }));
    return { es, trips, perDriver, T, topRoutes, byMonth, toCollect, wholeMonths };
  }, [drivers, entries, salaries, extras, range]);

  if (!r) return <div className="loading">Loading report...</div>;

  const { T } = r;
  const margin = T.work ? Math.round((T.profit / T.work) * 100) : 0;
  const costSlices = [
    { label: 'Diesel', value: T.diesel, color: SERIES[0] },
    { label: 'Toll + visa exit fee', value: T.toll, color: SERIES[1] },
    { label: 'Maintenance', value: T.maintenance, color: SERIES[2] },
    { label: 'Driver allowance', value: T.allowance, color: SERIES[5] },
    { label: 'Salaries (fixed)', value: T.salary, color: SERIES[3] },
    { label: 'Other (trailer rent etc.)', value: T.other, color: SERIES[4] }
  ];
  const biggestCost = [...costSlices].sort((a, b) => b.value - a.value)[0];
  const driverSlices = r.perDriver.map((x) => ({ label: x.d.name, value: x.work, color: x.color }));
  const topDriver = [...r.perDriver].sort((a, b) => b.profit - a.profit)[0];
  const topWork = [...r.perDriver].sort((a, b) => b.work - a.work)[0];
  const bestMonth = r.byMonth.reduce((b, x, i) => (x.profit > (r.byMonth[b]?.profit ?? -Infinity) ? i : b), -1);
  const topRoute = r.topRoutes[0];
  const driverName = (id) => drivers.find((d) => d.id === id)?.name || '';

  /* ---------- Exports ---------- */

  const driverHead = ['Driver', 'Trips', 'Work', 'Received', 'Diesel', 'Toll', 'Maintenance', 'Salary (incl. driver allowance)', 'Driver allowance paid', 'Driver allowance not paid', 'Other', 'Expenses', 'Profit'];
  const driverRows = r.perDriver.map((x) => [x.d.name, x.trips, x.work, x.received, x.diesel, x.toll, x.maintenance, num(x.salary + x.allowance), num(x.allowance - x.allowanceOpen), x.allowanceOpen, x.other, x.expenses, x.profit]);
  const driverTotal = ['Total', T.trips, T.work, T.received, T.diesel, T.toll, T.maintenance, num(T.salary + T.allowance), num(T.allowance - T.allowanceOpen), T.allowanceOpen, T.other, T.expenses, T.profit];
  const tripRows = r.es.map((e) => [fmtFullDate(e.entry_date), driverName(e.driver_id), e.from_place || '', e.to_place || e.description || '', num(e.rent), num(e.received), num(e.diesel), num(e.toll), num(e.maintenance), e.payment_status || '']);
  const collectRows = r.toCollect.map((e) => [fmtFullDate(e.entry_date), driverName(e.driver_id), `${clean(e.from_place)} → ${clean(e.to_place)}`, num(e.rent), num(e.received), e.due]);
  const fileBase = `Transport report ${RANGES[range]} ${new Date().toISOString().slice(0, 10)}`;
  const fmtRow = (row, from = 1) => row.map((v, i) => (i >= from && typeof v === 'number' ? fmtAmt(v) : v));

  async function doPdf() {
    setBusy('pdf');
    try {
      await exportReportPdf(`${fileBase}.pdf`, {
        title: 'Transport Expense: Report',
        note: `${COMPANY_NAME} (Transport Division) · ${RANGES[range]} · ${rangeNote(range)} Amounts in OMR.${r.wholeMonths ? '' : ' Salaries and monthly expenses are counted for whole months only, so they are not included in a 7-day view.'}`,
        area: areaRef.current,
        tables: [
          { heading: 'Drivers compared', head: driverHead, rows: driverRows.map((x) => fmtRow(x, 2)), totalsRow: fmtRow(driverTotal, 2), numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
          { heading: `Money still to collect (${r.toCollect.length})`, head: ['Date', 'Driver', 'Route', 'Rent', 'Received', 'Due'], rows: collectRows.map((x) => fmtRow(x, 3)), totalsRow: ['', '', 'Total', '', '', fmtAmt(T.receivable)], numCols: [3, 4, 5] },
          { heading: `All trips and expenses in this period (${r.es.length})`, head: ['Date', 'Driver', 'From', 'To / description', 'Rent', 'Received', 'Diesel', 'Toll', 'Maint.', 'Payment'], rows: tripRows.map((x) => fmtRow(x, 4)), totalsRow: ['Total', '', '', '', fmtAmt(T.work), fmtAmt(T.received), fmtAmt(T.diesel), fmtAmt(T.toll), fmtAmt(T.maintenance), ''], numCols: [4, 5, 6, 7, 8] }
        ]
      });
    } catch (e) {
      console.error(e);
    }
    setBusy('');
  }

  async function doExcel() {
    setBusy('xlsx');
    try {
      const sub = `${COMPANY_NAME} (Transport Division) · ${rangeNote(range)} · OMR`;
      await exportExcel(`${fileBase}.xlsx`, [
        {
          name: 'Summary', title: `Transport report · ${RANGES[range]}`, subtitle: sub, head: ['Measure', 'Amount (OMR)', 'Detail'], numCols: [1], widths: [26, 16, 44],
          rows: [
            ['Work amount', T.work, `${plural(T.trips, 'trip')}`],
            ['Received', T.received, `${T.work ? Math.round((T.received / T.work) * 100) : 0}% of work amount`],
            ['Receivable', T.receivable, plural(r.toCollect.length, 'trip') + ' not fully paid'],
            ['Diesel', T.diesel, ''], ['Toll + visa exit fee', T.toll, ''], ['Maintenance', T.maintenance, ''],
            ['Driver allowance', T.allowance, T.allowanceOpen ? `${fmtAmt(T.allowanceOpen)} not paid yet` : 'All paid'],
            ['Salaries (fixed part)', T.salary, r.wholeMonths ? 'Without driver allowance' : 'Not included in a 7-day view'], ['Other expenses', T.other, ''],
            ['Total expenses', T.expenses, ''], ['Profit', T.profit, `${margin}% of work amount`]
          ],
          boldRows: [8, 9]
        },
        { name: 'Drivers', title: 'Drivers compared', subtitle: sub, head: driverHead, rows: driverRows, totalsRow: driverTotal, numCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], widths: [16, 8, 11, 11, 10, 10, 13, 13, 13, 12, 10, 12, 12] },
        { name: 'Months', title: 'Month by month', subtitle: sub, head: ['Month', 'Work amount', 'Expenses', 'Profit'], rows: r.byMonth.map((x) => [monthLabel(x.m), x.work, x.cost, x.profit]), numCols: [1, 2, 3], widths: [18, 14, 14, 14] },
        { name: 'Routes', title: 'Routes', subtitle: sub, head: ['Route', 'Trips', 'Rent total', 'Average rent'], rows: r.topRoutes.map((x) => [x.label, x.trips, x.rent, num(x.rent / x.trips)]), numCols: [1, 2, 3], widths: [36, 8, 12, 12] },
        { name: 'To collect', title: 'Money still to collect', subtitle: sub, head: ['Date', 'Driver', 'Route', 'Rent', 'Received', 'Due'], rows: collectRows, totalsRow: ['', '', 'Total', '', '', T.receivable], numCols: [3, 4, 5], widths: [14, 14, 32, 10, 10, 10] },
        { name: 'Trips', title: `All trips · ${RANGES[range]}`, subtitle: sub, head: ['Date', 'Driver', 'From', 'To / description', 'Rent', 'Received', 'Diesel', 'Toll', 'Maintenance', 'Payment'], rows: tripRows, numCols: [4, 5, 6, 7, 8], widths: [13, 13, 16, 30, 9, 9, 9, 9, 11, 14] }
      ]);
    } catch (e) {
      console.error(e);
    }
    setBusy('');
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <button type="button" className="btn" onClick={doPdf} disabled={!!busy}>{busy === 'pdf' ? 'Preparing PDF...' : '⬇ Download PDF'}</button>
          <button type="button" className="btn ghost" onClick={doExcel} disabled={!!busy}>{busy === 'xlsx' ? 'Preparing...' : '⬇ Export to Excel'}</button>
        </div>
      </div>

      <div className="rp-head">
        <div>
          <h1>Transport Reports</h1>
          <p className="sub">{COMPANY_NAME} (Transport Division) · all amounts in OMR</p>
        </div>
      </div>

      <div className="rp-filters" role="group" aria-label="Report period">
        {RANGE_KEYS.map((k) => (
          <button key={k} type="button" className={`rp-chip ${range === k ? 'active' : ''}`} onClick={() => setRange(k)} aria-pressed={range === k}>{RANGES[k]}</button>
        ))}
        <RangeReport title="Transport report" company="Modern City for Express Services LLC · Transport Division" landscape className="rp-chip rr-chip"
          build={(from, to) => transportReport({ entries, drivers: drivers || [], salaries, extras, from, to })} label="📅 From date to date · Print" />
      </div>
      <p className="rp-range-note">
        {rangeNote(range)} {r.wholeMonths ? 'Salaries and monthly expenses are included for each month in the period.' : 'Salaries and monthly expenses count for whole months only, so they are left out of a 7-day view.'}
      </p>

      <div ref={areaRef} style={{ display: 'grid', gap: 12 }}>
        <div className="rp-tiles">
          <div className="rp-tile"><div className="rp-tile-label">💰 Work amount</div><div className="rp-tile-num">{fmtAmt(T.work)}</div><div className="rp-tile-sub">{plural(T.trips, 'trip')}{T.trips ? ` · average ${fmtAmt(num(T.work / T.trips))}` : ''}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">✅ Received</div><div className="rp-tile-num">{fmtAmt(T.received)}</div><div className="rp-tile-sub">{T.work ? Math.round((T.received / T.work) * 100) : 0}% of work amount</div></div>
          <div className="rp-tile"><div className="rp-tile-label">⏳ Still to collect</div><div className={`rp-tile-num ${T.receivable > 0 ? 'neg' : ''}`}>{fmtAmt(T.receivable)}</div><div className="rp-tile-sub">{r.toCollect.length ? `${plural(r.toCollect.length, 'trip')} not fully paid` : 'Everything collected'}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🧾 Total expenses</div><div className="rp-tile-num">{fmtAmt(T.expenses)}</div><div className="rp-tile-sub">Diesel {fmtAmt(T.diesel)} · Salary {fmtAmt(T.salary)}</div></div>
          <div className="rp-tile hero"><div className="rp-tile-label">📈 Profit</div><div className="rp-tile-num">{fmtAmt(T.profit)}</div><div className="rp-tile-sub">{margin}% of work amount</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🛣 Top route</div><div className="rp-tile-num" style={{ fontSize: 18 }}>{topRoute ? topRoute.label : '-'}</div><div className="rp-tile-sub">{topRoute ? `${plural(topRoute.trips, 'trip')} · ${fmtAmt(topRoute.rent)} OMR` : 'No trips yet'}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">⛽ Diesel per trip</div><div className="rp-tile-num">{T.trips ? fmtAmt(num(T.diesel / T.trips)) : 0}</div><div className="rp-tile-sub">{fmtAmt(T.diesel)} OMR diesel in total</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🏆 Most profit</div><div className="rp-tile-num" style={{ fontSize: 20 }}>{topDriver && T.work ? topDriver.d.name : '-'}</div><div className="rp-tile-sub">{topDriver && T.work ? `${fmtAmt(topDriver.profit)} OMR profit · ${plural(topDriver.trips, 'trip')}` : 'No trips yet'}</div></div>
        </div>

        <div className="rp-grid">
          <div className="rp-card">
            <div className="rp-card-title">Where the money goes</div>
            <div className="rp-takeaway">{T.expenses ? `${biggestCost.label} is the biggest cost: ${Math.round((biggestCost.value / T.expenses) * 100)}% of all expenses.` : 'No expenses in this period.'}</div>
            <Donut slices={costSlices} fmt={(v) => `${fmtAmt(v)} OMR`} centerBig={fmtAmt(Math.round(T.expenses))} centerSmall="OMR spent" />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Work amount by driver</div>
            <div className="rp-takeaway">{T.work ? `${topWork.d.name} brought in ${Math.round((topWork.work / T.work) * 100)}% of the work amount.` : 'No trips in this period.'}</div>
            <Donut slices={driverSlices} fmt={(v) => `${fmtAmt(v)} OMR`} centerBig={fmtAmt(Math.round(T.work))} centerSmall="OMR work" />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Profit each month <span className="rp-card-note">· all months</span></div>
            <div className="rp-takeaway">{bestMonth >= 0 ? `Best month: ${monthLabel(r.byMonth[bestMonth].m)} with ${fmtAmt(r.byMonth[bestMonth].profit)} OMR profit.` : 'No data yet.'}</div>
            <Bars labels={r.byMonth.map((x) => x.label)} values={r.byMonth.map((x) => x.profit)} highlight={bestMonth} labelAll fmt={(v) => fmtAmt(Math.round(v))} />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Work amount and expenses each month</div>
            <div className="rp-takeaway">{r.byMonth.length ? `The gap between the two bars is the profit.` : 'No data yet.'}</div>
            <PairBars labels={r.byMonth.map((x) => x.label)} a={r.byMonth.map((x) => x.work)} b={r.byMonth.map((x) => x.cost)} aLabel="Work amount" bLabel="Expenses" fmt={(v) => `${fmtAmt(v)} OMR`} />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Top routes by rent</div>
            <div className="rp-takeaway">{topRoute ? `${topRoute.label} earns the most: ${fmtAmt(topRoute.rent)} OMR from ${plural(topRoute.trips, 'trip')}.` : 'No trips in this period.'}</div>
            <HBars rows={r.topRoutes.slice(0, 8).map((x) => ({ label: x.label, value: x.rent, sub: `· ${plural(x.trips, 'trip')}` }))} fmt={(v) => fmtAmt(v)} />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Money still to collect</div>
            <div className="rp-takeaway">{r.toCollect.length ? `${fmtAmt(T.receivable)} OMR is still due from ${plural(r.toCollect.length, 'trip')}.` : 'Everything in this period is collected.'}</div>
            <div className="table-wrap">
              <table className="rp-block-table">
                <thead><tr><th>Date</th><th>Driver</th><th>Route</th><th className="num">Due</th></tr></thead>
                <tbody>
                  {r.toCollect.slice(0, 8).map((e, i) => (
                    <tr key={e.id} className={i === 0 ? 'top' : ''}>
                      <td>{fmtFullDate(e.entry_date)}</td>
                      <td>{driverName(e.driver_id)}</td>
                      <td>{clean(e.from_place)} → {clean(e.to_place)}</td>
                      <td className="num neg"><b>{fmtAmt(e.due)}</b></td>
                    </tr>
                  ))}
                  {r.toCollect.length > 0 && <tr className="sum"><td colSpan={3}>Total due</td><td className="num">{fmtAmt(T.receivable)}</td></tr>}
                  {r.toCollect.length === 0 && <tr><td colSpan={4} className="muted">Nothing due.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rp-card rp-wide">
            <div className="rp-card-title">Drivers compared</div>
            <div className="rp-takeaway">{T.work ? `${topDriver.d.name} made the most profit: ${fmtAmt(topDriver.profit)} OMR.` : 'No trips in this period.'}</div>
            <p className="rp-card-note" style={{ margin: '0 0 8px' }}>Salary = fixed salary + driver allowance of the trips in this period (paid or not), shown under it.</p>
            <div className="table-wrap">
              <table className="rp-block-table">
                <thead>
                  <tr><th>Driver</th><th className="num">Trips</th><th className="num">Work</th><th className="num">Diesel</th><th className="num">Diesel / trip</th><th className="num">Toll</th><th className="num">Maint.</th><th className="num">Salary</th><th className="num">Other</th><th className="num">Profit</th></tr>
                </thead>
                <tbody>
                  {r.perDriver.map((x) => (
                    <tr key={x.d.id} className={T.work && x.d.id === topDriver.d.id ? 'top' : ''}>
                      <td><span className="rp-leg-dot" style={{ background: x.color, display: 'inline-block', marginRight: 8, verticalAlign: -1 }} />{x.d.name}<br /><small className="muted">{x.d.vehicle_no}</small></td>
                      <td className="num">{x.trips}</td>
                      <td className="num">{fmtAmt(x.work)}</td>
                      <td className="num">{fmtAmt(x.diesel)}</td>
                      <td className="num">{fmtAmt(x.dieselPerTrip)}</td>
                      <td className="num">{fmtAmt(x.toll)}</td>
                      <td className="num">{fmtAmt(x.maintenance)}</td>
                      <td className="num"><SalaryCell salary={x.salary} allowance={x.allowance} open={x.allowanceOpen} /></td>
                      <td className="num">{fmtAmt(x.other)}</td>
                      <td className={`num ${x.profit < 0 ? 'neg' : ''}`}><b>{fmtAmt(x.profit)}</b></td>
                    </tr>
                  ))}
                  <tr className="sum">
                    <td>Total</td><td className="num">{T.trips}</td><td className="num">{fmtAmt(T.work)}</td><td className="num">{fmtAmt(T.diesel)}</td>
                    <td className="num">{T.trips ? fmtAmt(num(T.diesel / T.trips)) : 0}</td><td className="num">{fmtAmt(T.toll)}</td><td className="num">{fmtAmt(T.maintenance)}</td>
                    <td className="num"><SalaryCell salary={T.salary} allowance={T.allowance} open={T.allowanceOpen} /></td><td className="num">{fmtAmt(T.other)}</td><td className="num">{fmtAmt(T.profit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return <AuthGate wide><TransportReports /></AuthGate>;
}
