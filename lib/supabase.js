import { createClient } from '@supabase/supabase-js';

let client = null;

export function sb() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return client;
}

export function isLow(item) {
  return Number(item.min_qty) > 0 && Number(item.quantity) <= Number(item.min_qty);
}

export function fmtOMR(n) {
  return 'OMR ' + Number(n || 0).toFixed(3);
}

export function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
