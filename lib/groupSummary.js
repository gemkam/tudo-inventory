// Group Summary calculations. Pure functions: used by the page, the PDF download and the monthly email.
import { salaryPayable, vatOf } from '@/lib/transport';

export const GROUP_SOURCES = [
  { key: 'modern-city', label: 'Modern City', full: 'MODERN CITY FOR EXPRESS SERVICES L.L.C', kind: 'company' },
  { key: 'abu-wasif', label: 'Abu Wasif', full: 'ABU WASIF AND ASSOCIATES L.L.C', kind: 'company' },
  { key: 'sumptuosity', label: 'Sumptuosity', full: 'SUMPTUOSITY TROPICAL L.L.C', kind: 'company' },
  { key: 'transport', label: 'Transport Expense', full: 'MODERN CITY FOR EXPRESS SERVICES L.L.C (Transport Division)', kind: 'transport' }
];
export const TRANSPORT_HEADS = ['Salary', 'Diesel', 'Toll + visa exit fee', 'Vehicle Running and Maintenance', 'Other (trailer rent etc.)'];

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const mk = (d) => String(d || '').slice(0, 7);

export function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  return Math.round((new Date(`${String(b).slice(0, 10)}T00:00:00Z`) - new Date(`${String(a).slice(0, 10)}T00:00:00Z`)) / 86400000);
}

/* data: { exp, te, ts, tx, drivers } -> one list of expense lines with details for drill down */
export function buildLines(data) {
  const drv = Object.fromEntries((data.drivers || []).map((d) => [d.id, d.name]));
  const out = (data.exp || []).map((r) => ({
    src: r.company || 'sumptuosity', date: r.entry_date, month: mk(r.entry_date), head: r.head || 'Other',
    amount: n(r.paid), unpaid: n(r.unpaid), vat: n(r.vat),
    ref: r.bill_no || '', desc: [r.description, r.category].filter(Boolean).join(' · '), dept: r.department || 'No department',
    // copied from Transport (trip costs, salary, other): skipped when Transport itself is also picked
    mirror: ['trip', 'salary', 'extra'].includes(r.source_kind)
  }));
  for (const r of data.te || []) {
    const m = mk(r.entry_date);
    const trip = [r.from_place, r.to_place].filter(Boolean).join(' to ') || r.description || 'Trip';
    const who = drv[r.driver_id] ? ` · ${drv[r.driver_id]}` : '';
    if (n(r.diesel)) out.push({ src: 'transport', dept: 'Transport', date: r.entry_date, month: m, head: 'Diesel', amount: n(r.diesel), desc: `${trip}${who}` });
    if (n(r.toll)) out.push({ src: 'transport', dept: 'Transport', date: r.entry_date, month: m, head: 'Toll + visa exit fee', amount: n(r.toll), desc: `${trip}${who}` });
    if (n(r.maintenance)) out.push({ src: 'transport', dept: 'Transport', date: r.entry_date, month: m, head: 'Vehicle Running and Maintenance', amount: n(r.maintenance), desc: `${trip}${who}` });
  }
  for (const s of data.ts || []) out.push({ src: 'transport', dept: 'Transport', date: s.month, month: mk(s.month), head: 'Salary', amount: salaryPayable(s), desc: `Driver salary${drv[s.driver_id] ? ` · ${drv[s.driver_id]}` : ''}` });
  for (const x of data.tx || []) if (n(x.amount)) out.push({ src: 'transport', dept: 'Transport', date: x.month, month: mk(x.month), head: 'Other (trailer rent etc.)', amount: n(x.amount), desc: x.description || x.notes || 'Other transport cost' });
  return out.filter((l) => l.month && (l.amount || l.unpaid || l.vat));
}

export function buildIncome(data) {
  return (data.te || []).map((r) => ({
    month: mk(r.entry_date), date: r.entry_date, work: n(r.rent), vat: vatOf(r), received: n(r.received),
    recMonth: mk(r.received_date || r.entry_date), recDate: r.received_date || null,
    driver: r.driver_id || null, costs: r3(n(r.diesel) + n(r.toll) + n(r.maintenance)), allowance: n(r.driver_allowance),
    route: [r.from_place, r.to_place].filter(Boolean).join(' to ')
  })).filter((i) => i.month);
}

export function periodLabelOf(period, monthLabel) {
  return period === 'all' ? 'All months' : period.length === 4 ? `Year ${period}` : monthLabel(period);
}

