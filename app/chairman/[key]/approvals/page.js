'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import Omr from '@/components/Omr';
import Modal from '@/components/Modal';
import { Viewer } from '@/components/DocFiles';
import { sb } from '@/lib/supabase';
import { COMPANIES, companyOf } from '@/lib/expenses';
import { billTotal } from '@/lib/billCheck';
import { shortOf } from '@/lib/docShort';
import { fmtFullDate } from '@/lib/sheet';
import { chairmanOf, chairmanForUser, canOpenChairman } from '@/lib/chairmen';

/*
  👑 Chairman › Asif Altaf › ✅ Approvals (6 Nov 2026, Kamran: only for Asif Altaf).
  Bills (company_docs kind 'receipt') that Rauf verified (verify.status 'verified').
  Tabs: Waiting for approval · Approved · Rejected. Buttons ✅ Approve / ✗ Reject (optional note) / ↶ Undo.
  Saved in company_docs.approval {status 'approved'|'rejected', by, at, note}.
  DB trigger guard_bill_verify: ONLY the login asif@tudo.local can change approval (others see the list, buttons off).
*/
const TABS = [['wait', '⏳ Waiting for approval'], ['approved', '✅ Approved'], ['rejected', '✗ Rejected']];
const when = (s) => { try { return new Date(s).toLocaleString('en-GB', { timeZone: 'Asia/Muscat', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const stateOf = (d) => d.approval?.status === 'approved' ? 'approved' : d.approval?.status === 'rejected' ? 'rejected' : 'wait';

function Approvals() {
  const { key } = useParams();
  const user = useUser();
  const c = chairmanOf(key);
  const me = chairmanForUser(user);
  const canAct = !!(c?.approvals && me?.key === c.key);
  const [docs, setDocs] = useState(null);
  const [tab, setTab] = useState('wait');
  const [co, setCo] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [rej, setRej] = useState(null); // { d, note }
  const [view, setView] = useState(null);
  const [undo, setUndo] = useState([]); // [{ id, prev, label }]

  const flash = (text, kind = 'ok') => { setMsg({ text, kind }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    const { data, error } = await sb().from('company_docs').select('*').eq('kind', 'receipt').order('doc_date', { ascending: false });
    if (error) { flash(error.message, 'err'); setDocs([]); return; }
    setDocs((data || []).filter((d) => d.verify?.status === 'verified'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(d, next, text) {
    setBusy(d.id);
    const { error } = await sb().from('company_docs').update({ approval: next }).eq('id', d.id);
    setBusy('');
    if (error) { flash(error.code === '42501' ? 'Only the chairman Asif Altaf can approve bills.' : error.message, 'err'); return false; }
    setUndo((u) => [...u.slice(-29), { id: d.id, prev: d.approval || null, label: d.doc_no }]);
    flash(text);
    await load();
    return true;
  }
  const approve = (d) => save(d, { status: 'approved', by: c.name, at: new Date().toISOString() }, `${d.doc_no} approved.`);
  const reject = async () => { if (await save(rej.d, { status: 'rejected', by: c.name, at: new Date().toISOString(), note: rej.note.trim() }, `${rej.d.doc_no} rejected.`)) setRej(null); };
  const back = (d) => save(d, null, `${d.doc_no} is back to Waiting for approval.`);
  async function undoLast() {
    const last = undo[undo.length - 1];
    if (!last) return;
    setBusy(last.id);
    const { error } = await sb().from('company_docs').update({ approval: last.prev }).eq('id', last.id);
    setBusy('');
    if (error) { flash(error.message, 'err'); return; }
    setUndo((u) => u.slice(0, -1));
    flash(`Undone: ${last.label}`);
    load();
  }

  const shown = useMemo(() => (docs || []).filter((d) => stateOf(d) === tab && (!co || d.company === co)), [docs, tab, co]);
  const count = (t) => (docs || []).filter((d) => stateOf(d) === t && (!co || d.company === co)).length;
  const total = shown.reduce((t, d) => t + billTotal(d), 0);

  if (!c) return <p className="empty">Chairman not found. <Link href="/chairman">Back to Chairman</Link></p>;
  if (!c.approvals || !canOpenChairman(user, c.key)) return <p className="empty">Approvals are only for Asif Altaf.</p>;

  return (
    <>
      <h1>✅ Approvals</h1>
      <p className="sub">{c.name} · Chairman · Bills verified by Rauf{!canAct ? ' · Only Asif Altaf can press the buttons' : ''}</p>

      <div className="co-switch no-print" role="tablist" aria-label="Approvals">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label} <small className="pn-count">{docs ? count(k) : ''}</small>
          </button>
        ))}
      </div>

      <div className="page-tools no-print">
        <div className="tools">
          <select value={co} onChange={(e) => setCo(e.target.value)} aria-label="Company">
            <option value="">All companies</option>
            {COMPANIES.map((x) => <option key={x.key} value={x.key}>{x.short || x.name}</option>)}
          </select>
          {canAct && <button type="button" className="btn" disabled={!undo.length || !!busy} onClick={undoLast}>↶ Undo{undo.length ? ` (${undo.length})` : ''}</button>}
          <span className="muted">{shown.length} bills · Total <Omr v={total} /></span>
        </div>
      </div>

      {msg && <div className={`toast ${msg.kind}`} role="status">{msg.text}</div>}

      {!docs ? <div className="loading">Loading...</div> : shown.length === 0 ? (
        <p className="empty">{tab === 'wait' ? 'No bills waiting for approval.' : tab === 'approved' ? 'No approved bills yet.' : 'No rejected bills.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bill paper</th><th>Company</th><th>No.</th><th>Date</th><th>Paid to</th><th>Receipt No.</th><th>Vehicle No.</th><th>Amount</th><th>Verified by Rauf</th><th>{tab === 'wait' ? 'Chairman' : tab === 'approved' ? 'Approved' : 'Rejected'}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const x = shortOf(d);
                const f = (d.files || [])[0];
                return (
                  <tr key={d.id}>
                    <td>{f ? <button type="button" className="btn small ghost" onClick={() => setView(f)}>📄 View</button> : <span className="muted">No paper</span>}</td>
                    <td>{companyOf(d.company).short}</td>
                    <td><Link href={`/expenses/docs?co=${d.company}&kind=receipt`}>{d.doc_no}</Link></td>
                    <td>{d.doc_date ? fmtFullDate(d.doc_date) : ''}</td>
                    <td>{d.party || ''}</td>
                    <td>{x.receipt_no || ''}</td>
                    <td>{x.vehicle_no || ''}</td>
                    <td><Omr v={billTotal(d)} /></td>
                    <td><small>{d.verify?.by || 'Rauf'} · {when(d.verify?.at)}</small></td>
                    <td>
                      {tab === 'wait' ? (canAct ? (
                        <span className="bv-btns">
                          <button type="button" className="btn small" disabled={busy === d.id} onClick={() => approve(d)}>✅ Approve</button>
                          <button type="button" className="btn small ghost" disabled={busy === d.id} onClick={() => setRej({ d, note: '' })}>✗ Reject</button>
                        </span>
                      ) : <span className="muted">Waiting for Asif Altaf</span>) : (
                        <span>
                          <small>{when(d.approval?.at)}{d.approval?.note ? ` · ${d.approval.note}` : ''}</small>
                          {canAct && <> <button type="button" className="btn small ghost" disabled={busy === d.id} onClick={() => back(d)}>↶ Undo</button></>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rej && (
        <Modal title={`✗ Reject ${rej.d.doc_no}`} onClose={() => setRej(null)}>
          <label>Reason (optional)
            <textarea rows={3} value={rej.note} onChange={(e) => setRej({ ...rej, note: e.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setRej(null)}>Cancel</button>
            <button type="button" className="btn danger" disabled={busy === rej.d.id} onClick={reject}>✗ Reject</button>
          </div>
        </Modal>
      )}
      {view && <Viewer file={view} onClose={() => setView(null)} flash={flash} />}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><Approvals /></AuthGate>;
}
