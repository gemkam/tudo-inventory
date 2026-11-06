'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';

/*
  "Where am I" map on top of every page (rendered by components/AuthGate.js), every step clickable:
  e.g. Home › Transport › Drivers › All Drivers Trip Sheets.  Driver names come from the drivers table,
  All Companies company from ?co. Add new pages to trail() below (and to lib/sitemap.js).

  CAME FROM (5 Nov 2026): one page can be opened from many places (Salary from All Companies,
  Accounts, Personnel ...). When a link in the page body is clicked, the path you were on is kept
  (sessionStorage tudo-bc-from, per tab, survives refresh), so the next page shows e.g.
  Home › Accounts › All accounts › Salary plus "‹ Back to All accounts", which returns to the same
  scroll spot. Links in the top bar, side menu and company tabs open the page's normal path.
  Month / company changes on the same page keep the path.
*/

const FROM_KEY = 'tudo-bc-from';
const BACK_KEY = 'tudo-bc-restore';
// clicks here mean "go to that section normally"
const NATURAL = 'header.topbar, .tbx, .co-switch, .co-tab, [class*="tsn"]';
const readJSON = (store, k) => { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (store, k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch {} };
const pathOf = (href) => { try { return new URL(href, window.location.origin).pathname; } catch { return href; } };


const HOME = ['Home', '/'];
const TRANSPORT = ['Transport', '/transport'];
const DRIVERS = ['Drivers', '/transport/drivers'];
const OFFICE = ['All Companies', '/expenses'];
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
    if (s1 === 'combined') return [HOME, TRANSPORT, DRIVERS, ['All Drivers Trip Sheets', '/transport/trip-sheets'], ['Combined sheet', path]];
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
    if (s1 === 'salary') return [HOME, OFFICE, ...(coStep ? [coStep] : []), ['Salary', path]];
    if (s1 === 'summary') return q.get('tab') === 'vat' ? [HOME, ['Reports & Summary', path], ['VAT return', `${path}?tab=vat`]] : [HOME, ['Reports & Summary', path]];
    if (s1 === 'attendance') return [HOME, OFFICE, ...(coStep ? [coStep] : []), ['Attendance', path]];
    if (s1 === 'docs') return [HOME, OFFICE, ...(coStep ? [coStep] : []), [q.get('kind') === 'invoice' ? 'Invoice' : 'Bills', path]];
    return [HOME, OFFICE];
  }
  if (seg[0] === 'docs') return [HOME, OFFICE, ['Documents Checklist', path]];
  if (seg[0] === 'inventory' && seg[1] === 'reports') return [HOME, INVENTORY, ['Reports', path]];
  if (seg[0] === 'inventory') return [HOME, INVENTORY];
  if (seg[0] === 'c') return [HOME, INVENTORY, ['Category', path]];
  if (seg[0] === 'bills') return [HOME, INVENTORY, ['Bills', path]];
  if (seg[0] === 'log') return [HOME, INVENTORY, ['Stock log', path]];
  if (seg[0] === 'personnel') {
    const t = { office: 'Office Employees', drivers: 'Drivers', site: 'Site Employees', sub: 'Subcontractors', attendance: 'Attendance', archives: 'Archives', slips: 'Salary slips' }[q.get('tab') || 'office'];
    return [HOME, ['Employees', '/personnel'], [t || 'Office Employees', path]];
  }
  if (seg[0] === 'accounts') {
    const t = { all: 'All accounts', bank: 'Bank & Cash', balance: 'Balance sheet', receive: 'Money to receive', pay: 'Money to pay', items: 'Assets, loans & capital' }[q.get('tab') || 'all'];
    return [HOME, ['Accounts', '/accounts'], [t || 'All accounts', path]];
  }
  if (seg[0] === 'chairman' && seg[2] === 'approvals') return [HOME, ['Chairman', '/chairman'], [{ asif: 'Asif Altaf', sibtain: 'Sibtain' }[seg[1]] || seg[1], `/chairman/${seg[1]}`], ['Approvals', path]];
  if (seg[0] === 'chairman') return seg[1] ? [HOME, ['Chairman', '/chairman'], [{ asif: 'Asif Altaf', sibtain: 'Sibtain' }[seg[1]] || seg[1], path]] : [HOME, ['Chairman', '/chairman']];
  if (seg[0] === 'admin' && seg[1] === 'power') return [HOME, ADMIN, ['Power Editor', path]];
  if (seg[0] === 'admin') return [HOME, ADMIN];
  if (seg[0] === 'users') return [HOME, ADMIN, ['Users', path]];
  if (seg[0] === 'activity') return [HOME, ADMIN, ['User activity', path]];
  if (seg[0] === 'settings') return [HOME, ADMIN, ['Settings', path]];
  if (seg[0] === 'entry') return [HOME, ['Data entry', path]];
  if (seg[0] === 'sitemap') return [HOME, ['Sitemap', path]];
  if (seg[0] === 'timeline') return [HOME, ['Timeline', path]];
  return null;
}

