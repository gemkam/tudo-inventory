/*
  Accounts (top bar 🏦 Accounts, page /accounts, 4 Nov 2026). Pure functions, no database calls.
  Tables: acc_accounts (bank / cash accounts with opening balance), acc_txns (money in / out per account,
  cleared tick for bank reconciliation, transfer_id links the two sides of a transfer),
  acc_items (assets, loans and capital typed by hand: side asset | liability | equity).
  The Balance sheet is built from those plus what the app already knows:
  trip balances (money to receive, Modern City), unpaid bills, driver salaries and staff balances not paid,
  and VAT (output - input - VAT paid). "Profit kept in the business" is the balancing figure.
*/
import { vatOf, dieselVat } from '@/lib/transport';
import { salaryDue, hasPaidCols, staffBalance } from '@/lib/payBalance';
import { staffNet } from '@/lib/expenses';

export const n = (v) => Number(v || 0);
export const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const day = (d) => String(d || '').slice(0, 10);

export const ACC_KINDS = ['Bank', 'Cash', 'Petty cash', 'Card'];
export const TXN_CATS = [
  'Customer payment', 'Sales receipt', 'Bill payment', 'Supplier payment', 'Salary', 'Driver allowance', 'Diesel',
  'Rent', 'Utilities', 'VAT paid', 'VAT refund', 'Bank charges', 'Owner money in', 'Owner drawing',
  'Loan received', 'Loan repayment', 'Transfer', 'Other'
];
export const ITEM_SIDES = [
  ['asset', 'Asset (what the company owns)', ['Vehicles', 'Trailers', 'Equipment', 'Furniture', 'Computers', 'Deposit paid', 'Advance paid', 'Other asset']],
  ['liability', 'Loan or amount owed', ['Bank loan', 'Vehicle loan', 'Owner loan', 'Credit card', 'Other liability']],
  ['equity', 'Capital (owner money)', ['Owner capital', 'Partner capital', 'Other capital']]
];
export const sideLabel = (s) => ({ asset: 'Asset', liability: 'Loan / owed', equity: 'Capital' }[s] || s);
const MC = 'modern-city'; // Transport Division belongs to Modern City
const SKIP_VAT_KINDS = ['trip', 'salary', 'extra'];

/* Money of one account up to a date (inclusive). No date = all. */
export function accountBalance(acc, txns, upto) {
  const mine = (txns || []).filter((t) => t.account_id === acc.id && (!upto || day(t.txn_date) <= upto));
  const inn = mine.reduce((a, t) => a + n(t.money_in), 0);
  const out = mine.reduce((a, t) => a + n(t.money_out), 0);
  const cleared = mine.filter((t) => t.cleared).reduce((a, t) => a + n(t.money_in) - n(t.money_out), 0);
  return { in: r3(inn), out: r3(out), balance: r3(n(acc.opening_balance) + inn - out), cleared: r3(n(acc.opening_balance) + cleared), notCleared: mine.filter((t) => !t.cleared).length };
}

/* Ledger lines of one account between from and to, with the running balance and the balance brought forward */
export function ledger(acc, txns, from, to) {
  const all = (txns || []).filter((t) => t.account_id === acc.id)
    .sort((a, b) => day(a.txn_date).localeCompare(day(b.txn_date)) || String(a.created_at).localeCompare(String(b.created_at)));
  let bal = n(acc.opening_balance);
  let brought = null;
  const lines = [];
  all.forEach((t) => {
    const d = day(t.txn_date);
    if (from && d < from) { bal += n(t.money_in) - n(t.money_out); return; }
    if (brought === null) brought = r3(bal);
    if (to && d > to) return;
    bal += n(t.money_in) - n(t.money_out);
    lines.push({ ...t, balance: r3(bal) });
  });
  if (brought === null) brought = r3(bal);
  const inn = r3(lines.reduce((a, t) => a + n(t.money_in), 0));
  const out = r3(lines.reduce((a, t) => a + n(t.money_out), 0));
  return { brought, lines, in: inn, out, closing: r3(brought + inn - out) };
}

