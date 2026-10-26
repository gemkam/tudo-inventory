/* Date ranges for report pages (calendar days, local time) */

const DAY = 86400000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const RANGES = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'This month',
  lastmonth: 'Last month',
  quarter: 'Last 3 months',
  all: 'All time'
};

/* returns [start, end) as Date objects; end is exclusive */
export function rangeBounds(range) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(+today + DAY);
  switch (range) {
    case 'yesterday': return [new Date(+today - DAY), today];
    case 'week': return [new Date(+today - 6 * DAY), tomorrow];
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), tomorrow];
    case 'lastmonth': return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 1)];
    case 'quarter': return [new Date(today.getFullYear(), today.getMonth() - 2, 1), tomorrow];
    case 'all': return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
    default: return [today, tomorrow];
  }
}

/* a 'YYYY-MM-DD' date string as a local Date */
export function localDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function inRange(dateLike, [start, end]) {
  const t = typeof dateLike === 'string' && dateLike.length === 10 ? localDate(dateLike) : new Date(dateLike);
  return t >= start && t < end;
}

export function rangeNote(range) {
  const [s, e] = rangeBounds(range);
  const f = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (range === 'all') return 'Showing all records.';
  if (range === 'today' || range === 'yesterday') return `Showing ${f(s)}.`;
  return `Showing ${f(s)} to ${f(new Date(+e - DAY))}.`;
}

export function lastNDays(n) {
  const today = startOfDay(new Date());
  return Array.from({ length: n }, (_, i) => {
    const d0 = new Date(+today - (n - 1 - i) * DAY);
    return { start: d0, end: new Date(+d0 + DAY), label: i === n - 1 ? 'Today' : d0.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) };
  });
}
