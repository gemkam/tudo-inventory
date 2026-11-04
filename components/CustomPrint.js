'use client';

/*
  🖨 Custom print (Kamran 4 Nov 2026): no box, no choices. Prints straight away exactly the rows
  showing on screen (search and ▾ filters) with all columns, on A4 landscape, with totals.
  columns: [{ key, label, num }]  rows: [{ id, cells: { key: text }, nums: { key: number } }]
*/
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function printTable({ title, subtitle, columns, rows }) {
  const useCols = columns;
  const useRows = rows;
  if (!useCols.length || !useRows.length) return false;
  const totals = Object.fromEntries(useCols.filter((c) => c.num).map((c) => [c.key, useRows.reduce((t, r) => t + Number(r.nums?.[c.key] || 0), 0)]));
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
  return true;
}