/* Trips with money still to collect (rent - received) */
export function tripReceivables(trips, drivers, upto) {
  const nm = Object.fromEntries((drivers || []).map((d) => [d.id, d.name]));
  return (trips || []).filter((t) => (!upto || day(t.entry_date) <= upto) && n(t.rent) - n(t.received) > 0.0005)
    .map((t) => ({ id: t.id, date: day(t.entry_date), driver: nm[t.driver_id] || 'Driver', driver_id: t.driver_id, route: [t.from_place, t.to_place].filter(Boolean).join(' → ') || t.description || 'Trip', customer: t.customer || '', rent: r3(t.rent), received: r3(t.received), balance: r3(n(t.rent) - n(t.received)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* Everything the companies owe: unpaid bills, driver salaries not paid, office staff balances */
export function payables(D, co, upto) {
  const match = (c) => co === 'all' || (c || MC) === co;
  const drv = Object.fromEntries((D.drivers || []).map((d) => [d.id, d.name]));
  const bills = (D.bills || []).filter((b) => n(b.unpaid) > 0.0005 && match(b.company) && (!upto || day(b.entry_date) <= upto))
    .map((b) => ({ kind: 'Bill', company: b.company, date: day(b.entry_date), ref: b.bill_no || '', text: b.description || b.head || '', amount: r3(b.unpaid), auto: !!b.source_kind }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const salaries = match(MC) ? (D.salaries || []).filter((s) => hasPaidCols(s) && (!upto || day(s.month) <= upto))
    .map((s) => ({ kind: 'Driver salary', company: MC, date: day(s.month), ref: '', text: `${drv[s.driver_id] || 'Driver'} · salary ${day(s.month).slice(0, 7)}`, amount: Math.max(0, n(salaryDue(s))) }))
    .filter((x) => x.amount > 0.0005) : [];
  const staff = (D.staff || []).filter((s) => match(s.company) && hasPaidCols(s))
    .map((s) => ({ kind: 'Staff salary', company: s.company, date: '', ref: '', text: `${s.name} · salary balance`, amount: Math.max(0, n(staffBalance(s, staffNet(s)))) }))
    .filter((x) => x.amount > 0.0005);
  return { bills, salaries, staff, total: r3([...bills, ...salaries, ...staff].reduce((a, x) => a + x.amount, 0)) };
}

/* VAT to pay (+) or claim back (-) up to a date: output VAT - input VAT - VAT paid + VAT refund */
export function vatPosition(D, co, upto) {
  const match = (c) => co === 'all' || (c || MC) === co;
  const inDate = (d) => !upto || day(d) <= upto;
  let output = 0; let input = 0;
  if (match(MC)) (D.trips || []).filter((t) => inDate(t.entry_date)).forEach((t) => { output += vatOf(t); input += dieselVat(t); });
  (D.invoices || []).filter((x) => match(x.company) && inDate(x.doc_date)).forEach((x) => {
    const sub = (Array.isArray(x.items) ? x.items : []).reduce((a, it) => a + n(it.amount), 0);
    output += (sub * n(x.vat_pct)) / 100;
  });
  (D.bills || []).filter((b) => match(b.company) && inDate(b.entry_date) && !SKIP_VAT_KINDS.includes(b.source_kind)).forEach((b) => { input += n(b.vat); });
  const accCo = Object.fromEntries((D.accounts || []).map((a) => [a.id, a.company]));
  let paid = 0;
  (D.txns || []).filter((t) => match(accCo[t.account_id]) && inDate(t.txn_date)).forEach((t) => {
    if (t.category === 'VAT paid') paid += n(t.money_out) - n(t.money_in);
    if (t.category === 'VAT refund') paid -= n(t.money_in) - n(t.money_out);
  });
  return { output: r3(output), input: r3(input), paid: r3(paid), net: r3(output - input - paid) };
}

/* Balance sheet as on a date for one company or all */
export function balanceSheet(D, co, asOf) {
  const match = (c) => co === 'all' || (c || MC) === co;
  const inDate = (d) => !asOf || !d || day(d) <= asOf;
  const accounts = (D.accounts || []).filter((a) => match(a.company)).map((a) => ({ a, b: accountBalance(a, D.txns, asOf) }));
  const items = (D.items || []).filter((x) => match(x.company) && inDate(x.as_of));
  const rec = match(MC) ? tripReceivables(D.trips, D.drivers, asOf) : [];
  const pay = payables(D, co, asOf);
  const vat = vatPosition(D, co, asOf);

  const assets = [
    ...accounts.map(({ a, b }) => ({ group: 'Bank and cash', name: `${a.name}${a.kind && a.kind !== 'Bank' ? ` (${a.kind})` : a.bank_name ? ` (${a.bank_name})` : ''}`, amount: b.balance, link: `bank:${a.id}` })),
    { group: 'Money to receive', name: 'Trips not fully paid by customers (Transport)', amount: r3(rec.reduce((s, x) => s + x.balance, 0)), link: 'receive', hide: !match(MC) },
    { group: 'Money to receive', name: 'VAT to claim back', amount: vat.net < 0 ? -vat.net : 0, link: 'vat', hide: !(vat.net < 0) },
    ...items.filter((x) => x.side === 'asset').map((x) => ({ group: 'Assets typed in', name: x.name, amount: r3(x.amount), link: 'items' }))
  ].filter((x) => !x.hide);
  const liabilities = [
    { group: 'Bills and salaries', name: 'Unpaid bills', amount: r3(pay.bills.reduce((s, x) => s + x.amount, 0)), link: 'pay' },
    { group: 'Bills and salaries', name: 'Driver salaries not paid', amount: r3(pay.salaries.reduce((s, x) => s + x.amount, 0)), link: 'pay', hide: !match(MC) },
    { group: 'Bills and salaries', name: 'Office staff salaries not paid', amount: r3(pay.staff.reduce((s, x) => s + x.amount, 0)), link: 'pay' },
    { group: 'Tax', name: 'VAT to pay', amount: vat.net > 0 ? vat.net : 0, link: 'vat' },
    ...items.filter((x) => x.side === 'liability').map((x) => ({ group: 'Loans and amounts owed', name: x.name, amount: r3(x.amount), link: 'items' }))
  ].filter((x) => !x.hide);
  const equity = items.filter((x) => x.side === 'equity').map((x) => ({ group: 'Capital', name: x.name, amount: r3(x.amount), link: 'items' }));
  const tA = r3(assets.reduce((s, x) => s + x.amount, 0));
  const tL = r3(liabilities.reduce((s, x) => s + x.amount, 0));
  const tCap = r3(equity.reduce((s, x) => s + x.amount, 0));
  const kept = r3(tA - tL - tCap);
  equity.push({ group: 'Profit kept', name: 'Profit kept in the business (balancing figure)', amount: kept, balancing: true });
  return { assets, liabilities, equity, tA, tL, tE: r3(tCap + kept), netWorth: r3(tA - tL), vat, rec, pay };
}

export const ageDays = (d, today) => (d ? Math.max(0, Math.round((new Date(today) - new Date(d)) / 86400000)) : null);
export const ageBand = (days) => (days === null ? '' : days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+');
