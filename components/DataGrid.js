'use client';

import { useEffect, useRef, useState } from 'react';
import { evaluate, num } from '@/lib/sheet';

/*
  Excel-style grid used by the Transport pages.
  columns: [{ key, label, type: 'text'|'number'|'date'|'select'|'calc', width, align, options, render(row), raw(row), placeholder }]
  rows: [{ id, ... }]
  canEdit: Edit mode is on
  onSave(row, key, value): value is a number for 'number', 'YYYY-MM-DD' for 'date', string otherwise
  onAdd(): adds a new row (shows "+ Add new row" line)
  onDelete(row): shows a Delete button per row in Edit mode
  footer: { [key]: node } shown in a totals row
*/
export default function DataGrid({ columns, rows, canEdit, onSave, onAdd, addLabel = '+ Add new row', onDelete, footer, rowClass, emptyText = 'Nothing here yet.', flash }) {
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const wrapRef = useRef(null);
  const setEditing = (v) => { editingRef.current = v; setEditingState(v); };

  const firstWidth = columns[0]?.width || 140;

  useEffect(() => {
    setSel((s) => ({ r: Math.min(s.r, Math.max(rows.length - 1, 0)), c: Math.min(s.c, columns.length - 1) }));
  }, [rows.length, columns.length]);

  useEffect(() => {
    const el = wrapRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
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
    const useTyped = typed !== undefined && (col.type === 'text' || col.type === 'number');
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
    if (col.type === 'date') {
      return <input {...common} type="date" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />;
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

  const showDelete = canEdit && onDelete;
  const showAdd = canEdit && onAdd;
  const span = columns.length + (showDelete ? 1 : 0);

  return (
    <div className="grid-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKey}>
      <table className="grid dg" style={{ '--w-name': `${firstWidth}px` }}>
        <colgroup>
          <col className="w-num" />
          {columns.map((c) => <col key={c.key} style={{ width: c.width || 110 }} />)}
          {showDelete && <col style={{ width: 84 }} />}
        </colgroup>
        <thead>
          <tr className="labels">
            <th className="corner" />
            {columns.map((c) => <th key={c.key} className={`a-${c.align || (c.type === 'number' || c.type === 'calc' ? 'right' : 'left')}`}>{c.label}</th>)}
            {showDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !showAdd && (
            <tr><td className="rownum" /><td colSpan={span} className="empty-row">{emptyText}</td></tr>
          )}
          {rows.map((row, r) => (
            <tr key={row.id} className={`${rowClass ? rowClass(row) : ''} ${sel.r === r ? 'sel-row' : ''}`}>
              <td className="rownum">{r + 1}</td>
              {columns.map((col, c) => {
                const isSel = sel.r === r && sel.c === c;
                const isEd = editing && editing.r === r && editing.c === c;
                const align = col.align || (col.type === 'number' || col.type === 'calc' ? 'right' : 'left');
                return (
                  <td
                    key={col.key}
                    data-cell={`${r}-${c}`}
                    className={`cell a-${align} ${c === 0 ? 'k-first' : ''} ${isSel ? 'selected' : ''} ${editable(r, c) ? 'editable' : ''} ${isEd ? 'editing' : ''}`}
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
  );
}
