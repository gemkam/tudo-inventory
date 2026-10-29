// Group Summary PDF (A4 portrait). Charts are drawn with jsPDF shapes so it works in the browser and on the server.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { fmt } from '@/lib/groupSummary';

const GREEN = [10, 102, 84];
const DEEP = [5, 68, 54];
const MUTED = [93, 110, 103];
const INK = [28, 42, 37];
const LINE = [211, 225, 218];
const RED = [179, 38, 30];
const AMBER = [214, 140, 20];
const COLORS = [[42, 120, 214], [235, 104, 52], [27, 175, 122], [237, 161, 0], [232, 123, 164], [0, 131, 0], [98, 80, 214], [227, 73, 72]];

/*
  G: result of computeGroup, plus { periodLabel, monthLabel(fn), extraAlerts }
  logo: optional PNG data URL
*/
export function buildGroupPdf(G, { periodLabel, monthLabel, logo, extraAlerts = [], att = null }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Muscat' });
  const text = (t, x, y, { size = 9, bold = false, color = INK, align = 'left', maxWidth } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    doc.text(String(t), x, y, { align, maxWidth });
  };
  const heading = (t, y) => { text(t, M, y + 2, { size: 12, bold: true, color: GREEN }); return y + 7; };
  let y = 0;

  // Letterhead
  doc.setFillColor(...GREEN); doc.rect(0, 0, W, 3, 'F');
  let tx = M;
  if (logo) {
    try { doc.addImage(logo, 'PNG', M, 8, 30, 15); tx = M + 34; } catch { /* no logo */ }
  }
  text('TUDO NUM GROUP', tx, 12, { size: 8, bold: true, color: MUTED });
  text('Group Summary', tx, 20, { size: 19, bold: true, color: DEEP });
  text(`${periodLabel} · ${G.chosen.map((s) => s.label).join(', ')} · OMR`, tx, 26, { size: 8.5, color: MUTED, maxWidth: W - tx - M });
  text(`Printed ${stamp}`, W - M, 12, { size: 7.5, color: MUTED, align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 30, W - M, 30);
  y = 35;

  // Tiles
  const bt = G.budgetTotal;
  const tProfit = G.perSource.find((s) => s.kind === 'transport');
  const tiles = [
    ['Total spent', fmt(G.grand.spent), G.change == null ? periodLabel : `${G.change > 0 ? 'Up' : G.change < 0 ? 'Down' : 'Same'} ${Math.abs(G.change)}% vs before`, true],
    ['Unpaid', fmt(G.grand.unpaid), G.grand.unpaid ? 'Still to pay' : 'All paid'],
    ['VAT 5%', fmt(G.grand.vat), 'On bills'],
    ['Budget used', bt.budget ? `${Math.round((bt.actual / bt.budget) * 100)}%` : 'No budget', bt.budget ? `${fmt(bt.actual)} of ${fmt(bt.budget)}` : 'Set budgets in the app'],
    ['Cash in minus out', fmt(G.cash.totalNet), `In ${fmt(G.cash.totalIn)} · Out ${fmt(G.cash.totalOut)}`],
    tProfit ? ['Transport profit', fmt(tProfit.profit), `Work ${fmt(tProfit.work)}${tProfit.vatIn ? ` - VAT ${fmt(tProfit.vatIn)}` : ''}`] : ['Bills counted', String(G.sel.length), 'Lines']
  ];
  const tw = (W - M * 2 - 5 * 3) / 3, th = 18;
  tiles.forEach(([label, val, sub, hero], i) => {
    const x = M + (i % 3) * (tw + 3), yy = y + Math.floor(i / 3) * (th + 3);
    if (hero) { doc.setFillColor(...GREEN); doc.roundedRect(x, yy, tw, th, 2, 2, 'F'); }
    else { doc.setDrawColor(...LINE); doc.setFillColor(255, 255, 255); doc.roundedRect(x, yy, tw, th, 2, 2, 'FD'); }
    const c = hero ? [255, 255, 255] : INK;
    text(label, x + 3, yy + 5, { size: 7.5, bold: true, color: hero ? [225, 240, 235] : MUTED });
    const neg = String(val).startsWith('-');
    text(val, x + 3, yy + 11.5, { size: 13, bold: true, color: neg && !hero ? RED : c });
    text(sub, x + 3, yy + 16, { size: 6.8, color: hero ? [225, 240, 235] : MUTED, maxWidth: tw - 6 });
  });
  y += th * 2 + 3 + 7;

  // Alerts
  const alerts = [...G.alerts, ...extraAlerts].slice(0, 7);
  if (alerts.length) {
    y = heading('Alerts', y);
    for (const a of alerts) {
      const col = a.level === 'bad' ? RED : a.level === 'warn' ? AMBER : GREEN;
      doc.setFillColor(...col); doc.circle(M + 1.5, y + 1.6, 1.1, 'F');
      text(a.text.replace(/[^\x20-\x7E]/g, ''), M + 5, y + 2.6, { size: 8.5, maxWidth: W - M * 2 - 6 });
      y += 5;
    }
    y += 3;
  }

  // Horizontal bar chart helper
  const hbars = (title, rows, valueOf, y0, { budget } = {}) => {
    let yy = heading(title, y0);
    const max = Math.max(0, ...rows.map((r) => Math.max(valueOf(r), budget ? r.budget : 0)));
    const nameW = 58, valW = 34, barW = W - M * 2 - nameW - valW - 4;
    rows.forEach((r, i) => {
      text(r.label, M, yy + 3, { size: 8, maxWidth: nameW - 2 });
      doc.setFillColor(238, 244, 241); doc.rect(M + nameW, yy, barW, 4, 'F');
      const v = valueOf(r);
      const rmax = budget ? Math.max(v, r.budget) : max;
      const over = budget && v > r.budget;
      doc.setFillColor(...(budget ? (over ? RED : r.pct >= 85 ? AMBER : GREEN) : COLORS[i % COLORS.length]));
      if (rmax > 0 && v > 0) doc.rect(M + nameW, yy, Math.max(0.6, (Math.min(v, rmax) / rmax) * barW), 4, 'F');
      if (budget && rmax > 0) { doc.setDrawColor(...INK); doc.setLineWidth(0.5); const bx = M + nameW + (r.budget / rmax) * barW; doc.line(bx, yy - 1, bx, yy + 5); }
      text(budget ? `${fmt(v)} / ${fmt(r.budget)}` : fmt(v), W - M, yy + 3, { size: 7.5, align: 'right', bold: i === 0 && !budget });
      yy += 6;
    });
    return yy + 3;
  };
  const ensure = (need) => { if (y + need > H - 14) { doc.addPage(); y = 16; } };

  ensure(10 + G.perSource.length * 6);
  y = hbars('Where the money goes', [...G.perSource].sort((a, b) => b.spent - a.spent).map((s) => ({ label: s.label, v: s.spent })), (r) => r.v, y);
  const topHeads = G.heads.slice(0, 8);
  ensure(10 + topHeads.length * 6);
  y = hbars('What it was spent on', topHeads.map((h) => ({ label: h.head, v: h.total })), (r) => r.v, y);
  if (G.budgetHeads.length) {
    ensure(12 + G.budgetHeads.length * 6);
    y = hbars(`Budget vs actual (${G.nMonths} month${G.nMonths === 1 ? '' : 's'})`, G.budgetHeads.map((b) => ({ ...b, label: b.head })), (r) => r.actual, y, { budget: true });
  }

  // Cash flow bars
  if (G.cash.months.length) {
    ensure(62);
    y = heading('Cash flow: money in vs money spent', y);
    const ch = 40, cw = W - M * 2, base = y + ch;
    const max = Math.max(1, ...G.cash.in, ...G.cash.out);
    const slot = cw / G.cash.months.length, bw = Math.min(7, (slot - 3) / 2);
    doc.setDrawColor(...LINE); doc.line(M, base, W - M, base);
    G.cash.months.forEach((m, i) => {
      const x = M + i * slot + (slot - bw * 2 - 1) / 2;
      const hi = (G.cash.in[i] / max) * (ch - 6), ho = (G.cash.out[i] / max) * (ch - 6);
      doc.setFillColor(...COLORS[2]); if (hi > 0) doc.rect(x, base - hi, bw, hi, 'F');
      doc.setFillColor(...COLORS[1]); if (ho > 0) doc.rect(x + bw + 1, base - ho, bw, ho, 'F');
      text(new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), M + i * slot + slot / 2, base + 4, { size: 6.8, color: MUTED, align: 'center' });
    });
    doc.setFillColor(...COLORS[2]); doc.rect(M, base + 7, 3, 3, 'F'); text('Money in (transport received)', M + 4.5, base + 9.6, { size: 7.5, color: MUTED });
    doc.setFillColor(...COLORS[1]); doc.rect(M + 55, base + 7, 3, 3, 'F'); text('Money spent', M + 59.5, base + 9.6, { size: 7.5, color: MUTED });
    y = base + 16;
  }

  // Tables
  const base = {
    theme: 'grid', margin: { left: M, right: M, top: 16, bottom: 14 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.3, lineColor: LINE, lineWidth: 0.2, textColor: INK },
    alternateRowStyles: { fillColor: [246, 250, 248] }
  };
  const table = (title, head, body, foot, numFrom = 1) => {
    ensure(24);
    y = heading(title, y + 2);
    const cs = {}; for (let i = numFrom; i < head.length; i++) cs[i] = { halign: 'right' };
    autoTable(doc, { ...base, startY: y, head: [head], body, foot: foot ? [foot] : undefined, footStyles: { fillColor: [229, 239, 234], textColor: DEEP, fontStyle: 'bold' }, columnStyles: cs });
    y = doc.lastAutoTable.finalY + 6;
  };
  if (G.pl && G.pl.cols.length) {
    const P = G.pl;
    const many = P.cols.length > 1 && P.cols.length <= 6;
    const f = (v) => (v == null ? '' : Math.abs(v) < 0.0005 ? '-' : v < 0 ? `(${fmt(-v)})` : fmt(v));
    ensure(40);
    y = heading('Profit and Loss statement', y + 2);
    autoTable(doc, {
      ...base, startY: y,
      head: [['OMR', ...(many ? P.cols.map((m) => monthLabel(m)) : []), 'Total']],
      body: P.rows.map((r) => [r.kind === 'line' || r.kind === 'memo' ? `   ${r.label}` : r.label, ...(many ? r.vals.map((v) => (r.kind === 'head' ? '' : f(v))) : []), r.kind === 'head' ? '' : f(r.total)]),
      columnStyles: Object.fromEntries([...Array((many ? P.cols.length : 0) + 2).keys()].slice(1).map((i) => [i, { halign: 'right' }])),
      didParseCell: (c) => {
        if (c.section !== 'body') return;
        const r = P.rows[c.row.index];
        if (r.kind === 'head') { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [238, 244, 241]; }
        if (r.kind === 'total') c.cell.styles.fontStyle = 'bold';
        if (r.kind === 'result') { c.cell.styles.fontStyle = 'bold'; c.cell.styles.fillColor = [229, 239, 234]; }
      }
    });
    y = doc.lastAutoTable.finalY + 3;
    text('Gross profit does not subtract salary. VAT 5% kept aside. Tax 15% is an estimate.', M, y + 2, { size: 7, color: MUTED });
    y += 7;
  }
  table('By company', ['Company', 'Spent', 'Unpaid', 'VAT on bills', 'Work', 'VAT 5% on work', 'Profit'],
    G.perSource.map((s) => [s.label, fmt(s.spent), fmt(s.unpaid), fmt(s.vat), s.kind === 'transport' ? fmt(s.work) : '', s.kind === 'transport' && s.vatIn ? fmt(s.vatIn) : '', s.kind === 'transport' ? fmt(s.profit) : '']),
    ['Total', fmt(G.grand.spent), fmt(G.grand.unpaid), fmt(G.grand.vat), '', G.grand.vatIn ? fmt(G.grand.vatIn) : '', '']);
  table('By head of account', ['Head of account', ...G.chosen.map((s) => s.label), 'Total'],
    G.heads.map((h) => [h.head, ...h.vals.map((v) => (v ? fmt(v) : '')), fmt(h.total)]),
    ['Total', ...G.perSource.map((s) => fmt(s.spent)), fmt(G.grand.spent)]);
  if (G.budgetHeads.length) {
    table('Budget vs actual', ['Head', 'Budget', 'Actual', 'Left', 'Used'],
      G.budgetHeads.map((b) => [b.head, fmt(b.budget), fmt(b.actual), fmt(b.left), `${b.pct}%`]),
      ['Total', fmt(G.budgetTotal.budget), fmt(G.budgetTotal.actual), fmt(G.budgetTotal.budget - G.budgetTotal.actual), G.budgetTotal.budget ? `${Math.round((G.budgetTotal.actual / G.budgetTotal.budget) * 100)}%` : '']);
  }
  table('Unpaid bills by age', ['Age', 'Bills', 'Amount'], G.ageing.map((a) => [a.label, String(a.count), fmt(a.amount)]), ['Total', String(G.unpaidBills.length), fmt(G.unpaidAll)]);
  if (att && att.marked) {
    const rate = (r) => (r.rate == null ? '' : `${r.rate}%`);
    const tot = att.rows.reduce((t, r) => { ['staff', 'present', 'absent', 'leave', 'half', 'unmarked'].forEach((k) => { t[k] += r[k]; }); return t; }, { staff: 0, present: 0, absent: 0, leave: 0, half: 0, unmarked: 0 });
    table('Attendance (office staff Fri + Sat off, site staff Fri off)', ['Company', 'Staff', 'Present', 'Absent', 'Leave', 'Half day', 'Not marked', 'Attendance'],
      att.rows.map((r) => [r.label, String(r.staff), String(r.present), String(r.absent), String(r.leave), String(r.half), String(r.unmarked), rate(r)]),
      ['Total', String(tot.staff), String(tot.present), String(tot.absent), String(tot.leave), String(tot.half), String(tot.unmarked), '']);
    if (att.topAbsent.length) {
      table('Most absent', ['Staff', 'Company', 'Absent', 'Half day', 'Leave'], att.topAbsent.map((p) => [p.name, p.companyLabel, String(p.absent), String(p.half), String(p.leave)]), null, 2);
    }
  }
  if (G.byMonth.length > 1) {
    table('By month', ['Month', ...G.chosen.map((s) => s.label), 'Total'], G.byMonth.map((m) => [monthLabel(m.month), ...m.vals.map((v) => (v ? fmt(v) : '')), fmt(m.total)]));
  }
  if (G.yoy.hasPrev) {
    table(`Year on year: ${G.yoy.year} vs ${G.yoy.prevYear}`, ['Month', G.yoy.prevYear, G.yoy.year, 'Change'],
      G.yoy.labels.map((l, i) => [l, fmt(G.yoy.prev[i]), fmt(G.yoy.cur[i]), G.yoy.prev[i] ? `${Math.round(((G.yoy.cur[i] - G.yoy.prev[i]) / G.yoy.prev[i]) * 100)}%` : '']),
      ['Total', fmt(G.yoy.prevTotal), fmt(G.yoy.curTotal), G.yoy.prevTotal ? `${Math.round(((G.yoy.curTotal - G.yoy.prevTotal) / G.yoy.prevTotal) * 100)}%` : '']);
  }

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    text(`Tudo Num Office Systems · Group Summary · ${periodLabel}`, M, H - 6, { size: 7, color: MUTED });
    text(`Page ${i} of ${pages}`, W - M, H - 6, { size: 7, color: MUTED, align: 'right' });
  }
  return doc;
}
