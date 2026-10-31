import { createClient } from '@supabase/supabase-js';

let client = null;
let appRole = '';

/* AuthGate tells us the access level. Data entry users cannot delete (the database refuses it silently),
   so a delete from them answers at once with a clear message instead of looking done. */
export function setAppRole(role) { appRole = role || ''; }
const NO_DELETE = { data: null, error: { message: 'Data entry cannot delete. Ask a Full access user or the Administrator.' }, count: 0, status: 403 };
function noDeleteBuilder() {
  const b = { then: (res, rej) => Promise.resolve(NO_DELETE).then(res, rej) };
  ['eq', 'neq', 'in', 'is', 'match', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'select', 'single', 'maybeSingle', 'order', 'limit'].forEach((k) => { b[k] = () => b; });
  return b;
}

export function sb() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const from = client.from.bind(client);
    client.from = (table) => {
      const q = from(table);
      const del = q.delete.bind(q);
      q.delete = (...args) => (appRole === 'entry' ? noDeleteBuilder() : del(...args));
      return q;
    };
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
