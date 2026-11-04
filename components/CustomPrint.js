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
    // Printed from the page itself (not a hidden frame) so every browser keeps A4 LANDSCAPE (Kamran 4 Nov 2026)
    const css = `
      #cp-print { display: none; }
      @media print {
        @page { size: 297mm 210mm; margin: 10mm; }
        @page cp-land { size: A4 landscape; margin: 10mm; }
        html, body { width: auto !important; height: auto !important; background: #fff !important; }
        body.cp-printing > *:not(#cp-print) { display: none !important; }
        body.cp-printing #cp-print { display: block !important; page: cp-land; }
        #cp-print { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
        #cp-print h1 { font-size: 17px; margin: 0 0 2px; } #cp-print p { margin: 0 0 10px; color: #555; }
        #cp-print table { width: 100%; border-collapse: collapse; }
        #cp-print th, #cp-print td { border: 1px solid #bbb; padding: 5px 6px; text-align: left; vertical-align: top; }
        #cp-print th { background: #e8f3ef !important; font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #cp-print td.n, #cp-print th.n { text-align: right; white-space: nowrap; }
        #cp-print tr.alt td { background: #f7f9f8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #cp-print tr.tot td { font-weight: 700; background: #eef !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #cp-print thead { display: table-header-group; }
        #cp-print tr { page-break-inside: avoid; }
      }`;
    document.getElementById('cp-print')?.remove();
    document.getElementById('cp-print-css')?.remove();
    const st = document.createElement('style'); st.id = 'cp-print-css'; st.textContent = css;
    document.head.appendChild(st); // last in <head>, so its landscape page wins over the app's own print size
    const box = document.createElement('div'); box.id = 'cp-print';
    box.innerHTML = `<h1>${esc(title)}</h1><p>${esc(subtitle || '')} · ${useRows.length} row${useRows.length === 1 ? '' : 's'} · printed ${new Date().toLocaleDateString('en-GB')}</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
    document.body.appendChild(box);
    document.body.classList.add('cp-printing');
    const done = () => { document.body.classList.remove('cp-printing'); box.remove(); st.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
  return true;
}
