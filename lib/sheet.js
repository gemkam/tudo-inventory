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

/*
  Report PDF, same idea as The Snooker Cafe reports:
  page 1+ = picture of the tiles and charts, then white pages with the detail tables.
*/
export async function exportReportPdf(fileName, { title, note, area, tables = [] }) {
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');

  // capture the charts at a fixed desktop width so the PDF looks the same from phone or PC
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;background:#f3f7f5;padding:8px;';
  const clone = area.cloneNode(true);
  holder.appendChild(clone);
  document.body.appendChild(holder);
  await new Promise((r) => requestAnimationFrame(() => r()));
  const canvas = await html2canvas(holder, { backgroundColor: '#f3f7f5', scale: 2, logging: false });
  holder.remove();

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const M = 28;
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(10, 102, 84);
  pdf.rect(0, 0, pw, 8, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(10, 102, 84);
  pdf.text(title, M, M + 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9.5);
  pdf.setTextColor(93, 110, 103);
  pdf.text(note, M, M + 34, { maxWidth: pw - M * 2 });
  pdf.text(`Created ${exportStamp()}`, M, M + 48);

  // add the chart picture, splitting it over pages when it is taller than one page
  const imgW = pw - M * 2;
  const pxPerPt = canvas.width / imgW;
  let y = M + 60;
  let srcY = 0;
  while (srcY < canvas.height) {
    const roomPt = ph - y - M;
    const slicePx = Math.min(canvas.height - srcY, Math.floor(roomPt * pxPerPt));
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = slicePx;
    part.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
    pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, y, imgW, slicePx / pxPerPt);
    srcY += slicePx;
    if (srcY < canvas.height) { pdf.addPage(); y = M; }
  }

  // detail tables on white pages, easy to print
  tables.forEach((t, i) => {
    pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(10, 102, 84);
    pdf.text(t.heading, M, M + 10);
    const numCols = t.numCols || [];
    const body = t.totalsRow ? [...t.rows, t.totalsRow] : t.rows;
    autoTable(pdf, {
      startY: M + 22,
      margin: { left: M, right: M },
      head: [t.head],
      body: body.length ? body.map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v)))) : [[{ content: 'Nothing in this period.', colSpan: t.head.length }]],
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 4, textColor: [28, 42, 37], lineColor: [221, 232, 227], lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: [10, 102, 84], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 248, 246] },
      didParseCell: (h) => {
        if (numCols.includes(h.column.index)) h.cell.styles.halign = 'right';
        if (h.section === 'body' && t.totalsRow && h.row.index === body.length - 1) {
          h.cell.styles.fontStyle = 'bold';
          h.cell.styles.fillColor = [227, 240, 234];
        }
      }
    });
    if (i === tables.length - 1) {
      const pages = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFontSize(8);
        pdf.setTextColor(122, 143, 136);
        pdf.text(`Page ${p} of ${pages}`, pw - M, ph - 14, { align: 'right' });
      }
    }
  });
  pdf.save(fileName);
}