/*
  Everything the Group Summary shows.
  opts: { lines, income, budgets, pick, period, today }
*/
export function computeGroup({ lines, income, budgets = [], pick, period, today }) {
  const sum = (arr, k = 'amount') => r3(arr.reduce((t, x) => t + n(x[k]), 0));
  const months = [...new Set([...lines.map((l) => l.month), ...income.map((i) => i.month)])].filter(Boolean).sort();
  const inP = (p) => (m) => p === 'all' || (p.length === 4 ? m.startsWith(p) : m === p);
  const inPeriod = inP(period);
  const chosen = GROUP_SOURCES.filter((s) => pick.includes(s.key));
  const hasT = pick.includes('transport');
  const picked = lines.filter((l) => pick.includes(l.src) && !(hasT && l.mirror));
  const sel = picked.filter((l) => inPeriod(l.month));

  const perSource = chosen.map((s) => {
    const ls = sel.filter((l) => l.src === s.key);
    const row = { ...s, spent: sum(ls), unpaid: sum(ls, 'unpaid'), vat: sum(ls, 'vat'), count: ls.length };
    if (s.kind === 'transport') {
      const inc = income.filter((i) => inPeriod(i.month));
      row.work = r3(inc.reduce((t, i) => t + i.work, 0));
      row.received = r3(inc.reduce((t, i) => t + i.received, 0));
      row.vatIn = r3(inc.reduce((t, i) => t + n(i.vat), 0)); // VAT 5% inside the work amount (trips marked 'VAT 5% added')
      row.workNet = r3(row.work - row.vatIn);
      row.profit = r3(row.workNet - row.spent); // VAT is not income: kept aside
    }
    return row;
  });
  const grand = { spent: sum(perSource, 'spent'), unpaid: sum(perSource, 'unpaid'), vat: sum(perSource, 'vat'), vatIn: sum(perSource, 'vatIn') };

  const heads = [...new Set(sel.map((l) => l.head))]
    .map((h) => ({ head: h, vals: chosen.map((s) => sum(sel.filter((l) => l.head === h && l.src === s.key))), total: sum(sel.filter((l) => l.head === h)) }))
    .sort((a, b) => b.total - a.total);

  const periodMonths = months.filter(inPeriod);
  const byMonth = periodMonths.map((m) => ({ month: m, vals: chosen.map((s) => sum(sel.filter((l) => l.month === m && l.src === s.key))), total: sum(sel.filter((l) => l.month === m)) }));

  // previous period
  const prevPeriod = period === 'all' ? null : period.length === 4 ? String(Number(period) - 1) : shiftMonth(period, -1);
  const prevSel = prevPeriod ? picked.filter((l) => inP(prevPeriod)(l.month)) : [];
  const prevSpent = prevPeriod ? sum(prevSel) : null;
  const change = prevSpent ? Math.round(((grand.spent - prevSpent) / prevSpent) * 100) : null;

  // 1. budget vs actual (monthly budget x months in the period)
  const thisMonth = mk(today);
  let nMonths = 1;
  if (period === 'all') nMonths = Math.max(1, periodMonths.length);
  else if (period.length === 4) {
    const last = period === thisMonth.slice(0, 4) ? Number(thisMonth.slice(5, 7)) : 12;
    nMonths = Math.max(1, Math.min(12, period < thisMonth.slice(0, 4) ? 12 : last));
  }
  const bRows = budgets.filter((b) => pick.includes(b.source) && n(b.monthly) > 0);
  const budgetHeads = [...new Set(bRows.map((b) => b.head))].map((h) => {
    const budget = r3(bRows.filter((b) => b.head === h).reduce((t, b) => t + n(b.monthly), 0) * nMonths);
    const actual = sum(sel.filter((l) => l.head === h && bRows.some((b) => b.head === h && b.source === l.src)));
    return { head: h, budget, actual, left: r3(budget - actual), pct: budget ? Math.round((actual / budget) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct);
  const budgetTotal = { budget: r3(budgetHeads.reduce((t, b) => t + b.budget, 0)), actual: r3(budgetHeads.reduce((t, b) => t + b.actual, 0)) };
  const overBudget = budgetHeads.filter((b) => b.actual > b.budget);

  // 2. cash flow by month: money in (transport received, by received month) vs all money spent
  const cfMonths = (period === 'all' ? months : period.length === 4 ? months.filter((m) => m.startsWith(period)) : months.filter((m) => m <= period)).slice(-12);
  const cashIn = cfMonths.map((m) => (hasT ? r3(income.filter((i) => i.recMonth === m).reduce((t, i) => t + i.received, 0)) : 0));
  const cashOut = cfMonths.map((m) => sum(picked.filter((l) => l.month === m)));
  const cashNet = cfMonths.map((_, i) => r3(cashIn[i] - cashOut[i]));
  const cash = { months: cfMonths, in: cashIn, out: cashOut, net: cashNet, totalIn: r3(cashIn.reduce((t, v) => t + v, 0)), totalOut: r3(cashOut.reduce((t, v) => t + v, 0)) };
  cash.totalNet = r3(cash.totalIn - cash.totalOut);
  const owed = hasT ? r3(income.reduce((t, i) => t + i.work - i.received, 0)) : 0;

  // 4. unpaid bills ageing (all unpaid bills, any month)
  const unpaidBills = picked.filter((l) => l.unpaid > 0).map((l) => ({ ...l, age: daysBetween(l.date, today) })).sort((a, b) => b.age - a.age);
  const ageing = [
    { label: '0 to 30 days', min: -99999, max: 30 },
    { label: '31 to 60 days', min: 31, max: 60 },
    { label: '61 to 90 days', min: 61, max: 90 },
    { label: 'Over 90 days', min: 91, max: 99999 }
  ].map((b) => {
    const ls = unpaidBills.filter((l) => l.age >= b.min && l.age <= b.max);
    return { ...b, count: ls.length, amount: sum(ls, 'unpaid'), lines: ls };
  });
  const unpaidAll = sum(unpaidBills, 'unpaid');

  // 5. year on year: Jan..Dec this year vs last year (year of the chosen period)
  const yr = period === 'all' ? thisMonth.slice(0, 4) : period.slice(0, 4);
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yoy = {
    year: yr, prevYear: String(Number(yr) - 1), labels: MN,
    cur: MN.map((_, i) => sum(picked.filter((l) => l.month === `${yr}-${String(i + 1).padStart(2, '0')}`))),
    prev: MN.map((_, i) => sum(picked.filter((l) => l.month === `${Number(yr) - 1}-${String(i + 1).padStart(2, '0')}`)))
  };
  yoy.curTotal = r3(yoy.cur.reduce((t, v) => t + v, 0));
  yoy.prevTotal = r3(yoy.prev.reduce((t, v) => t + v, 0));
  yoy.hasPrev = yoy.prevTotal > 0;

  // 3. alerts (vehicle reminders are added by the page)
  const alerts = [];
  for (const b of overBudget) alerts.push({ level: 'bad', icon: '🚨', text: `${b.head} is over budget: ${fmt(b.actual)} of ${fmt(b.budget)} OMR (${b.pct}%).`, pick: { head: b.head } });
  for (const b of budgetHeads) if (b.actual <= b.budget && b.pct >= 85) alerts.push({ level: 'warn', icon: '⚠️', text: `${b.head} has used ${b.pct}% of its budget.`, pick: { head: b.head } });
  if (prevPeriod) {
    for (const h of heads) {
      const before = sum(prevSel.filter((l) => l.head === h.head));
      if (before >= 20 && h.total > before * 1.3) alerts.push({ level: 'warn', icon: '📈', text: `${h.head} is up ${Math.round(((h.total - before) / before) * 100)}% vs ${prevPeriod.length === 4 ? prevPeriod : 'last month'} (${fmt(before)} to ${fmt(h.total)} OMR).`, pick: { head: h.head } });
    }
  }
  const old = unpaidBills.filter((l) => l.age > 30);
  if (old.length) alerts.push({ level: 'bad', icon: '⏳', text: `${old.length} unpaid bill${old.length === 1 ? '' : 's'} older than 30 days: ${fmt(sum(old, 'unpaid'))} OMR.`, pick: { unpaidOld: true } });
  if (owed > 0) alerts.push({ level: 'info', icon: '💵', text: `Transport money still to receive: ${fmt(owed)} OMR.` });

  return { months, chosen, sel, perSource, grand, heads, byMonth, periodMonths, prevPeriod, prevSpent, change, nMonths, budgetHeads, budgetTotal, overBudget, cash, owed, unpaidBills, ageing, unpaidAll, yoy, alerts };
}

export function fmt(v) {
  return r3(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/*
  📊 Analytics for the Group Summary (uses the result of computeGroup).
  pace: average month, this month so far and forecast to month end
  movers: heads that changed most vs the previous period
  depts: spending by department, biggest: 10 biggest bills
  transport: trips, average rent / cost / margin per trip, collection rate, days to collect, per driver
*/
export function computeAnalytics({ G, lines, income, ts = [], drivers = [], pick, period, today }) {
  const sum = (arr, k = 'amount') => r3(arr.reduce((t, x) => t + n(x[k]), 0));
  const hasT = pick.includes('transport');
  const picked = lines.filter((l) => pick.includes(l.src) && !(hasT && l.mirror));
  const thisMonth = mk(today);
  const inP = (m) => period === 'all' || (period.length === 4 ? m.startsWith(period) : m === period);

  // spending pace: full months before this one (last 6 with spending)
  const monthTotals = [...new Set(picked.map((l) => l.month))].filter((m) => m < thisMonth).sort()
    .map((m) => ({ month: m, total: sum(picked.filter((l) => l.month === m)) })).filter((x) => x.total > 0).slice(-6);
  const avg = monthTotals.length ? r3(monthTotals.reduce((t, x) => t + x.total, 0) / monthTotals.length) : 0;
  const [y, mo] = thisMonth.split('-').map(Number);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const day = Number(String(today).slice(8, 10)) || 1;
  const cur = picked.filter((l) => l.month === thisMonth);
  const soFar = sum(cur);
  const fixed = sum(cur.filter((l) => /salary/i.test(l.head))); // salaries are booked once a month, not per day
  const forecast = r3(fixed + ((soFar - fixed) / day) * dim);
  const pace = { avg, months: monthTotals.length, soFar, forecast, day, dim, thisMonth, vsAvg: avg ? Math.round(((forecast - avg) / avg) * 100) : null };

  // biggest changes vs previous period, by head
  let movers = [];
  if (G.prevPeriod) {
    const inPrev = (m) => (G.prevPeriod.length === 4 ? m.startsWith(G.prevPeriod) : m === G.prevPeriod);
    const prev = picked.filter((l) => inPrev(l.month));
    const heads = [...new Set([...G.sel.map((l) => l.head), ...prev.map((l) => l.head)])];
    movers = heads.map((h) => {
      const now = sum(G.sel.filter((l) => l.head === h));
      const before = sum(prev.filter((l) => l.head === h));
      return { head: h, now, before, diff: r3(now - before), pct: before ? Math.round(((now - before) / before) * 100) : null };
    }).filter((x) => Math.abs(x.diff) >= 0.001).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 6);
  }

  // by department (all chosen companies, period)
  const deptNames = [...new Set(G.sel.map((l) => l.dept || 'No department'))];
  const depts = deptNames.map((d) => ({ dept: d, total: sum(G.sel.filter((l) => (l.dept || 'No department') === d)) }))
    .filter((d) => d.total > 0).sort((a, b) => b.total - a.total);

  const biggest = [...G.sel].filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // transport
  let transport = null;
  if (hasT) {
    const inc = income.filter((i) => inP(i.month));
    const trips = inc.filter((i) => i.work > 0);
    const work = sum(trips, 'work');
    const received = sum(inc, 'received');
    const costs = sum(inc, 'costs');
    const collected = trips.filter((i) => i.received > 0 && i.recDate);
    const days = collected.map((i) => Math.max(0, daysBetween(i.date, i.recDate)));
    const dName = Object.fromEntries(drivers.map((d) => [d.id, d.name]));
    const ids = [...new Set(inc.map((i) => i.driver).filter(Boolean))];
    const salOf = (id) => r3(ts.filter((x) => x.driver_id === id && inP(mk(x.month))).reduce((t, x) => t + salaryPayable(x), 0));
    const perDriver = ids.map((id) => {
      const mine = inc.filter((i) => i.driver === id);
      const t = mine.filter((i) => i.work > 0);
      const w = sum(t, 'work');
      const c = sum(mine, 'costs');
      const sal = salOf(id);
      return { id, name: dName[id] || 'Driver', trips: t.length, work: w, received: sum(mine, 'received'), costs: c, salary: sal, profit: r3(w - c - sal), toCollect: r3(w - sum(mine, 'received')) };
    }).sort((a, b) => b.work - a.work);
    const routes = {};
    trips.forEach((i) => { const k = i.route || 'No route'; routes[k] = routes[k] || { route: k, trips: 0, work: 0 }; routes[k].trips += 1; routes[k].work = r3(routes[k].work + i.work); });
    transport = {
      trips: trips.length, work, received, costs,
      avgRent: trips.length ? r3(work / trips.length) : 0,
      avgCost: trips.length ? r3(costs / trips.length) : 0,
      avgMargin: trips.length ? r3((work - costs) / trips.length) : 0,
      collectRate: work ? Math.round((received / work) * 100) : null,
      avgDays: days.length ? Math.round(days.reduce((t, v) => t + v, 0) / days.length) : null,
      slowest: days.length ? Math.max(...days) : null,
      perDriver,
      routes: Object.values(routes).sort((a, b) => b.trips - a.trips || b.work - a.work).slice(0, 5)
    };
  }
  return { pace, movers, depts, biggest, transport };
}
