/*
  VAT in every report (Kamran, 4 Nov 2026: "in every report show VAT report also, whatever is in the VAT").
  Pure functions, the SAME rules as the 🧾 VAT return page (/expenses/vat), so every report shows the same numbers:
  Output VAT = VAT inside sales: trips with "VAT 5% added" (Transport) + company invoices with VAT (company_docs kind invoice).
  Input VAT  = VAT typed on company bills (exp_entries.vat) + VAT 5% inside diesel on the trip sheets (Transport).
  Auto rows copied from Transport trips / salary / extras are left out (they are Transport costs, not company purchases).
  Used by: VAT return page, components/VatPanel.js (screen reports), components/RangeReport.js (Report by dates),
  lib/groupSummaryPdf.js (Reports & Summary PDF + monthly email).
*/
import { vatOf, dieselVat } from '@/lib/transport';

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const mk = (d) => String(d || '').slice(0, 7);
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const f3 = (v) => n(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const VAT_SKIP_KINDS = ['trip', 'salary', 'extra'];

export const VAT_COLS = [
  ['taxedNet', 'Sales with VAT (without VAT)'],
  ['outputVat', 'Output VAT 5%'],
  ['noVat', 'Sales with no VAT'],
  ['purchases', 'Purchases and bills'],
  ['inputVat', 'Input VAT'],
  ['net', 'Net VAT (pay + / claim −)']
];

/* companies: [{ key, short }] → sources for the VAT (3 companies + any added ones + Transport) */
export function vatSources(companies = []) {
  return [...companies.map((c) => ({ key: c.key, label: c.short || c.label || c.key })), { key: 'transport', label: 'Transport' }];
}

export const vatNetText = (v) => `${v >= 0 ? 'Pay' : 'Claim'} ${f3(Math.abs(v))}`;

/* raw rows → { sales, bills, months } */
export function buildVatData({ exp = [], te = [], docs = [], drivers = [], labelOf = (k) => k }) {
  const drv = Object.fromEntries((drivers || []).map((x) => [x.id, x.name]));
  const route = (r) => [r.from_place, r.to_place].filter(Boolean).join(' → ') || 'Trip';
  const sales = [
    ...(te || []).filter((r) => n(r.rent) > 0 && r.entry_date).map((r) => ({
      src: 'transport', driver: r.driver_id || null, date: r.entry_date, month: mk(r.entry_date), ref: drv[r.driver_id] || 'Trip',
      from: `Transport · trip sheet of ${drv[r.driver_id] || 'driver'}`, text: route(r), amount: r3(r.rent), vat: vatOf(r)
    })),
    ...(docs || []).filter((x) => (x.kind || 'invoice') === 'invoice').map((x) => {
      const sub = r3((Array.isArray(x.items) ? x.items : []).reduce((a, it) => a + n(it.amount), 0));
      const vat = r3((sub * n(x.vat_pct)) / 100);
      const co = x.company || 'modern-city';
      return { src: co, date: x.doc_date, month: mk(x.doc_date), ref: x.doc_no || 'Invoice', from: `Invoices · ${labelOf(co)}`, text: x.party || '', amount: r3(sub + vat), vat };
    }).filter((x) => x.amount && x.date)
  ];
  const bills = (exp || []).filter((b) => b.entry_date && !VAT_SKIP_KINDS.includes(b.source_kind)).map((b) => ({
    src: b.company, date: b.entry_date, month: mk(b.entry_date), ref: b.bill_no || '',
    from: b.source_kind === 'receipt' ? `Bills · ${labelOf(b.company)}` : b.source_kind === 'maint' ? `Transport · Vehicles maintenance (${labelOf(b.company)})` : `All Companies bills · ${labelOf(b.company)}`,
    text: b.description || '', amount: r3(n(b.paid) + n(b.unpaid)), vat: r3(b.vat), vatNo: b.vat_reg_no || ''
  }));
  // diesel on the trip sheets: 5% VAT is always inside the fuel price, so it is input VAT of Transport
  (te || []).filter((r) => n(r.diesel) > 0 && r.entry_date).forEach((r) => bills.push({
    src: 'transport', driver: r.driver_id || null, date: r.entry_date, month: mk(r.entry_date), ref: drv[r.driver_id] || 'Trip',
    from: `Transport · trip sheet diesel of ${drv[r.driver_id] || 'driver'}`, text: `Diesel · ${route(r)}`, amount: r3(r.diesel), vat: dieselVat(r), vatNo: ''
  }));
  const months = [...new Set([...sales, ...bills].map((x) => x.month).filter(Boolean))].sort();
  return { sales, bills, months };
}

/* from / to 'YYYY-MM-DD' ('' = no limit, both days included); sources = keys; driverId = only that driver's trips */
export function computeVat(data, { from = '', to = '', sources = [], allSources = [], driverId = null } = {}) {
  const src = allSources.filter((s) => sources.includes(s.key));
  const inP = (x) => {
    const d = String(x.date || '').slice(0, 10);
    if (!d || (from && d < from) || (to && d > to) || !sources.includes(x.src)) return false;
    if (driverId && x.src === 'transport' && x.driver !== driverId) return false;
    return true;
  };
  const S = (data?.sales || []).filter(inP);
  const B = (data?.bills || []).filter(inP);
  const sum = (arr, f) => r3(arr.reduce((a, x) => a + f(x), 0));
  const rowFor = (key, mon) => {
    const s = S.filter((x) => x.src === key && (!mon || x.month === mon));
    const b = B.filter((x) => x.src === key && (!mon || x.month === mon));
    const taxed = s.filter((x) => x.vat > 0);
    const r = {
      taxedNet: sum(taxed, (x) => x.amount - x.vat), outputVat: sum(taxed, (x) => x.vat), noVat: sum(s.filter((x) => !(x.vat > 0)), (x) => x.amount),
      purchases: sum(b, (x) => x.amount), inputVat: sum(b, (x) => x.vat)
    };
    r.net = r3(r.outputVat - r.inputVat);
    return r;
  };
  const rows = src.map((s) => ({ s, r: rowFor(s.key) }));
  const T = VAT_COLS.reduce((t, [k]) => ({ ...t, [k]: r3(rows.reduce((a, x) => a + x.r[k], 0)) }), {});
  const months = [...new Set([...S, ...B].map((x) => x.month))].sort();
  const byMonth = months.flatMap((m) => src.map((s) => ({ m, s, r: rowFor(s.key, m) })));
  const labelOf = (k) => allSources.find((s) => s.key === k)?.label || k;
  const lines = [
    ...S.filter((x) => x.vat > 0).map((x) => ({ ...x, type: 'Output (sale)', srcLabel: labelOf(x.src) })),
    ...B.filter((x) => x.vat > 0).map((x) => ({ ...x, type: 'Input (bill)', srcLabel: labelOf(x.src) }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { rows, T, byMonth, months, lines, sources: src, from, to };
}

/* The VAT part for "Report by dates" (components/RangeReport.js format) */
export function vatRangeParts(v) {
  if (!v) return { summary: [], sections: [] };
  const T = v.T;
  return {
    summary: [['🧾 Output VAT (sales)', T.outputVat], ['🧾 Input VAT (bills)', T.inputVat], [T.net >= 0 ? '🧾 VAT to pay' : '🧾 VAT to claim back', Math.abs(T.net)]],
    sections: [
      {
        heading: '🧾 VAT report by company',
        head: ['Company', ...VAT_COLS.map((c) => c[1])],
        rows: v.rows.map(({ s, r }) => [s.label, ...VAT_COLS.map(([k]) => (k === 'net' ? vatNetText(r[k]) : r[k]))]),
        totals: ['Total', ...VAT_COLS.map(([k]) => (k === 'net' ? vatNetText(T[k]) : T[k]))],
        num: [1, 2, 3, 4, 5, 6]
      },
      {
        heading: `🧾 Sales and bills with VAT (${v.lines.length})`,
        note: v.lines.length ? '' : 'No sales or bills with VAT in these dates. Trips count only when "VAT 5% added" is on.',
        head: ['Date', 'Company', 'Type', 'From', 'Ref / Bill no.', 'Details', 'Amount', 'VAT'],
        rows: v.lines.map((x) => [dmy(x.date), x.srcLabel, x.type, x.from || '', x.ref, x.text, x.amount, x.vat]),
        totals: v.lines.length ? ['Total', '', '', '', '', `${v.lines.length} lines`, r3(v.lines.reduce((a, x) => a + x.amount, 0)), r3(v.lines.reduce((a, x) => a + x.vat, 0))] : null,
        num: [6, 7]
      }
    ]
  };
}

/* VAT tables for PDFs (exportReportPdf / exportPdf: { heading, head, rows, totalsRow, numCols }) — text already formatted */
export function vatPdfTables(v) {
  if (!v) return [];
  return [
    {
      heading: 'VAT report by company',
      head: ['Company', ...VAT_COLS.map((c) => c[1])],
      rows: v.rows.map(({ s, r }) => [s.label, ...VAT_COLS.map(([k]) => (k === 'net' ? vatNetText(r[k]) : f3(r[k])))]),
      totalsRow: ['Total', ...VAT_COLS.map(([k]) => (k === 'net' ? vatNetText(v.T[k]) : f3(v.T[k])))],
      numCols: [1, 2, 3, 4, 5, 6]
    },
    {
      heading: `Sales and bills with VAT (${v.lines.length})`,
      head: ['Date', 'Company', 'Type', 'From', 'Ref / Bill no.', 'Details', 'Amount', 'VAT'],
      rows: v.lines.map((x) => [dmy(x.date), x.srcLabel, x.type, x.from || '', x.ref, x.text, f3(x.amount), f3(x.vat)]),
      numCols: [6, 7]
    }
  ];
}

/* VAT sheets for exportExcel (numbers stay numbers) */
export function vatExcelSheets(v, subtitle = '') {
  if (!v) return [];
  return [
    {
      name: 'VAT report', title: 'VAT report by company', subtitle,
      head: ['Company', ...VAT_COLS.map((c) => c[1])],
      rows: v.rows.map(({ s, r }) => [s.label, ...VAT_COLS.map(([k]) => r[k])]),
      totalsRow: ['Total', ...VAT_COLS.map(([k]) => v.T[k])], numCols: [1, 2, 3, 4, 5, 6], widths: [18, 18, 14, 16, 16, 12, 18]
    },
    {
      name: 'VAT lines', title: 'Sales and bills with VAT', subtitle,
      head: ['Date', 'Company', 'Type', 'From (where the VAT comes from)', 'Ref / Bill no.', 'Details', 'Amount', 'VAT'],
      rows: v.lines.map((x) => [dmy(x.date), x.srcLabel, x.type, x.from || '', x.ref, x.text, x.amount, x.vat]), numCols: [6, 7], widths: [12, 14, 14, 28, 16, 34, 12, 10]
    }
  ];
}

/* Reports & Summary period ('YYYY-MM', 'YYYY', 'all') → from / to */
export function periodDates(period) {
  if (!period || period === 'all') return { from: '', to: '' };
  if (period.length === 4) return { from: `${period}-01-01`, to: `${period}-12-31` };
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/* report page range bounds [start, end) Date objects → from / to */
export function boundsDates([start, end]) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (start.getFullYear() <= 2000) return { from: '', to: '' };
  return { from: iso(start), to: iso(new Date(+end - 86400000)) };
}
