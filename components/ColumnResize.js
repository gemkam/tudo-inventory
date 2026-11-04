'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/*
  Column widths like Excel, on every table of the app (rendered once by components/AuthGate.js).
  - Every header cell gets a thin handle on its right edge (span.col-rz). Drag it to make the column wider or narrower.
  - Double-click (double-tap) the handle: the column fits its longest text.
  - Saved on this device per page and per table (localStorage "tudo-colw" { path: { tableId: { colIndex: px } } }).
    The table id is a hash of its header labels (same idea as components/TableCards.js), so it stays when rows change.
  - First drag on a table freezes all its columns at their current width (table-layout fixed), so only the
    dragged column changes, as in Excel. A small ⟲ button (drawn by CSS, no text, so table ids do not change)
    appears in the first header cell of a table with saved widths: it resets that table.
  Skipped: papers (invoice, receipts, slip), print-only tables, pop-ups, tables shown as Cards.
*/

const KEY = 'tudo-colw';
const SKIP = '.trip-print, .iv-t, .iv-list, .cd-t, .slip-t, .slip-calc, .pc-sum, .combo-list, .modal, [role="dialog"], .tbx, .no-resize';
const HIDE_PATHS = [/^\/login/, /^\/f\//, /^\/transport\/invoice/, /^\/expenses\/docs/, /^\/transport\/salary\//, /^\/s\//];
const MIN = 34;

function readAll() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function writeAll(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full or blocked */ } }

function headerRow(table) {
  const head = table.tHead;
  if (!head || !head.rows.length) return null;
  return [...head.rows].sort((a, b) => b.cells.length - a.cells.length)[0];
}

/* [{ th, idx, span }] with idx = first column index of that cell */
function cellsOf(row) {
  let idx = 0;
  return [...row.cells].map((th) => { const span = Number(th.colSpan) || 1; const o = { th, idx, span }; idx += span; return o; });
}

function labelText(th) {
  const clone = th.cloneNode(true);
  clone.querySelectorAll('.col-rz, .dg-fbtn').forEach((x) => x.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function tableId(row, i) {
  const text = [...row.cells].map(labelText).filter(Boolean).join('|') || `t${i}`;
  let h = 0;
  for (let k = 0; k < text.length; k += 1) h = ((h << 5) - h + text.charCodeAt(k)) | 0;
  return `r${(h >>> 0).toString(36)}`;
}

function colCount(row) { return cellsOf(row).reduce((n, c) => n + c.span, 0); }

/* the <col> elements for this table: its own colgroup when it matches, else one we add (marked data-rz) */
function colsOf(table, n) {
  let cg = [...table.children].find((el) => el.tagName === 'COLGROUP');
  if (cg && cg.children.length === n) return [...cg.children];
  if (cg && !cg.hasAttribute('data-rz')) return null; // someone else's colgroup that does not match: leave it
  if (cg) cg.remove();
  cg = document.createElement('colgroup');
  cg.setAttribute('data-rz', '');
  for (let i = 0; i < n; i += 1) cg.appendChild(document.createElement('col'));
  table.insertBefore(cg, table.firstChild);
  return [...cg.children];
}

/* current widths of every column, read from the header cells */
function measure(row) {
  const out = {};
  cellsOf(row).forEach(({ th, idx, span }) => {
    const w = th.getBoundingClientRect().width / span;
    for (let k = 0; k < span; k += 1) out[idx + k] = Math.round(w);
  });
  return out;
}

function apply(table, row, map) {
  const n = colCount(row);
  const cols = colsOf(table, n);
  const now = measure(row);
  const corners = new Set(cellsOf(row).filter((c) => c.th.classList.contains('corner')).map((c) => c.idx));
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    if (corners.has(i)) { // row-number corner keeps its own width (sticky columns use it)
      total += parseFloat(getComputedStyle(table).getPropertyValue('--w-num')) || 46;
      continue;
    }
    const w = map[i] || now[i] || 80;
    total += w;
    if (cols) {
      if (!cols[i].hasAttribute('data-rz-w')) cols[i].setAttribute('data-rz-w', cols[i].style.width || '');
      if (cols[i].style.width !== `${w}px`) cols[i].style.width = `${w}px`;
    }
  }
  if (!cols) {
    cellsOf(row).forEach(({ th, idx, span }) => {
      if (span !== 1 || !map[idx]) return;
      th.style.width = `${map[idx]}px`; th.style.minWidth = `${map[idx]}px`; th.style.maxWidth = `${map[idx]}px`;
    });
  }
  table.style.tableLayout = 'fixed';
  table.style.width = `${total}px`;
  table.style.minWidth = '0';
  table.setAttribute('data-rz-on', '');
}

function clear(table, row) {
  table.style.tableLayout = ''; table.style.width = ''; table.style.minWidth = '';
  table.removeAttribute('data-rz-on');
  const cg = [...table.children].find((el) => el.tagName === 'COLGROUP');
  if (cg?.hasAttribute('data-rz')) cg.remove();
  else if (cg) [...cg.children].forEach((c) => { if (c.hasAttribute('data-rz-w')) { c.style.width = c.getAttribute('data-rz-w'); c.removeAttribute('data-rz-w'); } });
  if (row) cellsOf(row).forEach(({ th }) => { th.style.width = ''; th.style.minWidth = ''; th.style.maxWidth = ''; });
}

/* width that fits the longest text in that column */
function fitWidth(table, idx) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;';
  document.body.appendChild(probe);
  let best = MIN;
  const rows = [...table.rows].slice(0, 400);
  rows.forEach((tr) => {
    let c = 0;
    for (const cell of tr.cells) {
      const span = Number(cell.colSpan) || 1;
      if (c === idx && span === 1) {
        const cs = getComputedStyle(cell);
        const span2 = document.createElement('span');
        span2.style.font = cs.font;
        span2.style.fontWeight = cs.fontWeight;
        span2.innerHTML = cell.innerHTML;
        span2.querySelectorAll('.col-rz').forEach((x) => x.remove());
        probe.appendChild(span2);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 14;
        best = Math.max(best, Math.ceil(span2.getBoundingClientRect().width + pad));
        probe.removeChild(span2);
        break;
      }
      c += span;
      if (c > idx) break;
    }
  });
  probe.remove();
  return Math.min(best, 640);
}

