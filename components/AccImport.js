'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '@/lib/supabase';
import DateInput from '@/components/DateInput';
import { ACCEPT, kindOf, ICON, loadPdfJs, toJpeg, imageToJpeg } from '@/components/PeopleImport';
import { TXN_CATS } from '@/lib/accounts';
import { LINE_TYPES, isTxn, mapTable, cleanLine, txnKey, savedTxnIndex, itemKey, matchAccount, itemCats } from '@/lib/accImport';

/*
  📥 Import documents in 🏦 Accounts (Kamran, 4 Nov 2026: "import documents, all types of them, in Accounts").
  Any files at once: Excel (.xlsx .xls .ods), CSV / text, Word (.docx), PDF, photos.
  - Tables with headers (Date, Description, Debit, Credit, Amount, Cheque ...) are read here, no AI.
  - Other text, PDF text, photos and scanned PDFs go to the AI (app/api/acc-import).
  Every line shows in one list to check: Money in / Money out go to the Bank & Cash ledger of the chosen account
  (a bank statement with an account not saved yet can make a "＋ New account"), Asset / Loan / Capital go to
  Assets, loans & capital. DOUBLES (same account, date, amount and direction already saved, or twice in these files)
  are red and unticked; tick them to add anyway. The page's ↶ Undo import takes the whole import back.
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function askAI(body) {
  const { data: s } = await sb().auth.getSession();
  const res = await fetch('/api/acc-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not read (${res.status})`);
  return { lines: data.lines || [], account: data.account || {} };
}

/* one file -> { lines, account, how } */
async function readFile(file) {
  const k = kindOf(file);
  if (k === 'doc') throw new Error('Old Word file (.doc). Open it in Word and save it as .docx or PDF, then import again.');
  if (k === 'other') throw new Error('This file type cannot be read. Use Excel, CSV, Word (.docx), PDF or a photo.');

  if (k === 'sheet' || k === 'csvtext') {
    const XLSX = await import('xlsx');
    const wb = k === 'sheet'
      ? XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      : XLSX.read(await file.text(), { type: 'string', cellDates: true, raw: false });
    const lines = [];
    const loose = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const got = mapTable(rows);
      if (got && got.length) lines.push(...got);
      else if (rows.length) loose.push(`Sheet ${name}:\n${XLSX.utils.sheet_to_csv(ws)}`);
    }
    if (lines.length) return { lines, account: {}, how: 'columns' };
    if (loose.length) return { ...(await askAI({ text: loose.join('\n\n') })), how: 'AI' };
    return { lines: [], account: {}, how: 'columns' };
  }

  if (k === 'docx') {
    const mod = await import('mammoth');
    const mammoth = mod.default || mod;
    const buf = await file.arrayBuffer();
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = [];
    doc.querySelectorAll('table').forEach((t) => {
      const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((td) => td.textContent.trim()));
      const got = mapTable(rows);
      if (got && got.length) lines.push(...got);
    });
    if (lines.length) return { lines, account: {}, how: 'columns' };
    const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
    return { ...(await askAI({ text })), how: 'AI' };
  }

  if (k === 'pdf') {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(12, pdf.numPages); p += 1) {
      const c = await (await pdf.getPage(p)).getTextContent();
      text += `${c.items.map((i) => i.str).join(' ')}\n`;
    }
    if (text.replace(/\s+/g, '').length > 60) return { ...(await askAI({ text })), how: 'AI' };
    // scanned PDF: each page as a photo (up to 4 pages)
    const lines = [];
    let account = {};
    for (let p = 1; p <= Math.min(4, pdf.numPages); p += 1) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const got = await askAI({ image: toJpeg(cv) });
      lines.push(...got.lines);
      if (!account.bank_name && !account.account_no) account = got.account || {};
    }
    return { lines, account, how: 'AI photo' };
  }

  return { ...(await askAI({ image: await imageToJpeg(file) })), how: 'AI photo' };
}

function matchCompany(text, companies) {
  const s = normText(text);
  if (!s) return '';
  const hit = companies.find((c) => {
    const a = normText(c.short);
    const b = normText(c.name);
    const first = a.split(' ')[0];
    return s.includes(a) || (b && (b.includes(s) || s.includes(b))) || (first.length > 3 && s.includes(first));
  });
  return hit ? hit.key : '';
}

