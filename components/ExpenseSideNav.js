'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COMPANIES } from '@/lib/expenses';
import { TransportMenu } from '@/components/TransportSideNav';

/*
  Side buttons for Office Expense (rendered by components/AuthGate.js on every /expenses page), same look as the
  Transport side buttons (tsn-* CSS). Each company opens like a folder: Bills & salary, Attendance, Invoice,
  Payment receipt. Transport opens the same way with all Transport items (TransportMenu). The company and page you are on are filled. Stays in view while you scroll (sticky).
*/

export const showExpenseSide = (path) => /^\/expenses(\/|$)/.test(path);

function readCo() {
  try {
    const q = new URLSearchParams(window.location.search);
    return { co: q.get('co') || localStorage.getItem('tudo-exp-co') || COMPANIES[0].key, kind: q.get('kind') || '' };
  } catch { return { co: COMPANIES[0].key, kind: '' }; }
}

export default function ExpenseSideNav({ isAdmin = false }) {
  const path = usePathname();
  const [{ co, kind }, setCur] = useState({ co: COMPANIES[0].key, kind: '' });
  const [open, setOpen] = useState({});
  const [phoneOpen, setPhoneOpen] = useState(false);

  // the pages switch company without a page change, so keep an eye on the address
  useEffect(() => {
    const tick = () => setCur((old) => { const n = readCo(); return n.co === old.co && n.kind === old.kind ? old : n; });
    tick();
    const t = setInterval(tick, 600);
    window.addEventListener('popstate', tick);
    return () => { clearInterval(t); window.removeEventListener('popstate', tick); };
  }, [path]);
  useEffect(() => { setOpen((o) => ({ ...o, [co]: true })); }, [co]);
  useEffect(() => { setPhoneOpen(false); }, [path, co]);

  const onSummary = path === '/expenses/summary';
  const isOn = (p, c, k = '') => !onSummary && path === p && co === c && (!k || kind === k || (!kind && k === 'invoice'));
  const Btn = ({ href, on, icon, children, sub }) => (
    <Link href={href} className={`tsn-btn${sub ? ' sub' : ''}${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}>
      {icon && <span className="tsn-ic" aria-hidden="true">{icon}</span>}<span className="tsn-tx">{children}</span>
    </Link>
  );
  const here = COMPANIES.find((c) => c.key === co);

  return (
    <aside className={`tsn no-print${phoneOpen ? ' phone-open' : ''}`} aria-label="Office Expense menu">
      <button type="button" className="tsn-phone" onClick={() => setPhoneOpen((v) => !v)} aria-expanded={phoneOpen}>
        🧾 Office Expense menu{onSummary ? ' · Group Summary' : here ? ` · ${here.short}` : ''} <span aria-hidden="true">{phoneOpen ? '▴' : '▾'}</span>
      </button>
      <nav className="tsn-list">
        <div className="tsn-title">🧾 Office Expense</div>
        <Btn href="/expenses/summary" on={onSummary} icon="📊">Group Summary</Btn>
        <Btn href="/docs" on={false} icon="📋">Documents Checklist</Btn>
        <Btn href="/expenses/vat" on={path === '/expenses/vat'} icon="🧾">VAT return</Btn>
        {COMPANIES.map((c) => (
          <div key={c.key} className={`tsn-group${open[c.key] ? ' open' : ''}`}>
            <button type="button" className={`tsn-btn tsn-head${!onSummary && co === c.key ? ' here' : ''}`} aria-expanded={!!open[c.key]} onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}>
              <span className="tsn-ic" aria-hidden="true">🏢</span><span className="tsn-tx">{c.short}</span><span className="tsn-car" aria-hidden="true">▸</span>
            </button>
            {open[c.key] && (
              <div className="tsn-kids">
                <Btn href={`/expenses?co=${c.key}`} on={isOn('/expenses', c.key)} sub>Bills &amp; salary</Btn>
                <Btn href={`/expenses/attendance?co=${c.key}`} on={isOn('/expenses/attendance', c.key)} sub>Attendance</Btn>
                <Btn href={`/expenses/docs?co=${c.key}&kind=invoice`} on={isOn('/expenses/docs', c.key, 'invoice')} sub>Invoice</Btn>
                <Btn href={`/expenses/docs?co=${c.key}&kind=receipt`} on={isOn('/expenses/docs', c.key, 'receipt')} sub>Payment receipt</Btn>
              </div>
            )}
          </div>
        ))}
        <div className={`tsn-group${open.transport ? ' open' : ''}`}>
          <button type="button" className="tsn-btn tsn-head" aria-expanded={!!open.transport} onClick={() => setOpen((o) => ({ ...o, transport: !o.transport }))}>
            <span className="tsn-ic" aria-hidden="true">🚚</span><span className="tsn-tx">Transport</span><span className="tsn-car" aria-hidden="true">▸</span>
          </button>
          {open.transport && <div className="tsn-kids"><TransportMenu nested isAdmin={isAdmin} /></div>}
        </div>
        <div className="tsn-sep" />
        <Btn href="/docs" icon="📋">Documents Checklist</Btn>
      </nav>
    </aside>
  );
}
