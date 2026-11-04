'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '@/lib/supabase';
import DateInput from '@/components/DateInput';
import { FIELDS, TAB_FIELDS, DATE_FIELDS, NUM_FIELDS, mapTable, cleanPerson, makeIndex, findDup, personOf, toRow } from '@/lib/peopleImport';

/*
  📥 Import docs in Personnel (4 Nov 2026). Office / Site Employees, Drivers and Subcontractors tabs, ✏️ Edit rights.
  1. Pick any files: Excel (.xlsx .xls .ods), CSV / text, Word (.docx), PDF, photos (JPG, PNG, WEBP...). Several at once.
  2. Reading:
     - Excel / CSV / Word tables: the header row is read here (Name, Passport, Mobile, Basic ...), no AI needed.
       A sheet without clear headers goes to the AI as text.
     - Word text, PDF text: AI (app/api/people-import).
     - Photos and scanned PDFs (no text inside): each page as a photo to the AI (passport, resident card, staff list).
  3. Every person found shows in one list to check and change. DOUBLES are RED with the reason: same passport,
     resident card No., mobile or name as someone already saved (Archives included) or earlier in this list.
  4. "Add" saves every ticked person, doubles too (they stay red in the table so they can be checked).
     ↶ Undo in the ✏️ Edit menu takes the whole import back.
*/

const ACCEPT = '.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.docx,.doc,.pdf,image/*';
const MAX_SIDE = 1800;
const ext = (f) => (String(f.name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const kindOf = (f) => {
  const e = ext(f);
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(e)) return 'sheet';
  if (['csv', 'tsv', 'txt'].includes(e) || /text\/(csv|plain)/.test(f.type || '')) return 'csvtext';
  if (e === 'docx') return 'docx';
  if (e === 'doc') return 'doc';
  if (e === 'pdf' || /pdf/.test(f.type || '')) return 'pdf';
  if (/^image\//.test(f.type || '') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'].includes(e)) return 'image';
  return 'other';
};
const ICON = { sheet: '📗', csvtext: '📄', docx: '📘', doc: '📘', pdf: '📕', image: '🖼', other: '📎' };

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
  g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}
async function imageToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('This photo type cannot be opened here. Save it as JPG or PNG.'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return toJpeg(c);
  } finally { URL.revokeObjectURL(url); }
}

