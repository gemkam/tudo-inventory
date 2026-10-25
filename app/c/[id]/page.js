'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb, isLow, fmtDateTime } from '@/lib/supabase';

/* Sheet columns. edit: admin can type in the cell. adminOnly: hidden for view-only users. */
const ALL_COLS = [
  { key: 'name', label: 'Item', edit: true, sort: true, width: 230, align: 'left' },
  { key: 'unit', label: 'Unit', edit: true, sort: true, width: 90, align: 'left' },
  { key: 'quantity', label: 'Present', edit: true, sort: true, width: 150, align: 'right' },
  { key: 'add', label: 'Add +', edit: true, adminOnly: true, width: 96, align: 'right' },
  { key: 'remove', label: 'Remove −', edit: true, adminOnly: true, width: 104, align: 'right' },
  { key: 'min_qty', label: 'Minimum', edit: true, sort: true, width: 100, align: 'right' },
  { key: 'in_m', label: 'In this month', sort: true, width: 120, align: 'right' },
  { key: 'out_m', label: 'Out this month', sort: true, width: 126, align: 'right' }
];

const EMPTY_STATS = { in: 0, out: 0 };

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

/* Units shown in the Unit dropdown, Packets first */
const UNITS = [
  ['packets', 'Packets'], ['pcs', 'Pieces'], ['box', 'Box'], ['carton', 'Carton'], ['ream', 'Ream'],
  ['roll', 'Roll'], ['bottle', 'Bottle'], ['set', 'Set'], ['kg', 'Kg'], ['litre', 'Litre']
];
const UNIT_LABEL = Object.fromEntries(UNITS);
function unitLabel(u) {
  return UNIT_LABEL[u] || u || '';
}
function unitOptions(current) {
  return current && !UNIT_LABEL[current] ? [[current, current], ...UNITS] : UNITS;
}