export const showBreadcrumbs = (path) => path !== '/' && !/^\/(login|f|s)(\/|$)/.test(path);

// natural path, or the path you came from + this page
function withOrigin(path, natural, entry) {
  if (!natural || !entry || !Array.isArray(entry.steps) || entry.steps.length < 1) return { steps: natural, came: false };
  const from = entry.steps;
  // same section (e.g. Transport -> Transport page) or the chain loops back here: normal path
  if (from[1] && natural[1] && from[1][0] === natural[1][0]) return { steps: natural, came: false };
  if (from.some(([, h]) => pathOf(h) === path)) return { steps: natural, came: false };
  let steps = [...from, natural[natural.length - 1]];
  if (steps.length > 6) steps = [steps[0], ...steps.slice(steps.length - 5)];
  return { steps, came: true };
}

export default function Breadcrumbs() {
  const path = usePathname();
  const [names, setNames] = useState({});
  const [search, setSearch] = useState('');
  const [entry, setEntry] = useState(null);
  const shown = useRef(null); // steps on screen now, read by the click listener

  // pages change ?co / ?kind without a page change, so look at the address now and then
  useEffect(() => {
    const tick = () => setSearch((old) => (window.location.search === old ? old : window.location.search));
    tick();
    const t = setInterval(tick, 700);
    return () => clearInterval(t);
  }, [path]);

  // where this page was opened from (this browser tab only)
  useEffect(() => {
    const all = readJSON(window.sessionStorage, FROM_KEY) || {};
    setEntry(all[path] || null);
  }, [path]);

  // back to the same spot on the page you came from
  useEffect(() => {
    const r = readJSON(window.sessionStorage, BACK_KEY);
    if (!r || r.path !== path) return;
    try { window.sessionStorage.removeItem(BACK_KEY); } catch {}
    if (!(r.y > 0)) return;
    let stop = false;
    const stopOnUser = () => { stop = true; };
    window.addEventListener('wheel', stopOnUser, { passive: true });
    window.addEventListener('touchstart', stopOnUser, { passive: true });
    const timers = [150, 400, 800, 1300, 2000].map((ms) => setTimeout(() => { if (!stop) window.scrollTo(0, r.y); }, ms));
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('wheel', stopOnUser);
      window.removeEventListener('touchstart', stopOnUser);
    };
  }, [path]);

  // remember the path when a link in the page body is clicked
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url;
      try { url = new URL(a.getAttribute('href'), window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      const here = window.location.pathname;
      const to = url.pathname;
      if (to === here) return; // same page, only month / company / tab changes
      const store = window.sessionStorage;
      const all = readJSON(store, FROM_KEY) || {};

      if (a.closest('nav.bc')) {
        // breadcrumb or Back: go back to the spot where you clicked
        const mine = all[here];
        const last = mine && mine.steps && mine.steps[mine.steps.length - 1];
        if (last && pathOf(last[1]) === to) writeJSON(store, BACK_KEY, { path: to, y: mine.y || 0 });
        return;
      }
      if (a.closest(NATURAL) || to === '/') { delete all[to]; writeJSON(store, FROM_KEY, all); return; }

      const steps = shown.current;
      if (!steps || steps.length < 2) { delete all[to]; writeJSON(store, FROM_KEY, all); return; }
      const now = steps.map((s, i) => (i === steps.length - 1 ? [s[0], here + window.location.search] : s));
      all[to] = { steps: now, y: Math.round(window.scrollY || 0) };
      writeJSON(store, FROM_KEY, all);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!/^\/transport\//.test(path) || Object.keys(names).length) return;
    sb().from('transport_drivers').select('id, name').then(({ data }) => {
      const m = {};
      (data || []).forEach((d) => { m[d.id] = d.name; });
      setNames(m);
    });
  }, [path, names]);

  const visible = showBreadcrumbs(path);
  const natural = visible ? trail(path, new URLSearchParams(search), names) : null;
  const { steps, came } = withOrigin(path, natural, entry && entry.steps ? entry : null);
  shown.current = steps && steps.length >= 2 ? steps.map((s, i) => (i === steps.length - 1 ? [s[0], path] : s)) : null;
  if (!visible || !steps || steps.length < 2) return null;
  const back = came ? steps[steps.length - 2] : null;

  return (
    <nav className="bc no-print" aria-label="You are here">
      {back && <Link href={back[1]} className="bc-back" title="Go back to where you opened this page">‹ Back to {back[0]}</Link>}
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
