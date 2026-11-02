import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
  📥 Import documents (All Companies > Invoices / Payment receipts, app/expenses/docs/page.js).
  Body: { image: 'data:image/jpeg;base64,...', kind: 'invoice'|'receipt', company }.
  The page shrinks each photo / PDF page to a JPEG first. A vision AI reads the paper and returns JSON:
  the main fields for the receipt form + EVERY other label printed on the paper (TXN ID, Ticket, TID,
  Date of supply, Date of payment, Time, User, Pump No., VEH No. = vehicle number, product, quantity, price ...).
  Order of AI services (each only if its key is set in Vercel): Groq qwen/qwen3.8-27b (Llama 4 vision models were removed from Groq) -> OpenRouter -> Mistral -> OpenAI -> Anthropic.
  Nothing is saved here: the page shows the result to check and edit before Save.
*/

const PROMPT = `You read photos of bills, invoices, fuel receipts and payment receipts from Oman (English and Arabic).
Currency is Omani Rial (OMR, RO, R.O., ر.ع) with 3 decimals (1 OMR = 1000 baisa). Dates in Oman are day/month/year.
Glossary:
- MOGAS 95, M95, Mogas Super, Super = PETROL (super). MOGAS 91, M91, Regular = PETROL (regular). Gasoil, Diesel = DIESEL.
- VEH, VEH No, Vehicle No, Plate = vehicle number (Oman plates look like 1234 AB).
- TXN, TXN ID, Trans No = transaction id. TID = terminal id. MID = merchant id. Ticket / Ticket No = ticket number.
- Pump, Pump No, Nozzle = pump number. User / Cashier / Attendant = the person at the counter.
- Qty in L or Ltr = litres. Unit price = price per litre.
- "Inclusive" / "incl. VAT" means the amounts already contain VAT 5%. "Exclusive" means VAT is added on top.
Return ONLY one JSON object, no other text, in this exact shape:
{
 "doc_type": "fuel receipt | invoice | tax invoice | payment receipt | bill | other",
 "vendor": "shop or company that issued the paper",
 "vendor_details": "branch, address, phone (short)",
 "vendor_vat": "VAT / VATIN number of the issuer or empty",
 "doc_no": "invoice or receipt or bill number (empty if none)",
 "date": "YYYY-MM-DD of the payment or invoice",
 "time": "HH:MM or empty",
 "payment_method": "Cash | Card | Bank Transfer | Cheque | PDC | empty",
 "vehicle_no": "vehicle number if printed, else empty",
 "items": [{"desc": "plain English, e.g. Petrol (MOGAS 95)", "qty": number or null, "unit": "L or pcs or empty", "unit_price": number or null, "amount": number}],
 "vat_mode": "inclusive | exclusive | none",
 "vat_pct": 5 or 0,
 "subtotal_excl_vat": number,
 "vat_amount": number,
 "total": number,
 "cash_given": number or null,
 "change": number or null,
 "fields": [{"label": "label exactly as printed", "value": "value as printed"}],
 "is_fuel": true or false,
 "confidence": "high | medium | low",
 "warnings": "short note of anything unclear, blurred or not matching, else empty"
}
Rules: "fields" must list EVERY label and value printed on the paper (TXN ID, Ticket, TID, MID, Date of supply, Date of payment, Time, User, Pump No, VEH No, Product, Quantity, Price, Amount, Cash, VAT, Total, card last 4 digits, approval code, etc.), even if also used above.
Numbers are plain numbers (5.000 -> 5, 0.239 -> 0.239), never text. Do not invent values: if you cannot read something, leave it empty and say so in warnings.
If the paper is not a bill, invoice or receipt, return {"doc_type":"other","warnings":"not a bill or receipt"}.`;

async function openaiStyle(url, key, models, image, errs) {
  for (const model of [...new Set(models.filter(Boolean))]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0, max_tokens: 6000,
          messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: image } }] }]
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = data.choices?.[0]?.message?.content;
        const t = Array.isArray(text) ? text.map((x) => x.text || '').join('') : String(text || '');
        if (t.trim()) return { text: t, model };
        errs.push(`${model}: empty answer`);
        continue;
      }
      errs.push(`${model}: ${res.status} ${data?.error?.message || ''}`.trim());
      if (res.status === 401) break;
    } catch (e) {
      errs.push(`${model}: ${e.message}`);
    }
  }
  return null;
}

