'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb, isLow, fmtDateTime } from '@/lib/supabase';

/*
  Sheet columns.
  edit: can be typed in (Edit mode only). editOnly: column only shows in Edit mode.
  Stock is stored in pieces (quantity). Packets = pieces / per_pack.
*/
const ALL_COLS = [
  { key: 'name', label: 'Item', edit: true, sort: true, align: 'left' },
  { key: 'unit', label: 'Unit', edit: true, sort: true, align: 'left' },
  { key: 'per_pack', label: 'In 1 packet', edit: true, sort: true, align: 'right' },
  { key: 'packets', label: 'Packets', edit: true, sort: true, align: 'right' },
  { key: 'quantity', label: 'Pieces', edit: true, sort: true, align: 'right' },
  { key: 'add', label: 'Add +', edit: true, editOnly: true, align: 'right' },
  { key: 'remove', label: 'Remove −', edit: true, editOnly: true, align: 'right' },
  { key: 'price', label: 'Price', edit: true, sort: true, align: 'right' },
  { key: 'value', label: 'Value', sort: true, align: 'right' },
  { key: 'min_qty', label: 'Minimum', edit: true, sort: true, align: 'right' },
  { key: 'in_m', label: 'In this month', sort: true, align: 'right' },
  { key: 'out_m', label: 'Out this month', sort: true, align: 'right' }
];

