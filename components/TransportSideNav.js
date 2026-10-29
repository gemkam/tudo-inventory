'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';

/*
  Side buttons for Transport Expense (rendered by components/AuthGate.js on every /transport page except the salary slip).
  Groups open like folders: Trip sheets and Salary sheets list every driver as its own button (from the drivers table,
  so a new driver appears by himself). The button of the page you are on is filled. On phones it folds into one bar.
  CSS: tsn-* at the end of app/globals.css.
*/

export const showTransportSide = (path) => /^\/transport(\/|$)/.test(path) && !/^\/transport\/salary\//.test(path);

const sortDrivers = (list) => [...list].sort((a, b) => (a.status === 'Inactive') - (b.status === 'Inactive') || String(a.name).localeCompare(String(b.name)));

export default function TransportSideNav() {
  const path = usePathname();
  const [drivers, setDrivers] = useState([]);
  const [open, setOpen] = useState({ trips: true, salary: /salary-sheet/.test(path) });
  const [phoneOpen, setPhoneOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    sb().from('transport_drivers').select('id, name, status, vehicle_no').order('sort').order('name')
      .then(({ data }) => { if (alive) setDrivers(sortDrivers(data || [])); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setPhoneOpen(false);
    if (/salary-sheet/.test(path)) setOpen((o) => ({ ...o, salary: true }));
  }, [path]);

  const isOn = (href, exact = true) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const L = ({ href, icon, children, exact = true, sub }) => (
    <Link href={href} className={`tsn-btn${sub ? ' sub' : ''}${isOn(href, exact) ? ' on' : ''}`} aria-current={isOn(href, exact) ? 'page' : undefined}>
      {icon && <span className="tsn-ic" aria-hidden="true">{icon}</span>}<span className="tsn-tx">{children}</span>
    </Link>
  );
  const Group = ({ id, icon, label, children }) => (
    <div className={`tsn-group${open[id] ? ' open' : ''}`}>
      <button type="button" className="tsn-btn tsn-head" aria-expanded={!!open[id]} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
        <span className="tsn-ic" aria-hidden="true">{icon}</span><span className="tsn-tx">{label}</span><span className="tsn-car" aria-hidden="true">▸</span>
      </button>
      {open[id] && <div className="tsn-kids">{children}</div>}
    </div>
  );
  const here = drivers.find((d) => path.endsWith(d.id));

  return (
    <aside className={`tsn no-print${phoneOpen ? ' phone-open' : ''}`} aria-label="Transport Expense menu">
      <button type="button" className="tsn-phone" onClick={() => setPhoneOpen((v) => !v)} aria-expanded={phoneOpen}>
        🚚 Transport menu{here ? ` · ${here.name}` : ''} <span aria-hidden="true">{phoneOpen ? '▴' : '▾'}</span>
      </button>
      <nav className="tsn-list">
        <div className="tsn-title">🚚 Transport Expense</div>
        <L href="/transport" icon="📊">Overview</L>
        <Group id="trips" icon="📄" label="Trip sheets">
          {drivers.length === 0 && <span className="tsn-none">No drivers yet</span>}
          {drivers.map((d) => (
            <L key={d.id} href={`/transport/${d.id}`} sub>{d.name}{d.vehicle_no ? <small>{d.vehicle_no}</small> : null}{d.status === 'Inactive' ? <small>inactive</small> : null}</L>
          ))}
        </Group>
        <Group id="salary" icon="📑" label="Salary sheets">
          <L href="/transport/salary-sheet" sub>All drivers (one month)</L>
          {drivers.map((d) => <L key={d.id} href={`/transport/salary-sheet/${d.id}`} sub>{d.name}</L>)}
        </Group>
        <L href="/transport/drivers" icon="👤">Drivers</L>
        <L href="/transport/vehicles" icon="🚛">Vehicles &amp; maintenance</L>
        <L href="/transport/invoice" icon="🧾">Invoice</L>
        <L href="/transport/reports" icon="📈">Reports</L>
        <div className="tsn-sep" />
        <L href="/expenses/summary" icon="🏢">Group Summary</L>
      </nav>
    </aside>
  );
}
