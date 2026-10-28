/*
  Builds the data the AI assistant reads, and talks to the AI service.
  Server side only (used by app/api/assistant/route.js). Self-contained on purpose.
*/

const n3 = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
};
const amt = (v) => {
  const x = n3(v);
  return Number.isInteger(x) ? String(x) : x.toFixed(3);
};
const mk = (d) => String(d || '').slice(0, 7);
const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const UNIT = { packets: 'Packets', pcs: 'Pieces', roll: 'Rolls', box: 'Box', carton: 'Carton', ream: 'Ream', bottle: 'Bottle', set: 'Set', kg: 'Kg', litre: 'Litre' };
const unit = (u) => UNIT[u] || u || '';
const money = (v) => {
  const x = n3(v);
  if (x <= 0) return '-';
  return `${x.toFixed(3)} OMR`;
};

function today() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Muscat' });
}

/* ---------------- Inventory ---------------- */

export async function inventoryData(supa) {
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const [c, m, b] = await Promise.all([
    supa.from('categories').select('id, name, sort, items(id, name, unit, quantity, min_qty, price, per_pack)').order('sort'),
    supa.from('stock_moves').select('item_id, move_type, qty, note, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(600),
    supa.from('bill_payments').select('amount, paid_on, period, note, bill_accounts(name, payment_type)').order('paid_on', { ascending: false }).limit(100)
  ]);
  const err = c.error || m.error || b.error;
  if (err) throw new Error(err.message);
  return { cats: c.data || [], moves: m.data || [], bills: b.data || [] };
}

export function inventoryContext({ cats, moves, bills }) {
  const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, section: c.name })));
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const thisM = mk(new Date().toISOString());
  const prevD = new Date(); prevD.setDate(1); prevD.setMonth(prevD.getMonth() - 1);
  const lastM = mk(prevD.toISOString());
  const used = (id, month) => n3(moves.filter((x) => x.item_id === id && x.move_type === 'out' && mk(x.created_at) === month).reduce((t, x) => t + Number(x.qty), 0));
  const added = (id, month) => n3(moves.filter((x) => x.item_id === id && x.move_type === 'in' && mk(x.created_at) === month).reduce((t, x) => t + Number(x.qty), 0));

  const lines = [];
  lines.push(`TODAY: ${today()} (Muscat, Oman). Currency OMR. 1 OMR = 1000 Baisa (Bz).`);
  lines.push('');
  lines.push('STOCK (one line per item). Columns: Section | Item | Present stock | Unit | Pieces in 1 packet | Full packets | Minimum | Low? | Price per piece | Stock value | Used this month | Added this month | Used last month');
  items.forEach((i) => {
    const per = Number(i.per_pack) > 1 ? Number(i.per_pack) : 0;
    const packs = per ? `${Math.floor(n3(i.quantity) / per)}${n3(i.quantity) % per ? ` + ${amt(n3(i.quantity) % per)} loose` : ''}` : '-';
    const low = Number(i.min_qty) > 0 && Number(i.quantity) <= Number(i.min_qty) ? 'LOW' : (Number(i.quantity) <= 0 ? 'OUT' : 'ok');
    lines.push([i.section, i.name, amt(i.quantity), unit(i.unit), per || '-', packs, amt(i.min_qty), low, money(i.price), money(n3(i.quantity) * Number(i.price || 0)), used(i.id, thisM), added(i.id, thisM), used(i.id, lastM)].join(' | '));
  });
  const value = n3(items.reduce((t, i) => t + Number(i.quantity) * Number(i.price || 0), 0));
  lines.push(`TOTAL STOCK VALUE: ${money(value)}. ITEMS: ${items.length}. LOW OR OUT: ${items.filter((i) => Number(i.quantity) <= 0 || (Number(i.min_qty) > 0 && Number(i.quantity) <= Number(i.min_qty))).map((i) => i.name).join(', ') || 'none'}.`);
  lines.push('');
  lines.push('STOCK MOVEMENTS (last 120 days, newest first). Columns: Date | Item | In/Out | Qty | Note');
  moves.slice(0, 300).forEach((x) => {
    const it = byId[x.item_id];
    if (!it) return;
    lines.push([String(x.created_at).slice(0, 10), it.name, x.move_type === 'in' ? 'In' : 'Out', `${amt(x.qty)} ${unit(it.unit)}`, x.note || ''].join(' | '));
  });
  if (!moves.length) lines.push('(no movements recorded yet)');
  lines.push('');
  lines.push('BILL PAYMENTS (newest first). Columns: Paid on | Bill | Type | For month | Amount OMR | Note');
  bills.forEach((x) => lines.push([x.paid_on, x.bill_accounts?.name || '', x.bill_accounts?.payment_type || '', x.period || '', amt(x.amount), x.note || ''].join(' | ')));
  if (!bills.length) lines.push('(no bill payments recorded yet)');
  return lines.join('\n');
}

