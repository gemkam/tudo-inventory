'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DateInput from '@/components/DateInput';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { todayISO } from '@/lib/sheet';
import DeptPicker from '@/components/DeptPicker';
import { HEADS, CATEGORIES, PAY_METHODS, DEPARTMENTS, n, r3 } from '@/lib/expenses';
import { fuelOf, FUELS } from '@/lib/docShort';

/*
  📥 Import documents for All Companies > Invoices / Payment receipts (app/expenses/docs/page.js).
  1. Pick photos or PDFs (several at once; phone camera works too).
  2. Each file is shrunk to a JPEG (PDF: first 2 pages, drawn with pdf.js from cdnjs) and sent to /api/doc-ocr.
  3. The AI result shows as a card to CHECK and EDIT: date, paid to, payment method, vehicle, lines, VAT, and
     "All details on the paper" (TXN ID, Ticket, TID, Date of supply, Time, User, Pump, VEH No, product, qty, price ...).
  4. "Save" adds each ticked card as a company_docs row (kind = Payment receipt or Invoice, our own number PR-AW-0001 ...),
     keeps the original file in bucket doc-files (company_docs/<id>/...) and all read details in company_docs.scan.
     A payment receipt then goes to All Companies expenses by itself (DB trigger), like a typed one.
  VAT: Oman VAT is inside fuel prices (inclusive). Lines are saved WITHOUT VAT and vat_pct 5, so the total matches the paper.
*/

const ACCEPT = 'image/*,application/pdf,.pdf';
const MAX_SIDE = 1800;
const isPdf = (f) => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || '');
const safe = (name) => String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file';
const num = (v) => (v === null || v === undefined || v === '' ? '' : String(v));

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      ok(window.pdfjsLib);
    };
    s.onerror = () => bad(new Error('PDF reader could not load. Check the internet.'));
    document.head.appendChild(s);
  });
}

function toJpeg(canvas) {
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const g = out.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}

