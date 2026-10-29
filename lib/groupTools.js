/*
  Group Summary tools (top tabs of /expenses/summary, 29 Oct 2026):
  🧾 VAT return · 💵 Cash forecast (next 30 days) · 🔍 Checks (double entries, odd amounts).
  Pure functions: the page passes the loaded data.
*/
import { salaryDue, staffBalance } from '@/lib/payBalance';
import { staffNet } from '@/lib/expenses';

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const mk = (d) => String(d || '').slice(0, 7);
const day = (d) => String(d || '').slice(0, 10);
export const dmy = (d) => (d ? day(d).split('-').reverse().join('/') : '');
export function addDays(iso, k) {
  const d = new Date(`${day(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((new Date(`${day(b)}T00:00:00Z`) - new Date(`${day(a)}T00:00:00Z`)) / 86400000);
const AUTO_KINDS = ['trip', 'salary', 'extra', 'maint', 'receipt'];

/* ---------- 🧾 VAT return (one quarter) ---------- */
export function quarterOf(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
export function quarterMonths(q) {
  const [y, qq] = q.split('-Q').map(Number);
  return [0, 1, 2].map((i) => `${y}-${String((qq - 1) * 3 + i + 1).padStart(2, '0')}`);
}
export function quarterLabel(q) {
  const ms = quarterMonths(q);
  const name = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${q.replace('-', ' ')} (${name(ms[0])} to ${name(ms[2])} ${q.slice(0, 4)})`;
}
export function vatReturn({ salesAll = [], picked = [], quarter }) {
  const months = quarterMonths(quarter);
  const s = salesAll.filter((x) => months.includes(x.month));
  const b = picked.filter((l) => months.includes(l.month) && l.src !== 'transport');
  const sum = (arr, f) => r3(arr.reduce((t, x) => t + f(x), 0));
  const taxed = s.filter((x) => n(x.vat) > 0);
  const zero = s.filter((x) => !(n(x.vat) > 0));
  const out = {
    quarter, months,
    salesTaxedNet: sum(taxed, (x) => n(x.amount) - n(x.vat)),
    outputVat: sum(taxed, (x) => n(x.vat)),
    salesNoVat: sum(zero, (x) => n(x.amount)),
    purchases: sum(b, (l) => n(l.amount) + n(l.unpaid)),
    inputVat: sum(b, (l) => n(l.vat)),
    taxedCount: taxed.length, zeroCount: zero.length, billsWithVat: b.filter((l) => n(l.vat) > 0).length,
    byMonth: months.map((m) => ({
      month: m,
      sales: sum(s.filter((x) => x.month === m), (x) => n(x.amount)),
      outputVat: sum(s.filter((x) => x.month === m), (x) => n(x.vat)),
      inputVat: sum(b.filter((l) => l.month === m), (l) => n(l.vat))
    }))
  };
  out.netVat = r3(out.outputVat - out.inputVat);
  const end = new Date(Date.UTC(Number(months[2].slice(0, 4)), Number(months[2].slice(5, 7)), 0)).toISOString().slice(0, 10);
  out.periodEnd = end;
  out.fileBy = addDays(end, 30); // Oman: return and payment within 30 days after the tax period
  return out;
}

/* ---------- 💵 Cash forecast: next 30 days ---------- */
export const WEEKS = [
  { label: 'This week (and overdue)', from: -99999, to: 7 },
  { label: 'Week 2', from: 8, to: 14 },
  { label: 'Week 3', from: 15, to: 21 },
  { label: 'Week 4', from: 22, to: 30 }
];
export function cashForecast({ data, pick = [], today, opening = 0, labelOf = (k) => k, driverName = () => '' }) {
  const hasT = pick.includes('transport');
  const mc = pick.includes('modern-city');
  const items = [];
  const push = (dir, kind, date, amount, text, extra = {}) => {
    if (!(n(amount) > 0.0005)) return;
    const due = day(date) < day(today) ? day(today) : day(date);
    items.push({ dir, kind, date: due, wasDue: day(date), overdue: day(date) < day(today), amount: r3(amount), text, ...extra });
  };
  // money IN: trip balances, expected 30 days after the trip (credit time)
  if (hasT) {
    for (const e of data.te || []) {
      const bal = r3(n(e.rent) - n(e.received));
      if (bal > 0) push('in', 'Trip to collect', addDays(e.entry_date, 30), bal, `${[e.from_place, e.to_place].filter(Boolean).join(' > ') || e.description || 'Trip'}${e.customer ? ` · ${e.customer}` : ''}${driverName(e.driver_id) ? ` · ${driverName(e.driver_id)}` : ''}`);
    }
  }
  // money OUT: vehicle maintenance not paid (PDC cheques on their date)
  if (hasT || mc) {
    for (const m of data.maint || []) {
      if (/paid/i.test(m.status || '') && !/pend/i.test(m.status || '')) continue;
      push('out', m.payment_method === 'PDC' ? 'PDC cheque' : 'Maintenance to pay', m.pdc_date || m.work_date || today, m.amount, `${m.work || 'Maintenance'}${m.paid_to ? ` · ${m.paid_to}` : ''}`);
    }
  }
  // unpaid bills of the chosen companies (not the auto copies from Transport), due 30 days after the bill
  for (const b of data.exp || []) {
    if (!pick.includes(b.company) || AUTO_KINDS.includes(b.source_kind) || !(n(b.unpaid) > 0)) continue;
    push('out', 'Unpaid bill', addDays(b.entry_date, 30), b.unpaid, `${labelOf(b.company)} · ${b.description || b.head || 'Bill'}${b.bill_no ? ` · ${b.bill_no}` : ''}`);
  }
  // driver salaries not fully paid: due early next month
  if (hasT) {
    for (const s of data.ts || []) {
      const due = salaryDue(s);
      if (due == null || due <= 0.0005) continue;
      const [y, m] = mk(s.month).split('-').map(Number);
      push('out', 'Driver salary', new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10), due, `${driverName(s.driver_id) || 'Driver'} · ${mk(s.month)}`);
    }
  }
  // office staff salary balance: due on the 5th of next month
  const nextPay = (() => { const [y, m] = mk(today).split('-').map(Number); return new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10); })();
  for (const s of data.staff || []) {
    if (s.active === false || !pick.includes(s.company)) continue;
    const bal = staffBalance(s, staffNet(s));
    if (bal != null && bal > 0.0005) push('out', 'Staff salary', nextPay, bal, `${s.name} · ${labelOf(s.company)}`);
  }
  const later = items.filter((x) => daysBetween(today, x.date) > 30);
  const soon = items.filter((x) => daysBetween(today, x.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));
  let bal = r3(opening);
  const weeks = WEEKS.map((w) => {
    const its = soon.filter((x) => { const d = daysBetween(today, x.date); return d >= w.from && d <= w.to; });
    const inn = r3(its.filter((x) => x.dir === 'in').reduce((t, x) => t + x.amount, 0));
    const out = r3(its.filter((x) => x.dir === 'out').reduce((t, x) => t + x.amount, 0));
    bal = r3(bal + inn - out);
    return { ...w, from: addDays(today, Math.max(0, w.from)), to: addDays(today, w.to), in: inn, out, net: r3(inn - out), balance: bal, items: its };
  });
  const T = { in: r3(weeks.reduce((t, w) => t + w.in, 0)), out: r3(weeks.reduce((t, w) => t + w.out, 0)) };
  T.net = r3(T.in - T.out);
  const lowest = weeks.reduce((m, w) => (w.balance < m.balance ? w : m), weeks[0]);
  return { weeks, items: soon, later, T, opening: r3(opening), end: bal, lowest, overdueOut: r3(soon.filter((x) => x.dir === 'out' && x.overdue).reduce((t, x) => t + x.amount, 0)) };
}

