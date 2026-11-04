'use client';

import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

/*
  Bills table columns (Kamran 4 Nov 2026): in ✏️ Edit you can rename any column, add your own columns
  and delete the ones you added. Shared by everyone and by all companies' Bills.
  Saved in app_labels key "bills.columns" as JSON { names: { <builtin key>: "New name" }, cols: [{ key, name }] }.
  Values of added columns live in company_docs.extra { <col key>: "text" }.
*/
export const BUILTIN = [
  ['no', 'No.'], ['date', 'Date'], ['party', 'Paid to'], ['receipt_no', 'Receipt No.'], ['vehicle_no', 'Vehicle No.'], ['fuel', 'Fuel'],
  ['sub', 'Subtotal'], ['vat', 'VAT 5%'], ['grand', 'Grand Total'], ['vat_no', 'VAT No.'], ['department', 'Department'], ['paper', 'Bill paper']
];
const DEF = Object.fromEntries(BUILTIN);
const KEY = 'bills.columns';
const EVT = 'tudo-bill-cols-changed';
let cache = null;
let inflight = null;

const blank = () => ({ names: {}, cols: [] });
function clean(c) {
  const out = blank();
  for (const [k, v] of Object.entries(c?.names || {})) { const t = String(v || '').trim(); if (DEF[k] && t && t !== DEF[k]) out.names[k] = t; }
  const seen = new Set();
  for (const x of c?.cols || []) {
    const name = String(x?.name || '').trim();
    if (!x?.key || !name || seen.has(x.key)) continue;
    seen.add(x.key); out.cols.push({ key: String(x.key), name });
  }
  return out;
}

function fetchCfg() {
  if (!inflight) {
    inflight = sb().from('app_labels').select('label').eq('key', KEY).maybeSingle()
      .then(({ data }) => { try { return clean(JSON.parse(data?.label || '{}')); } catch { return blank(); } })
      .catch(() => blank())
      .finally(() => setTimeout(() => { inflight = null; }, 30000));
  }
  return inflight;
}

export async function saveBillCols(cfg) {
  const c = clean(cfg);
  const { error } = await sb().from('app_labels').upsert({ key: KEY, label: JSON.stringify(c), updated_at: new Date().toISOString() });
  if (error) return { error: error.code === '42501' ? 'You need edit rights to change the columns.' : error.message };
  cache = c;
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: c })); } catch { /* ignore */ }
  return { ok: true, cfg: c };
}

export const newColKey = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function useBillColumns() {
  const [cfg, setCfg] = useState(cache || blank());
  useEffect(() => {
    let live = true;
    fetchCfg().then((c) => { if (live) { cache = c; setCfg(c); } });
    const on = (e) => setCfg(e.detail);
    window.addEventListener(EVT, on);
    return () => { live = false; window.removeEventListener(EVT, on); };
  }, []);
  const label = useCallback((k) => cfg.names[k] || DEF[k] || k, [cfg]);
  return { cfg, cols: cfg.cols, label, save: saveBillCols };
}
