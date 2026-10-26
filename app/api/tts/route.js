import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Online Urdu voice for browsers that have no Urdu voice built in (for example Chrome on Windows).
// The browser sends one short piece of text, we return an MP3 of it read in Urdu.
export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const text = String(body.text || '').trim().slice(0, 200);
  const lang = ['ur', 'hi', 'en'].includes(body.lang) ? body.lang : 'ur';
  if (!text) return Response.json({ error: 'Nothing to read.' }, { status: 400 });

  // Only logged-in users can use the voice
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: u, error: uErr } = await supa.auth.getUser(token);
  if (uErr || !u?.user) return Response.json({ error: 'Please log in again.' }, { status: 401 });

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Referer: 'https://translate.google.com/'
      },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error(`voice service ${r.status}`);
    const audio = await r.arrayBuffer();
    return new Response(audio, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' }
    });
  } catch (e) {
    console.error('tts error', e);
    return Response.json({ error: 'The Urdu voice is not available right now. Please try again.' }, { status: 502 });
  }
}
