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

export function setViewMode(path, mode) {
  const all = readAll();
  all[pageKey(path)] = mode;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVT));
}

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
