import { createClient } from '@supabase/supabase-js';
import { aiJson } from '@/lib/aiJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
  📥 Import documents for 🏦 Accounts (components/AccImport.js), 4 Nov 2026.
  Body: { text } (Word, PDF text, a sheet without clear headers) or { image: 'data:image/jpeg;base64,...' }
  (photo or scanned page of a bank statement, deposit slip, cheque, receipt, voucher, loan paper, asset list).
  The AI lists every money line it finds. Nothing is saved here: the page shows them to check first.
*/

const PROMPT = `You read money documents of a company group in Oman (Modern City, Abu Wasif, Sumptuosity) for its accounts.
The document can be a bank statement, cash book, petty cash sheet, deposit slip, cheque, payment or receipt voucher,
transfer advice, card statement, loan statement or agreement, asset / vehicle list, capital or partner paper, or a table.
Dates in Oman are day/month/year. Money is Omani Rial (OMR, RO) with up to 3 decimals.
Return ONLY one JSON object, no other text:
{"account":{"bank_name":"bank name if printed","account_no":"account number if printed","holder":"account holder / company name if printed","opening_balance": number or null},
 "lines":[{
  "type": "in | out | asset | liability | equity",
  "date": "YYYY-MM-DD",
  "description": "what it is, short",
  "party": "paid to / received from",
  "ref": "cheque no, reference or voucher no",
  "category": "one of: Customer payment, Sales receipt, Bill payment, Supplier payment, Salary, Driver allowance, Diesel, Rent, Utilities, VAT paid, VAT refund, Bank charges, Owner money in, Owner drawing, Loan received, Loan repayment, Transfer, Other",
  "amount": number (always positive),
  "notes": "anything else useful, short"
 }],
 "warnings": "short note of anything unclear, else empty"}
Rules:
- in = money that came INTO the account (credit, deposit, receipt); out = money that went OUT (debit, withdrawal, payment, cheque paid, charges).
- asset = something the company owns (vehicle, equipment, deposit paid); liability = loan or amount owed; equity = owner / partner capital.
- One line per transaction. Do NOT list opening balance, closing balance, running balance or total rows as lines.
- Never invent values: leave "" or null when not printed.
- If there is nothing with money return {"account":{},"lines":[],"warnings":"no money lines found"}.`;

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
  const image = String(body.image || '');
  const text = String(body.text || '').slice(0, 24000);
  if (image && !/^data:image\/(jpeg|png|webp);base64,/.test(image)) return Response.json({ error: 'This photo type cannot be read.' }, { status: 400 });
  if (!image && !text.trim()) return Response.json({ error: 'Nothing to read in this file.' }, { status: 400 });

  try {
    const out = await aiJson({ prompt: PROMPT, text: image ? '' : `DOCUMENT:\n${text}`, image: image || null, maxTokens: 6000 });
    const lines = (Array.isArray(out.lines) ? out.lines : []).filter((l) => l && Number(String(l.amount ?? '').replace(/[^0-9.]/g, '')) > 0).slice(0, 500);
    return Response.json({ account: out.account && typeof out.account === 'object' ? out.account : {}, lines, warnings: String(out.warnings || '') });
  } catch (e) {
    const msg = e.code === 'NO_KEY' ? 'No AI key is set in Vercel.'
      : e.code === 'BAD_JSON' ? e.message
        : /rate|limit|quota|429/i.test(e.message) ? 'The free AI limit is used up for now. Try again later.'
          : `The AI could not read this file. ${e.message.slice(0, 900)}`;
    return Response.json({ error: msg }, { status: 502 });
  }
}