async function readImage(image) {
  const errs = [];
  const env = process.env;
  if (env.GROQ_API_KEY) {
    const a = await openaiStyle('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY,
      [env.OCR_MODEL, 'qwen/qwen3.8-27b'], image, errs);
    if (a) return a;
  }
  if (env.OPENROUTER_API_KEY) {
    const a = await openaiStyle('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY,
      [env.OPENROUTER_OCR_MODEL, 'qwen/qwen2.5-vl-72b-instruct:free', 'google/gemma-3-27b-it:free', 'meta-llama/llama-4-maverick:free', 'openrouter/free'], image, errs);
    if (a) return a;
  }
  if (env.MISTRAL_API_KEY) {
    const a = await openaiStyle('https://api.mistral.ai/v1/chat/completions', env.MISTRAL_API_KEY,
      ['pixtral-large-latest', 'mistral-small-latest', 'pixtral-12b-2409'], image, errs);
    if (a) return a;
  }
  if (env.OPENAI_API_KEY) {
    const a = await openaiStyle('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY, ['gpt-4o-mini'], image, errs);
    if (a) return a;
  }
  if (env.ANTHROPIC_API_KEY) {
    const m = String(image).match(/^data:(image\/\w+);base64,(.+)$/);
    if (m) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5', max_tokens: 2000, temperature: 0,
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: PROMPT }] }]
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return { text: (data.content || []).map((c) => c.text || '').join(''), model: 'claude-haiku-4-5' };
        errs.push(`claude: ${res.status} ${data?.error?.message || ''}`);
      } catch (e) { errs.push(`claude: ${e.message}`); }
    }
  }
  const e = new Error(errs.length ? errs.join(' | ') : 'No AI key is set in Vercel.');
  e.code = errs.length ? 'AI_FAIL' : 'NO_KEY';
  throw e;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(x) ? x : null;
};
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

function isoDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // day/month/year (Oman)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}

function clean(p) {
  const items = (Array.isArray(p.items) ? p.items : []).map((i) => ({
    desc: String(i.desc || '').trim(), qty: num(i.qty), unit: String(i.unit || '').trim(), unit_price: num(i.unit_price), amount: num(i.amount)
  })).filter((i) => i.desc || i.amount !== null);
  let total = num(p.total);
  let vat = num(p.vat_amount);
  let sub = num(p.subtotal_excl_vat);
  const mode = ['inclusive', 'exclusive', 'none'].includes(p.vat_mode) ? p.vat_mode : (vat ? 'inclusive' : 'none');
  if (total === null && items.length) total = r3(items.reduce((t, i) => t + (i.amount || 0), 0) + (mode === 'exclusive' ? vat || 0 : 0));
  if (sub === null && total !== null) sub = r3(total - (vat || 0));
  if (vat === null && sub !== null && total !== null) vat = r3(total - sub);
  return {
    doc_type: String(p.doc_type || 'other'),
    vendor: String(p.vendor || '').trim(),
    vendor_details: String(p.vendor_details || '').trim(),
    vendor_vat: String(p.vendor_vat || '').trim(),
    doc_no: String(p.doc_no || '').trim(),
    date: isoDate(p.date),
    time: String(p.time || '').trim(),
    payment_method: String(p.payment_method || '').trim(),
    vehicle_no: String(p.vehicle_no || '').trim(),
    items,
    vat_mode: mode,
    vat_pct: vat && vat > 0 ? 5 : 0,
    subtotal_excl_vat: sub,
    vat_amount: vat,
    total,
    cash_given: num(p.cash_given),
    change: num(p.change),
    fields: (Array.isArray(p.fields) ? p.fields : []).map((f) => ({ label: String(f.label || '').trim(), value: String(f.value ?? '').trim() })).filter((f) => f.label || f.value).slice(0, 60),
    is_fuel: !!p.is_fuel || items.some((i) => /petrol|diesel|mogas|gasoil/i.test(i.desc)),
    confidence: String(p.confidence || ''),
    warnings: String(p.warnings || '').trim()
  };
}

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: u, error: uErr } = await supa.auth.getUser(token);
  if (uErr || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'The file is too big to read. Send a smaller photo.' }, { status: 400 }); }
  const image = String(body.image || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return Response.json({ error: 'Only photos and PDFs can be read.' }, { status: 400 });

  try {
    const { text, model } = await readImage(image);
    const m = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = JSON.parse(m ? m[0] : '{}'); } catch { return Response.json({ error: 'The AI answer could not be read. Try again or use a clearer photo.' }, { status: 502 }); }
    return Response.json({ data: clean(parsed), model });
  } catch (e) {
    const msg = e.code === 'NO_KEY' ? 'No AI key with photo reading is set in Vercel.'
      : /rate|limit|quota|429/i.test(e.message) ? 'The free AI limit is used up for now. Try again later.'
        : `The AI could not read this file. ${e.message.slice(0, 900)}`;
    return Response.json({ error: msg }, { status: 502 });
  }
}