const EMPTY_STATS = { in: 0, out: 0 };
const PRICE_STEP = 0.1; // 100 Bz

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/* Excel-like maths: "12", "=4*3", "+5" (add to current), "-2" (subtract from current) */
function evaluate(raw, current) {
  let s = String(raw).trim().replace(/\s+/g, '');
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

/* Omani money: below 1 OMR shows Baisa (Bz), 1 OMR and above shows Rials */
function fmtMoney(v) {
  const n = num(v);
  if (n <= 0) return '';
  if (n < 1) return `${Math.round(n * 1000)} Bz`;
  return `${n.toFixed(3)} ${n === 1 ? 'Rial' : 'Rials'}`;
}

/* Units shown in the Unit dropdown */
const UNITS = [
  ['packets', 'Packets'], ['pcs', 'Pieces'], ['roll', 'Rolls'], ['box', 'Box'], ['carton', 'Carton'],
  ['ream', 'Ream'], ['bottle', 'Bottle'], ['set', 'Set'], ['kg', 'Kg'], ['litre', 'Litre']
];
const UNIT_LABEL = Object.fromEntries(UNITS);
function unitLabel(u) {
  return UNIT_LABEL[u] || u || '';
}
function unitOptions(current) {
  return current && !UNIT_LABEL[current] ? [[current, current], ...UNITS] : UNITS;
}

function perPack(it) {
  const p = Number(it.per_pack);
  return p > 0 ? p : 1;
}
function packs(it) {
  const p = perPack(it);
  const q = num(it.quantity);
  if (p <= 1) return null;
  const full = Math.floor(q / p);
  return { full, loose: num(q - full * p) };
}
function valueOf(it) {
  return num(Number(it.quantity) * Number(it.price || 0));
}

function SheetPage() {
  const { id } = useParams();
  const { isAdmin } = useUser();

  const [cat, setCat] = useState(null);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [moves, setMoves] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState({ key: null, dir: 1 });
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editMode, setEditMode] = useState(false);
  const [pendingNew, setPendingNew] = useState(false);
  const [editing, setEditingState] = useState(null); // { r, c, value, typed }
  const editingRef = useRef(null);
  const setEditing = (v) => { editingRef.current = v; setEditingState(v); };
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const gridRef = useRef(null);
  const toastTimer = useRef(null);

  const canChange = isAdmin && editMode;
  const cols = useMemo(() => ALL_COLS.filter((c) => canChange || !c.editOnly), [canChange]);

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const loadStats = useCallback(async () => {
    const s = sb();
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const [m, recent] = await Promise.all([
      s.from('stock_moves').select('item_id, move_type, qty, items!inner(category_id)')
        .eq('items.category_id', id).gte('created_at', start.toISOString()),
      s.from('stock_moves').select('id, move_type, qty, note, created_at, items!inner(name, unit, category_id)')
        .eq('items.category_id', id).order('created_at', { ascending: false }).limit(25)
    ]);
    const agg = {};
    (m.data || []).forEach((r) => {
      const a = agg[r.item_id] || (agg[r.item_id] = { in: 0, out: 0 });
      a[r.move_type] = num(a[r.move_type] + Number(r.qty));
    });
    setStats(agg);
    setMoves(recent.data || []);
  }, [id]);

  const load = useCallback(async () => {
    const s = sb();
    const [c, i] = await Promise.all([
      s.from('categories').select('id, name').eq('id', id).single(),
      s.from('items').select('*').eq('category_id', id).order('sort').order('name')
    ]);
    if (c.error) { setError('This category was not found.'); return; }
    if (i.error) setError(i.error.message);
    setCat(c.data);
    setItems(i.data || []);
    loadStats();
  }, [id, loadStats]);

  useEffect(() => { load(); }, [load]);

  /* Rows shown in the sheet: filtered, sorted, plus a "new item" row in Edit mode */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((it) => !q || it.name.toLowerCase().includes(q) || unitLabel(it.unit).toLowerCase().includes(q));
    if (sortBy.key) {
      const val = (it) => {
        switch (sortBy.key) {
          case 'in_m': return (stats[it.id] || EMPTY_STATS).in;
          case 'out_m': return (stats[it.id] || EMPTY_STATS).out;
          case 'packets': return packs(it)?.full ?? -1;
          case 'value': return valueOf(it);
          case 'unit': return unitLabel(it.unit).toLowerCase();
          case 'quantity': case 'min_qty': case 'price': case 'per_pack': return Number(it[sortBy.key]);
          default: return String(it[sortBy.key] || '').toLowerCase();
        }
      };
      list = [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sortBy.dir);
    }
    const out = list.map((item) => ({ item }));
    if (canChange && !q) out.push({ isNew: true });
    return out;
  }, [items, search, sortBy, stats, canChange]);

  // Keep selection inside the sheet
  useEffect(() => {
    setSel((s) => ({ r: Math.min(s.r, Math.max(rows.length - 1, 0)), c: Math.min(s.c, cols.length - 1) }));
  }, [rows.length, cols.length]);

  // Scroll selected cell into view
  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  function canEdit(r, c) {
    const row = rows[r];
    const col = cols[c];
    if (!canChange || !row || !col?.edit) return false;
    if (row.isNew) return col.key === 'name';
    if (col.key === 'packets') return perPack(row.item) > 1;
    return true;
  }

  function rawValue(r, c) {
    const row = rows[r];
    const col = cols[c];
    if (!row || !col || row.isNew) return '';
    const it = row.item;
    switch (col.key) {
      case 'name': return it.name;
      case 'quantity': return String(num(it.quantity));
      case 'min_qty': return String(num(it.min_qty));
      case 'per_pack': return String(perPack(it));
      case 'packets': return String(packs(it)?.full ?? '');
      case 'price': return Number(it.price) > 0 ? num(it.price).toFixed(3) : '';
      default: return '';
    }
  }

  function startEdit(r, c, value) {
    if (!canEdit(r, c)) return;
    const isUnit = cols[c]?.key === 'unit';
    const start = isUnit ? (rows[r]?.item?.unit || 'pcs') : (value ?? rawValue(r, c));
    setSel({ r, c });
    setEditing({ r, c, value: start, typed: !isUnit && value !== undefined });
  }

  function focusGrid() {
    requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  }

  async function commitEdit(move) {
    const ed = editingRef.current;
    if (!ed) return;
    const { r, c, value } = ed;
    setEditing(null);
    if (move === 'down') setSel({ r: Math.min(r + 1, rows.length - 1), c });
    if (move === 'right') setSel({ r, c: Math.min(c + 1, cols.length - 1) });
    focusGrid();
    await saveCell(rows[r], cols[c].key, value);
  }

  function cancelEdit() {
    setEditing(null);
    focusGrid();
  }

  function toggleEditMode() {
    if (editMode) commitEdit();
    setEditMode((v) => !v);
  }

  function newItem() {
    setSearch('');
    setEditMode(true);
    setPendingNew(true);
  }

  // After "+ New item" turns on Edit mode, jump into the new row
  useEffect(() => {
    if (!pendingNew || !canChange) return;
    const r = rows.findIndex((x) => x.isNew);
    if (r !== -1) {
      setPendingNew(false);
      setSel({ r, c: 0 });
      setEditing({ r, c: 0, value: '', typed: true });
    }
  }, [pendingNew, canChange, rows]);

  /* ---------- Saving ---------- */

  function patchItem(itemId, patch) {
    setItems((list) => list.map((x) => (x.id === itemId ? { ...x, ...patch } : x)));
  }

  async function moveStock(item, type, qty) {
    if (!(qty > 0)) { flash('Enter a number more than 0', 'err'); return; }
    if (type === 'out' && qty > Number(item.quantity)) { flash(`Only ${num(item.quantity)} ${unitLabel(item.unit)} in stock`, 'err'); return; }
    const before = item.quantity;
    patchItem(item.id, { quantity: num(Number(before) + (type === 'in' ? qty : -qty)) });
    const { data, error } = await sb().rpc('record_move', { p_item: item.id, p_type: type, p_qty: qty, p_note: null });
    if (error) { patchItem(item.id, { quantity: before }); flash(error.message, 'err'); return; }
    patchItem(item.id, { quantity: num(data) });
    flash(`${item.name}: ${type === 'in' ? '+' : '−'}${qty} → ${num(data)} ${unitLabel(item.unit)}`);
    loadStats();
  }

  async function setQuantity(item, qty) {
    if (qty === null) return;
    if (Number.isNaN(qty) || qty < 0) { flash('Stock cannot be less than 0', 'err'); return; }
    if (qty === num(item.quantity)) return;
    const before = item.quantity;
    patchItem(item.id, { quantity: qty });
    const { error } = await sb().rpc('set_quantity', { p_item: item.id, p_qty: qty, p_note: null });
    if (error) { patchItem(item.id, { quantity: before }); flash(error.message, 'err'); return; }
    flash(`${item.name}: ${num(before)} → ${qty} ${unitLabel(item.unit)}`);
    loadStats();
  }

  async function updateField(item, patch, label) {
    const before = { ...item };
    patchItem(item.id, patch);
    const { error } = await sb().from('items').update(patch).eq('id', item.id);
    if (error) {
      patchItem(item.id, before);
      flash(error.code === '42501' ? 'Only Administrator can edit' : error.message, 'err');
      return;
    }
    flash(label);
  }

  async function setPrice(item, v) {
    if (v === null) v = 0;
    if (Number.isNaN(v) || v < 0) { flash('Price must be 0 or more', 'err'); return; }
    if (v === num(item.price)) return;
    await updateField(item, { price: v }, v > 0 ? `${item.name}: ${fmtMoney(v)}` : `${item.name}: price cleared`);
  }

  async function addItem(name) {
    const clean = name.trim();
    if (!clean) return;
    const sort = items.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const { data, error } = await sb().from('items')
      .insert({ category_id: id, name: clean, unit: 'pcs', quantity: 0, min_qty: 0, per_pack: 1, price: 0, sort })
      .select().single();
    if (error) { flash(error.message, 'err'); return; }
    setItems((list) => [...list, data]);
    flash(`${clean} added`);
  }

  async function saveCell(row, key, raw) {
    if (!row) return;
    const value = String(raw ?? '').trim();
    if (row.isNew) { if (key === 'name') await addItem(value); return; }
    const it = row.item;
    switch (key) {
      case 'name':
        if (value && value !== it.name) await updateField(it, { name: value }, 'Name saved');
        break;
      case 'unit':
        if ((value || 'pcs') !== it.unit) await updateField(it, { unit: value || 'pcs' }, 'Unit saved');
        break;
      case 'per_pack': {
        const v = evaluate(value);
        if (v === null) break;
        if (Number.isNaN(v) || v < 1) { flash('Pieces in 1 packet must be 1 or more', 'err'); break; }
        if (v !== perPack(it)) await updateField(it, { per_pack: v }, v > 1 ? `1 packet = ${v} ${unitLabel(it.unit)}` : 'Sold as single pieces');
        break;
      }
      case 'packets': {
        const p = packs(it);
        if (!p) break;
        const v = evaluate(value, p.full);
        if (v === null) break;
        if (Number.isNaN(v) || v < 0) { flash('Packets cannot be less than 0', 'err'); break; }
        await setQuantity(it, num(Math.floor(v) * perPack(it) + p.loose));
        break;
      }
      case 'min_qty': {
        const v = evaluate(value);
        if (v === null) break;
        if (Number.isNaN(v) || v < 0) { flash('Minimum must be 0 or more', 'err'); break; }
        if (v !== num(it.min_qty)) await updateField(it, { min_qty: v }, `Minimum set to ${v}`);
        break;
      }
      case 'price':
        await setPrice(it, evaluate(value, it.price));
        break;
      case 'quantity':
        await setQuantity(it, evaluate(value, it.quantity));
        break;
      case 'add':
      case 'remove': {
        const v = evaluate(value);
        if (v === null) break;
        if (Number.isNaN(v)) { flash('Type a number, e.g. 5 or 2*6', 'err'); break; }
        await moveStock(it, key === 'add' ? 'in' : 'out', v);
        break;
      }
      default:
    }
  }

  async function confirmDelete() {
    setBusy(true);
    const { error } = await sb().from('items').delete().eq('id', del.id);
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    setItems((list) => list.filter((x) => x.id !== del.id));
    flash(`${del.name} deleted`);
    setDel(null);
    loadStats();
  }

  /* ---------- Export ---------- */

  function exportRows() {
    return rows.filter((r) => !r.isNew).map(({ item: it }, i) => {
      const st = stats[it.id] || EMPTY_STATS;
      const p = packs(it);
      return {
        n: i + 1, name: it.name, unit: unitLabel(it.unit), per: perPack(it) > 1 ? perPack(it) : '',
        packets: p ? (p.loose ? `${p.full} + ${p.loose} loose` : p.full) : '',
        qty: num(it.quantity), price: num(it.price), value: valueOf(it), min: num(it.min_qty),
        in: st.in, out: st.out, low: isLow(it)
      };
    });
  }

  function exportName(ext) {
    return `Tudo ${cat?.name || 'Inventory'} ${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  function exportDate() {
    return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportExcel() {
    try {
      flash('Preparing Excel file...');
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Tudo Office Inventory';
      const ws = wb.addWorksheet((cat?.name || 'Inventory').slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
      ws.columns = [
        { key: 'n', width: 6 }, { key: 'name', width: 30 }, { key: 'unit', width: 11 }, { key: 'per', width: 12 },
        { key: 'packets', width: 16 }, { key: 'qty', width: 10 }, { key: 'price', width: 13 }, { key: 'value', width: 14 },
        { key: 'min', width: 11 }, { key: 'in', width: 14 }, { key: 'out', width: 14 }
      ];
      ws.mergeCells('A1:K1');
      ws.getCell('A1').value = `Tudo Office Inventory · ${cat?.name || ''}`;
      ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF4A2E1C' } };
      ws.mergeCells('A2:K2');
      ws.getCell('A2').value = `Exported ${exportDate()} · Prices in OMR`;
      ws.getCell('A2').font = { size: 10, color: { argb: 'FF7A5F4A' } };
      const head = ws.getRow(4);
      head.values = ['#', 'Item', 'Unit', 'In 1 packet', 'Packets', 'Pieces', 'Price (OMR)', 'Value (OMR)', 'Minimum', 'In this month', 'Out this month'];
      head.height = 22;
      head.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFF7EFE1' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A2E1C' } };
        c.alignment = { vertical: 'middle', horizontal: c.col >= 4 ? 'right' : 'left' };
      });
      const data = exportRows();
      const last = 4 + data.length;
      data.forEach((d, i) => {
        const r = 5 + i;
        const row = ws.addRow({
          n: d.n, name: d.name, unit: d.unit, per: d.per, packets: d.packets, qty: d.qty,
          price: d.price || null, value: { formula: `F${r}*G${r}`, result: d.value }, min: d.min, in: d.in, out: d.out
        });
        row.getCell('price').numFmt = '0.000';
        row.getCell('value').numFmt = '0.000';
        row.getCell('packets').alignment = { horizontal: 'right' };
        row.eachCell({ includeEmpty: true }, (c) => {
          c.border = { bottom: { style: 'thin', color: { argb: 'FFE6D7BF' } } };
          if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3E6' } };
        });
        if (d.low) row.getCell('qty').font = { bold: true, color: { argb: 'FFA3321F' } };
      });
      const total = ws.addRow({
        name: `${data.length} items`,
        value: { formula: `SUM(H5:H${last})` }, in: { formula: `SUM(J5:J${last})` }, out: { formula: `SUM(K5:K${last})` }
      });
      total.getCell('value').numFmt = '0.000';
      total.font = { bold: true };
      total.eachCell((c) => { c.border = { top: { style: 'medium', color: { argb: 'FF4A2E1C' } } }; });
      ws.autoFilter = { from: 'A4', to: `K${last}` };
      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName('xlsx'));
      flash('Excel file downloaded');
    } catch (e) {
      flash('Could not create the Excel file. Please try again.', 'err');
    }
  }

  async function exportPdf() {
    try {
      flash('Preparing PDF...');
      const { jsPDF } = await import('jspdf');
      const { autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const data = exportRows();
      const low = data.filter((d) => d.low).length;
      const totalValue = num(data.reduce((t, d) => t + d.value, 0));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(74, 46, 28);
      doc.text(cat?.name || 'Inventory', 40, 50);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(122, 95, 74);
      doc.text(`Tudo Office Inventory  |  Exported ${exportDate()}  |  ${data.length} items, ${low} low  |  Stock value ${fmtMoney(totalValue) || '0'}`, 40, 68);
      autoTable(doc, {
        startY: 84,
        head: [['#', 'Item', 'Unit', 'In 1 packet', 'Packets', 'Pieces', 'Price', 'Value', 'Minimum', 'In (month)', 'Out (month)']],
        body: data.map((d) => [d.n, d.name, d.unit, d.per, d.packets, d.qty, fmtMoney(d.price), fmtMoney(d.value), d.min, d.in ? `+${d.in}` : '0', d.out ? `-${d.out}` : '0']),
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 5, textColor: [46, 29, 18], lineColor: [230, 215, 191], lineWidth: { bottom: 0.5 } },
        headStyles: { fillColor: [74, 46, 28], textColor: [247, 239, 225], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [251, 243, 230] },
        columnStyles: {
          0: { cellWidth: 24, textColor: [160, 134, 112] }, 3: { halign: 'right' }, 4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
          9: { halign: 'right', textColor: [63, 107, 47] }, 10: { halign: 'right', textColor: [163, 50, 31] }
        },
        didParseCell: (h) => {
          if (h.section === 'head' && h.column.index >= 3) h.cell.styles.halign = 'right';
          if (h.section === 'body' && h.column.index === 5 && data[h.row.index]?.low) h.cell.styles.textColor = [163, 50, 31];
          if (h.section === 'body' && h.column.index >= 9 && h.cell.raw === '0') h.cell.styles.textColor = [160, 134, 112];
        },
        didDrawPage: () => {
          const pages = doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.setTextColor(160, 134, 112);
          doc.text(`Page ${pages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
        }
      });
      doc.save(exportName('pdf'));
      flash('PDF downloaded');
    } catch (e) {
      flash('Could not create the PDF. Please try again.', 'err');
    }
  }

  /* ---------- Keyboard ---------- */

  function onGridKey(e) {
    if (editing || del) return;
    const { r, c } = sel;
    const maxR = rows.length - 1;
    const maxC = cols.length - 1;
    const go = (nr, nc) => { e.preventDefault(); setSel({ r: Math.max(0, Math.min(maxR, nr)), c: Math.max(0, Math.min(maxC, nc)) }); };
    switch (e.key) {
      case 'ArrowUp': return go(r - 1, c);
      case 'ArrowDown': return go(r + 1, c);
      case 'ArrowLeft': return go(r, c - 1);
      case 'ArrowRight': return go(r, c + 1);
      case 'Tab': return go(r, e.shiftKey ? c - 1 : c + 1);
      case 'Home': return go(r, 0);
      case 'End': return go(r, maxC);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (canEdit(r, c)) startEdit(r, c);
        else go(r + 1, c);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && canEdit(r, c)) {
          e.preventDefault();
          startEdit(r, c, e.key);
        }
    }
  }

  function onEditorKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit('right'); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  }

  function onCellClick(r, c) {
    const same = sel.r === r && sel.c === c;
    setSel({ r, c });
    if (same && canEdit(r, c)) startEdit(r, c);
  }

  function toggleSort(key) {
    setSortBy((s) => (s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }));
  }

  /* ---------- Render ---------- */

  if (!cat && !error) return <div className="loading">Loading sheet...</div>;
  if (!cat) return <div className="error">{error} <Link href="/">Back to home</Link></div>;

  const lowCount = items.filter(isLow).length;
  const monthIn = num(Object.values(stats).reduce((t, s) => t + s.in, 0));
  const monthOut = num(Object.values(stats).reduce((t, s) => t + s.out, 0));
  const stockValue = num(items.reduce((t, it) => t + valueOf(it), 0));

  function stepper(label, disabled, onClick) {
    return (
      <button
        type="button"
        className="step"
        aria-label={label}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >{label.startsWith('Remove') || label.startsWith('Lower') ? '−' : '+'}</button>
    );
  }

  function renderCell(row, col, r, c) {
    const isEditing = editing && editing.r === r && editing.c === c;
    if (isEditing && col.key === 'unit') {
      return (
        <select
          className="cell-input"
          id={`cell-editor-${r}-${c}`}
          autoFocus
          value={editing.value}
          onChange={(e) => { setEditing({ ...editing, value: e.target.value }); commitEdit(); }}
          onKeyDown={onEditorKey}
          onBlur={() => commitEdit()}
        >
          {unitOptions(editing.value).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      );
    }
    if (isEditing) {
      return (
        <input
          className="cell-input"
          id={`cell-editor-${r}-${c}`}
          autoFocus
          inputMode={col.key === 'name' ? 'text' : 'decimal'}
          placeholder={col.key === 'price' ? 'OMR e.g. 0.800' : ''}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={onEditorKey}
          onBlur={() => commitEdit()}
          onFocus={(e) => {
            const el = e.target;
            if (editing.typed) { const n = el.value.length; el.setSelectionRange(n, n); } else el.select();
          }}
        />
      );
    }
    if (row.isNew) {
      return col.key === 'name' ? <span className="ph">+ Add new item</span> : null;
    }
    const it = row.item;
    const st = stats[it.id] || EMPTY_STATS;
    const pk = packs(it);
    switch (col.key) {
      case 'name': return <span className="cell-text">{it.name}</span>;
      case 'unit': return <span className="muted">{unitLabel(it.unit)}</span>;
      case 'per_pack': return perPack(it) > 1 ? <span>{perPack(it)}</span> : <span className="muted">1</span>;
      case 'packets':
        if (!pk) return <span className="muted">–</span>;
        return (
          <div className="qty">
            {canChange && stepper(`Remove 1 packet of ${it.name}`, Number(it.quantity) < perPack(it), () => moveStock(it, 'out', perPack(it)))}
            <span className="qty-num">
              {pk.full}{pk.loose > 0 && <small className="loose"> +{pk.loose}</small>}
            </span>
            {canChange && stepper(`Add 1 packet of ${it.name}`, false, () => moveStock(it, 'in', perPack(it)))}
          </div>
        );
      case 'quantity':
        return (
          <div className="qty">
            {canChange && stepper(`Remove 1 ${it.name}`, Number(it.quantity) <= 0, () => moveStock(it, 'out', 1))}
            <span className={`qty-num ${isLow(it) ? 'is-low' : ''}`}>{num(it.quantity)}</span>
            {canChange && stepper(`Add 1 ${it.name}`, false, () => moveStock(it, 'in', 1))}
          </div>
        );
      case 'add': return <span className="ph in">+ qty</span>;
      case 'remove': return <span className="ph out">− qty</span>;
      case 'price':
        return (
          <div className="qty">
            {canChange && stepper(`Lower price of ${it.name}`, Number(it.price) <= 0, () => setPrice(it, Math.max(0, num(Number(it.price) - PRICE_STEP))))}
            <span className={Number(it.price) > 0 ? 'money' : 'muted'}>{fmtMoney(it.price) || '–'}</span>
            {canChange && stepper(`Raise price of ${it.name}`, false, () => setPrice(it, num(Number(it.price) + PRICE_STEP)))}
          </div>
        );
      case 'value': return <span className={valueOf(it) > 0 ? 'money strong' : 'muted'}>{fmtMoney(valueOf(it)) || '–'}</span>;
      case 'min_qty': return <span>{num(it.min_qty)}</span>;
      case 'in_m': return <span className={st.in ? 'pos' : 'muted'}>{st.in ? `+${st.in}` : '0'}</span>;
      case 'out_m': return <span className={st.out ? 'neg' : 'muted'}>{st.out ? `−${st.out}` : '0'}</span>;
      default: return null;
    }
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <div className="search">
            <label htmlFor="sheet-search" className="sr-only">Search items</label>
            <input id="sheet-search" type="search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isAdmin && (
            <button type="button" className={`btn ${editMode ? 'in' : ''}`} onClick={toggleEditMode} aria-pressed={editMode}>
              {editMode ? '✓ Done editing' : 'Edit'}
            </button>
          )}
          {isAdmin && <button type="button" className="btn ghost" onClick={newItem}>+ New item</button>}
          <button type="button" className="btn ghost" onClick={exportExcel}>Export Excel</button>
          <button type="button" className="btn ghost" onClick={exportPdf}>Export PDF</button>
        </div>
      </div>

      <div className="sheet-head">
        <div>
          <h1>{cat.name}</h1>
          <p className="sub">
            {items.length} items · {lowCount > 0 ? <span className="neg">{lowCount} low on stock</span> : 'stock levels OK'}
            {!isAdmin && ' · view only'}
          </p>
        </div>
        <div className="sheet-kpis">
          <div><span>Stock value</span><strong>{fmtMoney(stockValue) || '0'}</strong></div>
          <div><span>In this month</span><strong className="pos">{monthIn ? `+${monthIn}` : 0}</strong></div>
          <div><span>Out this month</span><strong className="neg">{monthOut ? `−${monthOut}` : 0}</strong></div>
        </div>
      </div>

      <section className={`sheet ${editMode ? 'is-editing' : ''}`}>
        {editMode && (
          <div className="edit-banner">
            Edit mode is on. Click any cell to change it, then press Enter. Click <strong>Done editing</strong> when finished.
          </div>
        )}
        <div className="grid-wrap" ref={gridRef} tabIndex={0} onKeyDown={onGridKey} aria-label={`${cat.name} sheet`}>
          <table className="grid">
            <colgroup>
              <col className="w-num" />
              {cols.map((c) => <col key={c.key} className={`w-${c.key}`} />)}
              {canChange && <col className="w-actions" />}
            </colgroup>
            <thead>
              <tr className="labels">
                <th className="corner" />
                {cols.map((c) => (
                  <th key={c.key} className={`a-${c.align}`}>
                    {c.sort ? (
                      <button type="button" className="sort" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        <span className="arrow">{sortBy.key === c.key ? (sortBy.dir === 1 ? '▲' : '▼') : ''}</span>
                      </button>
                    ) : c.label}
                  </th>
                ))}
                {canChange && <th className="a-right" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td className="rownum" /><td colSpan={cols.length + (canChange ? 1 : 0)} className="empty-row">No items match your search.</td></tr>
              )}
              {rows.map((row, r) => (
                <tr key={row.isNew ? 'new' : row.item.id} className={`${row.isNew ? 'new-row' : ''} ${!row.isNew && isLow(row.item) ? 'low-row' : ''} ${sel.r === r ? 'sel-row' : ''}`}>
                  <td className="rownum">{row.isNew ? '+' : r + 1}</td>
                  {cols.map((col, c) => {
                    const selected = sel.r === r && sel.c === c;
                    const editable = canEdit(r, c);
                    return (
                      <td
                        key={col.key}
                        data-cell={`${r}-${c}`}
                        className={`cell a-${col.align} k-${col.key} ${selected ? 'selected' : ''} ${editable ? 'editable' : ''} ${editing && editing.r === r && editing.c === c ? 'editing' : ''}`}
                        onClick={() => onCellClick(r, c)}
                        onDoubleClick={() => startEdit(r, c)}
                      >
                        {renderCell(row, col, r, c)}
                      </td>
                    );
                  })}
                  {canChange && (
                    <td className="row-actions">
                      {!row.isNew && (
                        <button type="button" className="mini danger" onClick={() => setDel(row.item)}>Delete</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="rownum">Σ</td>
                <td colSpan={cols.length + (canChange ? 1 : 0)}>
                  <div className="foot-sum">
                    <span>{items.length} items</span>
                    <span className={lowCount ? 'neg' : ''}>{lowCount} low</span>
                    <span>Value {fmtMoney(stockValue) || '0'}</span>
                    <span className="pos">In {monthIn ? `+${monthIn}` : 0}</span>
                    <span className="neg">Out {monthOut ? `−${monthOut}` : 0}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="sheet-hint">
          {!isAdmin
            ? 'View only. Ask Administrator to make changes.'
            : editMode
              ? 'Type 10 to set, +5 to add, -2 to subtract, =4*3 to calculate. Price is in OMR, e.g. 0.800 shows as 800 Bz. Packets work out from "In 1 packet".'
              : 'Click Edit to change items, stock and prices.'}
        </p>
      </section>

      <section className="panel">
        <h2>Recent activity</h2>
        {moves.length === 0 ? <p className="empty">No stock movement recorded yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th className="num">Qty</th><th>Note</th></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDateTime(m.created_at)}</td>
                    <td>{m.items?.name}</td>
                    <td><span className={`pill ${m.move_type}`}>{m.move_type === 'in' ? 'In' : 'Out'}</span></td>
                    <td className="num">{num(m.qty)} {unitLabel(m.items?.unit)}</td>
                    <td>{m.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}

      {del && (
        <Modal title="Delete item?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <strong>{del.name}</strong>? Its stock history will also be deleted.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete} disabled={busy}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><SheetPage /></AuthGate>;
}
