'use client';

import { monthShort } from '@/lib/transport';

/*
  Driver allowance lines for one month's salary (story from lib/transport.js allowanceStory):
  ✓ Sep 2026 driver allowance 25.000 paid with this salary
  ⚠ Previous not paid: Sep 2026 25.000 (2 trips)
  ✓ Sep 2026 driver allowance paid in Oct 2026          (on the September slip, once paid later)
  ⚠ Oct 2026 driver allowance not paid yet: 160.000
  compact: short words for tables.
*/
const f3 = (v) => Number(v || 0).toFixed(3);

export function allowanceLines(st, month, compact = false) {
  if (!st) return [];
  const L = [];
  st.carriedHere.forEach((c) => L.push({ ok: true, text: compact ? `${monthShort(c.month)} ${f3(c.amt)} paid here` : `${monthShort(c.month)} driver allowance ${f3(c.amt)} paid with this salary (${c.n} trip${c.n > 1 ? 's' : ''})` }));
  st.paidLater.forEach((p) => L.push({ ok: true, text: compact ? `${f3(p.amt)} paid in ${monthShort(p.paidIn)}` : `${monthShort(month)} driver allowance ${f3(p.amt)} paid later, in ${monthShort(p.paidIn)} salary` }));
  if (st.unpaidNow.n) L.push({ ok: false, text: compact ? `${monthShort(month)} ${f3(st.unpaidNow.amt)} not paid` : `${monthShort(month)} driver allowance not paid yet: ${f3(st.unpaidNow.amt)} (${st.unpaidNow.n} trip${st.unpaidNow.n > 1 ? 's' : ''})` });
  st.prevUnpaid.forEach((p) => L.push({ ok: false, text: compact ? `prev. ${monthShort(p.month)} ${f3(p.amt)} not paid` : `Previous not paid: ${monthShort(p.month)} driver allowance ${f3(p.amt)} (${p.n} trip${p.n > 1 ? 's' : ''})` }));
  if (st.waiting.n) L.push({ ok: null, text: compact ? `${f3(st.waiting.amt)} marked Paid, no receipt` : `Marked Paid, not on a salary yet: ${f3(st.waiting.amt)} (goes on the next salary)` });
  return L;
}

export default function AllowanceNotes({ story, month, compact = false }) {
  const L = allowanceLines(story, month, compact);
  if (!L.length) return null;
  return (
    <ul className={`an ${compact ? 'compact' : ''}`}>
      {L.map((l, i) => <li key={i} className={l.ok === true ? 'ok' : l.ok === false ? 'bad' : 'wait'}>{l.ok === true ? '✓' : l.ok === false ? '⚠' : '•'} {l.text}</li>)}
    </ul>
  );
}
