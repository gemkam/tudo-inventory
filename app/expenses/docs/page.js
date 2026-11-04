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
import DocImport from '@/components/DocImport';
import EditToggle from '@/components/EditToggle';
import PaperPreview from '@/components/PaperPreview';
import { shortOf, hasShort, FUELS } from '@/lib/docShort';
import { lockEdit } from '@/lib/editLock';
import DocFiles from '@/components/DocFiles';
import { COMPANIES, companyOf, DEPARTMENTS, HEADS, CATEGORIES, PAY_METHODS, n, r3 } from '@/lib/expenses';

/*
  Simple invoice and payment receipt for the 3 companies (Modern City, Abu Wasif, Sumptuosity).
  Table company_docs. A saved PAYMENT RECEIPT is added to that company's expenses (All Companies) by a DB trigger
  (sync_transport_exp): change or delete the receipt and the expense line follows.
*/

/* Bills (kind 'receipt', our purchases) FIRST, Invoices (our sales) second. "Payment receipts" renamed "Bills" 4 Nov 2026.
   DB value stays 'receipt' and numbers stay PR-.. so saved bills are not changed. */
const KINDS = {
  receipt: { label: 'Bills', one: 'Bill', title: 'BILL', prefix: 'PR', party: 'Paid to', partyPh: 'Name of person or company paid' },
  invoice: { label: 'Invoices', one: 'Invoice', title: 'INVOICE', prefix: 'INV', party: 'Bill to', partyPh: 'Client name' }
};
const CO_CODE = { 'modern-city': 'MC', 'abu-wasif': 'AW', sumptuosity: 'ST' };
const fmtD = (d) => (d ? fmtFullDate(d) : '');
const lineTotal = (items) => r3((items || []).reduce((t, i) => t + n(i.amount), 0));
const blankItems = () => [{ desc: '', amount: '' }, { desc: '', amount: '' }, { desc: '', amount: '' }];

