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
  for (const s of data.ts || []) out.push({ src: 'transport', dept: 'Transport', date: s.month, month: mk(s.month), head: 'Salary', amount: salaryPayable(s), allow: r3(n(s.trip_allowance) + n(s.allowance_carried)), desc: `Driver salary${drv[s.driver_id] ? ` · ${drv[s.driver_id]}` : ''}` });
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

/* Company invoices (company_docs kind 'invoice') as sales lines: subtotal of items + VAT % = total */
export function buildDocSales(docs = []) {
  return docs.filter((d) => d.kind === 'invoice' && d.doc_date).map((d) => {
    const sub = r3((Array.isArray(d.items) ? d.items : []).reduce((t, it) => t + n(it.amount), 0));
    const vat = r3((sub * n(d.vat_pct)) / 100);
    return { src: d.company || 'modern-city', kind: 'invoice', date: d.doc_date, month: mk(d.doc_date), ref: d.doc_no || '', party: d.party || '', amount: r3(sub + vat), vat, received: null };
  }).filter((x) => x.amount);
}

export function periodLabelOf(period, monthLabel) {
  return period === 'all' ? 'All months' : period.length === 4 ? `Year ${period}` : monthLabel(period);
}

/*
  Everything the Group Summary shows.
  opts: { lines, income, budgets, pick, period, today }
*/
export function computeGroup({ lines, income, budgets = [], pick, period, today, docSales = [] }) {
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
      // Profit: salary is NOT subtracted (client rule). Salary lines carry the driver allowance, so it is taken per trip instead.
      row.salary = sum(ls.filter((l) => l.head === 'Salary'));
      row.allowance = r3(inc.reduce((t, i) => t + n(i.allowance), 0));
      row.profit = r3(row.workNet - (row.spent - row.salary) - row.allowance);
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

  // 💰 SALES: everything earned = Transport trips (work amount) + company invoices
  const salesAll = [
    ...(hasT ? income.filter((i) => i.work > 0).map((i) => ({ src: 'transport', kind: 'trip', date: i.date, month: i.month, ref: '', party: i.route || 'Trip', driver: i.driver, amount: i.work, vat: n(i.vat), received: i.received })) : []),
    ...docSales.filter((d) => pick.includes(d.src))
  ];
  const sales = computeSales({ salesAll, chosen, inPeriod, periodMonths });
  const pl = computePL({ picked, income, months: periodMonths, hasT, salesAll });

  return { months, chosen, sel, perSource, grand, heads, byMonth, periodMonths, prevPeriod, prevSpent, change, nMonths, budgetHeads, budgetTotal, overBudget, cash, owed, unpaidBills, ageing, unpaidAll, yoy, alerts, pl, sales, salesAll, picked };
}

