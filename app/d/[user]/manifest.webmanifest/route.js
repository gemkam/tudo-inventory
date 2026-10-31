/* Own app manifest for each driver's link (/d/saif → "Saif Trips" icon that opens /d/saif, then his form). */
export const dynamic = 'force-dynamic';

const nice = (u) => String(u || 'driver').replace(/[^a-z0-9._-]/gi, '').slice(0, 30) || 'driver';
const cap = (u) => u.charAt(0).toUpperCase() + u.slice(1);

export async function GET(_req, { params }) {
  const u = nice(params.user).toLowerCase();
  const body = {
    name: `${cap(u)} Trips · Tudo Num`,
    short_name: `${cap(u)} Trips`,
    description: 'Driver trip form',
    id: `/d/${u}`,
    start_url: `/d/${u}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#13836b',
    icons: [
      { src: '/icons/trips-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/trips-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/trips-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } });
}