function DocsPage() {
  const { isAdmin, name: me } = useUser();
  const [co, setCo] = useState(null);
  const [kind, setKind] = useState('receipt');
  const [list, setList] = useState(null);
  const [doc, setDoc] = useState(null); // open document (editor)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState(false);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(false); // ✏️ Edit (password 728300) -> Add, Delete, Move
  const [picked, setPicked] = useState([]); // selected ids in Edit
  const [bulk, setBulk] = useState(null); // { act: 'delete' | 'move', to }
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState([]); // ↶ Undo steps this visit: [{ label, run }] newest last, up to 30
  const trash = useRef(new Set()); // papers of deleted docs: kept until ✓ Done so Undo can bring them back
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
  useEffect(() => { setList(null); setPicked([]); load(); }, [load]);

  const C = companyOf(co);
  const K = KINDS[kind];
  const canEdit = isAdmin && editing;

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

  /* next number for the import (any kind); read fresh each time, so numbers follow on during one import */
  async function nextNoFor(k) {
    const pre = `${KINDS[k].prefix}-${CO_CODE[co] || 'X'}-`;
    const { data } = await sb().from('company_docs').select('doc_no').eq('company', co).eq('kind', k);
    const max = (data || []).reduce((mx, d) => {
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
    if (dirty && canEdit && !window.confirm('Close without saving?')) return;
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
    if (doc.scan) row.scan = doc.scan;
    const s = sb().from('company_docs');
    const before = doc.id ? (list || []).find((d) => d.id === doc.id) : null;
    const res = doc.id
      ? await s.update(row).eq('id', doc.id).select().single()
      : await s.insert({ ...row, created_by: me || null }).select().single();
    setSaving(false);
    if (res.error) { flash(res.error.code === '42501' ? 'You need Full access to save.' : res.error.message, 'err'); return; }
    setDoc({ ...res.data, items: res.data.items.length ? res.data.items : blankItems() });
    setDirty(false);
    const saved = res.data;
    if (before) {
      const { id, created_at: _c, ...back } = before;
      pushUndo(`change ${before.doc_no}`, async () => {
        const { error } = await sb().from('company_docs').update(back).eq('id', id);
        if (error) throw new Error(error.message);
        setDoc((d) => (d && d.id === id ? { ...before, items: before.items?.length ? before.items : blankItems() } : d));
      });
    } else {
      pushUndo(`add ${saved.doc_no}`, async () => {
        const { error } = await sb().from('company_docs').delete().eq('id', saved.id);
        if (error) throw new Error(error.message);
        setDoc((d) => (d && d.id === saved.id ? null : d));
      });
    }
    load();
    flash(kind === 'receipt' ? `Saved. Added to ${C.short} expenses (All Companies).` : 'Saved');
  }

  const pushUndo = (label, run) => setUndo((u) => [...u.slice(-29), { label, run }]);

  async function doUndo() {
    const step = undo[undo.length - 1];
    if (!step || busy) return;
    setBusy(true);
    const err = await step.run().catch((e) => e.message);
    setBusy(false);
    if (err) { flash(`Undo failed: ${err}`, 'err'); return; }
    setUndo((u) => u.slice(0, -1));
    setPicked([]); load();
    flash(`↶ Undone: ${step.label}`);
  }

  /* put deleted rows back exactly (same id, number and papers); the DB trigger adds the expense lines again */
  async function restoreRows(rows) {
    const { error } = await sb().from('company_docs').insert(rows.map((r) => ({ ...r })));
    if (error) return error.message;
    rows.forEach((r) => (r.files || []).forEach((f) => trash.current.delete(f.path)));
    return '';
  }

  async function emptyTrash() {
    const paths = [...trash.current];
    trash.current.clear();
    if (paths.length) await sb().storage.from('doc-files').remove(paths);
  }

  function toggleEdit() {
    if (editing) {
      if (doc && dirty && !window.confirm('Close without saving?')) { return; }
      if (doc && !doc.id) setDoc(null);
      else if (doc && dirty) openDoc((list || []).find((d) => d.id === doc.id) || doc);
      setEditing(false); setPicked([]); setBulk(null); setUndo([]);
      emptyTrash();
      return;
    }
    setEditing(true);
  }
  // lock again when this page closes
  useEffect(() => () => { lockEdit(); emptyTrash(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickOne = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function removeFiles(rows) {
    const paths = rows.flatMap((d) => (d.files || []).map((f) => f.path)).filter(Boolean);
    if (paths.length) await sb().storage.from('doc-files').remove(paths);
  }

  async function bulkDelete() {
    const rows = (list || []).filter((d) => picked.includes(d.id));
    setBusy(true);
    const { error } = await sb().from('company_docs').delete().in('id', rows.map((d) => d.id));
    setBusy(false);
    if (error) { flash(error.code === '42501' ? 'You need Full access to delete.' : error.message, 'err'); return; }
    rows.forEach((r) => (r.files || []).forEach((f) => f.path && trash.current.add(f.path)));
    pushUndo(`delete ${rows.length}`, async () => { const e = await restoreRows(rows); if (e) throw new Error(e); });
    setBulk(null); setPicked([]); load();
    flash(`${rows.length} deleted${kind === 'receipt' ? '. Removed from All Companies too.' : ''}`);
  }

  /* Move to another company and / or to the other type (Invoices <-> Payment receipts).
     Each doc gets the next number of where it goes (PR-AW-0001 -> PR-ST-0005, INV-AW-0002 -> PR-AW-0007).
     A payment receipt is an expense in All Companies (DB trigger): it is added, moved or removed with it. */
  async function bulkMove(to, toKind = kind) {
    const rows = (list || []).filter((d) => picked.includes(d.id));
    const T = companyOf(to);
    setBusy(true);
    const pre = `${KINDS[toKind].prefix}-${CO_CODE[to] || 'X'}-`;
    const { data: there } = await sb().from('company_docs').select('doc_no').eq('company', to).eq('kind', toKind);
    let max = (there || []).reduce((mx, d) => { const m = String(d.doc_no || '').match(/(\d+)\s*$/); return m ? Math.max(mx, Number(m[1])) : mx; }, 0);
    let ok = 0; let err = '';
    const old = [];
    for (const d of [...rows].reverse()) {
      max += 1;
      const depts = DEPARTMENTS[to] || [];
      let department = d.department && !depts.includes(d.department) && depts.length ? depts[0] : d.department;
      const change = { company: to, kind: toKind, doc_no: `${pre}${String(max).padStart(4, '0')}`, updated_at: new Date().toISOString() };
      if (toKind === 'receipt') {
        // a receipt needs payment method, department and head (kept if it already had them)
        if (!department) department = depts[0] || null;
        change.payment_method = d.payment_method || 'Cash';
        change.head = d.head || 'Office Expenses';
      }
      change.department = department || null;
      const { error } = await sb().from('company_docs').update(change).eq('id', d.id);
      if (error) { err = error.code === '42501' ? 'You need Full access to move.' : error.message; break; }
      old.push({ id: d.id, company: d.company, kind: d.kind, doc_no: d.doc_no, department: d.department, payment_method: d.payment_method, head: d.head });
      ok += 1;
    }
    if (old.length) {
      pushUndo(`move ${old.length}`, async () => {
        for (const o of old) {
          const { id, ...back } = o;
          const { error } = await sb().from('company_docs').update({ ...back, updated_at: new Date().toISOString() }).eq('id', id);
          if (error) throw new Error(error.message);
        }
      });
    }
    setBusy(false);
    setBulk(null); setPicked([]); load();
    if (err) flash(`${ok} moved. Stopped: ${err}`, 'err');
    else {
      const where = [to !== co ? T.short : '', toKind !== kind ? KINDS[toKind].label : ''].filter(Boolean).join(' · ');
      const exp = toKind === 'receipt' && kind !== 'receipt' ? ` and added to ${T.short} expenses`
        : toKind !== 'receipt' && kind === 'receipt' ? ' and removed from All Companies expenses'
          : toKind === 'receipt' && to !== co ? ' (expense lines moved too)' : '';
      flash(`${ok} moved to ${where}${exp}.`);
    }
  }

  async function deleteDoc() {
    const before = (list || []).find((d) => d.id === doc.id);
    const { error } = await sb().from('company_docs').delete().eq('id', doc.id);
    if (error) { flash(error.message, 'err'); return; }
    if (before) {
      (before.files || []).forEach((f) => f.path && trash.current.add(f.path));
      pushUndo(`delete ${before.doc_no}`, async () => { const e = await restoreRows([before]); if (e) throw new Error(e); });
    } else await removeFiles([doc]);
    setDel(false); setDoc(null); setDirty(false); load();
    flash(kind === 'receipt' ? 'Deleted. Removed from All Companies too.' : 'Deleted');
  }

  function printDoc() {
    if (dirty && canEdit) flash('Tip: press Save first so this copy is kept.');
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
      <Link href="/docs" className="co-tab co-sum">📋 Checklist</Link>
      <span className="co-tab on" role="tab" aria-selected="true">🧾 Bills</span>
      <Link href={`/expenses/salary?co=${co}`} className="co-tab">💰 Salary</Link>
      <Link href="/expenses/vat" className="co-tab co-sum co-vat">🧾 VAT return</Link>
    </div>
  );

  /* ---------------- Editor / paper ---------------- */
  if (doc) {
    const ro = !canEdit;
    const sub = lineTotal(doc.items);
    const vat = r3((sub * n(doc.vat_pct)) / 100);
    const tot = r3(sub + vat);
    const depts = [...new Set([...(DEPARTMENTS[co] || []), doc.department].filter(Boolean))];
    return (
      <>
        <div className="page-tools">
          <button type="button" className="crumb linkish" onClick={closeDoc}>← {K.label}</button>
          <div className="tools">
            <EditToggle show={isAdmin} on={editing} onClick={toggleEdit} />
            {canEdit && <button type="button" className="btn" onClick={saveDoc} disabled={saving}>{saving ? 'Saving...' : dirty ? '💾 Save' : '✓ Saved'}</button>}
            <button type="button" className="btn ghost" onClick={printDoc}>🖨 Print / PDF</button>
            {canEdit && undo.length > 0 && <button type="button" className="btn ghost" onClick={doUndo} disabled={busy}>↶ Undo {undo[undo.length - 1].label}</button>}
            {canEdit && doc.id && <button type="button" className="btn ghost danger-text" onClick={() => setDel(true)}>Delete</button>}
          </div>
        </div>
        {kind === 'receipt' && <p className="cd-hint no-print">When you save, this bill is added to <b>{C.short}</b> expenses in All Companies{doc.department ? <> (department <b>{doc.department}</b>)</> : ''} by itself. Change or delete it here and the expense follows.</p>}

        {kind === 'receipt' && (doc.files || []).length > 0 && (
          <div className="pp-wrap">
            <div className="pp-cap">🧾 Bill from {doc.party || 'the supplier'}</div>
            <PaperPreview files={doc.files} />
          </div>
        )}

        <article className={`cd-paper k-${kind}${ro ? ' ro' : ''}${kind === 'receipt' ? ' cd-purchase' : ''}`}>
          {kind === 'receipt' ? (
            /* Bill = our purchase: NO letterhead (no logo, CR, address), just the record */
            <header className="cd-head cd-head-plain">
              <div className="cd-co">
                <b>Bill</b>
                <span>Purchase by {C.short}</span>
              </div>
              <div className="cd-title">
                <div className="cd-meta">
                  <label><span>No.</span><input className="cd-in" value={doc.doc_no || ''} readOnly={ro} onChange={(e) => set('doc_no', e.target.value)} /></label>
                  <label><span>Date</span>{ro ? <span className="cd-ro">{fmtD(doc.doc_date)}</span> : <DateInput className="cd-in" value={doc.doc_date || ''} onChange={(v) => set('doc_date', v)} />}</label>
                </div>
              </div>
            </header>
          ) : (
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
          )}
          {kind !== 'receipt' && <div className="cd-rule" />}

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

          {kind !== 'receipt' && <footer className="cd-sign">
            <div><div className="cd-line" /><span>{kind === 'receipt' ? 'Paid by' : 'Authorised signature'}</span>
              <input className="cd-in cd-signame" placeholder="Name (optional)" value={doc.signatory || ''} readOnly={ro} onChange={(e) => set('signatory', e.target.value)} />
            </div>
            <div><div className="cd-line" /><span>{kind === 'receipt' ? 'Received by' : 'Received by (client)'}</span></div>
          </footer>}
        </article>

        {doc.id || doc.scan ? (
          <section className="di-saved no-print">
            {doc.id && (
              <div className="di-saved-files">
                <b>📎 Original paper</b>
                <DocFiles row={{ id: `company_docs/${doc.id}`, owner: doc.party, doc_name: doc.doc_no, files: doc.files || [] }}
                  canEdit={canEdit} userName={me} flash={flash}
                  onSave={async (files) => {
                    const { error } = await sb().from('company_docs').update({ files }).eq('id', doc.id);
                    if (error) { flash(error.message, 'err'); return; }
                    setDoc((d) => ({ ...d, files })); load();
                  }} />
              </div>
            )}
            {doc.scan || hasShort(doc) ? (() => {
              const x = shortOf(doc);
              const setS = (k, v) => { setDoc((d) => ({ ...d, scan: { ...shortOf(d), ...(d.scan || {}), [k]: v } })); setDirty(true); };
              const box = (k, label) => (
                <label key={k}><span>{label}</span>
                  {ro ? <b>{x[k] || '-'}</b> : <input value={x[k] || ''} onChange={(e) => setS(k, e.target.value)} />}
                </label>
              );
              return (
                <div className="dx-short">
                  <div className="dx-short-cap">From the paper <small>(not printed on the letterhead)</small></div>
                  <div className="dx-short-grid">
                    {box('receipt_no', 'Receipt No.')}
                    {box('vehicle_no', 'Vehicle No.')}
                    <label><span>Fuel</span>
                      {ro ? <b>{x.fuel || '-'}</b> : (
                        <select value={x.fuel || ''} onChange={(e) => setS('fuel', e.target.value)}>
                          <option value="">Not fuel</option>{FUELS.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      )}
                    </label>
                    {box('vat_no', 'VAT No.')}
                    <label><span>Amount</span><b>{x.amount === null || x.amount === undefined || x.amount === '' ? '-' : <Omr v={n(x.amount)} />}</b>
                      {n(x.vat_amount) ? <small className="muted">VAT {fmt3(x.vat_amount)} inside</small> : null}</label>
                  </div>
                </div>
              );
            })() : null}
          </section>
        ) : null}

        {del && (
          <Modal title={`Delete ${K.one.toLowerCase()}?`} onClose={() => setDel(false)}>
            <p style={{ margin: 0 }}>Delete <b>{doc.doc_no}</b> ({doc.party})?{kind === 'receipt' && ' Its line in All Companies is removed too.'}</p>
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
  /* search: every word must be found somewhere in the doc (number, date, party, lines, receipt no., vehicle, fuel, VAT no., amounts, payment, department ...) */
  const hay = (d) => {
    const x = shortOf(d);
    const tot = r3(lineTotal(d.items) * (1 + n(d.vat_pct) / 100));
    return [d.doc_no, fmtD(d.doc_date), d.doc_date, d.party, d.party_details, d.party_vat, (d.items || []).map((i) => `${i.desc} ${i.amount}`).join(' '),
      x.receipt_no, x.vehicle_no, String(x.vehicle_no || '').replace(/[\s/-]/g, ''), x.fuel, x.vat_no, x.amount, tot.toFixed(3),
      d.payment_method, d.department, d.head, d.category, d.notes, d.signatory, d.created_by, KINDS[d.kind]?.one].filter(Boolean).join(' ').toLowerCase();
  };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (list || []).filter((d) => { if (!words.length) return true; const h = hay(d); return words.every((w) => h.includes(w)); });
  const totalOf = (d) => r3(lineTotal(d.items) * (1 + n(d.vat_pct) / 100));

  return (
    <>
      <div className="company-head ch-top">
        <span className="company-name">{C.name}</span>
        <h1>{K.label}</h1>
        <p className="sub">{kind === 'receipt' ? 'Each bill is added to All Companies by itself' : 'S.No, description and amount'}</p>
      </div>

      <div className="page-tools">
        <Link href={`/expenses?co=${co}`} className="crumb">← All Companies</Link>
        <div className="tools">
          <input className="iv-search" type="search" placeholder="Search anything: vehicle, receipt no., petrol, amount, date..." value={q} onChange={(e) => setQ(e.target.value)} />
          <EditToggle show={isAdmin} on={editing} onClick={toggleEdit} />
        </div>
      </div>

      {switcher}
      <div className="head-chips no-print" style={{ marginTop: 10 }}>
        {Object.entries(KINDS).map(([k, v]) => (
          <button key={k} type="button" className={`rp-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'invoice' ? '🧾' : '💵'} {v.label}</button>
        ))}
      </div>

      {canEdit && (
        <div className="dx-bar no-print">
          <b>✏️ Edit</b>
          <button type="button" className="btn" onClick={newDoc}>＋ Add {K.one.toLowerCase()}</button>
          <DocImport co={co} coShort={C.short} kind={kind} userName={me} last={(list || [])[0]} nextNo={nextNoFor} flash={flash}
            onDone={(rows) => {
              load();
              if (rows?.length) {
                pushUndo(`import ${rows.length}`, async () => {
                  const { error } = await sb().from('company_docs').delete().in('id', rows.map((r) => r.id));
                  if (error) throw new Error(error.message);
                  const paths = rows.map((r) => r.path).filter(Boolean);
                  if (paths.length) await sb().storage.from('doc-files').remove(paths);
                });
              }
            }} />
          <span className="dx-sep" />
          <button type="button" className="btn ghost" disabled={!shown.length}
            onClick={() => setPicked(picked.length === shown.length ? [] : shown.map((d) => d.id))}>
            {picked.length && picked.length === shown.length ? '☐ Clear' : '☑ Select all'}
          </button>
          <button type="button" className="btn ghost danger-text" disabled={!picked.length} onClick={() => setBulk({ act: 'delete' })}>🗑 Delete{picked.length ? ` (${picked.length})` : ''}</button>
          <button type="button" className="btn ghost" disabled={!picked.length}
            onClick={() => setBulk({ act: 'move', to: co, toKind: kind === 'invoice' ? 'receipt' : 'invoice' })}>↔ Move{picked.length ? ` (${picked.length})` : ''}</button>
          <button type="button" className="btn ghost" disabled={!undo.length || busy} onClick={doUndo}
            title={undo.length ? `Undo: ${undo[undo.length - 1].label}` : 'Nothing to undo yet'}>
            ↶ Undo{undo.length ? ` ${undo[undo.length - 1].label}` : ''}
          </button>
          <span className="muted dx-hint">{picked.length ? `${picked.length} selected` : 'Tick rows to delete or move'}</span>
        </div>
      )}


      {list !== null && shown.length > 0 && (() => {
        const tot = r3(shown.reduce((t, d) => t + totalOf(d), 0));
        const vat = r3(shown.reduce((t, d) => t + r3(lineTotal(d.items) * n(d.vat_pct) / 100), 0));
        return (
          <div className="rp-tiles dx-tiles">
            <div className="rp-tile">
              <div className="rp-tile-label">{kind === 'invoice' ? '🧾' : '💵'} Total amount</div>
              <div className="rp-tile-num"><Omr v={tot} /></div>
              <div className="rp-tile-sub">{shown.length} {shown.length === 1 ? K.one.toLowerCase() : K.label.toLowerCase()}{q ? ' found' : ''} · {C.short} · with VAT</div>
            </div>
            <div className="rp-tile">
              <div className="rp-tile-label">🧾 VAT 5%</div>
              <div className="rp-tile-num"><Omr v={vat} /></div>
              <div className="rp-tile-sub">{vat ? `Inside the total · without VAT ${fmt3(r3(tot - vat))}` : 'No VAT on these'}</div>
            </div>
          </div>
        );
      })()}

      {list === null ? <div className="loading">Loading...</div> : shown.length === 0 ? (
        <div className="iv-empty">
          <div className="iv-empty-mark">{kind === 'invoice' ? '🧾' : '💵'}</div>
          <p>No {K.label.toLowerCase()} yet for {C.short}.</p>
        </div>
      ) : (
        <div className="iv-table-wrap">
          <table className="iv-list" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{canEdit && <th className="dx-c"><input type="checkbox" aria-label="Select all" checked={!!shown.length && picked.length === shown.length} onChange={() => setPicked(picked.length === shown.length ? [] : shown.map((d) => d.id))} /></th>}<th>No.</th><th>Date</th><th>{K.party}</th><th>Receipt No.</th><th>Vehicle No.</th><th>Fuel</th><th>VAT No.</th><th className="num">VAT 5%</th>{kind === 'receipt' && <th>Department</th>}<th className="num">Amount OMR</th></tr></thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id} tabIndex={0} className={picked.includes(d.id) ? 'dx-on' : ''} onClick={() => openDoc(d)} onKeyDown={(e) => e.key === 'Enter' && openDoc(d)}>
                  {canEdit && <td className="dx-c" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${d.doc_no}`} checked={picked.includes(d.id)} onChange={() => pickOne(d.id)} /></td>}
                  <td className="iv-list-no">{d.doc_no}{(d.files || []).length ? ' 📎' : ''}</td>
                  <td>{fmtD(d.doc_date)}</td>
                  <td>{d.party}</td>
                  {(() => { const x = shortOf(d); return (<>
                    <td className="dx-rno">{x.receipt_no}</td>
                    <td>{x.vehicle_no}</td>
                    <td>{x.fuel ? <span className={`dx-fuel f-${x.fuel.toLowerCase()}`}>{x.fuel}</span> : ''}</td>
                    <td className="muted">{x.vat_no}</td>
                  </>); })()}
                  <td className="num">{n(d.vat_pct) > 0 ? <Omr v={r3(totalOf(d) - lineTotal(d.items))} /> : <span className="muted">0</span>}</td>
                  {kind === 'receipt' && <td>{d.department || ''}</td>}
                  <td className="num"><Omr v={totalOf(d)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bulk && (() => {
        const rows = (list || []).filter((d) => picked.includes(d.id));
        const names = rows.slice(0, 8).map((d) => <li key={d.id}><b>{d.doc_no}</b> · {fmtD(d.doc_date)} · {d.party} · {r3(totalOf(d)).toFixed(3)}</li>);
        return bulk.act === 'delete' ? (
          <Modal title={`Delete ${rows.length} ${rows.length === 1 ? K.one.toLowerCase() : K.label.toLowerCase()}?`} onClose={() => !busy && setBulk(null)}>
            <ul className="dx-list">{names}{rows.length > 8 && <li>... and {rows.length - 8} more</li>}</ul>
            {kind === 'receipt' && <p className="muted" style={{ margin: 0 }}>Their lines in All Companies are removed too, with the attached papers.</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setBulk(null)} disabled={busy}>Cancel</button>
              <button className="btn danger" onClick={bulkDelete} disabled={busy}>{busy ? 'Deleting...' : '🗑 Delete'}</button>
            </div>
          </Modal>
        ) : (
          <Modal title={`Move ${rows.length} ${rows.length === 1 ? K.one.toLowerCase() : K.label.toLowerCase()}`} onClose={() => !busy && setBulk(null)}>
            <ul className="dx-list">{names}{rows.length > 8 && <li>... and {rows.length - 8} more</li>}</ul>
            <div className="dx-to">
              <span>Move to type</span>
              <div className="dx-kinds">
                {Object.entries(KINDS).map(([k, v]) => (
                  <button key={k} type="button" className={`rp-chip ${bulk.toKind === k ? 'active' : ''}`} onClick={() => setBulk({ ...bulk, toKind: k })}>
                    {k === 'invoice' ? '🧾' : '💵'} {v.label}{k === kind ? ' (now)' : ''}
                  </button>
                ))}
              </div>
            </div>
            <label className="dx-to"><span>Move to company</span>
              <select value={bulk.to} onChange={(e) => setBulk({ ...bulk, to: e.target.value })}>
                {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.short}{c.key === co ? ' (now)' : ''}</option>)}
              </select>
            </label>
            {bulk.to === co && bulk.toKind === kind ? <p className="di-warn">Pick another type or another company.</p> : (
              <p className="muted" style={{ margin: 0 }}>
                They get the next number there ({KINDS[bulk.toKind].prefix}-{CO_CODE[bulk.to] || 'X'}-...).
                {bulk.toKind === 'receipt' && kind !== 'receipt' && <> As bills they are added to <b>{companyOf(bulk.to).short}</b> expenses in All Companies.</>}
                {bulk.toKind !== 'receipt' && kind === 'receipt' && <> As invoices they are removed from All Companies expenses.</>}
                {bulk.toKind === 'receipt' && kind === 'receipt' && bulk.to !== co && <> Their expense lines move to <b>{companyOf(bulk.to).short}</b> too.</>}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setBulk(null)} disabled={busy}>Cancel</button>
              <button className="btn" onClick={() => bulkMove(bulk.to, bulk.toKind)} disabled={busy || (bulk.to === co && bulk.toKind === kind)}>{busy ? 'Moving...' : '↔ Move'}</button>
            </div>
          </Modal>
        );
      })()}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DocsPage /></AuthGate>;
}
