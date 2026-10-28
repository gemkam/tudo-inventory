import { num } from '@/lib/sheet';

export const SALARY_FIELDS = [
  ['basic', 'Basic salary'],
  ['room_rent', 'Room rent'],
  ['utilities', 'Utilities'],
  ['mobile', 'Mobile allowance'],
  ['travel_food', 'Travel food'],
  ['trip_allowance', 'Trip allowance'],
  ['allowance_carried', 'Trip allowance of earlier months']
];

const mk = (d) => String(d || '').slice(0, 7);
export const monthShort = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

/*
  Trip allowance for a driver's salary receipt of one month (YYYY-MM).
  Only allowance marked "Paid" is counted, and each trip is counted on ONE receipt only
  (transport_entries.allowance_salary_id = the receipt that paid it).
  - current: this month's trips, paid
  - carried: earlier months' trips paid now (e.g. September balance paid in October), with a short note
  - unpaidEarlier: earlier months still not marked Paid (must be marked Paid before the receipt is made)
  - unpaidCurrent: this month's trips not paid yet (they go on the receipt of the month they are paid)
  - linkIds: trips to link to the receipt when it is saved
  salaryId: when editing a receipt, its own linked trips count too.
*/
export function allowancePlan(trips = [], driverId, month, salaryId = null) {
  const elig = trips.filter((t) => t.driver_id === driverId && Number(t.driver_allowance || 0) !== 0
    && mk(t.entry_date) <= month && (!t.allowance_salary_id || t.allowance_salary_id === salaryId));
  // already on this receipt = paid by it (older receipts counted every trip of their month)
  const isPaid = (t) => t.allowance_status === 'Paid' || (salaryId && t.allowance_salary_id === salaryId);
  const sum = (list) => num(list.reduce((s, t) => s + Number(t.driver_allowance || 0), 0));
  const paidNow = elig.filter((t) => isPaid(t) && mk(t.entry_date) === month);
  const paidOld = elig.filter((t) => isPaid(t) && mk(t.entry_date) < month);
  const byMonth = {};
  paidOld.forEach((t) => { const k = mk(t.entry_date); byMonth[k] = num((byMonth[k] || 0) + Number(t.driver_allowance || 0)); });
  const note = Object.keys(byMonth).sort().map((k) => `${monthShort(k)} trip allowance ${byMonth[k].toFixed(3)} paid in ${monthShort(month)}`).join('; ');
  return {
    current: sum(paidNow),
    carried: sum(paidOld),
    note,
    unpaidEarlier: elig.filter((t) => !isPaid(t) && mk(t.entry_date) < month).sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date))),
    unpaidCurrent: elig.filter((t) => !isPaid(t) && mk(t.entry_date) === month),
    linkIds: [...paidNow, ...paidOld].map((t) => t.id)
  };
}

export function salaryTotal(s) {
  if (!s) return 0;
  return num(SALARY_FIELDS.reduce((t, [k]) => t + Number(s[k] || 0), 0));
}

export function salaryPayable(s) {
  if (!s) return 0;
  return num(salaryTotal(s) - Number(s.advance_deduction || 0) + Number(s.special_allowance || 0));
}
