'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Modal from '@/components/Modal';

/*
  🖨 Print with column choice, on every page (shown by AuthGate).
  Reads the tables on the page, lets the user tick columns per table (and leave a table out),
  then builds a clean print copy (.pc-sheet) with only those columns and prints it.
  Choice is remembered per page on this device (localStorage "tudo-print:<path>").
  Not on the Home page. Pages with their own paper print (invoices, receipts, salary slip, data entry) do not show it.
*/

const SKIP_PATHS = [/^\/$/, /^\/login/, /^\/entry/, /^\/f\//, /^\/transport\/invoice/, /^\/expenses\/docs/, /^\/transport\/salary\//];
const KEY = (p) => `tudo-print:${p}`;

function visible(el) {
  return el.offsetParent !== null && el.getClientRects().length > 0;
}

function tableTitle(t, i) {
  const sec = t.closest('section, .panel, .rp-card, .card');
  const h = sec?.querySelector('h2, h3');
  const txt = (h?.textContent || '').replace(/\s+/g, ' ').trim();
  return txt || `Table ${i + 1}`;
}

/* header labels by logical column (colspan aware), using the header row with most columns */
function headerOf(t) {
  const rows = [...(t.tHead?.rows || [])];
  if (!rows.length && t.rows[0]) rows.push(t.rows[0]);
  let best = null, bestN = 0;
  for (const r of rows) {
    const n = [...r.cells].reduce((s, c) => s + (c.colSpan || 1), 0);
    if (n >= bestN) { best = r; bestN = n; }
  }
  const labels = [];
  if (!best) return labels;
  for (const c of best.cells) {
    let txt = (c.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt && c.classList.contains('corner')) txt = '# (row no.)';
    else if (!txt && labels.length === 0) txt = '(row names)';
    for (let k = 0; k < (c.colSpan || 1); k++) labels.push(txt);
  }
  return labels;
}

function scan() {
  const tables = [...document.querySelectorAll('main.page table')]
    .filter((t) => visible(t) && !t.closest('.iv-paper, .modal, .trip-print, .pc-sheet') && t.rows.length > 1);
  return tables.map((t, i) => {
    const labels = headerOf(t);
    return { el: t, title: tableTitle(t, i), labels, id: `${i}:${tableTitle(t, i)}` };
  }).filter((x) => x.labels.length);
}

/* copy of a table with only the chosen logical columns, no buttons or inputs */
function cleanCopy(t, keep) {
  const copy = document.createElement('table');
  copy.className = 'pc-table';
  for (const sect of [t.tHead, ...t.tBodies, t.tFoot].filter(Boolean)) {
    const out = document.createElement(sect.tagName.toLowerCase());
    for (const row of sect.rows) {
      if (row.querySelector('.add-row') || row.classList.contains('pc-skip')) continue;
      const tr = document.createElement('tr');
      tr.className = row.className;
      let col = 0;
      let any = false;
      for (const cell of row.cells) {
        const span = cell.colSpan || 1;
        const kept = [];
        for (let k = 0; k < span; k++) if (keep.has(col + k)) kept.push(col + k);
        col += span;
        if (!kept.length) continue;
        const c = document.createElement(cell.tagName.toLowerCase());
        if (kept.length > 1) c.colSpan = kept.length;
        c.className = [...cell.classList].filter((x) => /^a-|^tag|exp-|^num|total/.test(x)).join(' ');
        // values of inputs / selects, then plain text with tags kept for colour
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('input, textarea').forEach((inp) => { const s = document.createElement('span'); s.textContent = inp.type === 'checkbox' ? (inp.checked ? '✓' : '') : inp.value; inp.replaceWith(s); });
        clone.querySelectorAll('select').forEach((sel) => { const s = document.createElement('span'); s.textContent = sel.options[sel.selectedIndex]?.text || ''; sel.replaceWith(s); });
        clone.querySelectorAll('button, .date-pick, .date-native, svg.spark').forEach((b) => b.remove());
        c.innerHTML = clone.innerHTML;
        if ((c.textContent || '').trim()) any = true;
        tr.appendChild(c);
      }
      if (tr.cells.length && (any || sect === t.tHead)) out.appendChild(tr);
    }
    copy.appendChild(out);
  }
  return copy;
}

export default function PrintColumns() {
  const path = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState([]);
  const [choice, setChoice] = useState({}); // { [title]: { off: [labels], skip: bool } }
  const [kpis, setKpis] = useState(true);
  const [land, setLand] = useState(false);

  const hidden = SKIP_PATHS.some((re) => re.test(path));

  const openPicker = useCallback(() => {
    const found = scan();
    setTables(found);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY(path)) || '{}'); } catch { saved = {}; }
    setChoice(saved.tables || {});
    setKpis(saved.kpis !== false);
    setLand(Boolean(saved.land));
    setOpen(true);
  }, [path]);

  useEffect(() => { setOpen(false); }, [path]);

  function persist(next, k = kpis, l = land) {
    setChoice(next);
    try { localStorage.setItem(KEY(path), JSON.stringify({ tables: next, kpis: k, land: l })); } catch { /* ignore */ }
  }
  const tState = (t) => choice[t.title] || { off: [], skip: false };
  function toggleCol(t, label) {
    const s = tState(t);
    const off = s.off.includes(label) ? s.off.filter((x) => x !== label) : [...s.off, label];
    persist({ ...choice, [t.title]: { ...s, off } });
  }
  function setAll(t, on) {
    const s = tState(t);
    persist({ ...choice, [t.title]: { ...s, off: on ? [] : t.labels.filter((l, i) => i > 0 && l) } });
  }
  function toggleSkip(t) {
    const s = tState(t);
    persist({ ...choice, [t.title]: { ...s, skip: !s.skip } });
  }

  function doPrint() {
    const sheet = document.createElement('div');
    sheet.className = 'pc-sheet';
    const h1 = document.querySelector('main.page h1');
    const head = document.createElement('div');
    head.className = 'pc-head';
    const now = new Date();
    head.innerHTML = `<b>Tudo Num Office Systems</b><span>${(h1?.textContent || document.title || '').replace(/</g, '&lt;')}</span><small>Printed ${now.toLocaleDateString('en-GB')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>`;
    sheet.appendChild(head);
    if (kpis) {
      document.querySelectorAll('main.page .kpi-row').forEach((k) => { if (visible(k)) sheet.appendChild(k.cloneNode(true)); });
    }
    let n = 0;
    for (const t of tables) {
      const s = tState(t);
      if (s.skip) continue;
      // columns with a title that is not switched off; columns with no title (buttons) are left out
      const keep = new Set(t.labels.map((l, i) => i).filter((i) => t.labels[i] && !s.off.includes(t.labels[i])));
      if (!keep.size) continue;
      const h = document.createElement('h3');
      h.textContent = t.title;
      sheet.appendChild(h);
      sheet.appendChild(cleanCopy(t.el, keep));
      n += 1;
    }
    if (!n) { alert('Nothing chosen to print.'); return; }
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 10mm; }`;
    document.head.appendChild(style);
    document.body.appendChild(sheet);
    document.body.classList.add('pc-printing');
    setOpen(false);
    const done = () => {
      document.body.classList.remove('pc-printing');
      sheet.remove();
      style.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.contains(sheet)) done(); }, 1500); }, 120);
  }

  if (hidden) return null;

  return (
    <>
      <button type="button" className="pc-float" onClick={openPicker} title="Print this page with the columns you choose">🖨 Print</button>
      {open && (
        <Modal title="Print: choose columns" onClose={() => setOpen(false)}>
          {!tables.length && <p className="muted" style={{ margin: 0 }}>There is no table on this page. Use the browser print (Ctrl + P) for this page.</p>}
          <div className="pc-list">
            {tables.map((t) => {
              const s = tState(t);
              return (
                <div key={t.id} className={`pc-tbl ${s.skip ? 'off' : ''}`}>
                  <div className="pc-tbl-head">
                    <label className="pc-include">
                      <input type="checkbox" checked={!s.skip} onChange={() => toggleSkip(t)} />
                      <b>{t.title}</b>
                    </label>
                    {!s.skip && (
                      <span className="pc-quick">
                        <button type="button" className="al-link" onClick={() => setAll(t, true)}>All</button>
                        <button type="button" className="al-link" onClick={() => setAll(t, false)}>None</button>
                      </span>
                    )}
                  </div>
                  {!s.skip && (
                    <div className="tp-cols">
                      {t.labels.map((l, i) => (l && t.labels.indexOf(l) === i ? (
                        <label key={`${l}-${i}`} className={!s.off.includes(l) ? 'on' : ''}>
                          <input type="checkbox" checked={!s.off.includes(l)} onChange={() => toggleCol(t, l)} />
                          {l}
                        </label>
                      ) : null))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {tables.length > 0 && (
            <div className="pc-opts">
              <label><input type="checkbox" checked={kpis} onChange={(e) => { setKpis(e.target.checked); persist(choice, e.target.checked, land); }} /> Summary boxes at the top</label>
              <label><input type="checkbox" checked={land} onChange={(e) => { setLand(e.target.checked); persist(choice, kpis, e.target.checked); }} /> Landscape (wide tables)</label>
            </div>
          )}
          <p className="note" style={{ margin: '10px 0 0' }}>Your choice is remembered for this page on this device. To save a PDF, choose "Save as PDF" in the print window.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn in" onClick={doPrint} disabled={!tables.length}>🖨 Print</button>
          </div>
        </Modal>
      )}
    </>
  );
}
