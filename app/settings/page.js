'use client';

import { useCallback, useEffect, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

function SettingsPage() {
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newAcc, setNewAcc] = useState({ name: '', payment_type: '' });
  const [editCat, setEditCat] = useState(null);
  const [editAcc, setEditAcc] = useState(null);
  const [del, setDel] = useState(null); // { kind: 'cat'|'acc', row }

  const load = useCallback(async () => {
    const s = sb();
    const [c, a] = await Promise.all([
      s.from('categories').select('id, name, sort, items(count)').order('sort').order('name'),
      s.from('bill_accounts').select('*').order('sort').order('name')
    ]);
    if (c.error || a.error) setError((c.error || a.error).message);
    setCats(c.data || []);
    setAccounts(a.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(text) { setMsg(text); setTimeout(() => setMsg(''), 2500); }

  async function run(promise, okText, after) {
    setBusy(true); setError('');
    const { error } = await promise;
    setBusy(false);
    if (error) {
      setError(error.code === '23505' ? 'That name already exists.' : error.message);
      return;
    }
    if (after) after();
    flash(okText);
    load();
  }

  function addCat(e) {
    e.preventDefault();
    if (!newCat.trim()) return;
    const sort = cats.reduce((m, c) => Math.max(m, c.sort || 0), 0) + 1;
    run(sb().from('categories').insert({ name: newCat.trim(), sort }), 'Category added', () => setNewCat(''));
  }

  function addAcc(e) {
    e.preventDefault();
    if (!newAcc.name.trim()) return;
    const sort = accounts.reduce((m, a) => Math.max(m, a.sort || 0), 0) + 1;
    run(sb().from('bill_accounts').insert({ name: newAcc.name.trim(), payment_type: newAcc.payment_type || null, sort }),
      'Bill added', () => setNewAcc({ name: '', payment_type: '' }));
  }

  function saveCat(e) {
    e.preventDefault();
    run(sb().from('categories').update({ name: editCat.name.trim(), sort: Number(editCat.sort) || 0 }).eq('id', editCat.id),
      'Category saved', () => setEditCat(null));
  }

  function saveAcc(e) {
    e.preventDefault();
    run(sb().from('bill_accounts').update({
      name: editAcc.name.trim(), payment_type: editAcc.payment_type || null,
      account_no: editAcc.account_no?.trim() || null, sort: Number(editAcc.sort) || 0
    }).eq('id', editAcc.id), 'Bill saved', () => setEditAcc(null));
  }

  function confirmDelete() {
    const table = del.kind === 'cat' ? 'categories' : 'bill_accounts';
    run(sb().from(table).delete().eq('id', del.row.id), 'Deleted', () => setDel(null));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Manage categories and bills. Items are managed inside each category.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <section className="panel">
        <h2>Categories</h2>
        <form className="form-row" onSubmit={addCat}>
          <div className="field">
            <label htmlFor="nc-name">New category</label>
            <input id="nc-name" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. Assets" />
          </div>
          <button className="btn" type="submit" disabled={busy}>Add category</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th className="num">Items</th><th className="num">Order</th><th></th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">{c.items?.[0]?.count ?? 0}</td>
                  <td className="num">{c.sort}</td>
                  <td><div className="actions">
                    <button className="btn small ghost" onClick={() => setEditCat({ ...c, sort: String(c.sort) })}>Edit</button>
                    <button className="btn small ghost" onClick={() => setDel({ kind: 'cat', row: c })}>Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Bills</h2>
        <form className="form-row" onSubmit={addAcc}>
          <div className="field">
            <label htmlFor="na-name">New bill</label>
            <input id="na-name" value={newAcc.name} onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="e.g. Gas" />
          </div>
          <div className="field narrow" style={{ flex: '0 1 150px' }}>
            <label htmlFor="na-type">Payment type</label>
            <select id="na-type" value={newAcc.payment_type} onChange={(e) => setNewAcc({ ...newAcc, payment_type: e.target.value })}>
              <option value="">None</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Postpaid">Postpaid</option>
            </select>
          </div>
          <button className="btn" type="submit" disabled={busy}>Add bill</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Payment type</th><th>Account no.</th><th className="num">Order</th><th></th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.payment_type || ''}</td>
                  <td>{a.account_no || ''}</td>
                  <td className="num">{a.sort}</td>
                  <td><div className="actions">
                    <button className="btn small ghost" onClick={() => setEditAcc({ ...a, sort: String(a.sort), account_no: a.account_no || '', payment_type: a.payment_type || '' })}>Edit</button>
                    <button className="btn small ghost" onClick={() => setDel({ kind: 'acc', row: a })}>Delete</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editCat && (
        <Modal title="Edit category" onClose={() => setEditCat(null)}>
          <form onSubmit={saveCat} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="ec-name">Name</label>
              <input id="ec-name" required value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ec-sort">Order on home page</label>
              <input id="ec-sort" type="number" value={editCat.sort} onChange={(e) => setEditCat({ ...editCat, sort: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditCat(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>Save</button>
            </div>
          </form>
        </Modal>
      )}

      {editAcc && (
        <Modal title="Edit bill" onClose={() => setEditAcc(null)}>
          <form onSubmit={saveAcc} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="ea-name">Name</label>
              <input id="ea-name" required value={editAcc.name} onChange={(e) => setEditAcc({ ...editAcc, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ea-type">Payment type</label>
              <select id="ea-type" value={editAcc.payment_type} onChange={(e) => setEditAcc({ ...editAcc, payment_type: e.target.value })}>
                <option value="">None</option>
                <option value="Prepaid">Prepaid</option>
                <option value="Postpaid">Postpaid</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ea-acc">Account / meter no.</label>
              <input id="ea-acc" value={editAcc.account_no} onChange={(e) => setEditAcc({ ...editAcc, account_no: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ea-sort">Order</label>
              <input id="ea-sort" type="number" value={editAcc.sort} onChange={(e) => setEditAcc({ ...editAcc, sort: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditAcc(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>Save</button>
            </div>
          </form>
        </Modal>
      )}

      {del && (
        <Modal title="Delete?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>
            Delete <strong>{del.row.name}</strong>?{' '}
            {del.kind === 'cat'
              ? 'All its items and their stock history will also be deleted.'
              : 'All its payment records will also be deleted.'}
          </p>
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
  return <AuthGate><SettingsPage /></AuthGate>;
}