function SheetPage() {
  const { id } = useParams();
  const { isAdmin } = useUser();
  const cols = useMemo(() => ALL_COLS.filter((c) => isAdmin || !c.adminOnly), [isAdmin]);

  const [cat, setCat] = useState(null);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [moves, setMoves] = useState([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState({ key: null, dir: 1 });
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editing, setEditingState] = useState(null); // { r, c, value, bar }
  const editingRef = useRef(null);
  const setEditing = (v) => { editingRef.current = v; setEditingState(v); };
  const [rowEdit, setRowEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);

  const gridRef = useRef(null);
  const toastTimer = useRef(null);

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

  /* Rows shown in the sheet: filtered, sorted, plus a "new item" row for admin */
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items.filter((it) => !q || it.name.toLowerCase().includes(q) || (it.unit || '').toLowerCase().includes(q));
    if (sortBy.key) {
      const val = (it) => {
        switch (sortBy.key) {
          case 'in_m': return (stats[it.id] || EMPTY_STATS).in;
          case 'out_m': return (stats[it.id] || EMPTY_STATS).out;
          case 'quantity': case 'min_qty': return Number(it[sortBy.key]);
          default: return String(it[sortBy.key] || '').toLowerCase();
        }
      };
      list = [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sortBy.dir);
    }
    const out = list.map((item) => ({ item }));
    if (isAdmin && !q) out.push({ isNew: true });
    return out;
  }, [items, search, sortBy, stats, isAdmin]);

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
    if (!isAdmin || !row || !col?.edit) return false;
    if (row.isNew) return col.key === 'name';
    return true;
  }

  function rawValue(r, c) {
    const row = rows[r];
    const col = cols[c];
    if (!row || !col) return '';
    if (row.isNew) return '';
    const it = row.item;
    const st = stats[it.id] || EMPTY_STATS;
    switch (col.key) {
      case 'name': return it.name;
      case 'unit': return unitLabel(it.unit);
      case 'quantity': return String(num(it.quantity));
      case 'min_qty': return String(num(it.min_qty));
      case 'in_m': return String(st.in);
      case 'out_m': return String(st.out);
      default: return '';
    }
  }

  function startEdit(r, c, value, bar = false) {
    if (!canEdit(r, c)) return;
    setSel({ r, c });
    const isUnit = cols[c]?.key === 'unit';
    const start = isUnit ? (rows[r]?.item?.unit || 'pcs') : (value ?? rawValue(r, c));
    setEditing({ r, c, value: start, bar, typed: !isUnit && value !== undefined });
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
    if (Number.isNaN(qty) || qty < 0) { flash('Present cannot be less than 0', 'err'); return; }
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

  async function addItem(name) {
    const clean = name.trim();
    if (!clean) return;
    const sort = items.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const { data, error } = await sb().from('items')
      .insert({ category_id: id, name: clean, unit: 'pcs', quantity: 0, min_qty: 0, sort })
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
      case 'min_qty': {
        const v = evaluate(value);
        if (v === null) break;
        if (Number.isNaN(v) || v < 0) { flash('Minimum must be 0 or more', 'err'); break; }
        if (v !== num(it.min_qty)) await updateField(it, { min_qty: v }, `Minimum set to ${v}`);
        break;
      }
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

  async function saveRowEdit(e) {
    e.preventDefault();
    const it = items.find((x) => x.id === rowEdit.id);
    if (!it) return;
    setBusy(true);
    const patch = {};
    if (rowEdit.name.trim() && rowEdit.name.trim() !== it.name) patch.name = rowEdit.name.trim();
    if ((rowEdit.unit.trim() || 'pcs') !== it.unit) patch.unit = rowEdit.unit.trim() || 'pcs';
    const min = evaluate(rowEdit.min_qty);
    if (min !== null && !Number.isNaN(min) && min >= 0 && min !== num(it.min_qty)) patch.min_qty = min;
    if (Object.keys(patch).length) await updateField(it, patch, 'Item saved');
    const qty = evaluate(rowEdit.quantity, it.quantity);
    if (qty !== null && qty !== num(it.quantity)) await setQuantity({ ...it, ...patch }, qty);
    setBusy(false);
    setRowEdit(null);
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

  function exportRows() {
    return rows.filter((r) => !r.isNew).map(({ item: it }, i) => {
      const st = stats[it.id] || EMPTY_STATS;
      return { n: i + 1, name: it.name, unit: unitLabel(it.unit), qty: num(it.quantity), min: num(it.min_qty), in: st.in, out: st.out, low: isLow(it) };
    });
  }

  function exportName(ext) {
    return `Tudo ${cat?.name || 'Inventory'} ${new Date().toISOString().slice(0, 10)}.${ext}`;
  }

  function exportDate() {
    return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function exportExcel() {
    try {
      flash('Preparing Excel file...');
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Tudo Office Inventory';
      const ws = wb.addWorksheet((cat?.name || 'Inventory').slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
      ws.columns = [
        { key: 'n', width: 6 }, { key: 'name', width: 32 }, { key: 'unit', width: 12 }, { key: 'qty', width: 12 },
        { key: 'min', width: 12 }, { key: 'in', width: 16 }, { key: 'out', width: 16 }
      ];
      ws.mergeCells('A1:G1');
      ws.getCell('A1').value = `Tudo Office Inventory · ${cat?.name || ''}`;
      ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF4A2E1C' } };
      ws.mergeCells('A2:G2');
      ws.getCell('A2').value = `Exported ${exportDate()}`;
      ws.getCell('A2').font = { size: 10, color: { argb: 'FF7A5F4A' } };
      const head = ws.getRow(4);
      head.values = ['#', 'Item', 'Unit', 'Present', 'Minimum', 'In this month', 'Out this month'];
      head.height = 22;
      head.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFF7EFE1' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A2E1C' } };
        c.alignment = { vertical: 'middle', horizontal: c.col >= 4 ? 'right' : 'left' };
      });
      const data = exportRows();
      data.forEach((d, i) => {
        const row = ws.addRow({ n: d.n, name: d.name, unit: d.unit, qty: d.qty, min: d.min, in: d.in, out: d.out });
        row.eachCell((c) => {
          c.border = { bottom: { style: 'thin', color: { argb: 'FFE6D7BF' } } };
          if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3E6' } };
        });
        if (d.low) row.getCell('qty').font = { bold: true, color: { argb: 'FFA3321F' } };
      });
      const total = ws.addRow({ name: `${data.length} items`, in: { formula: `SUM(F5:F${4 + data.length})` }, out: { formula: `SUM(G5:G${4 + data.length})` } });
      total.font = { bold: true };
      total.eachCell((c) => { c.border = { top: { style: 'medium', color: { argb: 'FF4A2E1C' } } }; });
      ws.autoFilter = { from: 'A4', to: `G${4 + data.length}` };
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
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const data = exportRows();
      const low = data.filter((d) => d.low).length;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.setTextColor(74, 46, 28);
      doc.text(cat?.name || 'Inventory', 40, 54);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(122, 95, 74);
      doc.text(`Tudo Office Inventory  |  Exported ${exportDate()}  |  ${data.length} items, ${low} low`, 40, 72);
      autoTable(doc, {
        startY: 90,
        head: [['#', 'Item', 'Unit', 'Present', 'Minimum', 'In (month)', 'Out (month)']],
        body: data.map((d) => [d.n, d.name, d.unit, d.qty, d.min, d.in ? `+${d.in}` : '0', d.out ? `-${d.out}` : '0']),
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 6, textColor: [46, 29, 18], lineColor: [230, 215, 191], lineWidth: { bottom: 0.5 } },
        headStyles: { fillColor: [74, 46, 28], textColor: [247, 239, 225], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [251, 243, 230] },
        columnStyles: { 0: { cellWidth: 28, textColor: [160, 134, 112] }, 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right' }, 5: { halign: 'right', textColor: [63, 107, 47] }, 6: { halign: 'right', textColor: [163, 50, 31] } },
        didParseCell: (h) => {
          if (h.section === 'head' && h.column.index >= 3) h.cell.styles.halign = 'right';
          if (h.section === 'body' && h.column.index === 3 && data[h.row.index]?.low) h.cell.styles.textColor = [163, 50, 31];
          if (h.section === 'body' && h.column.index >= 5 && h.cell.raw === '0') h.cell.styles.textColor = [160, 134, 112];
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

  /* ---------- Keyboard ---------- */

  function onGridKey(e) {
    if (editing || rowEdit || del) return;
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
          inputMode={['name', 'unit'].includes(col.key) ? 'text' : 'decimal'}
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
    switch (col.key) {
      case 'name': return <span className="cell-text">{it.name}</span>;
      case 'unit': return <span className="muted">{unitLabel(it.unit)}</span>;
      case 'quantity':
        return (
          <div className="qty">
            {isAdmin && (
              <button
                type="button"
                className="step"
                aria-label={`Remove 1 ${it.name}`}
                disabled={Number(it.quantity) <= 0}
                onClick={(e) => { e.stopPropagation(); moveStock(it, 'out', 1); }}
              >−</button>
            )}
            <span className={`qty-num ${isLow(it) ? 'is-low' : ''}`}>{num(it.quantity)}</span>
            {isAdmin && (
              <button
                type="button"
                className="step"
                aria-label={`Add 1 ${it.name}`}
                onClick={(e) => { e.stopPropagation(); moveStock(it, 'in', 1); }}
              >+</button>
            )}
          </div>
        );
      case 'add': return <span className="ph in">+ qty</span>;
      case 'remove': return <span className="ph out">− qty</span>;
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
            <button type="button" className="btn" onClick={() => { const r = rows.findIndex((x) => x.isNew); if (r === -1) { setSearch(''); return; } startEdit(r, 0, ''); }}>
              + New item
            </button>
          )}
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
          <div><span>In this month</span><strong className="pos">{monthIn ? `+${monthIn}` : 0}</strong></div>
          <div><span>Out this month</span><strong className="neg">{monthOut ? `−${monthOut}` : 0}</strong></div>
        </div>
      </div>

      <section className="sheet">
        <div className="grid-wrap" ref={gridRef} tabIndex={0} onKeyDown={onGridKey} aria-label={`${cat.name} sheet`}>
          <table className="grid">
            <colgroup>
              <col className="w-num" />
              {cols.map((c) => <col key={c.key} className={`w-${c.key}`} />)}
              {isAdmin && <col className="w-actions" />}
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
                {isAdmin && <th className="a-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td className="rownum" /><td colSpan={cols.length + (isAdmin ? 1 : 0)} className="empty-row">No items match your search.</td></tr>
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
                  {isAdmin && (
                    <td className="row-actions">
                      {!row.isNew && (
                        <>
                          <button type="button" className="mini" onClick={() => setRowEdit({ id: row.item.id, name: row.item.name, unit: row.item.unit, quantity: String(num(row.item.quantity)), min_qty: String(num(row.item.min_qty)) })}>Edit</button>
                          <button type="button" className="mini danger" onClick={() => setDel(row.item)}>Delete</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="rownum">Σ</td>
                <td colSpan={cols.length + (isAdmin ? 1 : 0)}>
                  <div className="foot-sum">
                    <span>{items.length} items</span>
                    <span className={lowCount ? 'neg' : ''}>{lowCount} low</span>
                    <span className="pos">In {monthIn ? `+${monthIn}` : 0}</span>
                    <span className="neg">Out {monthOut ? `−${monthOut}` : 0}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="sheet-hint">
          {isAdmin
            ? 'Click a cell to select, click again or start typing to edit. Enter saves. In Present you can type 10, +5, -2 or =4*3. Add + and Remove − record stock in and out.'
            : 'View only. Ask Administrator to make changes.'}
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

      {rowEdit && (
        <Modal title="Edit item" onClose={() => setRowEdit(null)}>
          <form onSubmit={saveRowEdit} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="re-name">Item name</label>
              <input id="re-name" required value={rowEdit.name} onChange={(e) => setRowEdit({ ...rowEdit, name: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="re-unit">Unit</label>
                <select id="re-unit" value={rowEdit.unit} onChange={(e) => setRowEdit({ ...rowEdit, unit: e.target.value })}>
                  {unitOptions(rowEdit.unit).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="re-qty">Present</label>
                <input id="re-qty" inputMode="decimal" value={rowEdit.quantity} onChange={(e) => setRowEdit({ ...rowEdit, quantity: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="re-min">Minimum</label>
                <input id="re-min" inputMode="decimal" value={rowEdit.min_qty} onChange={(e) => setRowEdit({ ...rowEdit, min_qty: e.target.value })} />
              </div>
            </div>
            <p className="sub" style={{ margin: 0 }}>Changing Present is recorded in the stock log.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setRowEdit(null)}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>Save</button>
            </div>
          </form>
        </Modal>
      )}

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
