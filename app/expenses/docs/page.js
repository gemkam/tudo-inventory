'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import DateInput from '@/components/DateInput';
import Omr, { fmt3 } from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { todayISO, fmtFullDate } from '@/lib/sheet';
import { omrInWords } from '@/lib/words';
import { COMPANIES, companyOf, DEPARTMENTS, HEADS, CATEGORIES, PAY_METHODS, n, r3 } from '@/lib/expenses';

/*
  Simple invoice and payment receipt for the 3 companies (Modern City, Abu Wasif, Sumptuosity).
  Table company_docs. A saved PAYMENT RECEIPT is added to that company's Office Expense by a DB trigger
  (sync_transport_exp): change or delete the receipt and the expense line follows.
*/

const KINDS = {
  invoice: { label: 'Invoices', one: 'Invoice', title: 'INVOICE', prefix: 'INV', party: 'Bill to', partyPh: 'Client name' },
  receipt: { label: 'Payment receipts', one: 'Payment receipt', title: 'PAYMENT RECEIPT', prefix: 'PR', party: 'Paid to', partyPh: 'Name of person or company paid' }
};
const CO_CODE = { 'modern-city': 'MC', 'abu-wasif': 'AW', sumptuosity: 'ST' };
const fmtD = (d) => (d ? fmtFullDate(d) : '');
const lineTotal = (items) => r3((items || []).reduce((t, i) => t + n(i.amount), 0));
const blankItems = () => [{ desc: '', amount: '' }, { desc: '', amount: '' }, { desc: '', amount: '' }];

