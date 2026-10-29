/*
  Builders for the "📊 Report" button (components/RangeReport.js): each returns { summary, sections, count }
  for the dates chosen (from / to are 'YYYY-MM-DD', '' = no limit, both days included).
*/
import { inDates } from '@/components/RangeReport';
import { salaryPayable, vatOf } from '@/lib/transport';

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const sum = (list, k) => r3(list.reduce((t, x) => t + n(typeof k === 'function' ? k(x) : x[k]), 0));
const mk = (d) => String(d || '').slice(0, 7);
const monthIn = (m, from, to) => (!from || m >= mk(from)) && (!to || m <= mk(to));

/* Transport: one driver (driverId) or all drivers */
export function transportReport({ entries = [], drivers = [], salaries = [], extras = [], from, to, driverId }) {
  const name = Object.fromEntries(drivers.map((d) => [d.id, d.name]));
  const es = entries.filter((e) => (!driverId || e.driver_id === driverId) && inDates(e.entry_date, from, to))
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)) || (a.sort || 0) - (b.sort || 0));
  const trips = es.filter((e) => n(e.rent) > 0);
  const allow = sum(es, 'driver_allowance');
  const allowOpen = sum(es.filter((e) => e.allowance_status !== 'Paid'), 'driver_allowance');
  const costs = sum(es, (e) => n(e.diesel) + n(e.toll) + n(e.maintenance));
  const work = sum(es, 'rent');
  const received = sum(es, 'received');
  const vat = sum(es, vatOf); // VAT 5% inside the rent of trips marked 'VAT 5% added'
  const sal = salaries.filter((s) => (!driverId || s.driver_id === driverId) && monthIn(mk(s.month), from, to));
  const fixedSal = sum(sal, (s) => salaryPayable(s) - n(s.trip_allowance) - n(s.allowance_carried));
  const other = sum(extras.filter((x) => (!driverId || x.driver_id === driverId) && monthIn(mk(x.month), from, to)), 'amount');
  const net = r3(work - vat - costs - allow - fixedSal - other);

  const summary = [
    ['Trips', String(trips.length)], ['Work amount', work], ['VAT 5% (inside work, kept aside)', vat], ['Work without VAT', r3(work - vat)], ['Received', received], ['Still to collect', r3(work - received)],
    ['Driver allowance', allow], ['Allowance not paid', allowOpen], ['Diesel + toll + maint.', costs],
    ['Salaries (fixed, whole months)', fixedSal], ['Other expenses', other], ['Profit', net]
  ];
  const head = ['Date', ...(driverId ? [] : ['Driver']), 'From', 'To / description', 'Rent', 'VAT 5%', 'Received', 'Balance', 'Driver allow.', 'Allow. status', 'Diesel', 'Toll', 'Maint.', 'Payment'];
  const off = driverId ? 0 : 1;
  const rows = es.map((e) => [dmy(e.entry_date), ...(driverId ? [] : [name[e.driver_id] || '']), e.from_place || '', e.to_place || e.description || '',
    n(e.rent), vatOf(e), n(e.received), r3(n(e.rent) - n(e.received)), n(e.driver_allowance), n(e.driver_allowance) ? e.allowance_status || 'Not paid' : '',
    n(e.diesel), n(e.toll), n(e.maintenance), e.payment_status || '']);
  const totals = ['Total', ...(driverId ? [] : ['']), `${trips.length} trips`, '', work, vat, received, r3(work - received), allow, allowOpen ? `${r3(allowOpen)} not paid` : '', sum(es, 'diesel'), sum(es, 'toll'), sum(es, 'maintenance'), ''];
  const num = [3, 4, 5, 6, 7, 9, 10, 11].map((i) => i + off);
  const sections = [];
  if (!driverId) {
    const ids = [...new Set(es.map((e) => e.driver_id))];
    const per = ids.map((id) => {
      const de = es.filter((e) => e.driver_id === id);
      return [name[id] || 'Driver', de.filter((e) => n(e.rent) > 0).length, sum(de, 'rent'), sum(de, vatOf), sum(de, 'received'), r3(sum(de, 'rent') - sum(de, 'received')),
        sum(de, 'driver_allowance'), sum(de.filter((e) => e.allowance_status !== 'Paid'), 'driver_allowance'), sum(de, (e) => n(e.diesel) + n(e.toll) + n(e.maintenance))];
    });
    sections.push({ heading: 'By driver', head: ['Driver', 'Trips', 'Work', 'VAT 5%', 'Received', 'To collect', 'Driver allowance', 'Allowance not paid', 'Trip costs'], rows: per,
      totals: ['Total', trips.length, work, vat, received, r3(work - received), allow, allowOpen, costs], num: [2, 3, 4, 5, 6, 7, 8] });
  }
  sections.push({ heading: driverId ? `Trips · ${name[driverId] || ''}` : 'All trips', head, rows, totals, num });
  return { summary, sections, count: es.length };
}

