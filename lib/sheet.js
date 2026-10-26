/* Shared helpers for sheet-style pages */

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/* Excel-like maths: "12", "=4*3", "+5" (add to current), "-2" (subtract from current) */
export function evaluate(raw, current) {
  let s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  let relative = false;
  if (s.startsWith('=')) s = s.slice(1);
  else if (/^[+-]/.test(s) && current !== undefined) relative = true;
  if (!/^[0-9+\-*/().]+$/.test(s)) return NaN;
  let value;
  try {
    // eslint-disable-next-line no-new-func
    value = Function(`"use strict"; return (${s});`)();
  } catch {
    return NaN;
  }
  if (!Number.isFinite(value)) return NaN;
  return num(relative ? Number(current) + value : value);
}

/* OMR amount: whole numbers stay plain (90), fractions show 3 decimals (105.800) */
export function fmtAmt(v) {
  const n = num(v);
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/* Omani money for prices: below 1 OMR in Baisa (Bz), otherwise Rials */
export function fmtMoney(v) {
  const n = num(v);
  if (n <= 0) return '';
  if (n < 1) return `${Math.round(n * 1000)} Bz`;
  return `${n.toFixed(3)} ${n === 1 ? 'Rial' : 'Rials'}`;
}

export function monthKey(d) {
  return String(d || '').slice(0, 7);
}

export function monthStart(key) {
  return `${key}-01`;
}

export function monthLabel(key) {
  if (!key || key === 'all') return 'All months';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function fmtDay(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function fmtFullDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function exportStamp() {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/*
  Excel export. sheets: [{ name, title, subtitle, head: [..], rows: [[..]], numCols: [index..], totalsRow: [..] }]
*/
export async function exportExcel(fileName, sheets) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tudo Office Inventory';
  sheets.forEach((sh) => {
    const ws = wb.addWorksheet(sh.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
    const cols = sh.head.length;
    const last = String.fromCharCode(64 + Math.min(cols, 26));
    ws.columns = sh.head.map((h, i) => ({ width: sh.widths?.[i] || Math.max(10, String(h).length + 4) }));
    ws.mergeCells(`A1:${last}1`);
    ws.getCell('A1').value = sh.title;
    ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF4A2E1C' } };
    ws.mergeCells(`A2:${last}2`);
    ws.getCell('A2').value = sh.subtitle || '';
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF7A5F4A' } };
    const head = ws.getRow(4);
    head.values = sh.head;
    head.height = 22;
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFF7EFE1' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A2E1C' } };
      c.alignment = { vertical: 'middle', horizontal: (sh.numCols || []).includes(c.col - 1) ? 'right' : 'left', wrapText: true };
    });
    sh.rows.forEach((r, i) => {
      const row = ws.addRow(r);
      row.eachCell({ includeEmpty: true }, (c) => {
        c.border = { bottom: { style: 'thin', color: { argb: 'FFE6D7BF' } } };
        if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3E6' } };
        if ((sh.numCols || []).includes(c.col - 1) && typeof c.value === 'number') c.numFmt = '#,##0.###';
      });
      if (sh.boldRows?.includes(i)) row.font = { bold: true };
    });
    if (sh.totalsRow) {
      const t = ws.addRow(sh.totalsRow);
      t.font = { bold: true };
      t.eachCell((c) => {
        c.border = { top: { style: 'medium', color: { argb: 'FF4A2E1C' } } };
        if (typeof c.value === 'number') c.numFmt = '#,##0.###';
      });
    }
  });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}

/*
  PDF export. sections: [{ heading, head: [..], rows: [[..]], numCols: [..], totalsRow, boldRows }]
*/
export async function exportPdf(fileName, { title, subtitle, sections, landscape = true }) {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(74, 46, 28);
  doc.text(title, 40, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(122, 95, 74);
  doc.text(subtitle || '', 40, 67);
  let y = 84;
  sections.forEach((sec) => {
    if (sec.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(74, 46, 28);
      doc.text(sec.heading, 40, y + 4);
      y += 12;
    }
    const numCols = sec.numCols || [];
    const body = sec.totalsRow ? [...sec.rows, sec.totalsRow] : sec.rows;
    autoTable(doc, {
      startY: y,
      head: [sec.head],
      body: body.map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v)))),
      theme: 'plain',
      styles: { fontSize: sec.fontSize || 8.5, cellPadding: 4, textColor: [46, 29, 18], lineColor: [230, 215, 191], lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: [74, 46, 28], textColor: [247, 239, 225], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [251, 243, 230] },
      didParseCell: (h) => {
        if (numCols.includes(h.column.index)) h.cell.styles.halign = 'right';
        if (h.section === 'body' && sec.totalsRow && h.row.index === body.length - 1) {
          h.cell.styles.fontStyle = 'bold';
          h.cell.styles.fillColor = [243, 231, 211];
        }
        if (h.section === 'body' && sec.boldRows?.includes(h.row.index)) h.cell.styles.fontStyle = 'bold';
      },
      didDrawPage: () => {
        const pages = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(160, 134, 112);
        doc.text(`Page ${pages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
      }
    });
    y = doc.lastAutoTable.finalY + 26;
  });
  doc.save(fileName);
}
