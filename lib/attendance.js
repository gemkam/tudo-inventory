// Office staff attendance (table exp_attendance). Pure helpers: used by the attendance page,
// the salary sheet (working days) and the Group Summary.
// Friday and Saturday are off unless someone is marked on that day.

export const MARKS = [
  { key: 'P', label: 'Present', short: 'P' },
  { key: 'A', label: 'Absent', short: 'A' },
  { key: 'L', label: 'Leave', short: 'L' },
  { key: 'H', label: 'Half day', short: '½' }
];
export const MARK = Object.fromEntries(MARKS.map((m) => [m.key, m]));
export const OFF_DAYS = [5, 6]; // Friday, Saturday (getUTCDay)
export const PAY_BASIS = 30; // salary sheet: (basic + allowances) / 30 x working days

const pad = (v) => String(v).padStart(2, '0');
export function daysOfMonth(key) {
  const [y, m] = key.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const iso = `${key}-${pad(i + 1)}`;
    const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, d: i + 1, wd, off: OFF_DAYS.includes(wd) };
  });
}
export const WD_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const isOffDay = (iso) => OFF_DAYS.includes(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay());

/*
  One person, one month.
  marks: { 'YYYY-MM-DD': 'P'|'A'|'L'|'H' } for that person
  today: 'YYYY-MM-DD' (days after today are not counted as unmarked)
  Pay days = 30 - absent - half of the half days (leave and Fri/Sat are paid). Never below 0.
*/
export function personMonth(key, marks = {}, today = '') {
  const out = { present: 0, absent: 0, leave: 0, half: 0, off: 0, workDays: 0, unmarked: 0, workedOff: 0 };
  for (const day of daysOfMonth(key)) {
    const m = marks[day.iso];
    if (day.off) {
      if (!m) { out.off += 1; continue; }
      out.workedOff += m === 'P' || m === 'H' ? 1 : 0;
    } else out.workDays += 1;
    if (m === 'P') out.present += 1;
    else if (m === 'A') out.absent += 1;
    else if (m === 'L') out.leave += 1;
    else if (m === 'H') out.half += 1;
    else if (!day.off && (!today || day.iso <= today)) out.unmarked += 1;
  }
  out.payDays = Math.max(0, PAY_BASIS - out.absent - out.half * 0.5);
  const counted = out.present + out.absent + out.leave + out.half;
  out.rate = counted ? Math.round(((out.present + out.half * 0.5) / counted) * 100) : null;
  return out;
}

/* rows from exp_attendance -> { staff_id: { iso: mark } } */
export function marksByStaff(rows = []) {
  const map = {};
  for (const r of rows) (map[r.staff_id] ||= {})[String(r.day).slice(0, 10)] = r.mark;
  return map;
}

/*
  Group Summary block. staff: exp_staff rows (active), att: exp_attendance rows,
  pick: company keys, months: month keys of the period.
  Returns per company totals + people with most absences.
*/
export function attendanceSummary({ staff = [], att = [], pick = [], months = [], today = '', companies = [] }) {
  const marks = marksByStaff(att);
  const ms = months.filter((m) => !today || m <= today.slice(0, 7));
  const rows = companies.filter((c) => pick.includes(c.key)).map((c) => {
    const people = staff.filter((s) => s.company === c.key && s.active !== false);
    const t = { present: 0, absent: 0, leave: 0, half: 0, unmarked: 0, workDays: 0 };
    const per = people.map((p) => {
      const sum = { present: 0, absent: 0, leave: 0, half: 0, unmarked: 0, workDays: 0 };
      for (const m of ms) {
        const x = personMonth(m, marks[p.id], today);
        for (const k of Object.keys(sum)) sum[k] += x[k];
      }
      for (const k of Object.keys(t)) t[k] += sum[k];
      return { id: p.id, name: p.name, company: c.key, companyLabel: c.short, ...sum };
    });
    const counted = t.present + t.absent + t.leave + t.half;
    return { key: c.key, label: c.short, staff: people.length, ...t, rate: counted ? Math.round(((t.present + t.half * 0.5) / counted) * 100) : null, per };
  });
  const everyone = rows.flatMap((r) => r.per);
  const topAbsent = everyone.filter((p) => p.absent > 0).sort((a, b) => b.absent - a.absent || b.half - a.half).slice(0, 6);
  const marked = att.some((a) => pick.includes(a.company) && ms.includes(String(a.day).slice(0, 7)));
  return { rows, topAbsent, marked, months: ms };
}
