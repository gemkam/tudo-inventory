'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb, isLow, fmtDateTime } from '@/lib/supabase';

const EMPTY_ITEM = { name: '', unit: 'pcs', quantity: '0', min_qty: '0' };

function CategoryPage() {
  const { id } = useParams();
  const [cat, setCat] = useState(null);
  const [items, setItems] = useState([]);
  const [moves, setMoves] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [newItem, setNewItem] = useState(EMPTY_ITEM);
  const [move, setMove] = useState(null);       // { item, type, qty, note }
  const [edit, setEdit] = useState(null);       // item copy
  const [del, setDel] = useState(null);         // item
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = sb();
    const [c, i, m] = await Promise.all([
      s.from('categories').select('id, name').eq('id', id).single(),
      s.from('items').select('*').eq('category_id', id).order('sort').order('name'),
      s.from('stock_moves').select('id, move_type, qty, note, created_at, items!inner(name, unit, category_id)')
        .eq('items.category_id', id).order('created_at', { ascending: false }).limit(30)
    ]);
    if (c.error) { setError('This category was not found.'); return; }
    if (i.error || m.error) setError((i.error || m.error).message);
    setCat(c.data);
    setItems(i.data || []);
    setMoves(m.data || []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function flash(text) { setMsg(text); setTimeout(() => setMsg(''), 2500); }

  async function addItem(e) {
    e.preventDefault();
    if (!newItem.name.trim()) return;
    setBusy(true); setError('');
    const maxSort = items.reduce((m, x) => Math.max(m, x.sort || 0), 0);
    const { error } = await sb().from('items').insert({
      category_id: id,
      name: newItem.name.trim(),
      unit: newItem.unit.trim() || 'pcs',
      quantity: Number(newItem.quantity) || 0,
      min_qty: Number(newItem.min_qty) || 0,
      sort: maxSort + 1
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNewItem(EMPTY_ITEM);
    flash('Item added');
    load();
  }

  async function saveMove(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await sb().rpc('record_move', {
      p_item: move.item.id, p_type: move.type, p_qty: Number(move.qty), p_note: move.note
    });
    setBusy(false);
    if (error) { setError(error.message); setMove(null); return; }
    flash(move.type === 'in' ? 'Stock added' : 'Stock taken out');
    setMove(null);
    load();
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await sb().from('items').update({
      name: edit.name.trim(), unit: edit.unit.trim() || 'pcs', min_qty: Number(edit.min_qty) || 0
    }).eq('id', edit.id);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setEdit(null);
    flash('Item saved');
    load();
  }

  async function confirmDelete() {
    setBusy(true); setError('');
    const { error } = await sb().from('items').delete().eq('id', del.id);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDel(null);
    flash('Item deleted');
    load();
  }

  if (!cat && !error) return <div className="loading">Loading...</div>;
  if (!cat) return <div className="error">{error} <Link href="/">Back to home</Link></div>;

  const lowCount = items.filter(isLow).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{cat.name}</h1>
          <p className="sub">{items.length} items{lowCount > 0 ? `, ${lowCount} low on stock` : ''}</p>
        </div>
        <Link href="/" className="btn ghost">Back to home</Link>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <section className="panel">
        <h2>Add item</h2>
        <form className="form-row" onSubmit={addItem}>
          <div className="field">
            <label htmlFor="ni-name">Item name</label>
            <input id="ni-name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g. Marker" required />
          </div>
          <div className="field narrow">
            <label htmlFor="ni-unit">Unit</label>
            <input id="ni-unit" value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} placeholder="pcs, box, ream" />
          </div>
          <div className="field narrow">
            <label htmlFor="ni-qty">Starting qty</label>
            <input id="ni-qty" type="number" min="0" step="any" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} />
          </div>
          <div className="field narrow">
            <label htmlFor="ni-min">Minimum</label>
            <input id="ni-min" type="number" min="0" step="any" value={newItem.min_qty} onChange={(e) => setNewItem({ ...newItem, min_qty: e.target.value })} />
          </div>
          <button className="btn" type="submit" disabled={busy}>Add item</button>
        </form>
      </section>

      <section className="panel">
        <h2>Stock</h2>
        {items.length === 0 ? <p className="empty">No items yet. Add the first item above.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Item</th><th className="num">In stock</th><th className="num">Minimum</th><th>Status</th><th className="num">Actions</th></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="num">{Number(i.quantity)} {i.unit}</td>
                    <td className="num">{Number(i.min_qty)}</td>
                    <td>
                      {Number(i.min_qty) === 0 ? <span className="pill neutral">No minimum</span>
                        : isLow(i) ? <span className="pill low">Low</span> : <span className="pill ok">OK</span>}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn small in" onClick={() => setMove({ item: i, type: 'in', qty: '', note: '' })}>+ In</button>
                        <button className="btn small danger" onClick={() => setMove({ item: i, type: 'out', qty: '', note: '' })}>- Out</button>
                        <button className="btn small ghost" onClick={() => setEdit({ ...i, min_qty: String(i.min_qty) })}>Edit</button>
                        <button className="btn small ghost" onClick={() => setDel(i)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recent stock in / out</h2>
        {moves.length === 0 ? <p className="empty">No stock movement recorded yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th className="num">Qty</th><th>Note</th></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDateTime(m.created_at)}</td>
                    <td>{m.items?.name}</td>
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

      {move && (
        <Modal title={`${move.type === 'in' ? 'Stock in' : 'Stock out'}: ${move.item.name}`} onClose={() => setMove(null)}>
          <form onSubmit={saveMove} style={{ display: 'grid', gap: 12 }}>
            <p className="sub" style={{ margin: 0 }}>Currently in stock: {Number(move.item.quantity)} {move.item.unit}</p>
            <div className="field">
              <label htmlFor="mv-qty">Quantity</label>
              <input id="mv-qty" type="number" min="0" step="any" autoFocus required value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="mv-note">Note (optional)</label>
              <input id="mv-note" value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} placeholder={move.type === 'in' ? 'e.g. Bought from Lulu' : 'e.g. Given to reception'} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setMove(null)}>Cancel</button>
              <button type="submit" className={`btn ${move.type === 'in' ? 'in' : 'danger'}`} disabled={busy}>
                {move.type === 'in' ? 'Add to stock' : 'Take out'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {edit && (
        <Modal title="Edit item" onClose={() => setEdit(null)}>
          <form onSubmit={saveEdit} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="ed-name">Item name</label>
              <input id="ed-name" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="ed-unit">Unit</label>
                <input id="ed-unit" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ed-min">Minimum</label>
                <input id="ed-min" type="number" min="0" step="any" value={edit.min_qty} onChange={(e) => setEdit({ ...edit, min_qty: e.target.value })} />
              </div>
            </div>
            <p className="sub" style={{ margin: 0 }}>To change the quantity, use + In or - Out so it is recorded in the log.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>Save</button>
            </div>
          </form>
        </Modal>
      )}

      {del && (
        <Modal title="Delete item?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <strong>{del.name}</strong>? Its stock in / out history will also be deleted.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete} disabled={busy}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate><CategoryPage /></AuthGate>;
}
