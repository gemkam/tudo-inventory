'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DateInput from '@/components/DateInput';
import { evaluate, num, fmtAmt } from '@/lib/sheet';

/*
  Excel-style grid used by the Transport pages.
  columns: [{ key, label, type: 'text'|'number'|'date'|'select'|'combo' (pick or type)|'calc', width, align, options, render(row), raw(row), placeholder }]
  rows: [{ id, ... }]
  canEdit: Edit mode is on
  onSave(row, key, value): value is a number for 'number', 'YYYY-MM-DD' for 'date', string otherwise
  onAdd(): adds a new row (shows "+ Add new row" line)
  onDelete(row): shows a Delete button per row in Edit mode
  footer: { [key]: node } shown in a totals row
  groups: optional header rows above the labels (Personnel: Salary > Allowance)
  deleting: Delete mode without Edit mode: a red 🗑 in place of the row number, at the start of each row (Personnel)
  filters: Excel-style ▾ on every column header (sort A→Z / Z→A, search, tick the values to show). col.text(row) gives
    the text to filter on for 'calc' columns (calc columns without text get no ▾); col.filter === false hides it.
  onView(ids): called with the ids of the rows now shown (after filters / sort), so the page can total only those.
  Column widths: drag the edge of any header (components/ColumnResize.js, for every table in the app).
*/
const BLANK = '(Blanks)';
const dmy = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return day ? `${day}/${m}/${y}` : String(d); };

