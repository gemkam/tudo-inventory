'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { sb, fmtDateTime } from '@/lib/supabase';

function LogPage() {
  const [moves, setMoves] = useState(null);
  const [cats, setCats] = useState([]);
  const [type, setType] = useState('all');
  const [cat, setCat] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const s = sb();
      const [m, c] = await Promise.all([
        s.from('stock_moves').select('id, move_type, qty, note, created_at, items(name, unit, category_id, categories(name))')
          .order('created_at', { ascending: false }).limit(500),
        s.from('categories').select('id, name').order('sort').order('name')
      ]);
      if (m.error || c.error) setError((m.error || c.error).message);
      setMoves(m.data || []);
      setCats(c.data || []);
    })();
  }, []);

  if (!moves) return <div className="loading">Loading log...</div>;

  const shown = moves.filter((m) =>
    (type === 'all' || m.move_type === type) && (cat === 'all' || m.items?.category_id === cat));

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/inventory" className="crumb">← Inventory</Link>
          <h1>Stock log</h1>
          <p className="sub">Every stock in and stock out, newest first</p>
        </div>
        <div className="form-row">
          <div className="field narrow" style={{ flex: '0 1 170px' }}>
            <label htmlFor="lg-cat">Category</label>
            <select id="lg-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="all">All</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field narrow" style={{ flex: '0 1 130px' }}>
            <label htmlFor="lg-type">Type</label>
            <select id="lg-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All</option>
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        {shown.length === 0 ? <p className="empty">No stock movement found.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Item</th><th>Category</th><th>Type</th><th className="num">Qty</th><th>Note</th></tr></thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDateTime(m.created_at)}</td>
                    <td>{m.items?.name}</td>
                    <td>{m.items?.categories?.name}</td>
                    <td><span className={`pill ${m.move_type}`}>{m.move_type === 'in' ? 'In' : 'Out'}</span></td>
                    <td className="num">{Number(m.qty)} {m.items?.unit}</td>
                    <td>{m.note || ''}</td>
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
  return <AuthGate><LogPage /></AuthGate>;
}