export default function AccImport({ D, co, companies, user, flash, onSaved, className = 'btn', disabled }) {
  const input = useRef(null);
  const [files, setFiles] = useState(null); // [{ id, name, kind, status, error, how, count, account }]
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const defaultCo = co && co !== 'all' ? co : companies[0]?.key || 'modern-city';
  const savedIdx = useMemo(() => savedTxnIndex(D.txns), [D.txns]);
  const savedItems = useMemo(() => new Set((D.items || []).map((x) => itemKey(x.company, x.side, x.name, x.amount))), [D.items]);

  // new accounts this import can make (one per file that names a bank / account not saved yet)
  const newAccs = useMemo(() => (files || []).filter((f) => f.account && (f.account.bank_name || f.account.account_no)).map((f) => ({
    id: `new:${f.id}`, file: f.name, ...f.account,
    label: `＋ New: ${[f.account.bank_name, f.account.account_no ? `A/c ${f.account.account_no}` : ''].filter(Boolean).join(' ') || f.name}`
  })), [files]);

  const dupOf = (l, earlier) => {
    if (isTxn(l.type)) {
      if (!l.account) return '';
      const k = txnKey(l.account, l.date, l.type, l.amount);
      if (!String(l.account).startsWith('new:') && savedIdx.has(k)) {
        const t = savedIdx.get(k)[0];
        if (!l.ref || !t.ref || String(t.ref) === String(l.ref)) return `Already saved: ${t.description || t.category || 'line'} on the same day`;
      }
      if (earlier.has(k)) return 'Twice in these files';
      return '';
    }
    const k = itemKey(l.company, l.type, l.description, l.amount);
    if (savedItems.has(k)) return 'Already saved in Assets, loans & capital';
    if (earlier.has(k)) return 'Twice in these files';
    return '';
  };
  const dups = useMemo(() => {
    const out = {};
    const earlier = new Set();
    for (const l of lines) {
      out[l.id] = dupOf(l, earlier);
      if (l.save) earlier.add(isTxn(l.type) ? txnKey(l.account, l.date, l.type, l.amount) : itemKey(l.company, l.type, l.description, l.amount));
    }
    return out;
  }, [lines, savedIdx, savedItems]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick() { if (input.current) { input.current.value = ''; input.current.click(); } }

  async function onPick(e) {
    const list = [...(e.target.files || [])];
    if (!list.length) return;
    const fl = list.map((f, i) => ({ id: `${Date.now()}-${i}`, file: f, name: f.name, kind: kindOf(f), status: 'reading', error: '', how: '', count: 0, account: null }));
    setFiles(fl);
    setLines([]);
    let next = 0;
    const work = async () => {
      while (next < fl.length) {
        const f = fl[next]; next += 1;
        try {
          const { lines: got, account, how } = await readFile(f.file);
          const company = matchCompany(account?.holder, companies) || defaultCo;
          const known = matchAccount(account, D.accounts, company) || matchAccount(account, D.accounts);
          const hasHint = account && (account.bank_name || account.account_no);
          const acc = known || (hasHint ? `new:${f.id}` : (D.accounts.find((a) => a.company === company) || D.accounts[0])?.id || '');
          const seen = new Set();
          const rows = got.map(cleanLine).filter((l) => l.amount > 0).map((l, j) => {
            const row = { ...l, id: `${f.id}-${j}`, file: f.name, company: acc && !String(acc).startsWith('new:') ? (D.accounts.find((a) => a.id === acc)?.company || company) : company, account: isTxn(l.type) ? acc : '' };
            const k = isTxn(row.type) ? txnKey(row.account, row.date, row.type, row.amount) : itemKey(row.company, row.type, row.description, row.amount);
            const dupSaved = isTxn(row.type) ? (!String(row.account).startsWith('new:') && savedIdx.has(k)) : savedItems.has(k);
            row.save = !dupSaved && !seen.has(k);
            seen.add(k);
            return row;
          });
          setLines((l) => [...l, ...rows]);
          setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, status: 'done', how, count: rows.length, account: known ? null : (hasHint ? account : null) } : x)));
        } catch (err) {
          setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, status: 'error', error: err.message } : x)));
        }
      }
    };
    await Promise.all([work(), work()]);
  }

  const setL = (id, k, v) => setLines((l) => l.map((x) => {
    if (x.id !== id) return x;
    const y = { ...x, [k]: v };
    if (k === 'type' && isTxn(v) && !y.account) y.account = (D.accounts.find((a) => a.company === y.company) || D.accounts[0])?.id || newAccs[0]?.id || '';
    if (k === 'account' && v && !String(v).startsWith('new:')) y.company = D.accounts.find((a) => a.id === v)?.company || y.company;
    if (k === 'type') y.category = '';
    return y;
  }));
  const ticked = lines.filter((l) => l.save && l.amount > 0 && (!isTxn(l.type) || l.account));
  const doubles = ticked.filter((l) => dups[l.id]).length;
  const reading = (files || []).some((f) => f.status === 'reading');
  const accLabel = (a) => `${companies.find((c) => c.key === a.company)?.short || a.company} · ${a.name}${a.account_no ? ` (${a.account_no})` : ''}`;

  async function save() {
    if (!ticked.length) return;
    setBusy(true);
    const s = sb();
    const made = { accounts: [], txns: [], items: [] };
    try {
      // 1. new accounts used by ticked lines
      const map = {};
      for (const na of newAccs.filter((x) => ticked.some((l) => l.account === x.id))) {
        const first = ticked.find((l) => l.account === na.id);
        const row = {
          company: first.company || defaultCo, name: [na.bank_name || 'Bank', na.account_no ? String(na.account_no).slice(-4) : ''].filter(Boolean).join(' '), kind: 'Bank',
          bank_name: na.bank_name || null, account_no: na.account_no || null, opening_balance: r3(na.opening_balance), opening_date: null, active: true, notes: `Made by 📥 Import documents (${na.file})`
        };
        const r = await s.from('acc_accounts').insert(row).select().single();
        if (r.error) throw r.error;
        map[na.id] = r.data.id; made.accounts.push(r.data.id);
      }
      // 2. money in / out lines
      const txRows = ticked.filter((l) => isTxn(l.type)).map((l) => ({
        account_id: map[l.account] || l.account, txn_date: l.date || new Date().toISOString().slice(0, 10), description: l.description || null, party: l.party || null,
        ref: l.ref || null, category: l.category || null, money_in: l.type === 'in' ? r3(l.amount) : 0, money_out: l.type === 'out' ? r3(l.amount) : 0,
        cleared: false, notes: [l.notes, `Imported from ${l.file}`].filter(Boolean).join(' · '), entered_by: user.name
      }));
      if (txRows.length) {
        const r = await s.from('acc_txns').insert(txRows).select('id');
        if (r.error) throw r.error;
        made.txns = (r.data || []).map((x) => x.id);
      }
      // 3. assets, loans and capital
      const itRows = ticked.filter((l) => !isTxn(l.type)).map((l) => ({
        company: l.company || defaultCo, side: l.type, name: l.description || l.category || 'Imported', amount: r3(l.amount), as_of: l.date || null,
        notes: [l.category && l.category !== l.description ? l.category : '', l.party, l.ref, l.notes, `Imported from ${l.file}`].filter(Boolean).join(' · ')
      }));
      if (itRows.length) {
        const r = await s.from('acc_items').insert(itRows).select('id');
        if (r.error) throw r.error;
        made.items = (r.data || []).map((x) => x.id);
      }
      onSaved(made, { txns: txRows.length, items: itRows.length, accounts: made.accounts.length, doubles });
      setFiles(null); setLines([]);
    } catch (err) {
      flash(`${err.message || err}${made.txns.length || made.accounts.length ? ' (part was saved, use ↶ Undo import)' : ''}`, 'err');
      if (made.accounts.length || made.txns.length || made.items.length) onSaved(made, null);
    }
    setBusy(false);
  }

  function close() { if (!busy) { setFiles(null); setLines([]); } }

  return (
    <>
      <button type="button" className={className} onClick={pick} disabled={disabled} title={disabled ? 'Locked: press ✏️ Edit first' : 'Add money lines from bank statements, receipts, vouchers, loan or asset papers: Excel, CSV, Word, PDF or photos'}>📥 Import documents</button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
      {files && createPortal(
        <div className="modal-back di-back" role="dialog" aria-modal="true" aria-label="Import documents">
          <div className="di-box pi-box">
            <div className="di-head">
              <div>
                <b>📥 Import documents · Accounts</b>
                <span>Check every line before adding. Money in / out go to the Bank & Cash account you choose, Asset / Loan / Capital to Assets, loans & capital. <span className="pi-red-t">Red</span> = double (unticked).</span>
              </div>
              <button type="button" className="btn ghost small" onClick={close} disabled={busy}>✕ Close</button>
            </div>

            <div className="di-body">
              <div className="pi-files">
                {files.map((f) => (
                  <div key={f.id} className={`pi-file s-${f.status}`}>
                    <span aria-hidden="true">{ICON[f.kind]}</span>
                    <b>{f.name}</b>
                    <small>{f.status === 'reading' ? '⏳ Reading...' : f.status === 'error' ? `⚠ ${f.error}` : `✓ ${f.count} line${f.count === 1 ? '' : 's'} found${f.how ? ` (${f.how})` : ''}${f.account ? ` · account not saved yet: ${[f.account.bank_name, f.account.account_no].filter(Boolean).join(' ')}` : ''}`}</small>
                  </div>
                ))}
              </div>
              {!D.accounts.length && !newAccs.length && lines.some((l) => isTxn(l.type)) && (
                <p className="error">No bank or cash account is saved yet. Make one in 🏦 Bank & Cash first, or change these lines to Asset / Loan / Capital.</p>
              )}

              {lines.length > 0 && (
                <div className="grid-wrap pi-wrap">
                  <table className="pi-table">
                    <thead>
                      <tr><th>Add</th><th>Double?</th><th>Type</th><th>Date</th><th>Company</th><th>Account</th><th>Description</th><th>Paid to / from</th><th>Ref / Cheque</th><th>Category</th><th>Amount</th><th>Notes</th><th>From file</th></tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.id} className={`${dups[l.id] ? 'pi-dup' : ''}${l.save ? '' : ' pi-off'}`}>
                          <td><input type="checkbox" checked={l.save} onChange={(e) => setL(l.id, 'save', e.target.checked)} aria-label={`Add ${l.description}`} /></td>
                          <td className="pi-why">{dups[l.id] ? <><b>⚠ Double</b><small>{dups[l.id]}</small></> : <span className="pi-new">New</span>}</td>
                          <td>
                            <select value={l.type} onChange={(e) => setL(l.id, 'type', e.target.value)}>
                              {LINE_TYPES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </select>
                          </td>
                          <td><span className="pi-date"><DateInput value={l.date || ''} onChange={(v) => setL(l.id, 'date', v)} /></span></td>
                          <td>
                            <select value={l.company} onChange={(e) => setL(l.id, 'company', e.target.value)} disabled={isTxn(l.type) && l.account && !String(l.account).startsWith('new:')}>
                              {companies.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}
                            </select>
                          </td>
                          <td>
                            {isTxn(l.type) ? (
                              <select value={l.account} onChange={(e) => setL(l.id, 'account', e.target.value)}>
                                <option value="">– choose –</option>
                                {D.accounts.map((a) => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
                                {newAccs.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                              </select>
                            ) : <span className="muted">–</span>}
                          </td>
                          <td><input type="text" className="pi-in pi-name" value={l.description} onChange={(e) => setL(l.id, 'description', e.target.value)} /></td>
                          <td><input type="text" className="pi-in" value={l.party} onChange={(e) => setL(l.id, 'party', e.target.value)} /></td>
                          <td><input type="text" className="pi-in" value={l.ref} onChange={(e) => setL(l.id, 'ref', e.target.value)} /></td>
                          <td>
                            <select value={l.category} onChange={(e) => setL(l.id, 'category', e.target.value)}>
                              <option value="">–</option>
                              {(isTxn(l.type) ? TXN_CATS : itemCats(l.type)).map((c) => <option key={c}>{c}</option>)}
                              {l.category && !(isTxn(l.type) ? TXN_CATS : itemCats(l.type)).includes(l.category) && <option>{l.category}</option>}
                            </select>
                          </td>
                          <td><input type="text" inputMode="decimal" className="pi-in num" value={l.amount} onChange={(e) => setL(l.id, 'amount', e.target.value.replace(/[^0-9.]/g, ''))} /></td>
                          <td><input type="text" className="pi-in" value={l.notes} onChange={(e) => setL(l.id, 'notes', e.target.value)} /></td>
                          <td className="pi-src">{l.file}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!reading && !lines.length && <p className="muted">No money lines found in these files.</p>}
            </div>

            <div className="di-foot">
              <span className="muted">
                {reading ? '⏳ Still reading...' : `${ticked.length} ticked`}
                {doubles ? <> · <b className="pi-red-t">{doubles} double{doubles === 1 ? '' : 's'} ticked</b></> : null}
              </span>
              {lines.length > 0 && (
                <>
                  <button type="button" className="btn ghost" onClick={() => setLines((l) => l.map((x) => ({ ...x, save: !dups[x.id] })))} disabled={busy}>Untick doubles</button>
                  <button type="button" className="btn ghost" onClick={() => setLines((l) => l.map((x) => ({ ...x, save: true })))} disabled={busy}>Tick all</button>
                </>
              )}
              <button type="button" className="btn in" onClick={save} disabled={busy || reading || !ticked.length}>{busy ? 'Adding...' : `Add ${ticked.length} line${ticked.length === 1 ? '' : 's'}`}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