/* Excel filter box for one column */
function FilterMenu({ col, values, selected, sorted, pos, onApply, onSort, onClose }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(() => new Set(selected || values.map((v) => v[0])));
  const boxRef = useRef(null);
  useEffect(() => {
    const out = (e) => { if (boxRef.current && !boxRef.current.contains(e.target) && !e.target.closest?.('.dg-fbtn')) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', out);
    document.addEventListener('touchstart', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const shown = q ? values.filter(([v]) => v.toLowerCase().includes(q.toLowerCase())) : values;
  const allOn = shown.length > 0 && shown.every(([v]) => pick.has(v));
  const toggleAll = () => setPick((p) => { const n = new Set(p); shown.forEach(([v]) => (allOn ? n.delete(v) : n.add(v))); return n; });
  const toggle = (v) => setPick((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const left = Math.max(8, Math.min(pos.left, (typeof window !== 'undefined' ? window.innerWidth : 400) - 268));
  return createPortal(
    <div ref={boxRef} className="dg-fmenu" style={{ left, top: pos.top }} role="dialog" aria-label={`Filter ${col.label}`}>
      <div className="dg-fhead">{col.label}</div>
      <button type="button" className={`dg-fsort ${sorted === 'asc' ? 'on' : ''}`} onClick={() => onSort('asc')}>↑ Sort A → Z{col.type === 'number' ? ' (small to big)' : ''}</button>
      <button type="button" className={`dg-fsort ${sorted === 'desc' ? 'on' : ''}`} onClick={() => onSort('desc')}>↓ Sort Z → A{col.type === 'number' ? ' (big to small)' : ''}</button>
      <input className="dg-fsearch" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="dg-flist">
        <label className="dg-fall"><input type="checkbox" checked={allOn} onChange={toggleAll} /> (Select all{q ? ' shown' : ''})</label>
        {shown.map(([v, n]) => (
          <label key={v}><input type="checkbox" checked={pick.has(v)} onChange={() => toggle(v)} /> <span>{v}</span> <small>{n}</small></label>
        ))}
        {shown.length === 0 && <p className="muted">Nothing matches</p>}
      </div>
      <div className="dg-fact">
        <button type="button" className="btn small ghost" onClick={() => onApply(null)}>Clear filter</button>
        <button type="button" className="btn small ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn small in" disabled={pick.size === 0} onClick={() => onApply(pick.size >= values.length && values.every(([v]) => pick.has(v)) ? null : pick)}>OK</button>
      </div>
    </div>,
    document.body
  );
}
/* Pick-or-type cell: shows ALL saved choices; typing narrows the list; any new text is kept */
function ComboEditor({ options, placeholder, value, typed, onChange, onPick, onKeyDown, onBlur }) {
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [filtering, setFiltering] = useState(!!typed);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (typed) { const n = el.value.length; el.setSelectionRange(n, n); } else el.select();
    const place = () => { const r = el.getBoundingClientRect(); setPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 200) }); };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [typed]);
  const q = String(value || '').trim().toLowerCase();
  const shown = filtering && q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  return (
    <>
      <input
        ref={inputRef}
        className="cell-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { setFiltering(true); onChange(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {pos && shown.length > 0 && typeof document !== 'undefined' && createPortal(
        <ul className="combo-list" style={{ left: pos.left, top: pos.top, minWidth: pos.width }} role="listbox">
          {shown.map((o) => (
            <li key={o} role="option" aria-selected={o === value} className={o === value ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); onPick(o); }}>{o}</li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

export default function DataGrid({ columns, rows: allRows, filters = false, onView, canEdit, onSave, onAdd, addLabel = '+ Add new row', onDelete, footer, rowClass, emptyText = 'Nothing here yet.', flash, groups, deleting = false }) {
  /* ---------- Excel filters (filters prop) ---------- */
  const [flt, setFlt] = useState({}); // { colKey: Set of shown texts }
  const [sortBy, setSortBy] = useState(null); // { key, dir }
  const [fmenu, setFmenu] = useState(null); // { key, left, top }
  const canFilter = (col) => filters && col.filter !== false && (col.type !== 'calc' || !!col.text);
  const textOf = (row, col) => {
    let t;
    if (col.text) t = col.text(row);
    else {
      const v = row[col.key];
      if (v === null || v === undefined || v === '') t = '';
      else if (col.type === 'number') t = Number(v) ? fmtAmt(v) : '';
      else if (col.type === 'date') t = dmy(v);
      else t = String(v);
    }
    t = String(t ?? '').trim();
    return t || BLANK;
  };
  const sortVal = (row, col) => {
    if (col.sortValue) return col.sortValue(row);
    const v = row[col.key];
    if (col.type === 'number') return Number(v || 0);
    if (col.type === 'date') return String(v || '');
    return textOf(row, col).toLowerCase();
  };
  const passes = (row, skipKey) => Object.entries(flt).every(([k, set]) => {
    if (k === skipKey || !set) return true;
    const col = columns.find((c) => c.key === k);
    return !col || set.has(textOf(row, col));
  });
  const rows = useMemo(() => {
    if (!filters) return allRows;
    let list = allRows.filter((r) => passes(r));
    if (sortBy) {
      const col = columns.find((c) => c.key === sortBy.key);
      if (col) {
        const d = sortBy.dir === 'desc' ? -1 : 1;
        list = [...list].sort((a, b) => { const x = sortVal(a, col); const y = sortVal(b, col); return x < y ? -d : x > y ? d : 0; });
      }
    }
    return list;
  }, [allRows, flt, sortBy, columns, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastIds = useRef('');
  useEffect(() => {
    if (!onView) return;
    const ids = rows.map((r) => r.id);
    const key = ids.join(',');
    if (key !== lastIds.current) { lastIds.current = key; onView(ids); }
  }, [rows, onView]);
  const activeFilters = Object.keys(flt).filter((k) => flt[k]);
  function openFilter(e, col) {
    e.stopPropagation();
    if (fmenu?.key === col.key) { setFmenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setFmenu({ key: col.key, left: r.right - 250, top: r.bottom + 4 });
  }
  function filterValues(col) {
    const count = new Map();
    allRows.filter((r) => passes(r, col.key)).forEach((r) => { const t = textOf(r, col); count.set(t, (count.get(t) || 0) + 1); });
    const list = [...count.entries()];
    const sample = new Map(allRows.map((r) => [textOf(r, col), r]));
    return list.sort((a, b) => {
      if (a[0] === BLANK) return 1; if (b[0] === BLANK) return -1;
      const x = sortVal(sample.get(a[0]), col); const y = sortVal(sample.get(b[0]), col);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const wrapRef = useRef(null);

  /* Wide tables move left / right: ‹ › buttons on the sides (also mouse wheel with Shift, touchpad, finger, scroll bar). */
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  function checkSides() {
    const w = wrapRef.current;
    if (!w) return;
    setCanLeft(w.scrollLeft > 2);
    setCanRight(w.scrollLeft + w.clientWidth < w.scrollWidth - 2);
  }
  function slide(dir) {
    const w = wrapRef.current;
    if (w) w.scrollBy({ left: dir * Math.max(200, w.clientWidth * 0.7), behavior: 'smooth' });
  }
  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return undefined;
    checkSides();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkSides) : null;
    if (ro) { ro.observe(w); if (w.firstElementChild) ro.observe(w.firstElementChild); }
    window.addEventListener('resize', checkSides);
    return () => { ro?.disconnect(); window.removeEventListener('resize', checkSides); };
  }, [rows, columns, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const setEditing = (v) => { editingRef.current = v; setEditingState(v); };

  const firstWidth = columns[0]?.width || 140;

  useEffect(() => {
    setSel((s) => ({ r: Math.min(s.r, Math.max(rows.length - 1, 0)), c: Math.min(s.c, columns.length - 1) }));
  }, [rows.length, columns.length]);

  useEffect(() => {
    // Only follow the selected cell while the person is using the grid; never when the page opens or data loads
    const wrap = wrapRef.current;
    if (!wrap || !wrap.contains(document.activeElement)) return;
    const el = wrap.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  useEffect(() => { if (!canEdit) setEditing(null); }, [canEdit]);

  function editable(r, c) {
    const col = columns[c];
    const row = rows[r];
    if (!canEdit || !row || !col || col.type === 'calc' || col.readOnly) return false;
    return col.editable ? col.editable(row) : true;
  }

  function rawOf(row, col) {
    if (col.raw) return col.raw(row);
    const v = row[col.key];
    if (v === null || v === undefined) return '';
    if (col.type === 'number') return String(num(v));
    return String(v);
  }

  function startEdit(r, c, typed) {
    if (!editable(r, c)) return;
    const col = columns[c];
    const useTyped = typed !== undefined && (col.type === 'text' || col.type === 'number' || col.type === 'combo');
    setSel({ r, c });
    setEditing({ r, c, value: useTyped ? typed : rawOf(rows[r], col), typed: useTyped });
  }

  function focusWrap() {
    requestAnimationFrame(() => wrapRef.current?.focus({ preventScroll: true }));
  }

  async function commit(move) {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    const row = rows[ed.r];
    const col = columns[ed.c];
    if (move === 'down') setSel({ r: Math.min(ed.r + 1, rows.length - 1), c: ed.c });
    if (move === 'right') setSel({ r: ed.r, c: Math.min(ed.c + 1, columns.length - 1) });
    focusWrap();
    if (!row || !col) return;
    const before = rawOf(row, col);
    const raw = String(ed.value ?? '').trim();
    if (raw === before) return;
    let value = raw;
    if (col.type === 'number') {
      const v = evaluate(raw, row[col.key] ?? 0);
      if (v === null) value = 0;
      else if (Number.isNaN(v)) { flash?.('Type a number, e.g. 45 or 20+25', 'err'); return; }
      else value = v;
      if (col.min !== undefined && value < col.min) { flash?.(`${col.label} cannot be less than ${col.min}`, 'err'); return; }
    }
    if (col.type === 'date' && !raw) { flash?.('Pick a date', 'err'); return; }
    await onSave(row, col.key, value === '' ? null : value);
  }

  function onKey(e) {
    if (editing) return;
    const { r, c } = sel;
    const maxR = rows.length - 1;
    const maxC = columns.length - 1;
    const go = (nr, nc) => { e.preventDefault(); setSel({ r: Math.max(0, Math.min(maxR, nr)), c: Math.max(0, Math.min(maxC, nc)) }); };
    switch (e.key) {
      case 'ArrowUp': return go(r - 1, c);
      case 'ArrowDown': return go(r + 1, c);
      case 'ArrowLeft': return go(r, c - 1);
      case 'ArrowRight': return go(r, c + 1);
      case 'Tab': return go(r, e.shiftKey ? c - 1 : c + 1);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (editable(r, c)) startEdit(r, c); else go(r + 1, c);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && editable(r, c)) {
          e.preventDefault();
          startEdit(r, c, e.key);
        }
    }
  }

  function editorKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
    else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); focusWrap(); }
  }

  function renderEditor(col) {
    const common = {
      className: 'cell-input',
      autoFocus: true,
      onKeyDown: editorKey,
      onBlur: () => commit()
    };
    if (col.type === 'select') {
      const opts = col.options || [];
      const list = editing.value && !opts.includes(editing.value) ? [editing.value, ...opts] : opts;
      return (
        <select {...common} value={editing.value} onChange={(e) => { setEditing({ ...editing, value: e.target.value }); commit(); }}>
          <option value="">–</option>
          {list.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (col.type === 'combo') {
      return (
        <ComboEditor
          options={col.options || []}
          placeholder={col.placeholder || 'Pick or type'}
          value={editing.value}
          typed={editing.typed}
          onChange={(v) => setEditing({ ...editingRef.current, value: v })}
          onPick={(v) => { setEditing({ ...editingRef.current, value: v }); commit(); }}
          onKeyDown={editorKey}
          onBlur={() => commit()}
        />
      );
    }
    if (col.type === 'date') {
      return (
        <DateInput
          className="cell-date"
          autoFocus
          value={editing.value}
          onChange={(v) => setEditing({ ...editingRef.current, value: v })}
          onPicked={(v) => { setEditing({ ...editingRef.current, value: v }); commit(); }}
          onKeyDown={editorKey}
          onBlur={() => commit()}
        />
      );
    }
    return (
      <input
        {...common}
        inputMode={col.type === 'number' ? 'decimal' : 'text'}
        placeholder={col.placeholder || ''}
        value={editing.value}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
        onFocus={(e) => {
          const el = e.target;
          if (editing.typed) { const n = el.value.length; el.setSelectionRange(n, n); } else el.select();
        }}
      />
    );
  }

  const delAtStart = deleting && onDelete;
  const showDelete = canEdit && onDelete && !delAtStart;
  const showAdd = canEdit && onAdd;
  const span = columns.length + (showDelete ? 1 : 0);

  const fcol = fmenu && columns.find((c) => c.key === fmenu.key);
  return (
    <>
    {filters && (activeFilters.length > 0 || sortBy) && (
      <div className="dg-fbar no-print">
        <span>🔽 Showing <b>{rows.length}</b> of {allRows.length} rows</span>
        {activeFilters.map((k) => { const c = columns.find((x) => x.key === k); return c ? <button key={k} type="button" className="rp-chip" onClick={() => setFlt((f) => ({ ...f, [k]: null }))} title="Remove this filter">{c.label} ✕</button> : null; })}
        {sortBy && <button type="button" className="rp-chip" onClick={() => setSortBy(null)}>Sort: {columns.find((x) => x.key === sortBy.key)?.label} {sortBy.dir === 'asc' ? '↑' : '↓'} ✕</button>}
        <button type="button" className="btn small ghost" onClick={() => { setFlt({}); setSortBy(null); }}>Clear all</button>
      </div>
    )}
    {fcol && (
      <FilterMenu key={fcol.key} col={fcol} values={filterValues(fcol)} selected={flt[fcol.key] ? [...flt[fcol.key]] : null}
        sorted={sortBy?.key === fcol.key ? sortBy.dir : null} pos={fmenu}
        onSort={(dir) => { setSortBy({ key: fcol.key, dir }); setFmenu(null); }}
        onApply={(set) => { setFlt((f) => ({ ...f, [fcol.key]: set })); setFmenu(null); }}
        onClose={() => setFmenu(null)} />
    )}
    <div className="dg-outer">
    {canLeft && <button type="button" className="dg-arrow left" aria-label="Move table left" title="Move left" onClick={() => slide(-1)}>‹</button>}
    {canRight && <button type="button" className="dg-arrow right" aria-label="Move table right" title="Move right" onClick={() => slide(1)}>›</button>}
    <div className="grid-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKey} onScroll={checkSides}>
      <table className="grid dg" style={{ '--w-name': `${firstWidth}px` }}>
        <colgroup>
          <col className="w-num" />
          {columns.map((c) => <col key={c.key} style={{ width: c.width || 110 }} />)}
          {showDelete && <col style={{ width: 84 }} />}
        </colgroup>
        <thead>
          {/* groups (optional): header rows above the labels, e.g. [[{ label: 'Salary', span: 5 }, ...]] (spans add up to columns.length) */}
          {(groups || []).map((g, gi) => (
            <tr key={`g${gi}`} className="dg-group">
              <th className="dg-gcorner" />
              {g.map((x, xi) => <th key={xi} colSpan={x.span} className={x.label ? 'on' : ''}>{x.label}</th>)}
              {showDelete && <th />}
            </tr>
          ))}
          <tr className="labels">
            <th className="corner" />
            {columns.map((c) => (
              <th key={c.key} className={`a-${c.align || (c.type === 'number' || c.type === 'calc' ? 'right' : 'left')} col-${c.key}${canFilter(c) ? ' dg-fth' : ''}`}>
                {c.label}
                {canFilter(c) && (
                  <button type="button" className={`dg-fbtn no-print${flt[c.key] || sortBy?.key === c.key ? ' on' : ''}`} aria-label={`Filter ${c.label}`}
                    title={flt[c.key] ? 'Filtered: tap to change' : 'Filter and sort'} onClick={(e) => openFilter(e, c)}>▾</button>
                )}
              </th>
            ))}
            {showDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !showAdd && (
            <tr><td className="rownum" /><td colSpan={span} className="empty-row">{allRows.length && rows.length === 0 ? 'No rows match the filters.' : emptyText}</td></tr>
          )}
          {rows.map((row, r) => (
            <tr key={row.id} className={`${rowClass ? rowClass(row) : ''} ${sel.r === r ? 'sel-row' : ''}`}>
              <td className="rownum">{delAtStart ? <button type="button" className="dg-del" title={`Delete ${row.name || ''}`} aria-label="Delete" onClick={() => onDelete(row)}>🗑</button> : r + 1}</td>
              {columns.map((col, c) => {
                const isSel = sel.r === r && sel.c === c;
                const isEd = editing && editing.r === r && editing.c === c;
                const align = col.align || (col.type === 'number' || col.type === 'calc' ? 'right' : 'left');
                return (
                  <td
                    key={col.key}
                    data-cell={`${r}-${c}`}
                    className={`cell a-${align} col-${col.key} ${c === 0 ? 'k-first' : ''} ${isSel ? 'selected' : ''} ${editable(r, c) ? 'editable' : ''} ${isEd ? 'editing' : ''}`}
                    onClick={() => { const same = isSel; setSel({ r, c }); if (same) startEdit(r, c); }}
                    onDoubleClick={() => startEdit(r, c)}
                  >
                    {isEd ? renderEditor(col) : (col.render ? col.render(row) : (row[col.key] ?? ''))}
                  </td>
                );
              })}
              {showDelete && (
                <td className="row-actions">
                  <button type="button" className="mini danger" onClick={() => onDelete(row)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
          {showAdd && (
            <tr className="new-row">
              <td className="rownum">+</td>
              <td className="cell k-first add-cell" colSpan={span}>
                <button type="button" className="add-row" onClick={onAdd}>{addLabel}</button>
              </td>
            </tr>
          )}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="dg-foot">
              <td className="rownum">Σ</td>
              {columns.map((c, i) => (
                <td key={c.key} className={`a-${c.align || (c.type === 'number' || c.type === 'calc' ? 'right' : 'left')} ${i === 0 ? 'k-first' : ''}`}>{footer[c.key] ?? ''}</td>
              ))}
              {showDelete && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </div>
    </>
  );
}
