'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/*
  Side menu for Personnel (1 Nov 2026). Same look as the All Companies / Transport side menus (tsn-* CSS):
  on a PC a thin icon strip at the left edge that opens when the mouse is on it; on phones one fold-out bar.
  The tab buttons switch the Personnel tabs: they send the window event "personnel-tab" (app/personnel/page.js
  listens), and the page sends "personnel-tab-now" back so the button of the open tab is filled.
*/
export const showPersonnelSide = (path) => /^\/personnel(\/|$)/.test(path);

export const PERSONNEL_TABS = [
  ['office', '🏢', 'Office Employees'],
  ['drivers', '🚚', 'Drivers'],
  ['site', '👷', 'Site Employees'],
  ['sub', '🤝', 'Subcontractors'],
  ['attendance', '🗓', 'Attendance'],
  ['archives', '🗄', 'Archives']
];

export default function PersonnelSideNav() {
  const path = usePathname();
  const [tab, setTab] = useState('office');
  const [phoneOpen, setPhoneOpen] = useState(false);

  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (t) setTab(t); } catch { /* ignore */ }
    const on = (e) => { if (e.detail) setTab(e.detail); };
    window.addEventListener('personnel-tab-now', on);
    return () => window.removeEventListener('personnel-tab-now', on);
  }, []);

  function go(k) {
    setTab(k); setPhoneOpen(false);
    window.dispatchEvent(new CustomEvent('personnel-tab', { detail: k }));
  }
  const here = PERSONNEL_TABS.find(([k]) => k === tab);
  const onPage = path === '/personnel';

  return (
    <aside className={`tsn no-print${phoneOpen ? ' phone-open' : ''}`} aria-label="Personnel menu">
      <button type="button" className="tsn-phone" onClick={() => setPhoneOpen((v) => !v)} aria-expanded={phoneOpen}>
        👥 Personnel menu{here ? ` · ${here[2]}` : ''} <span aria-hidden="true">{phoneOpen ? '▴' : '▾'}</span>
      </button>
      <nav className="tsn-list">
        <div className="tsn-title"><span className="tsn-title-tx">👥 Personnel</span></div>
        {PERSONNEL_TABS.map(([k, ic, label]) => (onPage ? (
          <button key={k} type="button" className={`tsn-btn${tab === k ? ' on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
            <span className="tsn-ic" aria-hidden="true">{ic}</span><span className="tsn-tx">{label}</span>
          </button>
        ) : (
          <Link key={k} href={`/personnel?tab=${k}`} className="tsn-btn">
            <span className="tsn-ic" aria-hidden="true">{ic}</span><span className="tsn-tx">{label}</span>
          </Link>
        )))}
        <div className="tsn-sep" />
        <Link href="/expenses/salary" className="tsn-btn"><span className="tsn-ic" aria-hidden="true">💰</span><span className="tsn-tx">Salary slips</span></Link>
        <Link href="/entry" className="tsn-btn"><span className="tsn-ic" aria-hidden="true">📝</span><span className="tsn-tx">Data entry</span></Link>
      </nav>
    </aside>
  );
}