async function askAI(body, tab) {
  const { data: s } = await sb().auth.getSession();
  const res = await fetch('/api/people-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` },
    body: JSON.stringify({ ...body, tab })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not read (${res.status})`);
  return data.people || [];
}

/* sheet rows -> people; null when no header row was found */
function fromRows(rows) { const l = mapTable(rows); return l && l.length ? l : null; }

/* one file -> { people: [...], how } */
async function readFile(file, tab) {
  const k = kindOf(file);
  if (k === 'doc') throw new Error('Old Word file (.doc). Open it in Word and save it as .docx or PDF, then import again.');
  if (k === 'other') throw new Error('This file type cannot be read. Use Excel, CSV, Word (.docx), PDF or a photo.');

  if (k === 'sheet' || k === 'csvtext') {
    const XLSX = await import('xlsx');
    const wb = k === 'sheet'
      ? XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      : XLSX.read(await file.text(), { type: 'string', cellDates: true, raw: false });
    const people = [];
    const loose = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
      const got = fromRows(rows);
      if (got) people.push(...got);
      else if (rows.length) loose.push(`Sheet ${name}:\n${XLSX.utils.sheet_to_csv(ws)}`);
    }
    if (people.length) return { people, how: 'columns' };
    if (loose.length) return { people: await askAI({ text: loose.join('\n\n') }, tab), how: 'AI' };
    return { people: [], how: 'columns' };
  }

  if (k === 'docx') {
    const mod = await import('mammoth');
    const mammoth = mod.default || mod;
    const buf = await file.arrayBuffer();
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const people = [];
    doc.querySelectorAll('table').forEach((t) => {
      const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((td) => td.textContent.trim()));
      const got = fromRows(rows);
      if (got) people.push(...got);
    });
    if (people.length) return { people, how: 'columns' };
    const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
    return { people: await askAI({ text }, tab), how: 'AI' };
  }

  if (k === 'pdf') {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(10, pdf.numPages); p += 1) {
      const c = await (await pdf.getPage(p)).getTextContent();
      text += `${c.items.map((i) => i.str).join(' ')}\n`;
    }
    if (text.replace(/\s+/g, '').length > 60) return { people: await askAI({ text }, tab), how: 'AI' };
    // scanned PDF: each page as a photo (up to 4 pages)
    const people = [];
    for (let p = 1; p <= Math.min(4, pdf.numPages); p += 1) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 2 });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      people.push(...(await askAI({ image: toJpeg(cv) }, tab)));
    }
    return { people, how: 'AI photo' };
  }

  return { people: await askAI({ image: await imageToJpeg(file) }, tab), how: 'AI photo' };
}

/* company text from the file -> company key */
function matchCompany(text, companies) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const hit = companies.find((c) => {
    const a = String(c.short || '').toLowerCase();
    const b = String(c.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const first = a.split(' ')[0];
    return s === a || s.includes(a) || (b && (b.includes(s) || s.includes(b))) || (first.length > 3 && s.includes(first));
  });
  return hit ? hit.key : '';
}

const TAB_NAME = { office: 'Office Employees', site: 'Site Employees', drivers: 'Drivers', sub: 'Subcontractors' };
const TABLE = { office: 'exp_staff', site: 'exp_staff', drivers: 'transport_drivers', sub: 'personnel_subcontractors' };

export default function PeopleImport({ tab, co, companies, saved, onSaved, flash, className = 'btn', disabled }) {
  const input = useRef(null);
  const [files, setFiles] = useState(null); // [{ id, name, kind, status, error, how, count }]
  const [people, setPeople] = useState([]); // [{ id, file, save, ...fields, companyKey }]
  const [busy, setBusy] = useState(false);
  const fields = TAB_FIELDS[tab] || TAB_FIELDS.office;
  const table = TABLE[tab];
  const defaultCo = co || (tab === 'drivers' ? 'modern-city' : tab === 'sub' ? '' : 'sumptuosity');

  // saved people of this table (live + Archives) for the doubles check
  const savedIndex = useMemo(() => makeIndex((saved || []).map(({ row, table: t, where }) => ({ person: personOf(row, t), who: row.name, where }))), [saved]);

  // doubles: against saved people, then against earlier ticked rows of this import
  const dups = useMemo(() => {
    const out = {};
    const earlier = [];
    for (const p of people) {
      const inList = findDup(p, makeIndex(earlier));
      out[p.id] = [findDup(p, savedIndex), inList].filter(Boolean).join(' · ');
      if (p.save) earlier.push({ person: p, who: p.name, where: 'also in these files' });
    }
    return out;
  }, [people, savedIndex]);

  function pick() { if (input.current) { input.current.value = ''; input.current.click(); } }

  async function onPick(e) {
    const list = [...(e.target.files || [])];
    if (!list.length) return;
    const fl = list.map((f, i) => ({ id: `${Date.now()}-${i}`, file: f, name: f.name, kind: kindOf(f), status: 'reading', error: '', how: '', count: 0 }));
    setFiles(fl);
    setPeople([]);
    // two files at a time
    let next = 0;
    const work = async () => {
      while (next < fl.length) {
        const f = fl[next]; next += 1;
        try {
          const { people: got, how } = await readFile(f.file, tab);
          const rows = got.map((raw, j) => {
            const p = cleanPerson(raw);
            return { ...p, id: `${f.id}-${j}`, file: f.name, save: true, companyKey: matchCompany(p.company, companies) || defaultCo };
          });
          setPeople((l) => [...l, ...rows]);
          setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, status: 'done', how, count: rows.length } : x)));
        } catch (err) {
          setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, status: 'error', error: err.message } : x)));
        }
      }
    };
    await Promise.all([work(), work()]);
  }

  const setP = (id, k, v) => setPeople((l) => l.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  const ticked = people.filter((p) => p.save && String(p.name || '').trim());
  const doubles = ticked.filter((p) => dups[p.id]).length;
  const reading = (files || []).some((f) => f.status === 'reading');

  async function save() {
    if (!ticked.length) return;
    setBusy(true);
    const start = (saved || []).filter((x) => x.table === table).length + 1;
    const rows = ticked.map((p, i) => toRow({ ...p, name: String(p.name).trim() }, tab, p.companyKey || defaultCo || null, start + i));
    const { data, error } = await sb().from(table).insert(rows).select();
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    onSaved(data || [], table, doubles);
    setFiles(null); setPeople([]);
  }

  function close() { if (!busy) { setFiles(null); setPeople([]); } }

  return (
    <>
      <button type="button" className={className} onClick={pick} disabled={disabled} title={disabled ? 'Locked: ✏️ Edit › Enable editing' : `Add ${TAB_NAME[tab]} from Excel, CSV, Word, PDF or photos`}>📥 Import docs</button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
      {files && createPortal(
        <div className="modal-back di-back" role="dialog" aria-modal="true" aria-label="Import docs">
          <div className="di-box pi-box">
            <div className="di-head">
              <div>
                <b>📥 Import docs · {TAB_NAME[tab]}</b>
                <span>Check every person before adding. <span className="pi-red-t">Red</span> = double (already saved or twice in these files). Doubles are added too if they stay ticked.</span>
              </div>
              <button type="button" className="btn ghost small" onClick={close} disabled={busy}>✕ Close</button>
            </div>

            <div className="di-body">
              <div className="pi-files">
                {files.map((f) => (
                  <div key={f.id} className={`pi-file s-${f.status}`}>
                    <span aria-hidden="true">{ICON[f.kind]}</span>
                    <b>{f.name}</b>
                    <small>{f.status === 'reading' ? '⏳ Reading...' : f.status === 'error' ? `⚠ ${f.error}` : `✓ ${f.count} ${f.count === 1 ? 'person' : 'people'} found${f.how ? ` (${f.how})` : ''}`}</small>
                  </div>
                ))}
              </div>

              {people.length > 0 && (
                <div className="grid-wrap pi-wrap">
                  <table className="pi-table">
                    <thead>
                      <tr>
                        <th>Add</th>
                        <th>Double?</th>
                        {fields.map((f) => <th key={f}>{f === 'basic' && tab === 'sub' ? 'Basic' : (FIELDS.find((x) => x[0] === f) || [f, f])[1]}</th>)}
                        <th>From file</th>
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((p) => (
                        <tr key={p.id} className={`${dups[p.id] ? 'pi-dup' : ''}${p.save ? '' : ' pi-off'}`}>
                          <td><input type="checkbox" checked={p.save} onChange={(e) => setP(p.id, 'save', e.target.checked)} aria-label={`Add ${p.name}`} /></td>
                          <td className="pi-why">{dups[p.id] ? <><b>⚠ Double</b><small>{dups[p.id]}</small></> : <span className="pi-new">New</span>}</td>
                          {fields.map((f) => (
                            <td key={f}>
                              {f === 'company' ? (
                                <select value={p.companyKey || ''} onChange={(e) => setP(p.id, 'companyKey', e.target.value)} title={p.company ? `In the file: ${p.company}` : ''}>
                                  {tab === 'sub' && <option value="">– none –</option>}
                                  {companies.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}
                                </select>
                              ) : f === 'transport_allow' ? (
                                <select value={p[f] || ''} onChange={(e) => setP(p.id, f, e.target.value)}>
                                  <option value="">–</option><option>Yes</option><option>No</option>
                                </select>
                              ) : DATE_FIELDS.includes(f) ? (
                                <span className="pi-date"><DateInput value={p[f] || ''} onChange={(v) => setP(p.id, f, v)} /></span>
                              ) : (
                                <input
                                  type="text"
                                  inputMode={NUM_FIELDS.includes(f) ? 'decimal' : undefined}
                                  className={`pi-in${f === 'name' ? ' pi-name' : ''}${NUM_FIELDS.includes(f) ? ' num' : ''}`}
                                  value={p[f] || ''}
                                  onChange={(e) => setP(p.id, f, e.target.value)}
                                />
                              )}
                            </td>
                          ))}
                          <td className="pi-src">{p.file}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!reading && !people.length && <p className="muted">No people found in these files.</p>}
            </div>

            <div className="di-foot">
              <span className="muted">
                {reading ? '⏳ Still reading...' : `${ticked.length} ticked`}
                {doubles ? <> · <b className="pi-red-t">{doubles} double{doubles === 1 ? '' : 's'}</b></> : null}
              </span>
              {people.length > 0 && (
                <>
                  <button type="button" className="btn ghost" onClick={() => setPeople((l) => l.map((p) => ({ ...p, save: !dups[p.id] })))} disabled={busy}>Untick doubles</button>
                  <button type="button" className="btn ghost" onClick={() => setPeople((l) => l.map((p) => ({ ...p, save: true })))} disabled={busy}>Tick all</button>
                </>
              )}
              <button type="button" className="btn in" onClick={save} disabled={busy || reading || !ticked.length}>{busy ? 'Adding...' : `Add ${ticked.length} to ${TAB_NAME[tab]}`}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