/*
  📑 Profit and Loss statement for the chosen companies and period.
  Columns: one per month (last 12 of the period) + Total, or only Total for one month.
  Income: Transport work amount, less VAT 5% inside it. Direct costs: transport diesel, toll, maintenance,
  other, driver allowance (per trip). Gross profit = salary NOT subtracted (client rule, same as the app's Profit).
  Then salaries and company bills (paid + unpaid, i.e. when the bill is entered) give the net result, then 15% tax estimate.
  Row kinds: head, line, total, result, memo.
*/
/* 💰 Sales sheet: per company/source, per month, the sales lines (newest first) */
export function computeSales({ salesAll = [], chosen = [], inPeriod, periodMonths = [] }) {
  const list = salesAll.filter((x) => inPeriod(x.month)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const sum = (arr, k) => r3(arr.reduce((t, x) => t + n(x[k]), 0));
  const rows = [...chosen].sort((a, b) => (a.kind === 'transport' ? -1 : b.kind === 'transport' ? 1 : 0)).map((s) => {
    const ls = list.filter((x) => x.src === s.key);
    const tracked = ls.filter((x) => x.received != null);
    const amount = sum(ls, 'amount');
    const vat = sum(ls, 'vat');
    const received = sum(tracked, 'received');
    return { key: s.key, label: s.kind === 'transport' ? 'Transport (trips)' : `${s.label} (invoices)`, count: ls.length, amount, vat, net: r3(amount - vat), received, toCollect: r3(sum(tracked, 'amount') - received), tracked: tracked.length === ls.length };
  });
  const T = { count: list.length, amount: sum(rows, 'amount'), vat: sum(rows, 'vat'), net: sum(rows, 'net'), received: sum(rows, 'received'), toCollect: sum(rows, 'toCollect') };
  const cols = periodMonths.length > 1 ? periodMonths.slice(-12) : periodMonths;
  const byMonth = cols.map((m) => ({ month: m, vals: rows.map((r) => sum(list.filter((x) => x.src === r.key && x.month === m), 'amount')), total: sum(list.filter((x) => x.month === m), 'amount') }));
  const parties = {};
  list.forEach((x) => { const k = x.party || 'Other'; parties[k] = parties[k] || { party: k, count: 0, amount: 0 }; parties[k].count += 1; parties[k].amount = r3(parties[k].amount + n(x.amount)); });
  return { rows, T, cols, byMonth, list, top: Object.values(parties).sort((a, b) => b.amount - a.amount).slice(0, 8) };
}

export const PL_TAX = 15;
export function computePL({ picked = [], income = [], months = [], hasT = false, salesAll = [] }) {
  const cols = months.length > 1 ? months.slice(-12) : months;
  const inCols = (m) => cols.includes(m);
  const lines = picked.filter((l) => inCols(l.month));
  const inc = hasT ? income.filter((i) => inCols(i.month)) : [];
  const isSal = (h) => /salar/i.test(h || '');
  const amt = (l) => n(l.amount) + n(l.unpaid);
  const per = (fn) => { const v = cols.map((m) => r3(fn(m))); return { vals: v, total: r3(v.reduce((t, x) => t + x, 0)) }; };
  const sumL = (pred, f = amt) => (m) => lines.filter((l) => l.month === m && pred(l)).reduce((t, l) => t + f(l), 0);
  const sumI = (k) => (m) => inc.filter((i) => i.month === m).reduce((t, i) => t + n(i[k]), 0);
  const rows = [];
  const add = (kind, label, v, extra = {}) => { rows.push({ kind, label, ...(v || { vals: cols.map(() => null), total: null }), ...extra }); return v; };
  const minus = (a, b) => ({ vals: a.vals.map((x, i) => r3(x - b.vals[i])), total: r3(a.total - b.total) });
  const plus = (list) => ({ vals: cols.map((_, i) => r3(list.reduce((t, x) => t + x.vals[i], 0))), total: r3(list.reduce((t, x) => t + x.total, 0)) });

  // Sales (everything earned): Transport trips + company invoices
  add('head', 'Sales');
  const sl = salesAll.filter((x) => inCols(x.month));
  const srcs = [...new Set(sl.map((x) => x.src))].sort((a, b) => (a === 'transport' ? -1 : b === 'transport' ? 1 : a.localeCompare(b)));
  const salesBy = srcs.map((k) => ({ k, v: per((m) => sl.filter((x) => x.src === k && x.month === m).reduce((t, x) => t + n(x.amount), 0)) }));
  const nameOf = (k) => (k === 'transport' ? 'Transport (trips)' : `${(GROUP_SOURCES.find((s) => s.key === k) || { label: k }).label} (invoices)`);
  salesBy.forEach((x) => add('line', nameOf(x.k), x.v));
  if (!salesBy.length) add('line', 'No sales recorded for the chosen companies', null, { note: true });
  const work = plus(salesBy.map((x) => x.v));
  if (salesBy.length > 1) add('total', 'Total sales', work);
  const vat = per((m) => sl.filter((x) => x.month === m).reduce((t, x) => t + n(x.vat), 0));
  if (vat.total) add('line', 'Less: VAT 5% inside sales (kept aside)', { vals: vat.vals.map((x) => -x), total: -vat.total }, { neg: true });
  const income0 = add('total', 'Net sales (without VAT)', minus(work, vat));

  // Direct costs (Transport)
  const tLine = (h) => (l) => l.src === 'transport' && l.head === h;
  const direct = [];
  if (hasT) {
    add('head', 'Direct costs (Transport)');
    for (const h of ['Diesel', 'Toll + visa exit fee', 'Vehicle Running and Maintenance', 'Other (trailer rent etc.)']) {
      const v = per(sumL(tLine(h))); if (v.total) direct.push(add('line', h, v));
    }
    const al = per(sumI('allowance')); if (al.total) direct.push(add('line', 'Driver allowance (per trip)', al));
    add('total', 'Total direct costs', plus(direct));
  }
  const gross = add('result', 'Gross profit (salary not subtracted)', minus(income0, plus(direct)));

  // Salaries
  add('head', 'Salaries');
  const drvSal = per(sumL((l) => l.src === 'transport' && l.head === 'Salary', (l) => n(l.amount) - n(l.allow)));
  const coSal = per(sumL((l) => l.src !== 'transport' && isSal(l.head)));
  if (drvSal.total) add('line', 'Driver salaries (fixed, allowance counted above)', drvSal);
  if (coSal.total) add('line', 'Company salaries (bills)', coSal);
  if (!drvSal.total && !coSal.total) add('line', 'No salaries in this period', null, { note: true });
  const sal = add('total', 'Total salaries', plus([drvSal, coSal]));

  // Company bills by head (not salary)
  const coHeads = [...new Set(lines.filter((l) => l.src !== 'transport' && !isSal(l.head)).map((l) => l.head))];
  const coRows = coHeads.map((h) => ({ h, v: per(sumL((l) => l.src !== 'transport' && l.head === h)) })).filter((x) => x.v.total).sort((a, b) => b.v.total - a.v.total);
  let coTot = { vals: cols.map(() => 0), total: 0 };
  if (coRows.length) {
    add('head', 'Company expenses (bills, paid + unpaid)');
    coRows.forEach((x) => add('line', x.h, x.v));
    coTot = add('total', 'Total company expenses', plus(coRows.map((x) => x.v)));
  }

  const before = add('result', 'Net profit / (loss) before tax', minus(gross, plus([sal, coTot])), { big: true });
  const tax = { vals: before.vals.map((x) => (x > 0 ? r3((x * PL_TAX) / 100) : 0)), total: before.total > 0 ? r3((before.total * PL_TAX) / 100) : 0 };
  add('line', `Income tax ${PL_TAX}% (estimate, on profit only)`, { vals: tax.vals.map((x) => -x), total: -tax.total }, { neg: true });
  add('result', 'Net profit / (loss) after tax', minus(before, tax), { big: true });

  // VAT memo
  const vatBills = per(sumL(() => true, (l) => n(l.vat)));
  if (vat.total || vatBills.total) {
    add('head', 'VAT 5% (memo, not in profit)');
    add('memo', 'VAT inside sales (to pay to Tax Authority)', vat);
    add('memo', 'VAT paid on bills', vatBills);
    add('memo', 'VAT balance (work VAT minus bills VAT)', minus(vat, vatBills));
  }
  return { cols, rows, gross: gross.total, before: before.total, tax: tax.total, after: r3(before.total - tax.total) };
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
      // Profit: salary NOT subtracted (client rule); VAT kept aside; driver allowance per trip
      return { id, name: dName[id] || 'Driver', trips: t.length, work: w, received: sum(mine, 'received'), costs: c, salary: sal, profit: r3(w - sum(mine, 'vat') - c - sum(mine, 'allowance')), toCollect: r3(w - sum(mine, 'received')) };
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
