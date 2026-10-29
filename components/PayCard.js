'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmt3 } from '@/components/Omr';

/*
  Vertical salary card used by every salary sheet (all drivers, one driver, office staff of the 3 companies).
  One person = one card: name on top, details, then rows top to bottom (label left, amount right),
  net payable, paid and the UNPAID BALANCE box. CSS: pc-* at the end of app/globals.css.
*/

const n = (v) => Number(v || 0);
export const money = (v) => fmt3(v);

export function PayCard({ no, title, href, badge, meta = [], children, className = '' }) {
  return (
    <section className={`pc-card ${className}`}>
      <header className="pc-top">
        {no != null && <span className="pc-no">{no}</span>}
        <div className="pc-name">
          {href ? <Link href={href}><b>{title}</b></Link> : <b>{title}</b>}
          {badge}
        </div>
      </header>
      {meta.filter((m) => m && (m[1] || m[1] === 0)).length > 0 && (
        <dl className="pc-meta">
          {meta.filter((m) => m && (m[1] || m[1] === 0)).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      <div className="pc-body">{children}</div>
    </section>
  );
}

export function PaySection({ title, children }) {
  return (
    <div className="pc-sec">
      {title && <h4>{title}</h4>}
      {children}
    </div>
  );
}

/* kind: '' normal, 'minus' (shown with −), 'plus' (+), 'total', 'net', 'paid' */
export function PayRow({ label, value, kind = '', note, children, hideZero = false }) {
  if (hideZero && !n(value) && !children) return null;
  const shown = children ?? (value === null || value === undefined || value === '' ? '–'
    : kind === 'minus' ? (n(value) ? `− ${money(value)}` : '–')
      : kind === 'plus' ? (n(value) ? `+ ${money(value)}` : '–')
        : money(value));
  return (
    <div className={`pc-row ${kind}`}>
      <span className="pc-l">{label}{note && <small>{note}</small>}</span>
      <span className="pc-v">{shown}</span>
    </div>
  );
}

/* Number box that saves when you leave it or press Enter */
export function AmountInput({ value, onSave, placeholder = '0.000', disabled, width = 110 }) {
  const [t, setT] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { setT(value === null || value === undefined ? '' : String(value)); }, [value]);
  const commit = () => {
    const raw = t.trim();
    const v = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isFinite(v)) { setT(value == null ? '' : String(value)); return; }
    if ((v ?? null) === (value === undefined || value === null || value === '' ? null : Number(value))) return;
    onSave(v);
  };
  return (
    <input className="pc-in" type="number" step="0.001" min="0" inputMode="decimal" value={t} placeholder={placeholder}
      disabled={disabled} style={{ width }} onChange={(e) => setT(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export function TextInput({ value, onSave, placeholder = '', width = '100%' }) {
  const [t, setT] = useState(value || '');
  useEffect(() => { setT(value || ''); }, [value]);
  return (
    <input className="pc-in left" type="text" value={t} placeholder={placeholder} style={{ width }}
      onChange={(e) => setT(e.target.value)} onBlur={() => { if (t !== (value || '')) onSave(t); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

/* The unpaid balance box at the bottom of a card */
export function BalanceBox({ total, lines = [], tracked = true, missingNote }) {
  const due = n(total) > 0.0005;
  return (
    <div className={`pc-bal ${due ? 'due' : 'ok'}`}>
      <div className="pc-bal-head">
        <span>{due ? 'Unpaid balance' : 'Unpaid balance'}</span>
        <b>{due ? money(total) : 'Nil ✓'}</b>
      </div>
      {lines.filter((l) => n(l[1]) > 0.0005).map(([k, v]) => (
        <div key={k} className="pc-bal-line"><span>{k}</span><span>{money(v)}</span></div>
      ))}
      {!tracked && <small className="pc-bal-note">{missingNote || 'Salary payments are not recorded yet, only unpaid driver allowance is counted.'}</small>}
    </div>
  );
}

/* Short totals table under the cards: name | net | paid | balance (fits a phone and A4 portrait) */
export function PaySummary({ rows, tracked = true, netLabel = 'Net payable' }) {
  const sum = (k) => rows.reduce((t, r) => t + n(r[k]), 0);
  return (
    <div className="table-wrap">
      <table className="pc-sum">
        <thead><tr><th className="l">Name</th><th>{netLabel}</th>{tracked && <th>Paid</th>}<th>Unpaid balance</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="l">{r.name}</td>
              <td>{money(r.net)}</td>
              {tracked && <td>{r.paid == null ? '–' : money(r.paid)}</td>}
              <td className={n(r.balance) > 0.0005 ? 'due' : 'ok'}>{n(r.balance) > 0.0005 ? money(r.balance) : 'Nil'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="l">TOTAL (OMR)</td><td>{money(sum('net'))}</td>{tracked && <td>{money(sum('paid'))}</td>}<td className={sum('balance') > 0.0005 ? 'due' : 'ok'}>{money(sum('balance'))}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}
