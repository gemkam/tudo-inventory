// Reminders for vehicles: PDC cheques to pay, maintenance due, insurance and mulkiya expiry
import { todayISO } from '@/lib/sheet';

export const WORK_TYPES = ['Tyres', 'Greasing', 'Oil Filter', 'Washing', 'Headlights', 'Engine Wiring'];
export const PAY_METHODS = ['PDC', 'Bank Transfer'];

export function daysLeft(d) {
  if (!d) return null;
  const a = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  const b = new Date(`${todayISO()}T00:00:00`);
  return Math.round((a - b) / 86400000);
}

export const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

export function vehicleLabel(v) {
  if (!v) return 'Vehicle';
  return `${v.plate_no || v.name || 'Vehicle'} (${v.part})`;
}

/*
  Returns [{ key, kind, title, detail, date, left, urgent }]
  - PDC cheque not paid: 7 days before the PDC date
  - Maintenance next due (not done): 7 days before
  - Insurance / Mulkiya expiry: 30 days before
  urgent = 3 days or less left, or overdue (alarm)
*/
export function buildReminders(vehicles = [], maintenance = []) {
  const out = [];
  const byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  for (const m of maintenance) {
    const v = byId[m.vehicle_id];
    if (m.payment_method === 'PDC' && m.pdc_date && m.status !== 'Paid') {
      const left = daysLeft(m.pdc_date);
      if (left <= 7) {
        out.push({
          key: `pdc-${m.id}`, kind: 'pay', date: m.pdc_date, left,
          title: `PDC cheque to pay: ${Number(m.amount || 0).toFixed(3)} OMR`,
          detail: `${m.work || 'Maintenance'} · ${vehicleLabel(v)}`
        });
      }
    }
    // next service due: cleared when a newer row for the same vehicle and work is recorded
    const redone = m.next_due && maintenance.some((o) => o.id !== m.id && o.vehicle_id === m.vehicle_id && o.work === m.work && o.work_date && o.work_date > m.work_date);
    if (m.next_due && !redone) {
      const left = daysLeft(m.next_due);
      if (left <= 7) {
        out.push({
          key: `due-${m.id}`, kind: 'maintain', date: m.next_due, left,
          title: `${m.work || 'Maintenance'} due`,
          detail: vehicleLabel(v)
        });
      }
    }
  }
  for (const v of vehicles) {
    for (const [what, d] of [['Insurance', v.insurance_expiry], ['Mulkiya', v.mulkiya_expiry]]) {
      const left = daysLeft(d);
      if (d && left <= 30) out.push({ key: `${what}-${v.id}`, kind: 'renew', date: d, left, title: `${what} renewal`, detail: vehicleLabel(v) });
    }
  }
  return out.map((r) => ({ ...r, urgent: r.left <= 3 })).sort((a, b) => a.left - b.left);
}

export function whenText(left) {
  if (left < 0) return `${-left} day${left === -1 ? '' : 's'} overdue`;
  if (left === 0) return 'today';
  if (left === 1) return 'tomorrow';
  return `in ${left} days`;
}
