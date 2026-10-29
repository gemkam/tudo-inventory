// Office staff attendance (table exp_attendance). Pure helpers: used by the attendance page,
// the salary sheet (working days) and the Group Summary.
// Weekend: Office staff Friday + Saturday off, Site staff Friday off only (exp_staff.staff_type).
// All leave is paid; the reason (Sick, Marketing, Outside meeting, Personal) is kept in exp_attendance.note.
// Leave cannot be marked on a weekend day.

export const MARKS = [
  { key: 'P', label: 'Present', short: 'P' },
  { key: 'A', label: 'Absent', short: 'A' },
  { key: 'L', label: 'Leave', short: 'L' },
  { key: 'H', label: 'Half day', short: '½' }
];
export const MARK = Object.fromEntries(MARKS.map((m) => [m.key, m]));
export const OFF_DAYS = [5, 6]; // Friday, Saturday (getUTCDay) for office staff
export const STAFF_TYPES = ['Office', 'Site'];
export const offDaysFor = (type) => (String(type || '').toLowerCase() === 'site' ? [5] : OFF_DAYS);
export const weekendText = (type) => (String(type || '').toLowerCase() === 'site' ? 'Friday off' : 'Friday and Saturday off');
export const LEAVE_REASONS = ['Sick', 'Marketing', 'Outside meeting', 'Personal'];
export const PAY_BASIS = 30; // salary sheet: (basic + allowances) / 30 x working days

const pad = (v) => String(v).padStart(2, '0');
export function daysOfMonth(key, type) {
  const offs = offDaysFor(type);
  const [y, m] = key.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const iso = `${key}-${pad(i + 1)}`;
    const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return { iso, d: i + 1, wd, off: offs.includes(wd) };
  });
}
export const WD_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const isOffDay = (iso, type) => offDaysFor(type).includes(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay());

/*
  One person, one month.
  marks: { 'YYYY-MM-DD': 'P'|'A'|'L'|'H' } for that person
  today: 'YYYY-MM-DD' (days after today are not counted as unmarked)
  Pay days = 30 - absent - half of the half days (leave and Fri/Sat are paid). Never below 0.
*/
export function personMonth(key, marks = {}, today = '', type = 'Office') {
  const out = { present: 0, absent: 0, leave: 0, half: 0, off: 0, workDays: 0, unmarked: 0, workedOff: 0 };
  for (const day of daysOfMonth(key, type)) {
    const m = marks[day.iso];
    if (day.off) {
      if (!m) { out.off += 1; continue; }
      if (m === 'L') { out.off += 1; continue; } // no leave on a weekend day
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
/* rows -> { staff_id: { iso: note } } (leave reason) */
export function notesByStaff(rows = []) {
  const map = {};
  for (const r of rows) if (r.note) (map[r.staff_id] ||= {})[String(r.day).slice(0, 10)] = r.note;
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
        const x = personMonth(m, marks[p.id], today, p.staff_type);
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
  const leaveWhy = {};
  const ids = new Set(rows.flatMap((r) => r.per.map((p) => p.id)));
  for (const a of att) if (a.mark === 'L' && ids.has(a.staff_id) && ms.includes(String(a.day).slice(0, 7))) leaveWhy[a.note || 'Not given'] = (leaveWhy[a.note || 'Not given'] || 0) + 1;
  const marked = att.some((a) => pick.includes(a.company) && ms.includes(String(a.day).slice(0, 7)));
  return { rows, topAbsent, marked, months: ms, leaveWhy };
}