/* Office Expense bills of one company */
export function expenseReport({ rows = [], from, to }) {
  const list = rows.filter((r) => inDates(r.entry_date, from, to)).sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
  const group = (key) => {
    const g = {};
    list.forEach((r) => { const k = r[key] || 'Other'; g[k] = g[k] || { paid: 0, unpaid: 0, vat: 0, c: 0 }; g[k].paid += n(r.paid); g[k].unpaid += n(r.unpaid); g[k].vat += n(r.vat); g[k].c += 1; });
    return Object.entries(g).sort((a, b) => b[1].paid - a[1].paid).map(([k, v]) => [k, v.c, r3(v.paid), r3(v.unpaid), r3(v.vat)]);
  };
  const T = { paid: sum(list, 'paid'), unpaid: sum(list, 'unpaid'), vat: sum(list, 'vat') };
  return {
    count: list.length,
    summary: [['Bills', String(list.length)], ['Paid', T.paid], ['Unpaid', T.unpaid], ['VAT', T.vat]],
    sections: [
      { heading: 'By head of account', head: ['Head of account', 'Bills', 'Paid', 'Unpaid', 'VAT'], rows: group('head'), totals: ['Total', list.length, T.paid, T.unpaid, T.vat], num: [2, 3, 4] },
      { heading: 'By department', head: ['Department', 'Bills', 'Paid', 'Unpaid', 'VAT'], rows: group('department'), totals: ['Total', list.length, T.paid, T.unpaid, T.vat], num: [2, 3, 4] },
      {
        heading: 'All bills', head: ['Date', 'Bill No', 'Description', 'Department', 'Head of account', 'Paid', 'Unpaid', 'VAT'],
        rows: list.map((r) => [dmy(r.entry_date), r.bill_no || '', [r.description, r.category].filter(Boolean).join(' · '), r.department || '', r.head || '', n(r.paid), n(r.unpaid), n(r.vat)]),
        totals: ['Total', '', `${list.length} bills`, '', '', T.paid, T.unpaid, T.vat], num: [5, 6, 7]
      }
    ]
  };
}

/* Group Summary lines (lib/groupSummary buildLines), chosen companies */
export function groupReport({ lines = [], pick = [], labelOf = (k) => k, from, to }) {
  const hasT = pick.includes('transport');
  const list = lines.filter((l) => pick.includes(l.src) && !(hasT && l.mirror) && inDates(l.date, from, to))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const by = (fn) => {
    const g = {};
    list.forEach((l) => { const k = fn(l); g[k] = g[k] || { a: 0, u: 0 }; g[k].a += n(l.amount); g[k].u += n(l.unpaid); });
    return Object.entries(g).sort((a, b) => b[1].a - a[1].a).map(([k, v]) => [k, r3(v.a), r3(v.u)]);
  };
  const spent = sum(list, 'amount');
  const unpaid = sum(list, 'unpaid');
  return {
    count: list.length,
    summary: [['Spent', spent], ['Unpaid', unpaid], ['VAT', sum(list, 'vat')], ['Lines', String(list.length)]],
    sections: [
      { heading: 'By company', head: ['Company', 'Spent', 'Unpaid'], rows: by((l) => labelOf(l.src)), totals: ['Total', spent, unpaid], num: [1, 2] },
      { heading: 'By head of account', head: ['Head of account', 'Spent', 'Unpaid'], rows: by((l) => l.head), totals: ['Total', spent, unpaid], num: [1, 2] },
      { heading: 'All lines', head: ['Date', 'Company', 'Head', 'Description', 'Spent', 'Unpaid'], rows: list.map((l) => [dmy(l.date), labelOf(l.src), l.head, l.desc || '', n(l.amount), n(l.unpaid)]), totals: ['Total', '', '', `${list.length} lines`, spent, unpaid], num: [4, 5] }
    ]
  };
}

const localDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* Inventory: stock in / out (stock_moves) and bills paid (bill_payments) */
export function inventoryReport({ cats = [], moves = [], bills = [], from, to }) {
  const byId = {};
  cats.forEach((c) => (c.items || []).forEach((i) => { byId[i.id] = { ...i, category: c.name }; }));
  const pm = moves.filter((m) => byId[m.item_id] && inDates(localDay(m.created_at), from, to)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const pb = bills.filter((b) => inDates(b.paid_on, from, to)).sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));
  const per = {};
  pm.forEach((m) => { const it = byId[m.item_id]; const k = it.id; per[k] = per[k] || { name: it.name, cat: it.category, unit: it.unit || '', inQ: 0, outQ: 0 }; if (m.move_type === 'in') per[k].inQ += n(m.qty); else if (m.move_type === 'out') per[k].outQ += n(m.qty); });
  const billBy = {};
  pb.forEach((b) => { const k = b.bill_accounts?.name || 'Other'; billBy[k] = r3((billBy[k] || 0) + n(b.amount)); });
  const billTotal = sum(pb, 'amount');
  const inQ = pm.filter((m) => m.move_type === 'in').reduce((t, m) => t + n(m.qty), 0);
  const outQ = pm.filter((m) => m.move_type === 'out').reduce((t, m) => t + n(m.qty), 0);
  return {
    count: pm.length + pb.length,
    summary: [['Stock in (qty)', String(inQ)], ['Stock out (qty)', String(outQ)], ['Movements', String(pm.length)], ['Bills paid', billTotal]],
    sections: [
      { heading: 'Used and added per item', head: ['Item', 'Category', 'Unit', 'In', 'Out'], rows: Object.values(per).sort((a, b) => b.outQ - a.outQ).map((x) => [x.name, x.cat, x.unit, String(x.inQ), String(x.outQ)]), totals: ['Total', '', '', String(inQ), String(outQ)] },
      { heading: 'Bills paid by account', head: ['Bill', 'Amount'], rows: Object.entries(billBy).map(([k, v]) => [k, v]), totals: ['Total', billTotal], num: [1] },
      { heading: 'All stock movements', head: ['Date', 'Item', 'Category', 'Type', 'Qty', 'Note'], rows: pm.map((m) => [dmy(localDay(m.created_at)), byId[m.item_id].name, byId[m.item_id].category, m.move_type === 'in' ? 'In' : m.move_type === 'out' ? 'Out' : m.move_type, String(n(m.qty)), m.note || '']) },
      { heading: 'All bills paid', head: ['Paid on', 'Bill', 'For month', 'Amount', 'Note'], rows: pb.map((b) => [dmy(b.paid_on), b.bill_accounts?.name || '', b.period || '', n(b.amount), b.note || '']), totals: ['Total', '', '', billTotal, ''], num: [3] }
    ]
  };
}

/* Inventory > Bills: payments */
export function billsReport({ payments = [], from, to }) {
  const pb = payments.filter((b) => inDates(b.paid_on, from, to)).sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)));
  const by = {};
  pb.forEach((b) => { const k = b.bill_accounts?.name || 'Other'; by[k] = by[k] || { c: 0, a: 0 }; by[k].c += 1; by[k].a = r3(by[k].a + n(b.amount)); });
  const total = sum(pb, 'amount');
  return {
    count: pb.length,
    summary: [['Payments', String(pb.length)], ['Total paid', total]],
    sections: [
      { heading: 'By bill', head: ['Bill', 'Payments', 'Amount'], rows: Object.entries(by).map(([k, v]) => [k, String(v.c), v.a]), totals: ['Total', String(pb.length), total], num: [2] },
      { heading: 'All payments', head: ['Paid on', 'Bill', 'Type', 'For month', 'Amount', 'Note'], rows: pb.map((b) => [dmy(b.paid_on), b.bill_accounts?.name || '', b.bill_accounts?.payment_type || '', b.period || '', n(b.amount), b.note || '']), totals: ['Total', '', '', '', total, ''], num: [4] }
    ]
  };
}

