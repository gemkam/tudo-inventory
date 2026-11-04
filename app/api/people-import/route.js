import { createClient } from '@supabase/supabase-js';
import { aiJson } from '@/lib/aiJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
  📥 Import docs for Personnel (components/PeopleImport.js), 4 Nov 2026.
  Body: { text } (Word, PDF text, a sheet without clear headers) or { image: 'data:image/jpeg;base64,...' }
  (photo, scanned PDF page, passport, resident card, staff list), plus { tab } = office | site | drivers | sub.
  The AI lists every person it finds with the boxes below. Nothing is saved here: the page shows them to check first
  and marks doubles in red.
*/

const PROMPT = (tab) => `You read documents from a company in Oman and list the PEOPLE in them (${tab === 'drivers' ? 'drivers' : tab === 'sub' ? 'subcontractors' : 'employees'}).
The document can be a staff list, salary sheet, passport, resident card (Oman civil ID / labour card), visa, contract, CV or a table.
Dates in Oman are day/month/year. Money is Omani Rial (OMR, RO) with up to 3 decimals.
Return ONLY one JSON object, no other text:
{"people":[{
 "name": "full name in English letters as printed",
 "designation": "job / position",
 "company": "employer / sponsor company if printed",
 "company_name": "own company name (for subcontractors)",
 "mobile": "mobile / phone number",
 "passport": "passport number",
 "resident_card": "resident card / civil ID number",
 "resident_card_expiry": "YYYY-MM-DD",
 "visa_expiry": "YYYY-MM-DD",
 "contract": "contract period or end date, short",
 "basic": number or null,
 "allowances": number or null,
 "house_rent": number or null,
 "utilities": number or null,
 "transport_allow": "Yes | No | empty",
 "ticket": "ticket entitlement, short",
 "vehicle_no": "vehicle number for a driver",
 "notes": "anything else useful, short"
}],
"warnings": "short note of anything unclear, else empty"}
Rules: one entry per real person, never invent values (leave "" or null when not printed). A passport or resident card
has ONE person. Do not list company owners, signatures or managers that only sign the paper unless the paper is about them.
If there are no people in the document return {"people":[],"warnings":"no people found"}.`;

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: u, error: uErr } = await supa.auth.getUser(token);
  if (uErr || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'The file is too big to read. Send a smaller one.' }, { status: 400 }); }
  const tab = ['office', 'site', 'drivers', 'sub'].includes(body.tab) ? body.tab : 'office';
  const image = String(body.image || '');
  const text = String(body.text || '').slice(0, 24000);
  if (image && !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return Response.json({ error: 'This photo type cannot be read.' }, { status: 400 });
  if (!image && !text.trim()) return Response.json({ error: 'Nothing to read in this file.' }, { status: 400 });

  try {
    const out = await aiJson({ prompt: PROMPT(tab), text: image ? '' : `DOCUMENT:\n${text}`, image: image || null, maxTokens: 6000 });
    const people = (Array.isArray(out.people) ? out.people : []).filter((p) => p && String(p.name || '').trim()).slice(0, 300);
    return Response.json({ people, warnings: String(out.warnings || '') });
  } catch (e) {
    const msg = e.code === 'NO_KEY' ? 'No AI key is set in Vercel.'
      : e.code === 'BAD_JSON' ? e.message
        : /rate|limit|quota|429/i.test(e.message) ? 'The free AI limit is used up for now. Try again later.'
          : `The AI could not read this file. ${e.message.slice(0, 900)}`;
    return Response.json({ error: msg }, { status: 502 });
  }
}
