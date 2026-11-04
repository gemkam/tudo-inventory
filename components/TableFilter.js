'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

/*
  ▾ value drop-down (Excel filter) on every plain table of the app (rendered once by components/AuthGate.js).
  Editable grids (components/DataGrid.js, table.grid.dg) have their own ▾ with sort, so they are skipped here:
  no table ever gets two. The ▾ lists every value in that column (with counts); tick the ones to show.
  Rows are hidden, never moved, so the page's own code keeps working. Footer rows (totals) stay as they are.
  Filters last until the page changes. The button has no text (drawn by CSS), so table ids used by
  Table/Cards and column widths do not change.
*/

const SKIP = '.grid.dg, .trip-print, .iv-t, .cd-t, .slip-t, .slip-calc, .pc-sum, .combo-list, .modal, [role="dialog"], .tbx, .no-filter, .tv-cards';
const HIDE_PATHS = [/^\/login/, /^\/f\//, /^\/s\//, /^\/transport\/salary\//];
const BLANK = '(Blanks)';

function headerRow(table) {
  const head = table.tHead;
  if (!head || !head.rows.length) return null;
  return [...head.rows].sort((a, b) => b.cells.length - a.cells.length)[0];
}
function cellAt(tr, idx) {
  let c = 0;
  for (const cell of tr.cells) {
    const span = Number(cell.colSpan) || 1;
    if (c === idx) return span === 1 ? cell : null;
    c += span;
    if (c > idx) return null;
  }
  return null;
}
function textOf(cell) {
  if (!cell) return null;
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('button, .col-rz, .tf-btn').forEach((x) => x.remove());
  clone.querySelectorAll('select').forEach((sel) => { sel.replaceWith(document.createTextNode(sel.selectedOptions?.[0]?.text || '')); });
  clone.querySelectorAll('input').forEach((inp) => { inp.replaceWith(document.createTextNode(inp.type === 'checkbox' ? (inp.checked ? '✓' : '') : inp.value || '')); });
  const t = (clone.textContent || '').replace(/\s+/g, ' ').trim();
  return t || BLANK;
}
function bodyRows(table) { return [...table.tBodies].flatMap((b) => [...b.rows]); }

export default function TableFilter() {
  const path = usePathname();
  const off = HIDE_PATHS.some((re) => re.test(path));
  const [menu, setMenu] = useState(null); // { table, idx, label, values, left, top }
  const filters = useRef(new Map()); // table -> { idx: Set }

  useEffect(() => {
    const main = document.querySelector('main.page') || document.body;
    filters.current = new Map();
    const clean = () => {
      main.querySelectorAll('.tf-btn').forEach((b) => b.remove());
      main.querySelectorAll('tr.tf-hide').forEach((tr) => tr.classList.remove('tf-hide'));
    };
    if (off) { clean(); return undefined; }

    const applyTable = (table) => {
      const f = filters.current.get(table) || {};
      const keys = Object.keys(f).filter((k) => f[k]);
      bodyRows(table).forEach((tr) => {
        const hide = keys.some((k) => { const cell = cellAt(tr, Number(k)); return cell && !f[k].has(textOf(cell)); });
        if (tr.classList.contains('tf-hide') !== hide) tr.classList.toggle('tf-hide', hide);
      });
      const row = headerRow(table);
      row && [...row.querySelectorAll('.tf-btn')].forEach((b) => b.classList.toggle('on', !!f[b.dataset.idx]));
    };

    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        main.querySelectorAll('table').forEach((table) => {
          if (table.closest(SKIP) || table.matches(SKIP)) return;
          const row = headerRow(table);
          if (!row || row.cells.length < 2 || bodyRows(table).length < 2) return;
          let idx = 0;
          [...row.cells].forEach((th) => {
            const span = Number(th.colSpan) || 1;
            const label = (th.textContent || '').trim();
            if (span === 1 && label && !th.querySelector(':scope > .tf-btn')) {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'tf-btn no-print';
              b.title = 'Show only some values';
              b.setAttribute('aria-label', `Filter ${label}`);
              th.appendChild(b);
              th.classList.add('tf-th');
              if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
            }
            const b = th.querySelector(':scope > .tf-btn');
            if (b) b.dataset.idx = String(idx);
            idx += span;
          });
          if (filters.current.has(table)) applyTable(table);
        });
      });
    };

    const onClick = (e) => {
      const b = e.target.closest?.('.tf-btn');
      if (!b || !main.contains(b)) return;
      e.preventDefault(); e.stopPropagation();
      const table = b.closest('table');
      const idx = Number(b.dataset.idx);
      const f = filters.current.get(table) || {};
      // values in this column among the rows that pass the OTHER filters (as in Excel)
      const count = new Map();
      bodyRows(table).forEach((tr) => {
        const others = Object.keys(f).filter((k) => f[k] && Number(k) !== idx);
        if (others.some((k) => { const c = cellAt(tr, Number(k)); return c && !f[k].has(textOf(c)); })) return;
        const t = textOf(cellAt(tr, idx));
        if (t !== null) count.set(t, (count.get(t) || 0) + 1);
      });
      const values = [...count.entries()].sort((a, b2) => (a[0] === BLANK) - (b2[0] === BLANK) || a[0].localeCompare(b2[0], undefined, { numeric: true }));
      const r = b.getBoundingClientRect();
      const th = b.closest('th');
      setMenu((m) => (m && m.table === table && m.idx === idx ? null : {
        table, idx, values, label: (th.textContent || '').trim(), selected: f[idx] ? new Set(f[idx]) : null,
        left: Math.max(8, Math.min(r.right - 250, window.innerWidth - 268)), top: r.bottom + 4,
        apply: (set) => {
          const cur = { ...(filters.current.get(table) || {}) };
          cur[idx] = set;
          filters.current.set(table, cur);
          applyTable(table);
          setMenu(null);
        }
      }));
    };

    run();
    const mo = new MutationObserver(run);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    document.addEventListener('click', onClick, true);
    return () => { mo.disconnect(); cancelAnimationFrame(raf); document.removeEventListener('click', onClick, true); clean(); setMenu(null); };
  }, [off, path]);

  return menu ? <Menu menu={menu} onClose={() => setMenu(null)} /> : null;
}

