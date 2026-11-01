/* Own app manifest for each employee's salary slip link (/s/<token> → "My Salary" icon that opens his slips). */
export const dynamic = 'force-dynamic';

const clean = (t) => String(t || '').replace(/[^a-f0-9-]/gi, '').slice(0, 40);

export async function GET(_req, { params }) {
  const t = clean(params.token);
  let first = '';
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/public_staff_slip`, {
      method: 'POST',
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: t }),
      cache: 'no-store'
    });
    const j = await r.json();
    first = String(j?.name || '').replace(/^(mr|mrs|miss|ms)\.?\s+/i, '').split(/\s+/)[0] || '';
  } catch { /* name is only for the icon label */ }
  const body = {
    name: first ? `${first} Salary · Tudo Num` : 'My Salary · Tudo Num',
    short_name: first ? `${first} Salary` : 'My Salary',
    description: 'My salary slips',
    id: `/s/${t}`,
    start_url: `/s/${t}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#13836b',
    icons: [
      { src: '/icons/slip-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/slip-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/slip-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } });
}