/* ---------- 🔍 Checks: double entries and odd amounts ---------- */
export function checks({ data, pick = [], today, labelOf = (k) => k, driverName = () => '' }) {
  const out = [];
  const hasT = pick.includes('transport');
  // 1. same bill number twice in one company
  const bills = (data.exp || []).filter((b) => pick.includes(b.company) && !AUTO_KINDS.includes(b.source_kind));
  const byNo = {};
  bills.filter((b) => String(b.bill_no || '').trim()).forEach((b) => { const k = `${b.company}|${String(b.bill_no).trim().toLowerCase()}`; (byNo[k] = byNo[k] || []).push(b); });
  Object.values(byNo).filter((l) => l.length > 1).forEach((l) => out.push({ level: 'bad', icon: '📄', title: `Bill No ${l[0].bill_no} entered ${l.length} times (${labelOf(l[0].company)})`, lines: l.map((b) => `${dmy(b.entry_date)} · ${b.description || b.head || ''} · ${r3(n(b.paid) + n(b.unpaid)).toFixed(3)}`) }));
  // 2. same amount on the same day in one company (possible double entry)
  const bySame = {};
  // same company, same day, same amount (20 OMR or more) and the same description
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  bills.forEach((b) => { const amt = r3(n(b.paid) + n(b.unpaid)); if (amt < 20) return; const k = `${b.company}|${day(b.entry_date)}|${amt}|${norm(b.description)}`; (bySame[k] = bySame[k] || []).push(b); });
  Object.values(bySame).filter((l) => l.length > 1).forEach((l) => {
    const sameNo = l.every((b) => String(b.bill_no || '').trim() && String(b.bill_no).trim() === String(l[0].bill_no).trim());
    if (sameNo) return; // already in check 1
    out.push({ level: 'warn', icon: '👯', title: `${l.length} bills of ${r3(n(l[0].paid) + n(l[0].unpaid)).toFixed(3)} on ${dmy(l[0].entry_date)} (${labelOf(l[0].company)})`, lines: l.map((b) => `${b.bill_no || 'no bill no'} · ${b.description || b.head || ''}`) });
  });
  if (hasT) {
    // 3. maintenance on a trip sheet AND on the Vehicles page with the same amount within 31 days
    const tripM = (data.te || []).filter((e) => n(e.maintenance) > 0);
    for (const m of data.maint || []) {
      const twin = tripM.find((e) => Math.abs(n(e.maintenance) - n(m.amount)) < 0.001 && Math.abs(daysBetween(e.entry_date, m.work_date || e.entry_date)) <= 31);
      if (twin) out.push({ level: 'bad', icon: '🔧', title: `Maintenance ${n(m.amount).toFixed(3)} may be entered twice`, lines: [`Trip sheet ${dmy(twin.entry_date)} · ${driverName(twin.driver_id)} · ${twin.description || ''}`, `Vehicles page ${dmy(m.work_date)} · ${m.work || ''}${m.paid_to ? ` · ${m.paid_to}` : ''}`] });
    }
    // 4. diesel far above the driver's normal per trip
    const trips = (data.te || []).filter((e) => n(e.rent) > 0 && n(e.diesel) > 0);
    const byD = {};
    trips.forEach((e) => { (byD[e.driver_id] = byD[e.driver_id] || []).push(e); });
    Object.entries(byD).forEach(([id, l]) => {
      if (l.length < 4) return;
      const avg = l.reduce((t, e) => t + n(e.diesel), 0) / l.length;
      l.filter((e) => n(e.diesel) > avg * 1.6 && n(e.diesel) - avg > 15).forEach((e) => out.push({ level: 'warn', icon: '⛽', title: `High diesel ${n(e.diesel).toFixed(3)} on ${dmy(e.entry_date)} (${driverName(id)})`, lines: [`Normal for this driver about ${avg.toFixed(3)} per trip`, `${[e.from_place, e.to_place].filter(Boolean).join(' > ')}`] }));
    });
    // 5. received more than the rent
    (data.te || []).filter((e) => n(e.received) > n(e.rent) + 0.0005).forEach((e) => out.push({ level: 'bad', icon: '❗', title: `Received ${n(e.received).toFixed(3)} is more than rent ${n(e.rent).toFixed(3)} (${dmy(e.entry_date)})`, lines: [`${driverName(e.driver_id)} · ${[e.from_place, e.to_place].filter(Boolean).join(' > ')}`] }));
    // 6. money not received after 60 days
    const old = (data.te || []).filter((e) => n(e.rent) - n(e.received) > 0.0005 && daysBetween(e.entry_date, today) > 60);
    if (old.length) out.push({ level: 'warn', icon: '⏳', title: `${old.length} trip${old.length === 1 ? '' : 's'} not paid after 60 days: ${r3(old.reduce((t, e) => t + n(e.rent) - n(e.received), 0)).toFixed(3)} OMR`, lines: old.map((e) => `${dmy(e.entry_date)} · ${driverName(e.driver_id)} · ${[e.from_place, e.to_place].filter(Boolean).join(' > ')} · ${r3(n(e.rent) - n(e.received)).toFixed(3)}`) });
    // 7. trip with rent but no diesel at all
    const noDiesel = (data.te || []).filter((e) => n(e.rent) > 0 && !(n(e.diesel) > 0) && mk(e.entry_date) >= mk(addDays(today, -60)));
    if (noDiesel.length) out.push({ level: 'info', icon: '🛢', title: `${noDiesel.length} recent trip${noDiesel.length === 1 ? '' : 's'} with no diesel entered`, lines: noDiesel.map((e) => `${dmy(e.entry_date)} · ${driverName(e.driver_id)} · ${[e.from_place, e.to_place].filter(Boolean).join(' > ')}`) });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