/* ---------------- Transport ---------------- */

const SAL = ['basic', 'room_rent', 'utilities', 'mobile', 'travel_food', 'trip_allowance'];
const payable = (s) => n3(SAL.reduce((t, k) => t + Number(s[k] || 0), 0) - Number(s.advance_deduction || 0) + Number(s.special_allowance || 0));

export async function transportData(supa) {
  const [d, e, s, x] = await Promise.all([
    supa.from('transport_drivers').select('*').order('sort'),
    supa.from('transport_entries').select('*').order('entry_date'),
    supa.from('transport_salaries').select('*').order('month'),
    supa.from('transport_extras').select('*').order('month')
  ]);
  const err = d.error || e.error || s.error || x.error;
  if (err) throw new Error(err.message);
  return { drivers: d.data || [], entries: e.data || [], salaries: s.data || [], extras: x.data || [] };
}

export function transportContext({ drivers, entries, salaries, extras }) {
  const name = (id) => drivers.find((d) => d.id === id)?.name || '?';
  const months = [...new Set([...entries.map((e) => mk(e.entry_date)), ...salaries.map((s) => mk(s.month))])].sort();
  const sum = (list, k) => n3(list.reduce((t, x) => t + Number(x[k] || 0), 0));
  const lines = [];
  lines.push(`TODAY: ${today()} (Muscat, Oman). All amounts are OMR.`);
  lines.push('Company (from the Excel): Modern City for Express Services LLC (Transport Division).');
  lines.push(`DRIVERS: ${drivers.map((d) => `${d.name} (vehicle ${d.vehicle_no || '-'})`).join('; ')}`);
  lines.push('');
  lines.push('MONTHLY SUMMARY (already calculated, use these numbers). Columns: Month | Driver | Trips | Work amount (rent) | Received | Still to collect | Diesel | Toll + exit fee | Maintenance | Salary payable | Other expenses | Total expenses | Profit');
  months.forEach((m) => {
    const rows = drivers.map((d) => {
      const es = entries.filter((e) => e.driver_id === d.id && mk(e.entry_date) === m);
      const sal = salaries.filter((s) => s.driver_id === d.id && mk(s.month) === m).reduce((t, s) => t + payable(s), 0);
      const oth = sum(extras.filter((x) => x.driver_id === d.id && mk(x.month) === m), 'amount');
      const r = { trips: es.filter((e) => Number(e.rent) > 0).length, work: sum(es, 'rent'), rec: sum(es, 'received'), diesel: sum(es, 'diesel'), toll: sum(es, 'toll'), maint: sum(es, 'maintenance'), sal: n3(sal), oth };
      r.due = n3(r.work - r.rec);
      r.exp = n3(r.diesel + r.toll + r.maint + r.sal + r.oth);
      r.profit = n3(r.work - r.exp);
      return { d, r };
    });
    rows.forEach(({ d, r }) => lines.push([monthName(m), d.name, r.trips, amt(r.work), amt(r.rec), amt(r.due), amt(r.diesel), amt(r.toll), amt(r.maint), amt(r.sal), amt(r.oth), amt(r.exp), amt(r.profit)].join(' | ')));
    const t = (k) => n3(rows.reduce((a, x) => a + x.r[k], 0));
    lines.push([monthName(m), 'BOTH DRIVERS', t('trips'), amt(t('work')), amt(t('rec')), amt(t('due')), amt(t('diesel')), amt(t('toll')), amt(t('maint')), amt(t('sal')), amt(t('oth')), amt(t('exp')), amt(t('profit'))].join(' | '));
  });
  lines.push('');
  lines.push('SALARY DETAIL. Columns: Month | Driver | Basic | Room rent | Utilities | Mobile | Travel food | Trip allowance | Advance deducted | Special allowance | Balance payable');
  salaries.forEach((s) => lines.push([monthName(mk(s.month)), name(s.driver_id), ...SAL.map((k) => amt(s[k])), amt(s.advance_deduction), amt(s.special_allowance), amt(payable(s))].join(' | ')));
  lines.push('');
  lines.push('OTHER MONTHLY EXPENSES. Columns: Month | Driver | Description | Amount');
  extras.forEach((x) => lines.push([monthName(mk(x.month)), name(x.driver_id), x.description, amt(x.amount)].join(' | ')));
  if (!extras.length) lines.push('(none)');
  lines.push('');
  lines.push('EVERY TRIP AND EXPENSE ROW. Columns: Date | Driver | From | To | Description | Rent | Received | Balance due | Payment status | Driver allowance | Allowance paid? | Diesel | Toll/other | Maintenance | Status');
  entries.forEach((e) => lines.push([
    e.entry_date, name(e.driver_id), e.from_place || '', e.to_place || '', [e.description, e.cargo, e.consignee].filter(Boolean).join(', '),
    amt(e.rent), amt(e.received), amt(Number(e.rent || 0) - Number(e.received || 0)), e.payment_status || '', amt(e.driver_allowance), e.allowance_status || '',
    amt(e.diesel), amt(e.toll), amt(e.maintenance), e.remarks || ''
  ].join(' | ')));
  return lines.join('\n');
}

