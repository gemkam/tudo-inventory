/* Employee salary slip link /s/<token>: its own installable app ("Salary · <name>"). See app/s/[token]/page.js */
const clean = (t) => String(t || '').replace(/[^a-f0-9-]/gi, '').slice(0, 40);

export function generateMetadata({ params }) {
  const t = clean(params.token);
  return {
    title: 'My Salary · Tudo Num',
    manifest: `/s/${t}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: 'My Salary', statusBarStyle: 'default' },
    icons: { apple: '/icons/slip-180.png' }
  };
}

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#13836b' };

export default function SlipLinkLayout({ children }) {
  return children;
}
