'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import TruckAnim from '@/components/TruckAnim';
import AlertsPanel from '@/components/AlertsPanel';
import HomeSearch from '@/components/HomeSearch';
import { sb, isLow } from '@/lib/supabase';

function Letterhead() {
  return (
    <span className="hub-letterhead">
      <img src="/tudonum-logo.png" alt="Tudo Num" />
      <span className="hub-co">
        <b>MODERN CITY FOR EXPRESS SERVICES LLC</b>
        <span>CR No. 1404742 · VAT Registration No. OM11008665</span>
        <span>PO Box 149, PC 133, Sultanate of Oman · www.tudonumgroup.com</span>
      </span>
    </span>
  );
}

function Home() {
  const { isAdmin, isOwner } = useUser();
  const [inv, setInv] = useState(null);
  const [tr, setTr] = useState(null);
  const [ex, setEx] = useState(null);

  useEffect(() => {
    (async () => {
      const s = sb();
      const [c, d, e, x] = await Promise.all([
        s.from('categories').select('id, name, items(quantity, min_qty)').order('sort'),
        s.from('transport_drivers').select('id, name').order('sort'),
        s.from('transport_entries').select('entry_date').order('entry_date', { ascending: false }).limit(1),
        s.from('exp_entries').select('entry_date, paid')
      ]);
      const cats = c.data || [];
      const items = cats.flatMap((x) => x.items || []);
      setInv({ sections: cats.map((x) => x.name), items: items.length, low: items.filter(isLow).length });
      setTr({ drivers: (d.data || []).map((y) => y.name), last: e.data?.[0]?.entry_date || null });
      const ex2 = x.data || [];
      const lastMonth = ex2.map((r) => String(r.entry_date).slice(0, 7)).sort().pop();
      setEx({ bills: ex2.length, month: lastMonth, paid: ex2.filter((r) => String(r.entry_date).startsWith(lastMonth || '-')).reduce((t, r) => t + Number(r.paid || 0), 0) });
    })();
  }, []);

  return (
    <>
      <div className="home-hero">
        <span className="home-kicker">Modern City · Abu Wasif · Sumptuosity</span>
        <h1 className="center">Tudo Num Office Systems</h1>
        <span className="home-rule" aria-hidden="true"><i /></span>
      </div>
      <HomeSearch />
      <div className="home-grid">
      <div className="home-main">
      <div className="hub">
        <Link href="/inventory" className="hub-tile">
          <Letterhead />
          <span className="hub-kicker">Office</span>
          <span className="hub-title">Inventory</span>
          <span className="hub-sub">
            {inv ? `${[...inv.sections, 'Bills'].join(' · ')}` : 'Office supplies · Kitchen · Sanitary · Bills'}
          </span>
          <span className="hub-meta">
            {inv ? <>{inv.items} {inv.items === 1 ? "item" : "items"}{inv.low > 0 && <b className="hub-alert">{inv.low} low</b>}</> : ' '}
          </span>
        </Link>
        <Link href="/transport" className="hub-tile">
          <Letterhead />
          <span className="hub-kicker">Transport Division</span>
          <span className="hub-title-row">
            <span className="hub-title">Transport Expense</span>
            <TruckAnim />
          </span>
          <span className="hub-sub">Trips · Diesel · Tolls · Maintenance · Salaries</span>
          <span className="hub-meta">
            {tr ? <>{tr.drivers.length} drivers{tr.drivers.length > 0 && `: ${tr.drivers.join(', ')}`}</> : ' '}
          </span>
        </Link>
        <Link href="/expenses" className="hub-tile">
          <span className="hub-brand brand-anim" role="img" aria-label="Tudo Num Group">
            <img className="ba-base" src="/brand-base.png" alt="" />
            <img className="ba-swap" src="/brand-text-swap.png" alt="" />
            <img className="ba-arrow" src="/brand-arrow.png" alt="" />
          </span>
          <span className="hub-kicker">Modern City · Abu Wasif · Sumptuosity · Transport</span>
          <span className="hub-title">Office Expense</span>
          <span className="hub-sub">Bills · Salary · Petrol · Utility · VAT · 🚚 Trips &amp; Diesel</span>
          <span className="hub-meta">
            {ex ? (ex.bills ? <>{ex.bills} bills · {ex.month ? new Date(`${ex.month}-01T00:00:00`).toLocaleString('en-GB', { month: 'long' }) : ''}: {ex.paid.toFixed(3)} OMR</> : 'No bills yet') : ' '}
          </span>
        </Link>
      </div>
      {isAdmin && (
        <div className="home-quick">
          <Link href="/entry" className="dc-home" aria-label="Data entry">
            <span className="dc-home-ico" aria-hidden="true">✍️</span>
            <span className="dc-home-text">
              <b>Data entry</b>
              <small>Trip entry form and driver share links</small>
            </span>
            <span className="adm-go" aria-hidden="true">›</span>
          </Link>
          <Link href="/expenses/docs" className="dc-home" aria-label="Invoices and Receipts">
            <span className="dc-home-ico" aria-hidden="true">🧾</span>
            <span className="dc-home-text">
              <b>Invoices &amp; Receipts</b>
              <small>Modern City · Abu Wasif · Sumptuosity</small>
            </span>
            <span className="adm-go" aria-hidden="true">›</span>
          </Link>
        </div>
      )}
      {isAdmin && (
        <Link href="/admin" className="dc-home adm-home" aria-label="Admin">
          <span className="dc-home-ico" aria-hidden="true">🛡</span>
          <span className="dc-home-text">
            <b>Admin</b>
            <small>{isOwner ? 'Users · User activity · Settings · Timeline · Sitemap' : 'Settings · Timeline · Sitemap'}</small>
          </span>
          <span className="adm-go" aria-hidden="true">›</span>
        </Link>
      )}
      </div>
      <AlertsPanel />
      </div>
      <div className="powered-by" aria-label="Powered by KS TECH LLC">Powered by <b>KS TECH LLC</b></div>
    </>
  );
}

export default function Page() {
  return <AuthGate wide><Home /></AuthGate>;
}
