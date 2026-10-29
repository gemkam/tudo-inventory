import { salaryPayable } from '@/lib/transport';

/*
  Unpaid balance of salary sheets (drivers and office staff).
  Needs columns from supabase/salary-paid.sql:
    transport_salaries.paid_amount (null = nothing paid yet), paid_on
    exp_staff.paid_amount, paid_on, prev_balance (unpaid from earlier months)
  If the SQL is not run yet, hasPaidCols() is false and the salary part of the balance is not shown.
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const mk = (d) => String(d || '').slice(0, 7);

export const hasPaidCols = (row) => !!row && Object.prototype.hasOwnProperty.call(row, 'paid_amount');

/* ---------- Drivers ---------- */
export function salaryDue(s) {
  if (!hasPaidCols(s)) return null;
  return r3(salaryPayable(s) - n(s.paid_amount));
}

/* Driver allowance of trips that is not paid at all yet (not on any salary receipt), up to the month */
export function openAllowance(entries, driverId, uptoMonth) {
  const list = (entries || []).filter((t) => t.driver_id === driverId && n(t.driver_allowance) > 0
    && !t.allowance_salary_id && t.allowance_status !== 'Paid' && (!uptoMonth || mk(t.entry_date) <= uptoMonth));
  const by = {};
  list.forEach((t) => { const k = mk(t.entry_date); by[k] = by[k] || { month: k, total: 0, trips: 0 }; by[k].total = r3(by[k].total + n(t.driver_allowance)); by[k].trips += 1; });
  return { total: r3(list.reduce((a, t) => a + n(t.driver_allowance), 0)), months: Object.values(by).sort((a, b) => a.month.localeCompare(b.month)) };
}

/*
  Everything still owed to one driver up to (and including) the month:
  thisMonth = net payable of this month minus paid, earlier = earlier months not fully paid, allowance = trip allowance not paid.
*/
export function driverBalance(salaries, entries, driverId, month) {
  const mine = (salaries || []).filter((s) => s.driver_id === driverId && mk(s.month) <= month);
  const tracked = mine.some(hasPaidCols);
  const cur = mine.find((s) => mk(s.month) === month);
  const thisMonth = cur && tracked ? Math.max(0, salaryDue(cur)) : 0;
  const earlier = tracked ? mine.filter((s) => mk(s.month) < month)
    .map((s) => ({ month: mk(s.month), due: salaryDue(s) }))
    .filter((x) => x.due > 0.0005)
    .sort((a, b) => a.month.localeCompare(b.month)) : [];
  const allowance = openAllowance(entries, driverId, month);
  const earlierTotal = r3(earlier.reduce((a, x) => a + x.due, 0));
  return { tracked, thisMonth: r3(thisMonth), earlier, earlierTotal, allowance, total: r3(thisMonth + earlierTotal + allowance.total) };
}

/* ---------- Office staff (one sheet, current month) ---------- */
export function staffBalance(s, net) {
  if (!hasPaidCols(s)) return null;
  return r3(n(s.prev_balance) + n(net) - n(s.paid_amount));
}
