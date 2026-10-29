import { num } from '@/lib/sheet';

export const SALARY_FIELDS = [
  ['basic', 'Basic salary'],
  ['room_rent', 'Room rent'],
  ['utilities', 'Utilities'],
  ['mobile', 'Mobile allowance'],
  ['travel_food', 'Travel food'],
  ['trip_allowance', 'Driver allowance'],
  ['allowance_carried', 'Driver allowance of earlier months']
];

const mk = (d) => String(d || '').slice(0, 7);
export const monthShort = (key) => {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

/*
  Driver allowance (trip allowance) for a driver's salary receipt of one month (YYYY-MM).
  Only allowance marked "Paid" is counted, and each trip is counted on ONE receipt only
  (transport_entries.allowance_salary_id = the receipt that paid it).
  - current: this month's trips, paid
  - carried: earlier months' trips paid now (e.g. September balance paid in October), with a short note
  - unpaidEarlier: earlier months still not paid (shown as "previous not paid"; can be paid with this receipt)
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
  const note = Object.keys(byMonth).sort().map((k) => `${monthShort(k)} driver allowance ${byMonth[k].toFixed(3)} paid in ${monthShort(month)}`).join('; ');
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


/*
  The driver allowance story of one month's receipt (for the slip, the sheets and the receipts list):
  - paidHere:      this month's allowance paid with this receipt
  - carriedHere:   earlier months paid with this receipt   [{ month, amt, n }]  e.g. Sep 2026 25.000 paid with Oct
  - prevUnpaid:    earlier months STILL not paid (as of now) [{ month, amt, n }]  shown on later slips until paid
  - paidLater:     this month's allowance paid with a later receipt [{ paidIn, amt, n }]  e.g. paid in Oct 2026
  - unpaidNow:     this month's allowance not paid yet { amt, n }
  - waiting:       marked Paid but not on any receipt yet { amt, n }
  - openIds:       trips up to this month not on any receipt (what "Pay with this salary" pays)
  trips: transport_entries rows (id, driver_id, entry_date, driver_allowance, allowance_status, allowance_salary_id)
*/
export function allowanceStory(trips = [], salaries = [], driverId, month) {
  const sal = salaries.find((s) => s.driver_id === driverId && mk(s.month) === month) || null;
  const salMonth = Object.fromEntries(salaries.map((s) => [s.id, mk(s.month)]));
  const mine = trips.filter((t) => t.driver_id === driverId && Number(t.driver_allowance || 0) !== 0);
  const amt = (t) => Number(t.driver_allowance || 0);
  const group = (list, keyFn, name) => {
    const g = {};
    list.forEach((t) => { const k = keyFn(t); g[k] = g[k] || { [name]: k, amt: 0, n: 0 }; g[k].amt = num(g[k].amt + amt(t)); g[k].n += 1; });
    return Object.values(g).sort((a, b) => String(a[name]).localeCompare(String(b[name])));
  };
  const linkedHere = sal ? mine.filter((t) => t.allowance_salary_id === sal.id) : [];
  const open = (t) => !t.allowance_salary_id && t.allowance_status !== 'Paid'; // not paid at all yet
  const waitingList = mine.filter((t) => !t.allowance_salary_id && t.allowance_status === 'Paid' && mk(t.entry_date) <= month);
  const thisMonth = mine.filter((t) => mk(t.entry_date) === month);
  const unpaidNowList = thisMonth.filter(open);
  return {
    sal,
    paidHere: num(linkedHere.filter((t) => mk(t.entry_date) === month).reduce((s, t) => s + amt(t), 0)),
    carriedHere: group(linkedHere.filter((t) => mk(t.entry_date) < month), (t) => mk(t.entry_date), 'month'),
    prevUnpaid: group(mine.filter((t) => open(t) && mk(t.entry_date) < month), (t) => mk(t.entry_date), 'month'),
    paidLater: group(thisMonth.filter((t) => t.allowance_salary_id && sal && t.allowance_salary_id !== sal.id && salMonth[t.allowance_salary_id] > month), (t) => salMonth[t.allowance_salary_id], 'paidIn'),
    unpaidNow: { amt: num(unpaidNowList.reduce((s, t) => s + amt(t), 0)), n: unpaidNowList.length },
    // marked Paid on the trip sheet but no salary receipt for that month yet: goes on the next receipt
    waiting: { amt: num(waitingList.reduce((s, t) => s + amt(t), 0)), n: waitingList.length },
    openIds: mine.filter((t) => !t.allowance_salary_id && mk(t.entry_date) <= month).map((t) => t.id),
    prevOpenIds: mine.filter((t) => !t.allowance_salary_id && mk(t.entry_date) < month).map((t) => t.id),
    nowOpenIds: mine.filter((t) => !t.allowance_salary_id && mk(t.entry_date) === month).map((t) => t.id)
  };
}

/* ---------- VAT 5% (inside the trip amount), 15% Govt tax, Profit taken (29 Oct 2026) ---------- */
export const VAT_RATE = 5;
export const TAX_RATE = 15;

/* VAT is already INSIDE the rent when the trip's "VAT 5%" button is on: 325 = 309.524 net + 15.476 VAT */
export const vatOf = (r) => (r && r.vat_included ? num((Number(r.rent || 0) * VAT_RATE) / (100 + VAT_RATE)) : 0);

/* Fixed salary of a month (without driver allowance, which is counted per trip) */
export const salaryFixed = (s) => (s ? num(['basic', 'room_rent', 'utilities', 'mobile', 'travel_food'].reduce((t, k) => t + Number(s[k] || 0), 0)
  - Number(s.advance_deduction || 0) + Number(s.special_allowance || 0)) : 0);

/*
  Driver profit for a list of trips (one month or all months):
  rent - VAT = income without VAT - trip costs - driver allowance = profit before tax (driver salary NOT deducted)
  - 15% Govt tax (only when on and profit > 0) = profit after tax - profit taken = balance
*/
export function driverProfit({ trips = [], salaries = [], taken = [], taxOn = false }) {
  const sum = (k) => num(trips.reduce((t, e) => t + Number(e[k] || 0), 0));
  const rent = sum('rent');
  const vat = num(trips.reduce((t, e) => t + vatOf(e), 0));
  const income = num(rent - vat);
  const costs = num(sum('diesel') + sum('toll') + sum('maintenance'));
  const allowance = sum('driver_allowance');
  const before = num(income - costs - allowance);
  const tax = taxOn && before > 0 ? num((before * TAX_RATE) / 100) : 0;
  const after = num(before - tax);
  const takenAmt = num(taken.reduce((t, x) => t + Number(x.amount || 0), 0));
  return { rent, vat, income, costs, allowance, before, tax, after, taken: takenAmt, balance: num(after - takenAmt) };
}
