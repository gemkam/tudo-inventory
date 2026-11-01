/*
  Salary Credited (1 Nov 2026): table salary_credits (person_kind staff|driver, person_id, month 'YYYY-MM', amount, paid_at, paid_by).
  Used by Personnel (column "Salary Credited" + "All ... Salary Paid") and All Companies > 💰 Salary.
  Marking paid also approves that person's draft slip of the month (it then shows in his app) and tells his phone.
*/
import { sb } from '@/lib/supabase';

export const creditKey = (kind, id) => `${kind}:${id}`;

export async function notifySlips(ids) {
  if (!ids.length) return 0;
  try {
    const { data } = await sb().auth.getSession();
    const r = await fetch('/api/slip-push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` }, body: JSON.stringify({ ids }) });
    const j = await r.json().catch(() => ({}));
    return j.sent || 0;
  } catch { return 0; }
}

export async function loadCredits(month) {
  const { data } = await sb().from('salary_credits').select('*').eq('month', month);
  return Object.fromEntries((data || []).map((c) => [creditKey(c.person_kind, c.person_id), c]));
}

/* people: [{ kind, id, amount }] → { error, approved, sent } */
export async function markPaid(people, month, me) {
  if (!people.length) return { approved: 0, sent: 0 };
  const now = new Date().toISOString();
  const rows = people.map((p) => ({ person_kind: p.kind, person_id: p.id, month, amount: p.amount ?? null, paid_at: now, paid_by: me || null }));
  const { error } = await sb().from('salary_credits').upsert(rows, { onConflict: 'person_kind,person_id,month' });
  if (error) return { error: error.message };
  // approve their draft slips of this month
  const { data: drafts } = await sb().from('salary_slips').select('id, person_kind, person_id').eq('month', month).eq('status', 'draft')
    .in('person_id', people.map((p) => p.id));
  const ids = (drafts || []).filter((d) => people.some((p) => p.id === d.person_id && p.kind === d.person_kind)).map((d) => d.id);
  if (ids.length) await sb().from('salary_slips').update({ status: 'approved', approved_at: now, approved_by: me || null }).in('id', ids);
  const sent = await notifySlips(ids);
  return { approved: ids.length, sent };
}

export async function unmarkPaid(kind, id, month) {
  const { error } = await sb().from('salary_credits').delete().eq('person_kind', kind).eq('person_id', id).eq('month', month);
  return error ? error.message : '';
}
