import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { VAPID_PUBLIC } from '@/lib/push';

/*
  POST /api/slip-push { ids: [salary_slips.id] } with the office user's login (Authorization: Bearer <token>).
  Sends "Your salary slip is ready" to the phones of those employees that turned on notifications in their
  shortcut (/s/<token>). Reading the subscriptions needs Full access (RLS can_write); the private notification
  key is read with CRON_SECRET (RPC push_private_key). Dead phones (410 / 404) are removed.
*/
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTH = (k) => { const [y, m] = String(k).split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Login needed' }, { status: 401 });
  const { ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.length) return Response.json({ sent: 0 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: key } = await db.rpc('push_private_key', { p_key: process.env.CRON_SECRET || '' });
  if (!key) return Response.json({ sent: 0, error: 'Notifications key not readable (CRON_SECRET)' });
  webpush.setVapidDetails('mailto:kzstech000@gmail.com', VAPID_PUBLIC, key);

  const { data: slips, error } = await db.from('salary_slips').select('id, person_kind, person_id, month, version, status').in('id', ids.slice(0, 500));
  if (error) return Response.json({ sent: 0, error: error.message }, { status: 403 });
  const ok = (slips || []).filter((s) => s.status === 'approved');
  const staffIds = ok.filter((s) => s.person_kind === 'staff').map((s) => s.person_id);
  const drvIds = ok.filter((s) => s.person_kind === 'driver').map((s) => s.person_id);
  const [a, b] = await Promise.all([
    staffIds.length ? db.from('exp_staff').select('id, slip_token').in('id', staffIds) : { data: [] },
    drvIds.length ? db.from('transport_drivers').select('id, slip_token').in('id', drvIds) : { data: [] }
  ]);
  const tokenOf = Object.fromEntries([...(a.data || []), ...(b.data || [])].map((p) => [p.id, String(p.slip_token)]));
  const slipOf = Object.fromEntries(ok.map((s) => [tokenOf[s.person_id], s]));
  const tokens = Object.keys(slipOf).filter(Boolean);
  if (!tokens.length) return Response.json({ sent: 0 });
  const { data: subs } = await db.from('slip_push_subs').select('endpoint, token, sub').in('token', tokens);

  let sent = 0;
  const dead = [];
  await Promise.all((subs || []).map(async (row) => {
    const s = slipOf[row.token];
    const payload = JSON.stringify({
      title: s.version > 1 ? 'Salary slip revised' : 'Salary slip ready',
      body: `Your ${MONTH(s.month)} salary slip is ${s.version > 1 ? 'updated' : 'ready'}. Tap to open.`,
      url: `/s/${row.token}`
    });
    try { await webpush.sendNotification(row.sub, payload, { TTL: 60 * 60 * 24 * 7 }); sent += 1; } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(row.endpoint); }
  }));
  if (dead.length) await db.from('slip_push_subs').delete().in('endpoint', dead);
  return Response.json({ sent });
}
