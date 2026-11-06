'use client';

/*
  "Verification" column on All Companies > Bills (Kamran 6 Nov 2026), next to Bill paper.
  Two lines per bill:
  1. AI verification: rule checks (always live) + what the AI read on the paper (lib/billCheck.js).
     🟢 Looks OK / 🟠 Check / 🔴 Suspicious / ⚪ Not read yet. Tap to see the reasons and what the paper says,
     and "🤖 Read paper again". Imported bills keep the read from the import (no second AI call).
  2. Rauf verification (Administrator only can press). After ✔ Verify it shows "⏳ Waiting for chairman approval";
     when the chairman approves (company_docs.approval {status:'approved', by, at}, button comes later) it shows
     "✅ Chairman approved" in green and the bill's typed details stop being grey. Verify, or ✗ Reject with an optional reason
     (Fake, Not correct, Duplicate, Other) and optional note. ↶ Undo puts it back to not verified.
     Saved in company_docs.verify { status: 'verified'|'rejected', by, at, reason, note }.
     DB trigger trg_guard_bill_verify blocks anyone who is not Administrator.
  The chairman approval comes later (separate button before Admin). Nothing is hidden from totals yet.
*/
import { useState } from 'react';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { fmtFullDate } from '@/lib/sheet';
import { checkBill, slimPaper, AI_LABEL, REJECT_REASONS } from '@/lib/billCheck';
import { fileToImage } from '@/components/DocImport';

const when = (iso) => (iso ? fmtFullDate(String(iso).slice(0, 10)) : '');
const f3 = (v) => (v === null || v === undefined || v === '' ? '' : (Math.round(Number(v) * 1000) / 1000).toFixed(3));