async function fileToImage(file) {
  if (isPdf(file)) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= Math.min(2, pdf.numPages); p += 1) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      pages.push(c);
    }
    const all = document.createElement('canvas');
    all.width = Math.max(...pages.map((c) => c.width));
    all.height = pages.reduce((t, c) => t + c.height, 0);
    const g = all.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, all.width, all.height);
    let y = 0;
    for (const c of pages) { g.drawImage(c, 0, y); y += c.height; }
    return toJpeg(all);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('This photo could not be opened.'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return toJpeg(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* AI result -> a form the user checks */
function toForm(d, kind, co, last) {
  const fuelType = fuelOf((d.items || []).map((i) => i.desc).join(' ')) || (d.is_fuel ? 'Petrol' : '');
  const fuel = !!fuelType;
  const diesel = fuelType === 'Diesel';
  const mode = d.vat_mode;
  const vatOn = n(d.vat_amount) > 0;
  const raw = (d.items || []).length ? d.items : [{ desc: d.doc_type || 'Payment', amount: d.total }];
  const rawSum = raw.reduce((t, i) => t + n(i.amount), 0);
  // inclusive VAT: bring the lines down to their amount without VAT, so subtotal + 5% = the paper total
  const target = vatOn ? n(d.subtotal_excl_vat) : n(d.total) || rawSum;
  const factor = mode === 'inclusive' && vatOn && rawSum ? target / rawSum : 1;
  // the line printed on the letterhead stays short: only the product (vehicle, receipt no. etc. are NOT printed)
  const items = raw.map((i) => ({ desc: i.desc || 'Item', amount: r3(n(i.amount) * factor).toFixed(3) }));
  // any rounding gap goes on the first line
  const gap = r3(target - items.reduce((t, i) => t + n(i.amount), 0));
  if (gap && Math.abs(gap) < 0.05) items[0].amount = r3(n(items[0].amount) + gap).toFixed(3);
  const pay = PAY_METHODS.find((p) => p.toLowerCase() === String(d.payment_method || '').toLowerCase()) || d.payment_method || last?.payment_method || 'Cash';
  return {
    save: d.doc_type !== 'other',
    kind,
    doc_date: d.date || todayISO(),
    party: d.vendor || '',
    party_details: '',
    party_vat: d.vendor_vat || '',
    receipt_no: d.doc_no || '',
    vehicle_no: d.vehicle_no || '',
    fuel: fuelType,
    payment_method: pay,
    department: last?.department || (DEPARTMENTS[co] || [])[0] || '',
    head: fuel ? 'Vehicle Running and Maintenance' : last?.head || 'Office Expenses',
    category: fuel ? (diesel ? 'Diesel' : 'Petrol') : last?.category || '',
    vat_pct: vatOn ? 5 : 0,
    items,
    paperTotal: d.total,
    vat_amount: d.vat_amount,
    scan: d,
    diesel
  };
}

export default function DocImport({ co, coShort, kind, userName, last, nextNo, onDone, flash }) {
  const pick = useRef(null);
  const [cards, setCards] = useState(null); // [{ id, file, name, preview, status: reading|ready|error, error, form }]
  const [saving, setSaving] = useState(false);

  const upd = (id, fn) => setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const setF = (id, k, v) => upd(id, (c) => {
    const form = { ...c.form, [k]: v };
    if (k === 'fuel' && v) { form.category = v; form.head = 'Vehicle Running and Maintenance'; }
    return { ...c, form };
  });
  const setItem = (id, i, k, v) => upd(id, (c) => ({ ...c, form: { ...c.form, items: c.form.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) } }));

  async function readOne(card) {
    try {
      const image = await fileToImage(card.file);
      upd(card.id, (c) => ({ ...c, preview: image }));
      const { data: s } = await sb().auth.getSession();
      const res = await fetch('/api/doc-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
        body: JSON.stringify({ image, kind, company: co })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
      const form = toForm(out.data, kind, co, last);
      // same bill saved before? (same receipt no., any company) -> untick and say where
      const rno = String(form.receipt_no || '').trim();
      if (rno) {
        const { data: same } = await sb().from('company_docs').select('doc_no, company').eq('scan->>receipt_no', rno).limit(1);
        if (same && same.length) { form.save = false; form.dup = `Already saved as ${same[0].doc_no}. Not ticked, so it is not saved twice.`; }
      }
      upd(card.id, (c) => ({ ...c, status: 'ready', model: out.model, form }));
    } catch (e) {
      upd(card.id, (c) => ({ ...c, status: 'error', error: e.message }));
    }
  }

  async function onPick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const fresh = files.map((file, i) => ({ id: `${Date.now()}-${i}`, file, name: file.name, status: 'reading' }));
    setCards((cs) => [...(cs || []), ...fresh]);
    // two at a time so the free AI limit is not hit at once
    const queue = [...fresh];
    const worker = async () => { while (queue.length) await readOne(queue.shift()); };
    await Promise.all([worker(), worker()]);
  }

  async function saveAll() {
    const todo = (cards || []).filter((c) => c.status === 'ready' && c.form.save);
    if (!todo.length) { flash('Nothing ticked to save.', 'err'); return; }
    for (const c of todo) if (!c.form.party.trim()) { flash(`${c.name}: please fill "Paid to / Bill to".`, 'err'); return; }
    setSaving(true);
    let ok = 0;
    const seq = { invoice: 0, receipt: 0 };
    const savedRows = [];
    // the same receipt no. ticked twice in this import: keep the first only
    const seen = new Set();
    for (const c of todo) {
      const r = String(c.form.receipt_no || '').trim();
      if (r && seen.has(r)) { flash(`${c.name}: receipt ${r} is ticked twice. Untick one.`, 'err'); return; }
      if (r) seen.add(r);
    }
    for (const c of todo) {
      const f = c.form;
      const items = f.items.map((i) => ({ desc: String(i.desc || '').trim(), amount: i.amount === '' ? '' : r3(i.amount) })).filter((i) => i.desc || i.amount !== '');
      const row = {
        company: co, kind: f.kind, doc_no: await nextNo(f.kind, seq[f.kind]), doc_date: f.doc_date || todayISO(), party: f.party.trim(),
        party_details: f.party_details || null, party_vat: f.party_vat || null, items, vat_pct: n(f.vat_pct),
        payment_method: f.kind === 'receipt' ? f.payment_method || null : null,
        department: f.kind === 'receipt' ? f.department || null : null,
        head: f.kind === 'receipt' ? f.head || null : null,
        category: f.kind === 'receipt' ? f.category || null : null,
        notes: null, signatory: null, created_by: userName || null,
        // only the short details are kept (Kamran: Receipt No., Amount, VAT No., Vehicle No., Fuel)
        scan: {
          receipt_no: f.receipt_no.trim(), vehicle_no: f.vehicle_no.trim(), fuel: f.fuel, vat_no: f.party_vat.trim(),
          amount: f.paperTotal ?? null, vat_amount: f.vat_amount ?? null, file_name: c.name
        }
      };
      const { data, error } = await sb().from('company_docs').insert(row).select().single();
      if (error) { upd(c.id, (x) => ({ ...x, status: 'error', error: error.code === '42501' ? 'You need Full access to save.' : error.message })); continue; }
      seq[f.kind] += 1;
      // keep the original paper with the record
      const path = `company_docs/${data.id}/${Date.now()}-${safe(c.name)}`;
      const up = await sb().storage.from('doc-files').upload(path, c.file, { contentType: c.file.type || undefined, upsert: false });
      if (!up.error) {
        await sb().from('company_docs').update({ files: [{ path, name: c.name, size: c.file.size, type: c.file.type || '', at: new Date().toISOString(), by: userName || '' }] }).eq('id', data.id);
      }
      ok += 1;
      savedRows.push({ id: data.id, path: up.error ? null : path });
      upd(c.id, (x) => ({ ...x, status: 'saved', savedNo: data.doc_no }));
    }
    setSaving(false);
    if (ok) { flash(`${ok} saved${todo.some((c) => c.form.kind === 'receipt') ? ` and added to ${coShort} expenses` : ''}.`); onDone(savedRows); }
  }

  const close = () => {
    if (saving) return;
    if ((cards || []).some((c) => c.status === 'ready' && c.form.save) && !window.confirm('Close without saving the read documents?')) return;
    setCards(null);
  };

  const readyCount = (cards || []).filter((c) => c.status === 'ready' && c.form.save).length;
  const reading = (cards || []).filter((c) => c.status === 'reading').length;

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => { setCards((c) => c || []); setTimeout(() => pick.current?.click(), 0); }}>📥 Import documents</button>
      <input ref={pick} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
      {cards && createPortal(
        <div className="modal-back di-back" role="dialog" aria-modal="true" aria-label="Import documents">
          <div className="di-box">
            <div className="di-head">
              <div>
                <b>📥 Import documents · {coShort}</b>
                <span>AI reads each photo or PDF. Check every box before you save.</span>
              </div>
              <button type="button" className="cd-x" onClick={close} aria-label="Close">×</button>
            </div>

            <div className="di-body">
              {cards.length === 0 && <p className="muted">Choose photos or PDFs of bills, invoices or receipts.</p>}
              {cards.map((c) => {
                const f = c.form;
                const sub = f ? r3(f.items.reduce((t, i) => t + n(i.amount), 0)) : 0;
                const tot = f ? r3(sub + r3((sub * n(f.vat_pct)) / 100)) : 0;
                const off = f && f.paperTotal !== null && f.paperTotal !== undefined && Math.abs(r3(f.paperTotal) - tot) > 0.004;
                return (
                  <section key={c.id} className={`di-card s-${c.status}${f && !f.save ? ' off' : ''}`}>
                    <div className="di-pic">{c.preview ? <img src={c.preview} alt={c.name} /> : <span>{isPdf(c.file) ? '📕' : '🖼'}</span>}<small>{c.name}</small></div>
                    <div className="di-form">
                      {c.status === 'reading' && <p className="di-status">⏳ Reading...</p>}
                      {c.status === 'error' && <p className="di-status err">⚠ {c.error} <button type="button" className="btn small ghost" onClick={() => { upd(c.id, (x) => ({ ...x, status: 'reading', error: '' })); readOne(c); }}>↻ Try again</button></p>}
                      {c.status === 'saved' && <p className="di-status ok">✓ Saved as {c.savedNo}</p>}
                      {f && c.status === 'ready' && (
                        <>
                          <div className="di-top">
                            <label className="di-tick"><input type="checkbox" checked={f.save} onChange={(e) => setF(c.id, 'save', e.target.checked)} /> Save this</label>
                            <select value={f.kind} onChange={(e) => setF(c.id, 'kind', e.target.value)}>
                              <option value="receipt">Bill (expense)</option>
                              <option value="invoice">Invoice (our sale)</option>
                            </select>
                            {f.scan.confidence && <span className={`di-conf c-${f.scan.confidence}`}>{f.scan.confidence === 'high' ? 'Clear' : f.scan.confidence === 'medium' ? 'Check' : 'Unclear'}</span>}
                          </div>
                          {f.dup && <p className="di-warn di-dup">⚠ {f.dup}</p>}
                          {f.scan.warnings && <p className="di-warn">⚠ {f.scan.warnings}</p>}
                          {f.diesel && co === 'modern-city' && f.kind === 'receipt' && <p className="di-warn">⚠ Diesel for the trucks is already counted from the trip sheets. Save this only if it is not on a trip sheet, or it is counted twice.</p>}
                          <div className="di-grid">
                            <label><span>Date</span><DateInput value={f.doc_date} onChange={(v) => setF(c.id, 'doc_date', v)} /></label>
                            <label className="wide"><span>{f.kind === 'receipt' ? 'Paid to' : 'Bill to'}</span><input value={f.party} onChange={(e) => setF(c.id, 'party', e.target.value)} /></label>
                            <label><span>Receipt No.</span><input value={f.receipt_no} onChange={(e) => setF(c.id, 'receipt_no', e.target.value)} /></label>
                            <label><span>Vehicle No.</span><input value={f.vehicle_no} onChange={(e) => setF(c.id, 'vehicle_no', e.target.value)} /></label>
                            <label><span>Fuel</span>
                              <select value={f.fuel} onChange={(e) => setF(c.id, 'fuel', e.target.value)}>
                                <option value="">Not fuel</option>{FUELS.map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            </label>
                            <label><span>VAT No.</span><input value={f.party_vat} onChange={(e) => setF(c.id, 'party_vat', e.target.value)} /></label>
                            {f.kind === 'receipt' && (
                              <>
                                <label><span>Payment</span><input list="di-pay" value={f.payment_method} onChange={(e) => setF(c.id, 'payment_method', e.target.value)} /></label>
                                <div className="di-dept"><span>Department</span><DeptPicker co={co} className="" value={f.department} onChange={(v) => setF(c.id, 'department', v)} /></div>
                                <label><span>Head</span><input list="di-head" value={f.head} onChange={(e) => setF(c.id, 'head', e.target.value)} /></label>
                                <label><span>Category</span><input list="di-cat" value={f.category} onChange={(e) => setF(c.id, 'category', e.target.value)} /></label>
                              </>
                            )}
                          </div>

                          <table className="di-lines">
                            <thead><tr><th>Description</th><th className="num">Amount {n(f.vat_pct) ? '(without VAT)' : ''}</th></tr></thead>
                            <tbody>
                              {f.items.map((it, i) => (
                                <tr key={i}>
                                  <td><input value={it.desc} onChange={(e) => setItem(c.id, i, 'desc', e.target.value)} /></td>
                                  <td className="num"><input inputMode="decimal" value={it.amount} onChange={(e) => setItem(c.id, i, 'amount', e.target.value.replace(/[^\d.-]/g, ''))} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="di-sum">
                            <span>VAT <select value={String(n(f.vat_pct))} onChange={(e) => setF(c.id, 'vat_pct', Number(e.target.value))}><option value="0">0%</option><option value="5">5%</option></select></span>
                            <span>Total <b><Omr v={tot} /></b></span>
                            {f.paperTotal !== null && f.paperTotal !== undefined && <span className={off ? 'bad' : 'good'}>Paper says {r3(f.paperTotal).toFixed(3)} {off ? '⚠ not the same' : '✓'}</span>}
                          </div>

                        </>
                      )}
                    </div>
                  </section>
                );
              })}
              <datalist id="di-pay">{PAY_METHODS.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="di-head">{HEADS.map((p) => <option key={p} value={p} />)}</datalist>
              <datalist id="di-cat">{[...CATEGORIES, 'Diesel'].map((p) => <option key={p} value={p} />)}</datalist>
            </div>

            <div className="di-foot">
              <button type="button" className="btn ghost" onClick={() => pick.current?.click()} disabled={saving}>＋ Add more files</button>
              <span className="muted">{reading ? `Reading ${reading}...` : `${readyCount} ready to save`}</span>
              <button type="button" className="btn ghost" onClick={close} disabled={saving}>Close</button>
              <button type="button" className="btn" onClick={saveAll} disabled={saving || !readyCount}>{saving ? 'Saving...' : `💾 Save ${readyCount || ''}`}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
