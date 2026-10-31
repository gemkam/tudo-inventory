'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';

/*
  "Where am I" map on top of every page (rendered by components/AuthGate.js), every step clickable:
  e.g. Home › Transport › Drivers › All Drivers Trip Sheets.  Driver names come from the drivers table,
  Office Expense company from ?co. Add new pages to trail() below (and to lib/sitemap.js).
*/

const HOME = ['Home', '/'];
const TRANSPORT = ['Transport', '/transport'];
const DRIVERS = ['Drivers', '/transport/drivers'];
const OFFICE = ['Office Expense', '/expenses'];
const INVENTORY = ['Inventory', '/inventory'];
const ADMIN = ['Admin', '/admin'];
const UUID = /^[0-9a-f-]{20,}$/i;

function trail(path, q, names) {
  const seg = path.split('/').filter(Boolean);
  const nm = (id) => names[id] || 'Driver';
  const co = COMPANIES.find((c) => c.key === q.get('co'));
  const coStep = co ? [co.short, `/expenses?co=${co.key}`] : null;

  if (seg[0] === 'transport') {
    const s1 = seg[1];
    if (!s1) return [HOME, TRANSPORT];
    if (s1 === 'drivers') return [HOME, TRANSPORT, DRIVERS];
    if (s1 === 'trip-sheets') return [HOME, TRANSPORT, DRIVERS, ['All Drivers Trip Sheets', '/transport/trip-sheets']];
    if (s1 === 'vehicles') return [HOME, TRANSPORT, ['Vehicles & maintenance', path]];
    if (s1 === 'invoice') return [HOME, TRANSPORT, ['Invoice', path]];
    if (s1 === 'reports') return [HOME, TRANSPORT, ['Reports', path]];
    if (s1 === 'salary-sheet' && !seg[2]) return [HOME, TRANSPORT, DRIVERS, ['All Drivers Salary Sheet', path]];
    if (s1 === 'salary-sheet') return [HOME, TRANSPORT, DRIVERS, [nm(seg[2]), `/transport/${seg[2]}`], ['Salary sheet', path]];
    if (s1 === 'salary') return [HOME, TRANSPORT, DRIVERS, [nm(seg[2]), `/transport/${seg[2]}`], ['Salary slip', path]];
    if (UUID.test(s1)) return [HOME, TRANSPORT, DRIVERS, ['All Drivers Trip Sheets', '/transport/trip-sheets'], [`${nm(s1)} · Trip sheet`, path]];
    return [HOME, TRANSPORT];
  }
  if (seg[0] === 'expenses') {
    const s1 = seg[1];
    if (!s1) return coStep ? [HOME, OFFICE, coStep, ['Bills & salary', path]] : [HOME, OFFICE];
    if (s1 === 'vat') return [HOME, OFFICE, ['VAT return', path]];
    if (s1 === 'summary') return q.get('tab') === 'vat' ? [HOME, OFFICE, ['Group Summary', path], ['VAT return', `${path}?tab=vat`]] : [HOME, OFFICE, ['Group Summary', path]];
    if (s1 === 'attendance') return [HOME, OFFICE, ...(coStep ? [coStep] : []), ['Attendance', path]];
    if (s1 === 'docs') return [HOME, OFFICE, ...(coStep ? [coStep] : []), [q.get('kind') === 'receipt' ? 'Payment receipt' : 'Invoice', path]];
    return [HOME, OFFICE];
  }
  if (seg[0] === 'docs') return [HOME, OFFICE, ['Documents Checklist', path]];
  if (seg[0] === 'inventory' && seg[1] === 'reports') return [HOME, INVENTORY, ['Reports', path]];
  if (seg[0] === 'inventory') return [HOME, INVENTORY];
  if (seg[0] === 'c') return [HOME, INVENTORY, ['Category', path]];
  if (seg[0] === 'bills') return [HOME, INVENTORY, ['Bills', path]];
  if (seg[0] === 'log') return [HOME, INVENTORY, ['Stock log', path]];
  if (seg[0] === 'admin') return [HOME, ADMIN];
  if (seg[0] === 'users') return [HOME, ADMIN, ['Users', path]];
  if (seg[0] === 'activity') return [HOME, ADMIN, ['User activity', path]];
  if (seg[0] === 'settings') return [HOME, ADMIN, ['Settings', path]];
  if (seg[0] === 'entry') return [HOME, ['Driver trip form', path]];
  if (seg[0] === 'sitemap') return [HOME, ['Sitemap', path]];
  if (seg[0] === 'timeline') return [HOME, ['Timeline', path]];
  return null;
}

export const showBreadcrumbs = (path) => path !== '/' && !/^\/(login|f)(\/|$)/.test(path);

export default function Breadcrumbs() {
  const path = usePathname();
  const [names, setNames] = useState({});
  const [search, setSearch] = useState('');

  // pages change ?co / ?kind without a page change, so look at the address now and then
  useEffect(() => {
    const tick = () => setSearch((old) => (window.location.search === old ? old : window.location.search));
    tick();
    const t = setInterval(tick, 700);
    return () => clearInterval(t);
  }, [path]);

  useEffect(() => {
    if (!/^\/transport\//.test(path) || Object.keys(names).length) return;
    sb().from('transport_drivers').select('id, name').then(({ data }) => {
      const m = {};
      (data || []).forEach((d) => { m[d.id] = d.name; });
      setNames(m);
    });
  }, [path, names]);

  if (!showBreadcrumbs(path)) return null;
  const steps = trail(path, new URLSearchParams(search), names);
  if (!steps || steps.length < 2) return null;

  return (
    <nav className="bc no-print" aria-label="You are here">
      {steps.map(([label, href], i) => {
        const last = i === steps.length - 1;
        return (
          <span key={`${href}-${i}`} style={{ display: 'contents' }}>
            {i > 0 && <span className="bc-sep" aria-hidden="true">›</span>}
            {last ? <span className="bc-here" aria-current="page">{label}</span> : <Link href={href}>{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}
