'use client';

import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { DEPARTMENTS } from '@/lib/expenses';

/*
  Department list per company (Kamran 4 Nov 2026). Saved for everyone in table app_labels,
  key "dept.<company>", label = JSON array of names. Nothing saved yet = the standard list
  (DEPARTMENTS in lib/expenses.js, always with Admin / Office and Construction).
  A new name typed in a bill is added to the list by itself.
*/
const EVT = 'tudo-dept-changed';
const cache = {};

export function defaultDepts(co) {
  const base = DEPARTMENTS[co] || [];
  const out = ['Admin / Office', 'Construction', ...base];
  return [...new Set(out)];
}

const clean = (arr) => {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const t = String(x || '').trim().replace(/\s+/g, ' ');
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
};

async function fetchList(co) {
  const { data, error } = await sb().from('app_labels').select('label').eq('key', `dept.${co}`).maybeSingle();
  if (error || !data?.label) return defaultDepts(co);
  try { const arr = clean(JSON.parse(data.label)); return arr.length ? arr : defaultDepts(co); } catch { return defaultDepts(co); }
}

export async function saveDepts(co, list) {
  const arr = clean(list);
  const { error } = await sb().from('app_labels').upsert({ key: `dept.${co}`, label: JSON.stringify(arr), updated_at: new Date().toISOString() });
  if (error) return { error: error.code === '42501' ? 'You need edit rights to change the list.' : error.message };
  cache[co] = arr;
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { co, list: arr } })); } catch { /* ignore */ }
  return { ok: true, list: arr };
}

/* Adds one name if it is not in the list yet (used when a bill is saved with a new department). */
export async function addDept(co, name) {
  const t = String(name || '').trim();
  if (!co || !t) return { ok: true };
  const cur = cache[co] || (await fetchList(co));
  if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return { ok: true };
  return saveDepts(co, [...cur, t]);
}

export function useDepartments(co) {
  const [list, setList] = useState(() => (co && cache[co]) || defaultDepts(co));

  useEffect(() => {
    if (!co) return undefined;
    let live = true;
    setList(cache[co] || defaultDepts(co));
    fetchList(co).then((arr) => { if (live) { cache[co] = arr; setList(arr); } }).catch(() => {});
    const on = (e) => { if (e.detail?.co === co) setList(e.detail.list); };
    window.addEventListener(EVT, on);
    return () => { live = false; window.removeEventListener(EVT, on); };
  }, [co]);

  const save = useCallback((arr) => saveDepts(co, arr), [co]);
  const add = useCallback((name) => addDept(co, name), [co]);
  return { list, save, add };
}
