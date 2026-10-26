import { createClient } from '@supabase/supabase-js';
import { inventoryData, inventoryContext, transportData, transportContext, systemPrompt, askAI } from '@/lib/assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }
  const scope = body.scope === 'transport' ? 'transport' : 'inventory';
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && m.content) : [];
  if (!messages.length) return Response.json({ error: 'Type or say a question.' }, { status: 400 });

  // Read the data as the logged-in user, so the database rules still apply
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: u, error: uErr } = await supa.auth.getUser(token);
  if (uErr || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  try {
    const context = scope === 'transport' ? transportContext(await transportData(supa)) : inventoryContext(await inventoryData(supa));
    const answer = await askAI(systemPrompt(scope, context), messages);
    return Response.json({ answer: answer || 'Sorry, I could not find an answer.' });
  } catch (e) {
    if (e.code === 'NO_KEY') {
      return Response.json({ error: 'The assistant is not switched on yet. Administrator: add GROQ_API_KEY in Vercel, then redeploy.' }, { status: 503 });
    }
    console.error('assistant error', e);
    return Response.json({ error: 'The assistant could not answer right now. Please try again.' }, { status: 502 });
  }
}