/* ---------------- Prompt and AI call ---------------- */

export function systemPrompt(scope, context) {
  const who = scope === 'transport' ? 'Transport Expense assistant' : 'Inventory assistant';
  const topic = scope === 'transport'
    ? 'the transport division: trips, rent (work amount), money received and still to collect, diesel, tolls, maintenance, driver salaries and profit'
    : 'the office inventory (office supplies, kitchen, sanitary items), stock levels, packets and pieces, prices, stock used and added, and bill payments';
  return `You are the ${who} inside the Tudo Num Office Systems. You answer questions about ${topic}, using ONLY the data below.

LANGUAGE RULES (very important):
- Reply in the SAME language and script the user used.
- English question: answer in English.
- Roman Urdu question (Urdu written in English letters, e.g. "sugar kitni baki hai", "Saif ka kitna expense hua"): answer in Roman Urdu, in simple everyday words.
- Urdu script question (اردو): answer in Urdu script.
- Questions often come from a microphone, so words and names can be misheard or misspelled. Match them to the closest name in the data (for example "Self", "Safif", "Saif" all mean the driver Saif Altaf; "Aman", "Amanullah" mean Aman Ullah; "cheeni" means Sugar; "chai" means Tea; "doodh" means Milk powder).

ANSWER RULES:
- Be short: 1 to 5 lines. Lead with the number the user asked for.
- Use the pre-calculated totals in the data. Only add up rows yourself when no total exists, and then do it carefully.
- If the user does not say which month, use the current month (see TODAY) and say which month you used. If the current month has no data, use the latest month that has data and say so.
- Amounts are OMR. Write OMR amounts with 3 decimals (e.g. 0.800 OMR, 1.000 OMR, 1,036.500 OMR).
- Never invent numbers, items, drivers or dates. If something is not in the data, say clearly that it is not recorded.
- You can only read data. If someone asks you to change, add or delete something, tell them to use the Edit button (only Administrator can edit).
- Plain text only. No markdown tables, no ** stars. Short lines or simple dashes are fine.

DATA:
${context}`;
}