function Menu({ menu, onClose }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(() => new Set(menu.selected || menu.values.map((v) => v[0])));
  const box = useRef(null);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.('.tf-btn')) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    const away = () => onClose();
    document.addEventListener('mousedown', out);
    document.addEventListener('touchstart', out);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', away);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('touchstart', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', away); };
  }, [onClose]);
  const shown = q ? menu.values.filter(([v]) => v.toLowerCase().includes(q.toLowerCase())) : menu.values;
  const allOn = shown.length > 0 && shown.every(([v]) => pick.has(v));
  const toggleAll = () => setPick((p) => { const n = new Set(p); shown.forEach(([v]) => (allOn ? n.delete(v) : n.add(v))); return n; });
  const toggle = (v) => setPick((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const full = menu.values.every(([v]) => pick.has(v));
  return createPortal(
    <div ref={box} className="dg-fmenu" style={{ left: menu.left, top: menu.top }} role="dialog" aria-label={`Filter ${menu.label}`}>
      <div className="dg-fhead">{menu.label}</div>
      <input className="dg-fsearch" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="dg-flist">
        <label className="dg-fall"><input type="checkbox" checked={allOn} onChange={toggleAll} /> (Select all{q ? ' shown' : ''})</label>
        {shown.map(([v, n]) => (
          <label key={v}><input type="checkbox" checked={pick.has(v)} onChange={() => toggle(v)} /> <span>{v}</span> <small>{n}</small></label>
        ))}
        {shown.length === 0 && <p className="muted">Nothing matches</p>}
      </div>
      <div className="dg-fact">
        <button type="button" className="btn small ghost" onClick={() => menu.apply(null)}>Clear filter</button>
        <button type="button" className="btn small ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn small in" disabled={pick.size === 0} onClick={() => menu.apply(full ? null : pick)}>OK</button>
      </div>
    </div>,
    document.body
  );
}
