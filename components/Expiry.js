'use client';

import { daysLeft, fmtD } from '@/lib/reminders';

/* Expiry date in a sheet: amber from 30 days before, red when expired */
export default function Expiry({ date }) {
  if (!date) return <span className="muted">–</span>;
  const left = daysLeft(date);
  const cls = left < 0 ? 'exp-bad' : left <= 30 ? 'exp-soon' : 'exp-ok';
  const note = left < 0 ? `expired ${-left}d ago` : left === 0 ? 'expires today' : left <= 30 ? `${left}d left` : '';
  return <span className={`exp ${cls}`}>{fmtD(date)}{note && <small>{note}</small>}</span>;
}

export const expiryCol = (key, label) => ({ key, label, type: 'date', width: 140, render: (r) => <Expiry date={r[key]} /> });
