'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/*
  Table / Cards view switch (top bar ▦ Table | ▤ Cards). Saved per page on this device (localStorage "tudo-view").
  Pages with their own card design (trip sheet, salary sheets, office staff) call useViewMode('cards')
  so Cards is their default; every other page defaults to Table and its tables are turned into cards
  by components/TableCards.js.
*/

const KEY = 'tudo-view';
const EVT = 'tudo-view-change';
const defaults = {}; // page key -> default mode registered by the page

/* /transport/3f2a...-uuid -> /transport/:id so all drivers share one choice */
export const pageKey = (path) => String(path || '/').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function getViewMode(path, def) {
  const k = pageKey(path);
  return readAll()[k] || defaults[k] || def || 'table';
}

/* Top bar switch: sets the whole page and clears the per-table choices of that page */
export function setViewMode(path, mode) {
  const all = readAll();
  const k = pageKey(path);
  all[k] = mode;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  const t = readTables();
  if (t[k]) { delete t[k]; try { localStorage.setItem(TKEY, JSON.stringify(t)); } catch { /* ignore */ } }
  window.dispatchEvent(new Event(EVT));
}

/*
  Per-table switch (4 Nov 2026): every table has its own ▦ Table | ▤ Cards above it.
  Saved per page per table on this device (localStorage "tudo-view-t" {page: {tableId: mode}}).
  No choice for a table = the page choice (top bar).
*/
const TKEY = 'tudo-view-t';
function readTables() {
  try { return JSON.parse(localStorage.getItem(TKEY) || '{}') || {}; } catch { return {}; }
}
export function getTableMode(path, id, def) {
  return readTables()[pageKey(path)]?.[id] || getViewMode(path, def);
}
export function setTableMode(path, id, mode) {
  const t = readTables();
  const k = pageKey(path);
  t[k] = { ...(t[k] || {}), [id]: mode };
  try { localStorage.setItem(TKEY, JSON.stringify(t)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVT));
}
export const VIEW_EVENT = EVT;

export function useViewMode(def) {
  const path = usePathname();
  const [mode, setMode] = useState(def || 'table');
  useEffect(() => {
    const k = pageKey(path);
    if (def && defaults[k] !== def) { defaults[k] = def; window.dispatchEvent(new Event(EVT)); }
    const f = () => setMode(getViewMode(path, def));
    f();
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, [path, def]);
  const set = useCallback((m) => setViewMode(path, m), [path]);
  return [mode, set];
}

/* One section with its own card design (trip sheet, salary sheets, office staff): [mode, set] for that section only.
   Also registers def as the page default, like useViewMode(def). */
export function useTableView(id, def) {
  const path = usePathname();
  const [pageMode] = useViewMode(def);
  const [mode, setMode] = useState(pageMode);
  useEffect(() => {
    const f = () => setMode(getTableMode(path, id, def));
    f();
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, [path, id, def, pageMode]);
  const set = useCallback((m) => setTableMode(path, id, m), [path, id]);
  return [mode, set];
}
