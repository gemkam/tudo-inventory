'use client';

import { useEffect, useRef, useState } from 'react';

/*
  ☑ Columns ▾ drop-down (5 Nov 2026, Bills / Invoices list): tick to show, untick to hide a column.
  cols = [{ key, label }], hidden = [keys], onChange(nextHidden). The page hides the cells itself.
*/
export default function ColumnPicker({ cols, hidden, onChange, className = 'btn ghost' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('touchstart', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shownCount = cols.filter((c) => !hidden.includes(c.key)).length;
  const flip = (k) => {
    const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
    if (cols.every((c) => next.includes(c.key))) return; // keep at least one column
    onChange(next);
  };
  return (
    <span className="cpk" ref={box}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true">
        ☑ Columns{hidden.length ? ` (${shownCount}/${cols.length})` : ''} ▾
      </button>
      {open && (
        <div className="cpk-menu" role="menu">
          <div className="cpk-top">
            <button type="button" className="al-link" onClick={() => onChange([])}>Show all</button>
            <button type="button" className="al-link" onClick={() => onChange(cols.slice(1).map((c) => c.key))}>Hide all</button>
          </div>
          {cols.map((c) => (
            <label key={c.key} className="cpk-row">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => flip(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </span>
  );
}
