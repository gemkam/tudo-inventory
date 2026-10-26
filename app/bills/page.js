'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb, fmtOMR, fmtDate } from '@/lib/supabase';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function BillsPage() {
  const { isAdmin } = useUser();
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [del, setDel] = useState(null);
  const [form, setForm] = useState({ account_id: '', amount: '', paid_on: today(), period: '', note: '' });

  const load = useCallback(async () => {
    const s = sb();
    const [a, p] = await Promise.all([
      s.from('bill_accounts').select('*').order('sort').order('name'),
      s.from('bill_payments').select('*, bill_accounts(name, payment_type)').order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(300)
    ]);
    if (a.error || p.error) setError((a.error || p.error).message);
    setAccounts(a.data || []);
    setPayments(p.data || []);
    setForm((f) => ({ ...f, account_id: f.account_id || a.data?.[0]?.id || '' }));
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(text) { setMsg(text); setTimeout(() => setMsg(''), 2500); }

  async function addPayment(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await sb().from('bill_payments').insert({
      account_id: form.account_id,
      amount: Number(form.amount),
      paid_on: form.paid_on,
      period: form.period.trim() || null,
      note: form.note.trim() || null
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setForm({ ...form, amount: '', period: '', note: '' });
    flash('Payment saved');
    load();
  }

  async function confirmDelete() {
    setBusy(true);
    const { error } = await sb().from('bill_payments').delete().eq('id', del.id);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDel(null);
    flash('Payment deleted');
    load();
  }

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = payments.filter((p) => p.paid_on?.startsWith(monthKey));
  const thisYear = payments.filter((p) => p.paid_on?.startsWith(String(now.getFullYear())));
  const sum = (list) => list.reduce((t, p) => t + Number(p.amount), 0);
  const shown = filter === 'all' ? payments : payments.filter((p) => p.account_id === filter);

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/inventory" className="crumb">← Inventory</Link>
          <h1>Bills</h1>
          <p className="sub">Electricity, water, dispenser and internet payments</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="stats">
        <div className="stat"><div className="label">This month</div><div className="value">{fmtOMR(sum(thisMonth))}</div></div>
        <div className="stat"><div className="label">This year</div><div className="value">{fmtOMR(sum(thisYear))}</div></div>
        {accounts.map((a) => {
          const last = payments.find((p) => p.account_id === a.id);
          return (
            <div className="stat" key={a.id}>
              <div className="label">{a.name}{a.payment_type ? ` (${a.payment_type})` : ''}</div>
              <div className="value" style={{ fontSize: 18 }}>{last ? fmtOMR(last.amount) : 'No payments'}</div>
              {last && <div className="sub" style={{ fontSize: 13 }}>Last paid {fmtDate(last.paid_on)}</div>}
            </div>
          );
        })}
      </div>

      {isAdmin && <section className="panel">
        <h2>Add payment</h2>
        <form className="form-row" onSubmit={addPayment}>
          <div className="field">
            <label htmlFor="bp-acc">Bill</label>
            <select id="bp-acc" required value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.payment_type ? ` (${a.payment_type})` : ''}</option>)}
            </select>
          </div>
          <div className="field narrow">
            <label htmlFor="bp-amt">Amount (OMR)</label>
            <input id="bp-amt" type="number" min="0" step="0.001" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="field narrow">
            <label htmlFor="bp-date">Paid on</label>
            <input id="bp-date" type="date" required value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
          </div>
          <div className="field narrow">
            <label htmlFor="bp-period">For month</label>
            <input id="bp-period" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. Oct 2026" />
          </div>
          <div className="field">
            <label htmlFor="bp-note">Note</label>
            <input id="bp-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Receipt no., top-up, etc." />
          </div>
          <button className="btn" type="submit" disabled={busy || !form.account_id}>Save payment</button>
        </form>
      </section>}

      <section className="panel">
        <div className="page-head">
          <h2>Payment history</h2>
          <div className="field narrow" style={{ flex: '0 1 200px' }}>
            <label htmlFor="bp-filter">Show</label>
            <select id="bp-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All bills</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {shown.length === 0 ? <p className="empty">No payments recorded yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Paid on</th><th>Bill</th><th>For month</th><th className="num">Amount</th><th>Note</th>{isAdmin && <th></th>}</tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.paid_on)}</td>
                    <td>{p.bill_accounts?.name}</td>
                    <td>{p.period || ''}</td>
                    <td className="num">{fmtOMR(p.amount)}</td>
                    <td>{p.note || ''}</td>
                    {isAdmin && <td><div className="actions"><button className="btn small ghost" onClick={() => setDel(p)}>Delete</button></div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {del && (
        <Modal title="Delete payment?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete the {del.bill_accounts?.name} payment of {fmtOMR(del.amount)} on {fmtDate(del.paid_on)}?</p>
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
  return <AuthGate><BillsPage /></AuthGate>;
}
