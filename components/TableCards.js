'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useViewMode, useTableView, getTableMode, setTableMode, VIEW_EVENT } from '@/lib/viewMode';

/*
  ▦ Table | ▤ Cards.
  - Top bar switch (ViewSwitch, rendered by components/AuthGate.js): the whole page.
  - Per-table switch (4 Nov 2026): every table with a header row gets its own small switch just above it
    (injected here, class tv-tswitch). Its choice wins for that table only; the top bar switch clears them.
    The table id is its header labels, so it stays the same when the rows change.
  - Sections with their own card design (trip sheet, salary sheets, office staff) use <ViewToggle id>
    from this file instead, and their tables sit in .no-cards, so no table ever gets two switches.
  In Cards view a normal table is shown as cards: one card per row, each cell as "Column name ..... value"
  (labels taken from the table header). Works on the editable grids too. Papers (invoice, receipts,
  salary slip, print-only tables) stay as they are. CSS: tv-* in app/globals.css.
*/

const HIDE_PATHS = [/^\/$/, /^\/login/, /^\/entry/, /^\/f\//, /^\/transport\/salary\//, /^\/c\//];
const SKIP = '.no-cards, .trip-print, .iv-t, .cd-t, .slip-t, .slip-calc, .pc-sum, .combo-list, .modal, [role="dialog"], .tbx';

function headerLabels(table) {
  const head = table.tHead;
  if (!head || !head.rows.length) return null;
  // use the header row with the most cells (some tables have a title row above)
  const row = [...head.rows].sort((a, b) => b.cells.length - a.cells.length)[0];
  const labels = [];
  [...row.cells].forEach((th) => {
    const span = Number(th.colSpan) || 1;
    const text = (th.innerText || th.textContent || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < span; i += 1) labels.push(text);
  });
  return labels;
}

function cardify(table, labels) {
  if (!table.classList.contains('tv-cards')) table.classList.add('tv-cards');
  [...table.tBodies, table.tFoot].filter(Boolean).forEach((sec) => {
    [...sec.rows].forEach((tr) => {
      let col = 0;
      [...tr.cells].forEach((td) => {
        const span = Number(td.colSpan) || 1;
        const label = span > 1 && span >= labels.length - 1 ? '' : (labels[col] || '');
        if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label);
        const empty = !td.querySelector('input, select, button, img, svg, a, textarea') && !(td.textContent || '').trim();
        td.classList.toggle('tv-empty', empty && !td.classList.contains('editable'));
        col += span;
      });
    });
  });
}

function uncard(table) { if (table.classList.contains('tv-cards')) table.classList.remove('tv-cards'); }

/* short stable id from the header labels */
function tableId(labels, i) {
  const text = labels.filter(Boolean).join('|') || `t${i}`;
  let h = 0;
  for (let k = 0; k < text.length; k += 1) h = ((h << 5) - h + text.charCodeAt(k)) | 0;
  return `t${(h >>> 0).toString(36)}`;
}

/* the box the switch goes above: the scroll wrapper when it holds only this table */
function boxOf(table) {
  const w = table.parentElement?.closest('.grid-wrap, .table-wrap');
  return w && w.querySelectorAll('table').length === 1 ? w : table;
}

function switchEl(path, id) {
  const el = document.createElement('div');
  el.className = 'tv-tswitch no-print';
  el.setAttribute('data-tvk', id);
  el.innerHTML = '<div class="tv-switch" role="group" aria-label="View of this table">'
    + '<button type="button" data-m="table" title="Show this table as a table">▦<span> Table</span></button>'
    + '<button type="button" data-m="cards" title="Show this table as cards">▤<span> Cards</span></button></div>';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (b) setTableMode(path, id, b.getAttribute('data-m'));
  });
  return el;
}

function markSwitch(el, mode) {
  el.querySelectorAll('button[data-m]').forEach((b) => {
    const on = b.getAttribute('data-m') === mode;
    if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function ViewSwitch() {
  const path = usePathname();
  const [mode, setMode] = useViewMode();
  if (HIDE_PATHS.some((re) => re.test(path))) return null;
  return (
    <div className="tv-switch" role="group" aria-label="View">
      <button type="button" className={mode !== 'cards' ? 'on' : ''} onClick={() => setMode('table')} title="Table view">▦<span> Table</span></button>
      <button type="button" className={mode === 'cards' ? 'on' : ''} onClick={() => setMode('cards')} title="Cards view">▤<span> Cards</span></button>
    </div>
  );
}

/* Switch for a section with its own card design: const [view] = useTableView('trips', 'cards'); <ViewToggle id="trips" def="cards" /> */
export function ViewToggle({ id, def }) {
  const [mode, setMode] = useTableView(id, def);
  return (
    <div className="tv-tswitch no-print">
      <div className="tv-switch" role="group" aria-label="View of this table">
        <button type="button" className={mode !== 'cards' ? 'on' : ''} aria-pressed={mode !== 'cards'} onClick={() => setMode('table')} title="Show as a table">▦<span> Table</span></button>
        <button type="button" className={mode === 'cards' ? 'on' : ''} aria-pressed={mode === 'cards'} onClick={() => setMode('cards')} title="Show as cards">▤<span> Cards</span></button>
      </div>
    </div>
  );
}

export default function TableCards() {
  const path = usePathname();
  const off = HIDE_PATHS.some((re) => re.test(path));

  useEffect(() => {
    const main = document.querySelector('main.page');
    if (!main) return undefined;
    const clean = () => {
      main.querySelectorAll('div.tv-tswitch[data-tvk]').forEach((s) => s.remove());
      main.querySelectorAll('table.tv-cards').forEach(uncard);
    };
    if (off) { clean(); return undefined; }
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const keep = new Set();
        main.querySelectorAll('table').forEach((t, i) => {
          if (t.closest(SKIP) || t.matches(SKIP)) return;
          const labels = headerLabels(t);
          if (!labels || labels.length < 2) return;
          const id = tableId(labels, i);
          const box = boxOf(t);
          let sw = box.previousElementSibling;
          if (!(sw && sw.matches('div.tv-tswitch[data-tvk]'))) { sw = switchEl(path, id); box.parentNode.insertBefore(sw, box); }
          else if (sw.getAttribute('data-tvk') !== id) { const fresh = switchEl(path, id); sw.replaceWith(fresh); sw = fresh; }
          keep.add(sw);
          const mode = getTableMode(path, id);
          markSwitch(sw, mode);
          if (mode === 'cards') cardify(t, labels); else uncard(t);
        });
        // switches left behind by tables that are gone
        main.querySelectorAll('div.tv-tswitch[data-tvk]').forEach((s) => { if (!keep.has(s)) s.remove(); });
      });
    };
    run();
    const mo = new MutationObserver(run);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    window.addEventListener(VIEW_EVENT, run);
    return () => { mo.disconnect(); cancelAnimationFrame(raf); window.removeEventListener(VIEW_EVENT, run); clean(); };
  }, [off, path]);

  return null;
}
