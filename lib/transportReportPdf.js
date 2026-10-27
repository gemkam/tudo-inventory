// Builds the full Transport Expense PDF on the server (used by the monthly email).
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { salaryPayable, salaryTotal, SALARY_FIELDS } from '@/lib/transport';

const GREEN = [10, 102, 84];
const DEEP = [5, 68, 54];
const LIGHT = [234, 243, 239];
const MUTED = [93, 110, 103];
const COMPANY = 'MODERN CITY FOR EXPRESS SERVICES LLC (Transport Division)';

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(v * 1000) / 1000;
const m = (v) => r3(n(v)).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const mkey = (d) => String(d).slice(0, 7);
const mlabel = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dlabel = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

function isEmptyRow(e) {
  return !e.from_place && !e.to_place && !e.description && !n(e.rent) && !n(e.diesel) && !n(e.toll) && !n(e.maintenance);
}

export function summarize(data) {
  const entries = (data.entries || []).filter((e) => !isEmptyRow(e));
  const months = [...new Set([
    ...entries.map((e) => mkey(e.entry_date)),
    ...(data.salaries || []).map((s) => mkey(s.month)),
    ...(data.extras || []).map((x) => mkey(x.month))
  ])].sort();
  const active = (data.drivers || []).filter((d) => entries.some((e) => e.driver_id === d.id) || (data.salaries || []).some((s) => s.driver_id === d.id));

  function one(month, d) {
    const es = entries.filter((e) => e.driver_id === d.id && mkey(e.entry_date) === month);
    const sum = (k) => r3(es.reduce((t, e) => t + n(e[k]), 0));
    const sal = (data.salaries || []).filter((s) => s.driver_id === d.id && mkey(s.month) === month);
    const ex = (data.extras || []).filter((x) => x.driver_id === d.id && mkey(x.month) === month);
    const r = {
      trips: es.filter((e) => n(e.rent) > 0).length,
      work: sum('rent'), received: sum('received'), diesel: sum('diesel'), toll: sum('toll'), maintenance: sum('maintenance'),
      salary: r3(sal.reduce((t, s) => t + salaryPayable(s), 0)),
      other: r3(ex.reduce((t, x) => t + n(x.amount), 0))
    };
    r.receivable = r3(r.work - r.received);
    r.expenses = r3(r.diesel + r.toll + r.maintenance + r.salary + r.other);
    r.profit = r3(r.work - r.expenses);
    return r;
  }
  const byMonth = months.map((mo) => ({ month: mo, drivers: active.map((d) => ({ driver: d, ...one(mo, d) })) }));
  const KEYS = ['trips', 'work', 'received', 'receivable', 'diesel', 'toll', 'maintenance', 'salary', 'other', 'expenses', 'profit'];
  const monthTotals = byMonth.map((b) => {
    const t = { month: b.month };
    for (const k of KEYS) t[k] = r3(b.drivers.reduce((s, x) => s + x[k], 0));
    return t;
  });
  const grand = {};
  for (const k of KEYS) grand[k] = r3(monthTotals.reduce((s, x) => s + x[k], 0));
  return { entries, months, active, byMonth, monthTotals, grand };
}

