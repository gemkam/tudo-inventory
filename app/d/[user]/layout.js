/* Personal driver link /d/<username>: its own installable app ("Saif Trips"). See app/d/[user]/page.js */
const nice = (u) => String(u || 'driver').replace(/[^a-z0-9._-]/gi, '').toLowerCase().slice(0, 30) || 'driver';
const cap = (u) => u.charAt(0).toUpperCase() + u.slice(1);

export function generateMetadata({ params }) {
  const u = nice(params.user);
  return {
    title: `${cap(u)} Trips · Tudo Num`,
    manifest: `/d/${u}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: `${cap(u)} Trips`, statusBarStyle: 'default' },
    icons: { apple: '/icons/trips-180.png' }
  };
}

export default function DriverLinkLayout({ children }) {
  return children;
}
