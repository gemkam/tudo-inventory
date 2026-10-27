'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { sb, isLow } from '@/lib/supabase';

function Home() {
  const [inv, setInv] = useState(null);
  const [tr, setTr] = useState(null);

  useEffect(() => {
    (async () => {
      const s = sb();
      const [c, d, e] = await Promise.all([
        s.from('categories').select('id, name, items(quantity, min_qty)').order('sort'),
        s.from('transport_drivers').select('id, name').order('sort'),
        s.from('transport_entries').select('entry_date').order('entry_date', { ascending: false }).limit(1)
      ]);
      const cats = c.data || [];
      const items = cats.flatMap((x) => x.items || []);
      setInv({ sections: cats.map((x) => x.name), items: items.length, low: items.filter(isLow).length });
      setTr({ drivers: (d.data || []).map((x) => x.name), last: e.data?.[0]?.entry_date || null });
    })();
  }, []);

  return (
    <>
      <h1 className="center">Tudo Office Inventory System</h1>
      <div className="hub">
        <Link href="/inventory" className="hub-tile">
          <span className="hub-logo center"><img src="/tudonum-logo-lg.png" alt="Tudo Num" /></span>
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
          <span className="hub-logo"><img src="/tudonum-logo.png" alt="Tudo Num" /></span>
          <span className="hub-kicker">Transport Division</span>
          <span className="hub-title">Transport Expense</span>
          <span className="hub-sub">Trips · Diesel · Tolls · Maintenance · Salaries</span>
          <span className="hub-meta">
            {tr ? <>{tr.drivers.length} drivers{tr.drivers.length > 0 && `: ${tr.drivers.join(', ')}`}</> : ' '}
          </span>
        </Link>
      </div>
    </>
  );
}

export default function Page() {
  return <AuthGate><Home /></AuthGate>;
}