/* Group Summary assistant (Rauf). The page sends the summary as text, lang is 'en' or 'ru' (Roman Urdu) */
export function groupPrompt(context, lang) {
  const langRule = lang === 'ru'
    ? 'ALWAYS reply in ROMAN URDU (Urdu written in English letters, e.g. "October mein total kharcha 1,250.500 OMR hai"), even if the question is in English or Urdu script. Use simple everyday words, polite forms (aap, ji, shukriya). Never use Urdu or Hindi script.'
    : 'ALWAYS reply in simple, clear ENGLISH, even if the question is in Roman Urdu or Urdu script.';
  return `You are Rauf, the friendly and polite male AI assistant of Tudo Num Office Systems (Tudo Num Group, Muscat, Oman). You appear on every page of the app.
You have the full picture of the WHOLE APP, not only this page: the WHOLE APP WATCH section covers every module (Office Expense of Modern City, Abu Wasif and Sumptuosity with departments, Transport trips and drivers, vehicle VOC / Mulkiya renewals, PDC cheques and services, unpaid bills, driver allowances not paid, salaries, office utility bills, invoices and payment receipts, budgets, inventory low stock). When present, the GROUP SUMMARY PAGE section has the totals, heads, budgets, cash flow, unpaid bills by age, year on year, alerts and month by month history. On other pages you also get TRANSPORT DETAIL (every trip, monthly summary per driver, salaries) and INVENTORY DETAIL (stock, movements, bill payments). Use ONLY the data below.

PERSONALITY: warm, respectful, calm and professional, like a helpful office assistant. Speak as a man (in Roman Urdu use masculine verbs: "main bata raha hoon", "mujhe lagta hai", "main dekh leta hoon"). Greet back if greeted. Thank politely if thanked. No long speeches.

LANGUAGE: ${langRule}
Questions often come from a microphone, so words can be misheard. Match them to the closest name in the data (e.g. "modern siti" = Modern City, "abu vasif" = Abu Wasif, "sumptuous" = Sumptuosity, "diesal" = Diesel, "kharcha" = spent, "baqaya / udhaar" = unpaid).

ANSWER RULES:
- Short: 1 to 4 sentences, easy to listen to. Lead with the number asked for.
- When asked about alerts, what needs attention, what to pay, what is due or pending, or what to collect: check EVERY part of the WHOLE APP WATCH. Give the most urgent first (overdue, today, this week), with amount, who or what, and the date. Up to 6 short sentences are fine for such a list; then say how many more items there are.
- If the user asks generally "any alerts?" or "kya pending hai?", cover all modules (bills, cheques, renewals, money to collect, allowances, low stock), not only expenses.
- Amounts in OMR with 3 decimals (e.g. 1,036.500 OMR).
- If no month or period is said, use the current month (or what the Group Summary screen shows, when you have it) and say which period.
- For other months use the HISTORY tables.
- Never invent numbers. If something is not in the data, say politely that it is not recorded.
- You can only read. To change data, the user must use the Edit or Budgets buttons.
- Plain text only. No markdown, no stars, no tables, no bullet symbols.
- On the very last line write exactly: NEXT: followed by 2 or 3 short follow-up questions the user might ask next, in the same language as your reply, separated by " | ". Example: NEXT: Which head grew the most? | Show unpaid bills

DATA:
${context}`;
}

export async function askAI(system, messages) {
  const history = messages.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) }));
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;

  const gemini = process.env.GEMINI_API_KEY;
  const mistral = process.env.MISTRAL_API_KEY;
  const openrouter = process.env.OPENROUTER_API_KEY;
  const errs = [];

  // One OpenAI-style provider: try its models in order (a model can be retired or hit its free limit)
  async function tryProvider(url, key, models) {
    for (const model of [...new Set(models.filter(Boolean))]) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, temperature: 0.2, max_tokens: 600, messages: [{ role: 'system', content: system }, ...history] })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) return text;
          errs.push(`${model}: empty answer`);
          continue;
        }
        errs.push(`${model}: ${res.status} ${data?.error?.message || data?.[0]?.error?.message || ''}`.trim());
        if (res.status === 401 || res.status === 403) break; // wrong key, no point trying other models
      } catch (e) {
        errs.push(`${model}: ${e.message}`);
      }
    }
    return null;
  }

  if (groq) {
    const a = await tryProvider('https://api.groq.com/openai/v1/chat/completions', groq, [
      process.env.AI_MODEL, 'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'
    ]);
    if (a) return a;
  }
  // Free backup when the Groq daily limit is used up: OpenRouter free models (about 50 questions a day, key from openrouter.ai/keys)
  if (openrouter) {
    const a = await tryProvider('https://openrouter.ai/api/v1/chat/completions', openrouter, [
      process.env.OPENROUTER_MODEL, 'openrouter/free'
    ]);
    if (a) return a;
  }
  // Next free backup: Mistral (free Experiment plan, key from console.mistral.ai)
  if (mistral) {
    const a = await tryProvider('https://api.mistral.ai/v1/chat/completions', mistral, [
      process.env.MISTRAL_MODEL, 'mistral-small-latest', 'mistral-medium-latest', 'open-mistral-nemo'
    ]);
    if (a) return a;
  }
  // Second free backup: Google Gemini (key from aistudio.google.com)
  if (gemini) {
    const a = await tryProvider('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', gemini, [
      process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'
    ]);
    if (a) return a;
  }
  if (openai) {
    const a = await tryProvider('https://api.openai.com/v1/chat/completions', openai, [process.env.AI_MODEL, 'gpt-4o-mini']);
    if (a) return a;
  }
  if ((groq || openrouter || mistral || gemini || openai) && !anthropic) {
    const e = new Error(errs.join(' | ') || 'AI service error');
    e.code = 'AI_FAIL';
    throw e;
  }

  if (anthropic) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-4-5', max_tokens: 600, temperature: 0.2, system, messages: history })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `AI service error ${res.status}`);
    return (data.content || []).map((c) => c.text || '').join('').trim();
  }

  const err = new Error('NO_KEY');
  err.code = 'NO_KEY';
  throw err;
}