export function buildTransportPdf(data) {
  const S = summarize(data);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const today = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Muscat' });

  const base = {
    theme: 'grid',
    margin: { left: 12, right: 12, top: 16, bottom: 14 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 1.1, lineColor: [211, 225, 218], lineWidth: 0.2, textColor: [28, 42, 37] },
    alternateRowStyles: { fillColor: [246, 250, 248] }
  };
  const heading = (text, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...GREEN); doc.text(text, 12, y); };
  const after = () => doc.lastAutoTable.finalY;

  // Title + overview
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...DEEP);
  doc.text('Transport Expense: Full Report', 12, 22);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  const range = S.months.length ? `${mlabel(S.months[0])} to ${mlabel(S.months[S.months.length - 1])}` : 'No data yet';
  doc.text(`Modern City for Express Services LLC (Transport Division) · ${range} · Amounts in OMR`, 12, 28);
  heading('Overview by month', 38);
  autoTable(doc, {
    ...base, startY: 41,
    head: [['Month', 'Trips', 'Work amount', 'Received', 'Receivable', 'Diesel', 'Toll + visa', 'Maintenance', 'Salary', 'Other', 'Total expenses', 'Profit']],
    body: [
      ...S.monthTotals.map((t) => [mlabel(t.month), t.trips, m(t.work), m(t.received), m(t.receivable), m(t.diesel), m(t.toll), m(t.maintenance), m(t.salary), m(t.other), m(t.expenses), m(t.profit)]),
      ['Total', S.grand.trips, m(S.grand.work), m(S.grand.received), m(S.grand.receivable), m(S.grand.diesel), m(S.grand.toll), m(S.grand.maintenance), m(S.grand.salary), m(S.grand.other), m(S.grand.expenses), m(S.grand.profit)]
    ],
    columnStyles: Object.fromEntries([...Array(11)].map((_, i) => [i + 1, { halign: 'right' }])),
    didParseCell: (c) => { if (c.section === 'body' && c.row.index === S.monthTotals.length) { c.cell.styles.fillColor = LIGHT; c.cell.styles.fontStyle = 'bold'; } }
  });

  // Monthly sections
  const LABELS = [['trips', 'Total trips'], ['work', 'Total work amount'], ['received', 'Total received amount'], ['receivable', 'Receivable amount'],
    ['diesel', 'Diesel expense'], ['toll', 'Toll + visa exit fee'], ['maintenance', 'Maintenance charges'], ['salary', 'Total salary'],
    ['other', 'Other (trailer rent etc.)'], ['expenses', 'Total expenses'], ['profit', 'Profit']];
  const lastRowDark = (count) => (c) => { if (c.section === 'body' && c.row.index === count - 1) { c.cell.styles.fillColor = DEEP; c.cell.styles.textColor = 255; c.cell.styles.fontStyle = 'bold'; } };
  const right3 = { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } };

  for (const b of S.byMonth) {
    doc.addPage();
    heading(`Monthly summary · ${mlabel(b.month)}`, 22);
    const body = LABELS.map(([k, label]) => {
      const vals = b.drivers.map((x) => x[k]);
      const f = k === 'trips' ? (v) => String(v) : m;
      return [label, ...vals.map(f), f(r3(vals.reduce((s, v) => s + v, 0)))];
    });
    autoTable(doc, {
      ...base, startY: 25, head: [['', ...b.drivers.map((x) => `${x.driver.name}${x.driver.vehicle_no ? `\n${x.driver.vehicle_no}` : ''}`), 'Total']],
      body, columnStyles: right3, didParseCell: lastRowDark(body.length)
    });

    let y = after() + 9;
    heading(`Salary · ${mlabel(b.month)}`, y);
    const sal = b.drivers.map((x) => (data.salaries || []).find((s) => s.driver_id === x.driver.id && mkey(s.month) === b.month) || null);
    const salRows = [
      ...SALARY_FIELDS.map(([k, label]) => [label, ...sal.map((s) => n(s?.[k]))]),
      ['Total', ...sal.map((s) => salaryTotal(s))],
      ['Advance deduction', ...sal.map((s) => n(s?.advance_deduction))],
      ['Special allowance', ...sal.map((s) => n(s?.special_allowance))],
      ['Payable', ...sal.map((s) => salaryPayable(s))]
    ].map(([label, ...vals]) => [label, ...vals.map(m), m(vals.reduce((t, v) => t + v, 0))]);
    autoTable(doc, { ...base, startY: y + 3, head: [['', ...b.drivers.map((x) => x.driver.name), 'Total']], body: salRows, columnStyles: right3, didParseCell: lastRowDark(salRows.length) });

    y = after() + 9;
    const ex = (data.extras || []).filter((x) => mkey(x.month) === b.month && n(x.amount));
    if (y > H - 30) { doc.addPage(); y = 22; }
    heading(`Other expenses · ${mlabel(b.month)}`, y);
    if (ex.length) {
      const name = (id) => (data.drivers || []).find((d) => d.id === id)?.name || '';
      autoTable(doc, {
        ...base, startY: y + 3, head: [['Driver', 'Description', 'Amount']],
        body: [...ex.map((x) => [name(x.driver_id), x.description || '', m(x.amount)]), ['Total', '', m(ex.reduce((t, x) => t + n(x.amount), 0))]],
        columnStyles: { 2: { halign: 'right' } },
        didParseCell: (c) => { if (c.section === 'body' && c.row.index === ex.length) { c.cell.styles.fillColor = LIGHT; c.cell.styles.fontStyle = 'bold'; } }
      });
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
      doc.text('No other expenses this month.', 12, y + 6);
    }
  }

  // Trip sheets
  for (const d of S.active) {
    const rows = S.entries.filter((e) => e.driver_id === d.id);
    if (!rows.length) continue;
    doc.addPage();
    heading(`Trip sheet · ${d.name}${d.vehicle_no ? ` (${d.vehicle_no})` : ''}`, 22);
    const T = { rent: 0, received: 0, driver_allowance: 0, diesel: 0, toll: 0, maintenance: 0 };
    let trips = 0;
    const body = rows.map((e) => {
      for (const k of Object.keys(T)) T[k] += n(e[k]);
      if (n(e.rent) > 0) trips += 1;
      const to = e.to_place ? `${e.to_place}${e.description ? ` / ${e.description}` : ''}` : (e.description || '');
      return [dlabel(e.entry_date), e.from_place || '', to, m(e.rent), m(e.received), e.received_date ? dlabel(e.received_date) : '', m(n(e.rent) - n(e.received)), e.payment_status || '',
        m(e.driver_allowance), e.allowance_status || '', m(e.diesel), m(e.toll), m(e.maintenance), e.remarks || '', e.credit_in || '', e.entered_by || ''];
    });
    body.push(['Total', `${trips} trips`, '', m(T.rent), m(T.received), '', m(T.rent - T.received), '', m(T.driver_allowance), '', m(T.diesel), m(T.toll), m(T.maintenance), '', '', '']);
    autoTable(doc, {
      ...base, startY: 25, styles: { ...base.styles, fontSize: 7, cellPadding: 1.3 },
      head: [['Date', 'From', 'To / Description', 'Rent', 'Received', 'Recv. on', 'Balance', 'Payment', 'Drv. allow.', 'Allowance', 'Diesel', 'Toll/other', 'Maint.', 'Status', 'Credit in', 'Entered by']],
      body,
      columnStyles: { 2: { cellWidth: 40 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 6: { halign: 'right' }, 8: { halign: 'right' }, 10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' } },
      didParseCell: (c) => { if (c.section === 'body' && c.row.index === body.length - 1) { c.cell.styles.fillColor = LIGHT; c.cell.styles.fontStyle = 'bold'; } }
    });
  }

  // Header, footer and watermark on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.05 }));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...GREEN);
    for (let x = 0; x < W + 60; x += 120) for (let y = 10; y < H + 60; y += 60) doc.text('Tudo Num Office Systems', x, y, { angle: 28 });
    doc.restoreGraphicsState();
    doc.setFillColor(...GREEN); doc.rect(0, 0, W, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255);
    doc.text(COMPANY, 12, 5.4);
    doc.text('Transport Expense Report', W - 12, 5.4, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(`Generated ${today} from Tudo Num Office Systems`, 12, H - 6);
    doc.text(`Page ${p} of ${pages}`, W - 12, H - 6, { align: 'right' });
  }

  return { pdf: Buffer.from(doc.output('arraybuffer')), summary: S };
}

export { m as fmt3, mlabel };
