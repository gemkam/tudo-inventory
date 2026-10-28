'use client';

import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { SALARY_FIELDS } from '@/lib/transport';

/*
  Row names the user can rename in Edit mode (table app_labels, shared by everyone).
  Salary rows use keys "salary.<field>", e.g. salary.basic, salary.trip_allowance, salary._payable.
*/
export const SALARY_EXTRA_LABELS = [
  ['_total', 'Total'],
  ['advance_deduction', 'Advance deduction'],
  ['special_allowance', 'Special allowance'],
  ['_payable', 'Balance payable']
];
const DEFAULTS = Object.fromEntries([...SALARY_FIELDS, ...SALARY_EXTRA_LABELS]);

export function useSalaryLabels() {
  const [map, setMap] = useState({});

  useEffect(() => {
    sb().from('app_labels').select('key, label').like('key', 'salary.%')
      .then(({ data }) => setMap(Object.fromEntries((data || []).map((r) => [r.key.slice(7), r.label]))))
      .catch(() => {});
  }, []);

  const label = useCallback((k) => map[k] || DEFAULTS[k] || k, [map]);

  // empty text = back to the standard name
  const rename = useCallback(async (k, text) => {
    const t = String(text || '').trim();
    if ((map[k] || DEFAULTS[k]) === t) return { ok: true };
    const res = t && t !== DEFAULTS[k]
      ? await sb().from('app_labels').upsert({ key: `salary.${k}`, label: t, updated_at: new Date().toISOString() })
      : await sb().from('app_labels').delete().eq('key', `salary.${k}`);
    if (res.error) return { error: res.error.message };
    setMap((m) => { const next = { ...m }; if (t && t !== DEFAULTS[k]) next[k] = t; else delete next[k]; return next; });
    return { ok: true };
  }, [map]);

  const fields = SALARY_FIELDS.map(([k]) => [k, label(k)]);
  return { label, rename, fields };
}