/* AI reads the bill's first paper and saves the read on the bill. Returns '' or an error message. */
export async function readBillPaper(d) {
  const first = (d.files || [])[0];
  if (!first?.path) return 'No bill paper to read.';
  try {
    const { data: blob, error } = await sb().storage.from('doc-files').download(first.path);
    if (error) throw new Error(error.message);
    const file = new File([blob], first.name || 'paper', { type: first.type || blob.type || '' });
    const image = await fileToImage(file);
    const { data: s } = await sb().auth.getSession();
    const res = await fetch('/api/doc-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
      body: JSON.stringify({ image, kind: d.kind, company: d.company })
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
    const ai = { paper: slimPaper(out.data), path: first.path, model: out.model || '', at: new Date().toISOString() };
    const { error: e2 } = await sb().from('company_docs').update({ ai_check: ai }).eq('id', d.id);
    if (e2) throw new Error(e2.message);
    return '';
  } catch (e) {
    return String(e.message || e).slice(0, 300);
  }
}

export function aiStatus(d, list) { return checkBill(d, list).status; }
/* bill details stay grey until the chairman approves (Kamran 6 Nov 2026) */
export const isApproved = (d) => d?.approval?.status === 'approved';

export default function BillVerify({ d, list, canVerify, me, flash, onChanged }) {
  const [open, setOpen] = useState(false); // AI details
  const [rej, setRej] = useState(null); // { reason, note }
  const [busy, setBusy] = useState('');
  const res = checkBill(d, list);
  const v = d.verify || null;
  const a = d.approval || null; // chairman approval (button comes later)
  const appr = isApproved(d);
  const p = res.read?.paper;

  async function setVerify(next, msg) {
    setBusy('v');
    const { error } = await sb().from('company_docs').update({ verify: next }).eq('id', d.id);
    setBusy('');
    if (error) { flash(error.code === '42501' ? 'Only the Administrator can verify bills.' : error.message, 'err'); return false; }
    flash(msg);
    onChanged?.();
    return true;
  }
  const verify = () => setVerify({ status: 'verified', by: me || '', at: new Date().toISOString(), ai: res.status }, `${d.doc_no} verified.`);
  const undo = () => setVerify(null, `${d.doc_no} is not verified now.`);
  async function reject() {
    const ok = await setVerify({ status: 'rejected', by: me || '', at: new Date().toISOString(), reason: rej.reason || '', note: rej.note.trim(), ai: res.status }, `${d.doc_no} rejected.`);
    if (ok) setRej(null);
  }
  async function readAgain() {
    setBusy('ai');
    const err = await readBillPaper(d);
    setBusy('');
    if (err) flash(`${d.doc_no}: ${err}`, 'err'); else { flash(`${d.doc_no}: paper read by AI.`); onChanged?.(); }
  }

  return (
    <div className="bv" onClick={(e) => e.stopPropagation()}>
      <div className="bv-line">
        <span className="bv-who">AI</span>
        <button type="button" className={`bv-chip bv-${res.status}`} onClick={() => setOpen(true)}
          title={res.reasons.length ? res.reasons.map((r) => r.text).join('\n') : 'Tap for details'}>
          {busy === 'ai' ? '🤖 Reading...' : AI_LABEL[res.status]}{res.reasons.length ? ` (${res.reasons.length})` : ''}
        </button>
      </div>
      <div className="bv-line">
        <span className="bv-who">Rauf</span>
        {appr ? (
          <span className="bv-chip bv-appr" title={`${a.by || ''} · ${when(a.at)}`}>✅ Chairman approved</span>
        ) : v?.status === 'verified' ? (
          <span className="bv-chip bv-waitc" title={`Verified by ${v.by || ''} · ${when(v.at)}${v.note ? ` · ${v.note}` : ''}`}>⏳ Waiting for chairman approval</span>
        ) : v?.status === 'rejected' ? (
          <span className="bv-chip bv-rej" title={`${v.by} · ${when(v.at)}`}>✗ Rejected{v.reason ? `: ${v.reason}` : ''}{v.note ? ` (${v.note})` : ''}</span>
        ) : canVerify ? (
          <span className="bv-btns">
            <button type="button" className="btn small" disabled={!!busy} onClick={verify}>✔ Verify</button>
            <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => setRej({ reason: res.status === 'bad' && /Same/.test(res.reasons[0]?.text || '') ? 'Duplicate' : '', note: '' })}>✗ Reject</button>
          </span>
        ) : <span className="muted bv-wait">Waiting for Rauf</span>}
        {v && !appr && canVerify && <button type="button" className="bv-undo" disabled={!!busy} onClick={undo} title="Undo: back to not verified">↶ Undo</button>}
      </div>
      {(appr ? a.at : v?.at) && <div className="bv-when muted">{appr ? `Approved ${when(a.at)}` : `${v.status === 'verified' ? 'Verified' : 'Rejected'} by ${v.by || ''} · ${when(v.at)}`}</div>}

      {open && (
        <Modal title={`AI verification · ${d.doc_no}`} onClose={() => setOpen(false)}>
          <p className={`bv-big bv-${res.status}`}>{AI_LABEL[res.status]}</p>
          {res.reasons.length ? (
            <ul className="bv-list">{res.reasons.map((r, i) => <li key={i} className={`bv-r-${r.lvl}`}>{r.lvl === 'bad' ? '🔴' : '🟠'} {r.text}</li>)}</ul>
          ) : <p className="muted">{res.status === 'wait' ? 'The paper has not been read by AI yet.' : 'Nothing wrong found.'}</p>}
          {p && (
            <div className="bv-paper">
              <b>What the AI read on the paper</b>
              <table><tbody>
                {[['Shop', p.vendor], ['Receipt No.', p.doc_no], ['Date', p.date ? when(p.date) : ''], ['VAT No.', p.vendor_vat], ['Vehicle No.', p.vehicle_no],
                  ['Subtotal', f3(p.subtotal)], ['VAT', f3(p.vat_amount)], ['Total', f3(p.total)], ['Printed by', p.printed_by], ['Clear photo', p.confidence]]
                  .filter(([, val]) => val !== '' && val !== null && val !== undefined).map(([k, val]) => <tr key={k}><td>{k}</td><td>{val}</td></tr>)}
              </tbody></table>
              <span className="muted">Read {when(res.read.at)}</span>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12 }}>AI only lists what it finds. It cannot prove a bill is real.</p>
          <div className="modal-actions">
            {(d.files || []).length > 0 && (
              <button type="button" className="btn ghost" disabled={!!busy} onClick={readAgain}>{busy === 'ai' ? 'Reading...' : p ? '🤖 Read paper again' : '🤖 Read paper with AI'}</button>
            )}
            <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </Modal>
      )}

      {rej && (
        <Modal title={`Reject ${d.doc_no}`} onClose={() => !busy && setRej(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Reason is optional.</p>
          <div className="bv-reasons">
            {REJECT_REASONS.map((r) => (
              <button key={r} type="button" className={`rp-chip ${rej.reason === r ? 'active' : ''}`} onClick={() => setRej({ ...rej, reason: rej.reason === r ? '' : r })}>{r}</button>
            ))}
          </div>
          <textarea className="bv-note" rows={3} placeholder="Note (optional)" value={rej.note} onChange={(e) => setRej({ ...rej, note: e.target.value })} />
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setRej(null)} disabled={!!busy}>Cancel</button>
            <button type="button" className="btn danger" onClick={reject} disabled={!!busy}>{busy ? 'Saving...' : '✗ Reject'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