export default function ColumnResize() {
  const path = usePathname();
  const off = HIDE_PATHS.some((re) => re.test(path));

  useEffect(() => {
    const main = document.querySelector('main.page') || document.body;
    const cleanAll = () => main.querySelectorAll('.col-rz, .col-rz-reset').forEach((x) => x.remove());
    if (off) { cleanAll(); return undefined; }

    const saveMap = (tid, map) => {
      const all = readAll();
      all[path] = all[path] || {};
      if (map) all[path][tid] = map; else delete all[path][tid];
      writeAll(all);
    };

    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const saved = readAll()[path] || {};
        main.querySelectorAll('table').forEach((table, ti) => {
          if (table.closest(SKIP) || table.classList.contains('tv-cards')) return;
          const row = headerRow(table);
          if (!row || row.cells.length < 2) return;
          const tid = tableId(row, ti);
          table.setAttribute('data-rz-id', tid);
          cellsOf(row).forEach(({ th, idx, span }) => {
            if (span !== 1 || th.classList.contains('corner')) return;
            let h = th.querySelector(':scope > .col-rz');
            if (!h) {
              h = document.createElement('span');
              h.className = 'col-rz no-print';
              h.title = 'Drag to change the column width · double-click to fit';
              h.setAttribute('aria-hidden', 'true');
              th.appendChild(h);
              if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
            }
            h.dataset.idx = String(idx);
          });
          const map = saved[tid];
          const first = row.cells[0];
          let reset = first.querySelector(':scope > .col-rz-reset');
          if (map && Object.keys(map).length) {
            apply(table, row, map);
            if (!reset) {
              reset = document.createElement('button');
              reset.type = 'button';
              reset.className = 'col-rz-reset no-print';
              reset.title = 'Reset column widths of this table';
              reset.setAttribute('aria-label', 'Reset column widths');
              first.appendChild(reset);
              if (getComputedStyle(first).position === 'static') first.style.position = 'relative';
            }
          } else {
            if (table.hasAttribute('data-rz-on')) clear(table, row);
            reset?.remove();
          }
        });
      });
    };

    /* dragging */
    let drag = null;
    const onDown = (e) => {
      const h = e.target.closest?.('.col-rz');
      if (h && main.contains(h)) {
        e.preventDefault(); e.stopPropagation();
        const table = h.closest('table');
        const row = headerRow(table);
        const tid = table.getAttribute('data-rz-id');
        const idx = Number(h.dataset.idx);
        const map = { ...measure(row), ...((readAll()[path] || {})[tid] || {}) };
        drag = { table, row, tid, idx, map, x: e.clientX, w: map[idx] || 80, moved: false };
        h.classList.add('on');
        document.body.classList.add('col-rz-drag');
        try { h.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        return;
      }
      const r = e.target.closest?.('.col-rz-reset');
      if (r && main.contains(r)) {
        e.preventDefault(); e.stopPropagation();
        const table = r.closest('table');
        saveMap(table.getAttribute('data-rz-id'), null);
        clear(table, headerRow(table));
        r.remove();
      }
    };
    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      const w = Math.max(MIN, Math.round(drag.w + (e.clientX - drag.x)));
      if (Math.abs(e.clientX - drag.x) > 2) drag.moved = true;
      drag.map[drag.idx] = w;
      apply(drag.table, drag.row, drag.map);
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.moved) saveMap(drag.tid, drag.map);
      main.querySelectorAll('.col-rz.on').forEach((x) => x.classList.remove('on'));
      document.body.classList.remove('col-rz-drag');
      drag = null;
      run();
    };
    const onDbl = (e) => {
      const h = e.target.closest?.('.col-rz');
      if (!h || !main.contains(h)) return;
      e.preventDefault(); e.stopPropagation();
      const table = h.closest('table');
      const row = headerRow(table);
      const tid = table.getAttribute('data-rz-id');
      const idx = Number(h.dataset.idx);
      const map = { ...measure(row), ...((readAll()[path] || {})[tid] || {}) };
      map[idx] = fitWidth(table, idx);
      saveMap(tid, map);
      apply(table, row, map);
      run();
    };
    // a click on the handle must not reach the header (sorting, filters)
    const onClick = (e) => { if (e.target.closest?.('.col-rz, .col-rz-reset')) { e.preventDefault(); e.stopPropagation(); } };

    run();
    const mo = new MutationObserver(run);
    mo.observe(main, { childList: true, subtree: true });
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('dblclick', onDbl, true);
    document.addEventListener('click', onClick, true);
    return () => {
      mo.disconnect(); cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('dblclick', onDbl, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [off, path]);

  return null;
}
