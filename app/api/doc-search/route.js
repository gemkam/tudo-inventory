import { createClient } from '@supabase/supabase-js';
import { askAI } from '@/lib/assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
  AI Search for the Documents Checklist.
  Body: { query }. Reads doc_checklist as the logged-in user (database rules apply),
  asks the AI which lines match, returns { ids: [...], answer: 'short sentence' }.
*/
const SEC = { employee: 'Employee Docs', car: 'Cars Docs', heavy: 'Heavy Vehicles', govt: 'Govt License', company: 'Company Docs' };

function muscatToday() {
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }); }
  const query = String(body.query || '').trim().slice(0, 300);
  if (!query) return Response.json({ error: 'Type what you are looking for.' }, { status: 400 });

  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: u, error: uErr } = await supa.auth.getUser(token);
  if (uErr || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  const { data: rows, error } = await supa.from('doc_checklist').select('id, section, owner, doc_name, doc_no, issue_date, expiry_date, state, notes').order('sort');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const today = muscatToday();
  const list = (rows || []).map((r, i) => {
    const left = r.expiry_date ? Math.round((new Date(`${r.expiry_date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null;
    const status = r.state ? r.state : left === null ? 'no expiry date' : left < 0 ? `EXPIRED ${-left} days ago` : left <= 30 ? `renew soon, ${left} days left` : `active, ${left} days left`;
    return `${i + 1}|${SEC[r.section]}|${r.owner || '-'}|${r.doc_name || '-'}|No ${r.doc_no || '-'}|issued ${dmy(r.issue_date)}|expires ${dmy(r.expiry_date)}|${status}${r.notes ? `|note: ${r.notes}` : ''}`;
  });

  const system = `You search a company documents checklist. Today is ${dmy(today)} (dd/mm/yyyy).
Each line: number|section|company or vehicle or person|document|document no|issue date|expiry date|status.
The user may write in English, Roman Urdu or Urdu, with spelling mistakes and short forms (MC = Modern City, AW = Abu Wasif, CR = CR Paper, chamber = Chamber of Commerce, mulkiya = registration).
Return ONLY JSON, no other text: {"ids":[line numbers that match],"answer":"one short plain English sentence with the count and what was found"}.
If nothing matches, return {"ids":[],"answer":"Nothing found for ..."}.

LINES:
${list.join('\n')}`;

  try {
    const raw = await askAI(system, [{ role: 'user', content: query }]);
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    let parsed = {};
    try { parsed = JSON.parse(m ? m[0] : '{}'); } catch { parsed = {}; }
    const nums = Array.isArray(parsed.ids) ? parsed.ids.map(Number).filter((n) => n >= 1 && n <= rows.length) : [];
    return Response.json({ ids: [...new Set(nums)].map((n) => rows[n - 1].id), answer: String(parsed.answer || '').slice(0, 300) });
  } catch (e) {
    if (e.code === 'NO_KEY') return Response.json({ error: 'AI Search is not switched on. Administrator: add GROQ_API_KEY in Vercel.' }, { status: 503 });
    const msg = String(e.message || '');
    const reason = /429|rate limit|quota/i.test(msg) ? 'The free AI limit is used up for now. Wait a minute.' : 'Please try again.';
    return Response.json({ error: `AI Search could not answer. ${reason}` }, { status: 502 });
  }
}