function DocsPage() {
  const { isAdmin, name: me } = useUser();
  const [co, setCo] = useState(null);
  const [kind, setKind] = useState('invoice');
  const [list, setList] = useState(null);
  const [doc, setDoc] = useState(null); // open document (editor)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(false);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const flash = useCallback((text, k = 'ok') => {
    setToast({ text, kind: k });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    let c = ''; let k = '';
    try {
      const p = new URLSearchParams(window.location.search);
      c = p.get('co') || localStorage.getItem('tudo-exp-co') || '';
      k = p.get('kind') || '';
    } catch { /* ignore */ }
    setCo(COMPANIES.some((x) => x.key === c) ? c : 'modern-city');
    if (KINDS[k]) setKind(k);
  }, []);

  useEffect(() => {
    if (!co) return;
    try { window.history.replaceState(null, '', `/expenses/docs?co=${co}&kind=${kind}`); localStorage.setItem('tudo-exp-co', co); } catch { /* ignore */ }
  }, [co, kind]);

  const load = useCallback(async () => {
    if (!co) return;
    const { data, error } = await sb().from('company_docs').select('*').eq('company', co).eq('kind', kind)
      .order('doc_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) { flash(error.message, 'err'); setList([]); return; }
    setList(data || []);
  }, [co, kind, flash]);
  useEffect(() => { setList(null); load(); }, [load]);

  const C = companyOf(co);
  const K = KINDS[kind];

  /* Choices from earlier documents (pick or type) */
  const parties = useMemo(() => [...new Set((list || []).map((d) => d.party).filter(Boolean))], [list]);
  const partyInfo = useMemo(() => {
    const m = {};
    for (const d of list || []) if (d.party && !m[d.party]) m[d.party] = { party_details: d.party_details || '', party_vat: d.party_vat || '' };
    return m;
  }, [list]);

  function nextNo() {
    const pre = `${K.prefix}-${CO_CODE[co] || 'X'}-`;
    const max = (list || []).reduce((mx, d) => {
      const m = String(d.doc_no || '').match(/(\d+)\s*$/);
      return m ? Math.max(mx, Number(m[1])) : mx;
    }, 0);
    return `${pre}${String(max + 1).padStart(4, '0')}`;
  }

  function newDoc() {
    const last = (list || [])[0];
    setDoc({
      id: null, company: co, kind, doc_no: nextNo(), doc_date: todayISO(), party: '', party_details: '', party_vat: '',
      items: blankItems(), vat_pct: kind === 'invoice' ? n(last?.vat_pct) : 0,
      payment_method: kind === 'receipt' ? (last?.payment_method || 'Cash') : '',
      department: kind === 'receipt' ? (last?.department || (DEPARTMENTS[co] || [])[0] || '') : '',
      head: kind === 'receipt' ? (last?.head || 'Office Expenses') : '', category: '',
      notes: '', signatory: last?.signatory || ''
    });
    setDirty(true);
  }

  function openDoc(d) {
    const items = Array.isArray(d.items) && d.items.length ? d.items.map((i) => ({ desc: i.desc || '', amount: i.amount ?? '' })) : blankItems();
    setDoc({ ...d, items });
    setDirty(false);
  }

  function closeDoc() {
    if (dirty && isAdmin && !window.confirm('Close without saving?')) return;
    setDoc(null); setDirty(false);
  }

  const set = (k, v) => { setDoc((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setItem = (i, k, v) => { setDoc((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })); setDirty(true); };
  const addItem = () => { setDoc((d) => ({ ...d, items: [...d.items, { desc: '', amount: '' }] })); setDirty(true); };
  const removeItem = (i) => { setDoc((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, j) => j !== i) : [{ desc: '', amount: '' }] })); setDirty(true); };

  function pickParty(v) {
    setDoc((d) => {
      const info = partyInfo[v];
      return info && !d.party_details ? { ...d, party: v, ...info } : { ...d, party: v };
    });
    setDirty(true);
  }

  async function saveDoc() {
    if (!doc.party?.trim()) { flash(`Please fill "${K.party}".`, 'err'); return; }
    const items = doc.items
      .map((i) => ({ desc: String(i.desc || '').trim(), amount: i.amount === '' || i.amount === null ? '' : r3(i.amount) }))
      .filter((i) => i.desc || i.amount !== '');
    if (!items.length) { flash('Add at least one line with an amount.', 'err'); return; }
    setSaving(true);
    const row = {
      company: co, kind, doc_no: doc.doc_no || null, doc_date: doc.doc_date || todayISO(), party: doc.party.trim(),
      party_details: doc.party_details || null, party_vat: doc.party_vat || null, items, vat_pct: n(doc.vat_pct),
      payment_method: doc.payment_method || null, department: doc.department || null, head: doc.head || null, category: doc.category || null,
      notes: doc.notes || null, signatory: doc.signatory || null, updated_at: new Date().toISOString()
    };
    const s = sb().from('company_docs');
    const res = doc.id
      ? await s.update(row).eq('id', doc.id).select().single()
      : await s.insert({ ...row, created_by: me || null }).select().single();
    setSaving(false);
    if (res.error) { flash(res.error.code === '42501' ? 'You need Full access to save.' : res.error.message, 'err'); return; }
    setDoc({ ...res.data, items: res.data.items.length ? res.data.items : blankItems() });
    setDirty(false);
    load();
    flash(kind === 'receipt' ? `Saved. Added to ${C.short} Office Expense.` : 'Saved');
  }

  async function deleteDoc() {
    const { error } = await sb().from('company_docs').delete().eq('id', doc.id);
    if (error) { flash(error.message, 'err'); return; }
    setDel(false); setDoc(null); setDirty(false); load();
    flash(kind === 'receipt' ? 'Deleted. Removed from Office Expense too.' : 'Deleted');
  }

  function printDoc() {
    if (dirty && isAdmin) flash('Tip: press Save first so this copy is kept.');
    setTimeout(() => window.print(), 50);
  }

  if (!co) return <div className="loading">Loading...</div>;

  const switcher = (
    <div className="co-switch no-print" role="tablist" aria-label="Company">
      {COMPANIES.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={co === c.key} className={co === c.key ? 'on' : ''}
          onClick={() => { if (doc) closeDoc(); setCo(c.key); }}>{c.short}</button>
      ))}
      <Link href="/transport" className="co-tab co-tr">🚚 Transport</Link>
    </div>
  );

  /* ---------------- Editor / paper ---------------- */
  if (doc) {
    const ro = !isAdmin;
    const sub = lineTotal(doc.items);
    const vat = r3((sub * n(doc.vat_pct)) / 100);
    const tot = r3(sub + vat);
    const depts = [...new Set([...(DEPARTMENTS[co] || []), doc.department].filter(Boolean))];
    return (
      <>
        <div className="page-tools">
          <button type="button" className="crumb linkish" onClick={closeDoc}>← {K.label}</button>
          <div className="tools">
            {isAdmin && <button type="button" className="btn" onClick={saveDoc} disabled={saving}>{saving ? 'Saving...' : dirty ? '💾 Save' : '✓ Saved'}</button>}
            <button type="button" className="btn ghost" onClick={printDoc}>🖨 Print / PDF</button>
            {isAdmin && doc.id && <button type="button" className="btn ghost danger-text" onClick={() => setDel(true)}>Delete</button>}
          </div>
        </div>
        {kind === 'receipt' && <p className="cd-hint no-print">When you save, this receipt is added to <b>{C.short}</b> Office Expense{doc.department ? <> (department <b>{doc.department}</b>)</> : ''} by itself. Change or delete it here and the expense follows.</p>}

        <article className={`cd-paper k-${kind}${ro ? ' ro' : ''}`}>
          <header className="cd-head">
            <img className="cd-logo" src={C.logo} alt={C.short} />
            <div className="cd-co">
              <b>{C.name}</b>
              <span>{C.cr}</span>
              <span>{C.address}</span>
            </div>
            <div className="cd-title">
              <div className="cd-title-main">{K.title}</div>
              <div className="cd-meta">
                <label><span>No.</span><input className="cd-in" value={doc.doc_no || ''} readOnly={ro} onChange={(e) => set('doc_no', e.target.value)} /></label>
                <label><span>Date</span>{ro ? <span className="cd-ro">{fmtD(doc.doc_date)}</span> : <DateInput className="cd-in" value={doc.doc_date || ''} onChange={(v) => set('doc_date', v)} />}</label>
              </div>
            </div>
          </header>
          <div className="cd-rule" />

          <section className="cd-party">
            <div className="cd-cap">{K.party}</div>
            <input className="cd-in cd-big" list="cd-parties" placeholder={K.partyPh} value={doc.party || ''} readOnly={ro} onChange={(e) => pickParty(e.target.value)} />
            <datalist id="cd-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
            <textarea className="cd-in cd-area" rows={2} placeholder="Address, phone, email (optional)" value={doc.party_details || ''} readOnly={ro} onChange={(e) => set('party_details', e.target.value)} />
            {kind === 'invoice' && (
              <label className="cd-inline"><span>VAT No.</span><input className="cd-in" placeholder="optional" value={doc.party_vat || ''} readOnly={ro} onChange={(e) => set('party_vat', e.target.value)} /></label>
            )}
          </section>

          {kind === 'receipt' && (
            <section className="cd-grid">
              <label><span>Payment method</span>
                <input className="cd-in" list="cd-pay" value={doc.payment_method || ''} readOnly={ro} onChange={(e) => set('payment_method', e.target.value)} />
              </label>
              <label><span>Department</span>
                <input className="cd-in" list="cd-dept" value={doc.department || ''} readOnly={ro} onChange={(e) => set('department', e.target.value)} />
              </label>
              <label className="no-print-soft"><span>Head of account</span>
                <input className="cd-in" list="cd-head" value={doc.head || ''} readOnly={ro} onChange={(e) => set('head', e.target.value)} />
              </label>
              <label className="no-print-soft"><span>Bill category</span>
                <input className="cd-in" list="cd-cat" value={doc.category || ''} readOnly={ro} onChange={(e) => set('category', e.target.value)} />
              </label>
              <datalist id="cd-pay">{PAY_METHODS.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="cd-dept">{depts.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="cd-head">{HEADS.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="cd-cat">{CATEGORIES.map((p) => <option key={p} value={p} />)}</datalist>
            </section>
          )}

          <table className="cd-t">
            <thead>
              <tr><th className="c-no">S.No</th><th>Description</th><th className="c-amt">Amount (OMR)</th>{!ro && <th className="c-x no-print" />}</tr>
            </thead>
            <tbody>
              {doc.items.map((it, i) => (
                <tr key={i} className={!it.desc && (it.amount === '' || it.amount === null) ? 'is-empty' : ''}>
                  <td className="c-no">{i + 1}</td>
                  <td><textarea className="cd-in cd-desc" rows={1} value={it.desc} readOnly={ro} placeholder="Description" onChange={(e) => setItem(i, 'desc', e.target.value)} /></td>
                  <td className="c-amt">
                    {ro ? <span className="cd-ro">{it.amount === '' ? '' : fmt3(it.amount)}</span>
                      : <input className="cd-in cd-num" inputMode="decimal" value={it.amount} placeholder="0.000"
                        onChange={(e) => setItem(i, 'amount', e.target.value.replace(/[^\d.]/g, ''))}
                        onBlur={(e) => e.target.value !== '' && setItem(i, 'amount', r3(e.target.value).toFixed(3))} />}
                  </td>
                  {!ro && <td className="c-x no-print"><button type="button" className="cd-x" onClick={() => removeItem(i)} aria-label={`Remove line ${i + 1}`}>×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && <button type="button" className="btn small ghost no-print cd-add" onClick={addItem}>+ Add line</button>}

          <section className="cd-sum">
            <div className="cd-words"><span className="cd-cap">Amount in words</span>{omrInWords(tot)}</div>
            <dl>
              <dt>Subtotal</dt><dd><Omr v={sub} /></dd>
              <dt>
                VAT{' '}
                {ro ? `${n(doc.vat_pct)}%` : (
                  <select className="cd-vat" value={String(n(doc.vat_pct))} onChange={(e) => set('vat_pct', Number(e.target.value))}>
                    <option value="0">0%</option><option value="5">5%</option>
                  </select>
                )}
              </dt><dd><Omr v={vat} /></dd>
              <dt className="cd-tot">Total</dt><dd className="cd-tot"><Omr v={tot} /></dd>
            </dl>
          </section>

          <textarea className={`cd-in cd-notes${doc.notes ? '' : ' is-empty'}`} rows={2} placeholder="Notes (optional)" value={doc.notes || ''} readOnly={ro} onChange={(e) => set('notes', e.target.value)} />

          <footer className="cd-sign">
            <div><div className="cd-line" /><span>{kind === 'receipt' ? 'Paid by' : 'Authorised signature'}</span>
              <input className="cd-in cd-signame" placeholder="Name (optional)" value={doc.signatory || ''} readOnly={ro} onChange={(e) => set('signatory', e.target.value)} />
            </div>
            <div><div className="cd-line" /><span>{kind === 'receipt' ? 'Received by' : 'Received by (client)'}</span></div>
          </footer>
        </article>

        {del && (
          <Modal title={`Delete ${K.one.toLowerCase()}?`} onClose={() => setDel(false)}>
            <p style={{ margin: 0 }}>Delete <b>{doc.doc_no}</b> ({doc.party})?{kind === 'receipt' && ' Its line in Office Expense is removed too.'}</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setDel(false)}>Cancel</button>
              <button className="btn danger" onClick={deleteDoc}>Delete</button>
            </div>
          </Modal>
        )}
        {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
      </>
    );
  }

  /* ---------------- List ---------------- */
  const shown = (list || []).filter((d) => !q || `${d.doc_no} ${d.party} ${(d.items || []).map((i) => i.desc).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const totalOf = (d) => r3(lineTotal(d.items) * (1 + n(d.vat_pct) / 100));

  return (
    <>
      <div className="page-tools">
        <Link href={`/expenses?co=${co}`} className="crumb">← Office Expense</Link>
        <div className="tools">
          <input className="iv-search" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          {isAdmin && <button type="button" className="btn" onClick={newDoc}>+ New {K.one.toLowerCase()}</button>}
        </div>
      </div>
      {switcher}
      <div className="head-chips no-print" style={{ marginTop: 10 }}>
        {Object.entries(KINDS).map(([k, v]) => (
          <button key={k} type="button" className={`rp-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'invoice' ? '🧾' : '💵'} {v.label}</button>
        ))}
      </div>

      <div className="iv-list-head">
        <h1>{K.label}</h1>
        <p>{C.name}{kind === 'receipt' ? ' · each receipt is added to Office Expense by itself' : ' · S.No, description and amount'}</p>
      </div>

      {list === null ? <div className="loading">Loading...</div> : shown.length === 0 ? (
        <div className="iv-empty">
          <div className="iv-empty-mark">{kind === 'invoice' ? '🧾' : '💵'}</div>
          <p>No {K.label.toLowerCase()} yet for {C.short}.</p>
          {isAdmin && <button type="button" className="btn" onClick={newDoc}>+ New {K.one.toLowerCase()}</button>}
        </div>
      ) : (
        <div className="iv-table-wrap">
          <table className="iv-list" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th>No.</th><th>Date</th><th>{K.party}</th><th>Details</th>{kind === 'receipt' && <th>Department</th>}<th className="num">Total OMR</th></tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} tabIndex={0} onClick={() => openDoc(d)} onKeyDown={(e) => e.key === 'Enter' && openDoc(d)}>
                  <td className="iv-list-no">{d.doc_no}</td>
                  <td>{fmtD(d.doc_date)}</td>
                  <td>{d.party}</td>
                  <td className="muted">{(d.items || []).map((i) => i.desc).filter(Boolean).join(', ').slice(0, 70)}</td>
                  {kind === 'receipt' && <td>{d.department || ''}</td>}
                  <td className="num"><Omr v={totalOf(d)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DocsPage /></AuthGate>;
}
