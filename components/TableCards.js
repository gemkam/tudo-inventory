'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useViewMode } from '@/lib/viewMode';

/*
  ▦ Table | ▤ Cards switch in the top bar (rendered by components/AuthGate.js) for every page.
  In Cards view, every normal table on the page is shown as cards: one card per row,
  each cell as "Column name ........ value" (labels taken from the table header).
  Works on the editable grids too (tap a value to edit it). Papers (invoice, receipts, salary slip,
  print-only tables) stay as they are. CSS: tv-* at the end of app/globals.css.
*/

const HIDE_PATHS = [/^\/$/, /^\/login/, /^\/entry/, /^\/f\//, /^\/transport\/invoice/, /^\/expenses\/docs/, /^\/transport\/salary\//, /^\/c\//];
const SKIP = '.no-cards, .trip-print, .iv-t, .iv-list, .cd-t, .slip-t, .slip-calc, .pc-sum, .combo-list, .modal, [role="dialog"]';

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

function cardify(table) {
  const labels = headerLabels(table);
  if (!labels) return;
  table.classList.add('tv-cards');
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

function uncardify(root) {
  root.querySelectorAll('table.tv-cards').forEach((t) => t.classList.remove('tv-cards'));
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

export default function TableCards() {
  const path = usePathname();
  const [mode] = useViewMode();
  const off = HIDE_PATHS.some((re) => re.test(path));

  useEffect(() => {
    const main = document.querySelector('main.page');
    if (!main) return undefined;
    if (off || mode !== 'cards') { uncardify(main); return undefined; }
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        main.querySelectorAll('table').forEach((t) => { if (!t.closest(SKIP) && !t.matches(SKIP)) cardify(t); });
      });
    };
    run();
    const mo = new MutationObserver(run);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); uncardify(main); };
  }, [mode, off, path]);

  return null;
}