/* Stock log: stock_moves with items(name, unit, categories(name)) */
export function stockLogReport({ moves = [], from, to }) {
  const pm = moves.filter((m) => inDates(localDay(m.created_at), from, to)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const q = (t) => pm.filter((m) => m.move_type === t).reduce((a, m) => a + n(m.qty), 0);
  return {
    count: pm.length,
    summary: [['Movements', String(pm.length)], ['Stock in (qty)', String(q('in'))], ['Stock out (qty)', String(q('out'))]],
    sections: [{ heading: 'Stock movements', head: ['Date', 'Time', 'Item', 'Category', 'Type', 'Qty', 'Unit', 'Note'],
      rows: pm.map((m) => { const d = new Date(m.created_at); return [dmy(localDay(m.created_at)), d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), m.items?.name || '', m.items?.categories?.name || '', m.move_type === 'in' ? 'In' : m.move_type === 'out' ? 'Out' : m.move_type, String(n(m.qty)), m.items?.unit || '', m.note || '']; }) }]
  };
}

/* Vehicle maintenance */
export function maintenanceReport({ rows = [], labelOf = () => '', from, to }) {
  const list = rows.filter((r) => inDates(r.work_date, from, to)).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
  const total = sum(list, 'amount');
  const pending = sum(list.filter((r) => r.status !== 'Paid'), 'amount');
  const by = {};
  list.forEach((r) => { const k = labelOf(r.vehicle_id) || 'Vehicle'; by[k] = r3((by[k] || 0) + n(r.amount)); });
  return {
    count: list.length,
    summary: [['Jobs', String(list.length)], ['Total charges', total], ['Payment pending', pending]],
    sections: [
      { heading: 'By vehicle', head: ['Vehicle', 'Charges'], rows: Object.entries(by).sort((a, b) => b[1] - a[1]), totals: ['Total', total], num: [1] },
      { heading: 'All maintenance', head: ['Date', 'Vehicle', 'Work', 'Charges', 'Paid by', 'PDC date', 'Paid to', 'Status'],
        rows: list.map((r) => [dmy(r.work_date), labelOf(r.vehicle_id), r.work || '', n(r.amount), r.payment_method || '', r.payment_method === 'PDC' ? dmy(r.pdc_date) : '', r.paid_to || '', r.status || 'Pending']),
        totals: ['Total', '', `${list.length} jobs`, total, '', '', '', ''], num: [3] }
    ]
  };
}

/* Documents Checklist: documents EXPIRING between the dates (plus already expired when From is empty) */
export function docsReport({ rows = [], sectionLabel = (k) => k, from, to }) {
  const list = rows.filter((r) => r.expiry_date && !r.state && inDates(r.expiry_date, from, to)).sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const today = localDay(Date.now());
  return {
    count: list.length,
    summary: [['Documents expiring', String(list.length)], ['Already expired', String(list.filter((r) => r.expiry_date < today).length)]],
    sections: [{ heading: 'Documents expiring in this period', head: ['Expiry date', 'Section', 'Owner', 'Document', 'Document No.', 'Status', 'Notes'],
      rows: list.map((r) => [dmy(r.expiry_date), sectionLabel(r.section), r.owner || '', r.doc_name || '', r.doc_no || '', r.expiry_date < today ? 'Expired' : 'Expires', r.notes || '']) }]
  };
}

/* Attendance: marks of one company between the dates (fetched by the page) */
export function attendanceReport({ staff = [], att = [], from, to }) {
  const names = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  const list = att.filter((a) => names[a.staff_id] && inDates(a.day, from, to));
  const per = staff.map((s) => {
    const mine = list.filter((a) => a.staff_id === s.id);
    const c = (re) => mine.filter((a) => re.test(a.mark || '')).length;
    return [s.name, s.staff_type || 'Office', String(c(/^p/i)), String(c(/^a/i)), String(c(/^l/i)), String(c(/^h/i)), String(mine.length)];
  });
  return {
    count: list.length,
    summary: [['Staff', String(staff.length)], ['Days marked', String(list.length)], ['Absent', String(list.filter((a) => /^a/i.test(a.mark || '')).length)]],
    sections: [
      { heading: 'By staff', head: ['Name', 'Type', 'Present', 'Absent', 'Leave', 'Half day', 'Marked'], rows: per },
      { heading: 'All marks', head: ['Date', 'Name', 'Mark', 'Note'], rows: list.sort((a, b) => String(a.day).localeCompare(String(b.day))).map((a) => [dmy(a.day), names[a.staff_id], a.mark || '', a.note || '']) }
    ]
  };
}
