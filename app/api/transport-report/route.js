import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { buildTransportPdf, fmt3, mlabel } from '@/lib/transportReportPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_TO = 'mianrauf.altaf9@gmail.com';

function anon(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {})
  });
}

async function send(note) {
  const key = process.env.CRON_SECRET;
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!key || !user || !pass) {
    return Response.json({ error: 'Email is not set up yet. Add CRON_SECRET, GMAIL_USER and GMAIL_APP_PASSWORD in Vercel, then redeploy.' }, { status: 503 });
  }
  const to = (process.env.REPORT_TO || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);

  const { data, error } = await anon().rpc('report_transport_data', { p_key: key });
  if (error) return Response.json({ error: 'Could not read the transport data.', detail: error.message }, { status: 500 });

  const { pdf, summary: S } = buildTransportPdf(data);
  const last = S.monthTotals[S.monthTotals.length - 1];
  const range = S.months.length ? `${mlabel(S.months[0])} to ${mlabel(S.months[S.months.length - 1])}` : '';
  const stamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Muscat' });

  const text = [
    'Good day,',
    '',
    `Please find attached the full Transport Expense report (${range}).`,
    '',
    last ? `${mlabel(last.month)} (OMR):` : '',
    last ? `Trips: ${last.trips}` : '',
    last ? `Work amount: ${fmt3(last.work)}` : '',
    last ? `Received: ${fmt3(last.received)}` : '',
    last ? `Total expenses: ${fmt3(last.expenses)}` : '',
    last ? `Profit: ${fmt3(last.profit)}` : '',
    '',
    `All months total profit: ${fmt3(S.grand.profit)} OMR`,
    '',
    'This email is sent automatically by Tudo Num Office Systems.'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  const mailer = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await mailer.sendMail({
    from: `Tudo Num Office Systems <${user}>`,
    to,
    subject: `Transport Expense Report · ${stamp}`,
    text,
    attachments: [{ filename: `Transport Expense Report ${stamp}.pdf`, content: pdf, contentType: 'application/pdf' }]
  });
  return Response.json({ ok: true, to, note, bytes: pdf.length });
}

// Vercel Cron (monthly). Vercel sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Not allowed.' }, { status: 401 });
  }
  try { return await send('monthly'); } catch (e) {
    console.error('report email error', e);
    return Response.json({ error: 'Sending failed.', detail: String(e.message || e).slice(0, 400) }, { status: 502 });
  }
}

// "Send now" button for Administrator / Full access
export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });
  const { data: u, error } = await anon(token).auth.getUser(token);
  const role = u?.user?.app_metadata?.role;
  if (error || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });
  if (role !== 'admin' && role !== 'editor') return Response.json({ error: 'You need Full access to send the report.' }, { status: 403 });
  try { return await send('manual'); } catch (e) {
    console.error('report email error', e);
    const msg = String(e.message || e);
    const hint = /535|Username and Password|BadCredentials/i.test(msg) ? ' The Gmail app password is not accepted. Make a new app password and update GMAIL_APP_PASSWORD.' : '';
    return Response.json({ error: `Sending failed.${hint}`, detail: msg.slice(0, 400) }, { status: 502 });
  }
}
