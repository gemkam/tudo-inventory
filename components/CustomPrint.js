'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';

/*
  🖨 Custom print (Kamran 4 Nov 2026): tick the rows and the columns you want, then Print.
  columns: [{ key, label, num }]  rows: [{ id, cells: { key: text }, nums: { key: number } }]
  Numeric columns get a total line. Always A4 landscape. Rows = only those showing on screen (search and ▾ filters).
*/
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STORE = 'tudo-custom-print-cols';

export default function CustomPrint({ title, subtitle, columns, rows, preselect = [], storeKey = 'bills', onClose }) {
  const [mounted, setMounted] = useState(false);
  const [cols, setCols] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(STORE) || '{}')[storeKey]; if (Array.isArray(s) && s.length) return s.filter((k) => columns.some((c) => c.key === k)); } catch { /* ignore */ }
    return columns.map((c) => c.key);
  });
  const [ids, setIds] = useState(() => (preselect.length ? preselect : rows.map((r) => r.id)));
  useEffect(() => setMounted(true), []);
  useEffect(() => { try { const all = JSON.parse(localStorage.getItem(STORE) || '{}'); all[storeKey] = cols; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ } }, [cols, storeKey]);

  const useCols = columns.filter((c) => cols.includes(c.key));
  const useRows = rows.filter((r) => ids.includes(r.id));
  const totals = useMemo(() => Object.fromEntries(useCols.filter((c) => c.num).map((c) => [c.key, useRows.reduce((t, r) => t + Number(r.nums?.[c.key] || 0), 0)])), [useCols, useRows]);
  const flip = (arr, set, k) => set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  function doPrint() {
    if (!useCols.length || !useRows.length) return;
    const head = useCols.map((c) => `<th class="${c.num ? 'n' : ''}">${esc(c.label)}</th>`).join('');
    const body = useRows.map((r, i) => `<tr class="${i % 2 ? 'alt' : ''}">${useCols.map((c) => `<td class="${c.num ? 'n' : ''}">${esc(r.cells[c.key])}</td>`).join('')}</tr>`).join('');
    const hasTot = useCols.some((c) => c.num);
    const foot = hasTot ? `<tr class="tot">${useCols.map((c, i) => `<td class="${c.num ? 'n' : ''}">${c.num ? totals[c.key].toFixed(3) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr>` : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
      h1 { font-size: 17px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #555; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 5px 6px; text-align: left; vertical-align: top; }
      th { background: #e8f3ef; font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; }
      td.n, th.n { text-align: right; white-space: nowrap; }
      tr.alt td { background: #f7f9f8; } tr.tot td { font-weight: 700; background: #eef; }
      thead { display: table-header-group; }
    </style></head><body><h1>${esc(title)}</h1><p>${esc(subtitle || '')} · ${useRows.length} row${useRows.length === 1 ? '' : 's'} · printed ${new Date().toLocaleDateString('en-GB')}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table></body></html>`;
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.srcdoc = html;
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { /* ignore */ } setTimeout(() => fr.remove(), 60000); };
  }

  if (!mounted) return null;
  return createPortal(
    <Modal title="🖨 Custom print" onClose={onClose}>
      <div className="cp-box">
        <div className="cp-cap">Columns ({useCols.length} of {columns.length})
          <span className="cp-links"><button type="button" className="linkish" onClick={() => setCols(columns.map((c) => c.key))}>All</button> · <button type="button" className="linkish" onClick={() => setCols([])}>None</button></span>
        </div>
        <div className="cp-cols">
          {columns.map((c) => (
            <label key={c.key} className="cp-chk"><input type="checkbox" checked={cols.includes(c.key)} onChange={() => flip(cols, setCols, c.key)} /> {c.label}</label>
          ))}
        </div>
        <div className="cp-cap">Rows ({useRows.length} of {rows.length})
          <span className="cp-links"><button type="button" className="linkish" onClick={() => setIds(rows.map((r) => r.id))}>All</button> · <button type="button" className="linkish" onClick={() => setIds([])}>None</button></span>
        </div>
        <div className="cp-rows">
          {rows.map((r) => (
            <label key={r.id} className="cp-chk"><input type="checkbox" checked={ids.includes(r.id)} onChange={() => flip(ids, setIds, r.id)} /> {r.label}</label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Only the rows showing on screen (your search and ▾ filters) are listed. Prints on A4 landscape.</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={!useCols.length || !useRows.length} onClick={doPrint}>🖨 Print / PDF</button>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
