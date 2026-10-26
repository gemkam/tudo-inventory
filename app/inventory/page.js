'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { sb, isLow } from '@/lib/supabase';

function bySort(a, b) {
  return (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);
}

function InventoryHome() {
  const [cats, setCats] = useState(null);
  const [bills, setBills] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const s = sb();
      const [c, b] = await Promise.all([
        s.from('categories').select('id, name, sort, items(id, name, unit, quantity, min_qty, sort)').order('sort').order('name'),
        s.from('bill_accounts').select('id, name, payment_type, sort').order('sort').order('name')
      ]);
      if (c.error || b.error) setError((c.error || b.error).message);
      setCats((c.data || []).map((cat) => ({ ...cat, items: (cat.items || []).sort(bySort) })));
      setBills(b.data || []);
    })();
  }, []);

  if (!cats) return <div className="loading">Loading inventory...</div>;

  const lowItems = cats.flatMap((c) => c.items.filter(isLow).map((i) => ({ ...i, category: c.name, category_id: c.id })));

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <Link href="/log" className="btn ghost">Stock log</Link>
      </div>
      <h1 className="center">Inventory</h1>
      {error && <div className="error">{error}</div>}

      <div className="tiles">
        {cats.map((c) => {
          const low = c.items.filter(isLow).length;
          return (
            <div className="tile-wrap" key={c.id}>
              <Link href={`/c/${c.id}`} className="tile">
                <span>{c.name}</span>
                <span className="count">{c.items.length} items</span>
                {low > 0 && <span className="low-badge">{low} low</span>}
              </Link>
              <div className="drop">
                <ul>
                  {c.items.length === 0 && <li>No items yet</li>}
                  {c.items.map((i) => (
                    <li key={i.id} className={isLow(i) ? 'low' : ''}>
                      <span>{i.name}</span>
                      <span className="q">{Number(i.quantity)} {i.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}

        <div className="tile-wrap">
          <Link href="/bills" className="tile">
            <span>Bills</span>
            <span className="count">{bills.length} accounts</span>
          </Link>
          <div className="drop">
            <ul>
              {bills.map((b) => (
                <li key={b.id}>
                  <span>{b.name}</span>
                  <span className="q">{b.payment_type || ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <section className="panel">
        <h2>Low stock</h2>
        {lowItems.length === 0 ? (
          <p className="empty">Nothing is below its minimum level. Administrator can set a minimum on each item to get alerts here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Item</th><th>Category</th><th className="num">In stock</th><th className="num">Minimum</th></tr>
              </thead>
              <tbody>
                {lowItems.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td><Link href={`/c/${i.category_id}`}>{i.category}</Link></td>
                    <td className="num"><span className="pill low">{Number(i.quantity)} {i.unit}</span></td>
                    <td className="num">{Number(i.min_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function Page() {
  return <AuthGate><InventoryHome /></AuthGate>;
}
