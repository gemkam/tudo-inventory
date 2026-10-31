'use client';

import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

/*
  Names of the boxes on the driver trip form (/entry). The Administrator can rename any of them
  (✏️ Rename boxes); saved for everyone in table app_labels as "entry.<key>". Empty = back to the standard name.
*/
export const ENTRY_LABELS = {
  entry_date: 'Date', from_place: 'From', to_place: 'To', rent: 'Total rent', driver_allowance: 'Driver allowance',
  diesel: 'Diesel', toll: 'Toll / others', gate_pass: 'Gate pass', exit_fee: 'Exit fee',
  empty_border_fee: 'Empty container fee at the border', container_wash: 'Container wash', vehicle_wash: 'Vehicle wash',
  delivery_order: 'Delivery order',
  received: 'Received', received_date: 'Received on', payment_status: 'Payment', allowance_status: 'Driver allowance status',
  vat_included: 'VAT 5% added', maintenance: 'Maintenance', description: 'Description', remarks: 'Trip status', credit_in: 'Payment credit in',
  _driver_part: 'Trip (driver fills)', _office_part: 'Office (Administrator only)'
};

export function useEntryLabels() {
  const [map, setMap] = useState({});
  useEffect(() => {
    sb().from('app_labels').select('key, label').like('key', 'entry.%')
      .then(({ data }) => setMap(Object.fromEntries((data || []).map((r) => [r.key.slice(6), r.label]))))
      .catch(() => {});
  }, []);
  const label = useCallback((k) => map[k] || ENTRY_LABELS[k] || k, [map]);
  const rename = useCallback(async (k, text) => {
    const t = String(text || '').trim();
    if (label(k) === t) return null;
    const res = t && t !== ENTRY_LABELS[k]
      ? await sb().from('app_labels').upsert({ key: `entry.${k}`, label: t, updated_at: new Date().toISOString() })
      : await sb().from('app_labels').delete().eq('key', `entry.${k}`);
    if (res.error) return res.error.message;
    setMap((m) => { const n = { ...m }; if (t && t !== ENTRY_LABELS[k]) n[k] = t; else delete n[k]; return n; });
    return null;
  }, [label]);
  return { label, rename };
}
