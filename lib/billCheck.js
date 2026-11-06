/*
  AI verification of a bill (Kamran 6 Nov 2026). Pure, used by components/BillVerify.js on the Bills list.
  Two parts, put together into one result:
  1. Rule checks, always live (no AI cost): VAT %, VAT No. format, date, same Receipt No. twice,
     same Paid to + date + amount twice, amount far above that supplier's usual bills, no paper.
  2. What the AI read on the paper (company_docs.ai_check.paper, saved when the paper was read):
     total, VAT, receipt no., date, VAT No., vehicle no. compared with what is typed; not a bill;
     signs of editing; handwritten; unclear photo.
  Result: { status: 'ok' | 'check' | 'bad' | 'wait', reasons: [{ lvl: 'bad'|'check', text }], read }
    ok = nothing found, check = look at the reasons, bad = suspicious, wait = paper not read by AI yet.
  The AI never says a bill is genuine or fake for sure: it only lists what it found.
*/
import { shortOf } from '@/lib/docShort';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const lineTotal = (items) => r3((items || []).reduce((t, i) => t + n(i.amount), 0));
export const billTotal = (d) => r3(lineTotal(d.items) * (1 + n(d.vat_pct) / 100));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const dmy = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const f3 = (v) => r3(v).toFixed(3);

/* the paper the AI read must still be the bill's first paper (a replaced paper needs a new read) */
export function paperRead(d) {
  const a = d?.ai_check;
  const first = (d?.files || [])[0];
  if (!a || !first) return null;
  if (a.path && a.path !== first.path) return null;
  return a;
}

export function checkBill(d, list = [], today = new Date().toISOString().slice(0, 10)) {
  const reasons = [];
  const add = (lvl, text) => reasons.push({ lvl, text });
  const x = shortOf(d);
  const total = billTotal(d);
  const sub = lineTotal(d.items);
  const vat = r3(total - sub);
  const pct = n(d.vat_pct);
  const others = (list || []).filter((o) => o.id !== d.id && o.kind === d.kind);

  // paper
  const hasPaper = (d.files || []).length > 0;
  if (!hasPaper) add('check', 'No bill paper uploaded.');

  // maths / VAT
  if (pct > 0 && Math.abs(pct - 5) > 0.05) add('check', `VAT is ${pct.toFixed(2)}%, not 5%.`);
  const vno = String(x.vat_no || '').replace(/\s+/g, '').toUpperCase();
  if (vat > 0 && !vno) add('check', 'VAT is charged but there is no VAT No.');
  if (vno && !/^OM\d{10}$/.test(vno)) add('check', `VAT No. ${x.vat_no} does not look like an Oman VAT No. (OM and 10 digits).`);

  // date
  if (d.doc_date && d.doc_date > today) add('check', `Date ${dmy(d.doc_date)} is in the future.`);
  if (d.doc_date) {
    const age = (new Date(today) - new Date(d.doc_date)) / 86400000;
    if (age > 365) add('check', `Bill is more than one year old (${dmy(d.doc_date)}).`);
  }

  // duplicates
  const rno = digits(x.receipt_no) || norm(x.receipt_no);
  if (rno) {
    const same = others.find((o) => { const r = shortOf(o).receipt_no; return (digits(r) || norm(r)) === rno; });
    if (same) add('bad', `Same Receipt No. as ${same.doc_no}.`);
  }
  const party = norm(d.party);
  if (party && total > 0) {
    const twin = others.find((o) => norm(o.party) === party && o.doc_date === d.doc_date && Math.abs(billTotal(o) - total) < 0.0005);
    if (twin) add('bad', `Same Paid to, date and amount as ${twin.doc_no}.`);
  }

  // unusual amount for this supplier
  if (party && total > 0) {
    const amts = others.filter((o) => norm(o.party) === party).map(billTotal).filter((v) => v > 0).sort((a, b) => a - b);
    if (amts.length >= 3) {
      const mid = amts[Math.floor(amts.length / 2)];
      if (total > mid * 3 && total - mid > 10) add('check', `Amount ${f3(total)} is much higher than usual for ${d.party} (usually about ${f3(mid)}).`);
    }
  }

  // what the AI read on the paper
  const a = paperRead(d);
  if (a?.error) add('check', `AI could not read the paper: ${a.error}`);
  const p = a?.paper;
  if (p) {
    if (p.doc_type === 'other') add('bad', 'AI says the paper does not look like a bill or receipt.');
    if (p.total !== null && p.total !== undefined && total > 0 && Math.abs(r3(p.total) - total) > 0.005) add('bad', `Paper total is ${f3(p.total)} but ${f3(total)} is typed.`);
    if (p.vat_amount !== null && p.vat_amount !== undefined && Math.abs(r3(p.vat_amount) - vat) > 0.005) add('check', `Paper VAT is ${f3(p.vat_amount)} but ${f3(vat)} is typed.`);
    const pr = digits(p.doc_no) || norm(p.doc_no);
    if (pr && rno && pr !== rno) add('check', `Paper Receipt No. is ${p.doc_no} but ${x.receipt_no} is typed.`);
    if (p.date && d.doc_date && p.date !== d.doc_date) add('check', `Paper date is ${dmy(p.date)} but ${dmy(d.doc_date)} is typed.`);
    const pv = String(p.vendor_vat || '').replace(/\s+/g, '').toUpperCase();
    if (pv && vno && pv !== vno) add('check', `Paper VAT No. is ${p.vendor_vat} but ${x.vat_no} is typed.`);
    if (p.vehicle_no && x.vehicle_no && norm(p.vehicle_no) !== norm(x.vehicle_no)) add('check', `Paper vehicle no. is ${p.vehicle_no} but ${x.vehicle_no} is typed.`);
    if (p.looks_edited) add('bad', `Signs of editing on the paper${p.edit_signs ? `: ${p.edit_signs}` : '.'}`);
    if (/hand/i.test(p.printed_by || '')) add('check', 'Handwritten bill: check it by eye.');
    if (/screen/i.test(p.printed_by || '')) add('check', 'Looks like a screenshot, not a printed bill.');
    if (p.confidence === 'low') add('check', 'The photo is not clear, AI could not read it well.');
    if (p.warnings) add('check', `AI note: ${p.warnings}`);
  }

  const status = reasons.some((r) => r.lvl === 'bad') ? 'bad'
    : reasons.length ? 'check'
      : hasPaper && !p ? 'wait' : 'ok';
  return { status, reasons, read: a };
}

export const AI_LABEL = { ok: '🟢 Looks OK', check: '🟠 Check', bad: '🔴 Suspicious', wait: '⚪ Not read yet' };

/* short copy of the AI paper read kept in company_docs.ai_check.paper */
export function slimPaper(p) {
  if (!p) return null;
  return {
    doc_type: p.doc_type || '', vendor: p.vendor || '', vendor_vat: p.vendor_vat || '', doc_no: p.doc_no || '', date: p.date || '',
    vehicle_no: p.vehicle_no || '', total: p.total ?? null, vat_amount: p.vat_amount ?? null, subtotal: p.subtotal_excl_vat ?? null,
    confidence: p.confidence || '', warnings: p.warnings || '', looks_edited: !!p.looks_edited, edit_signs: p.edit_signs || '',
    printed_by: p.printed_by || ''
  };
}

export const REJECT_REASONS = ['Fake', 'Not correct', 'Duplicate', 'Other'];
