'use client';

import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import RaufPicturePanel from '@/components/RaufPicturePanel';

/*
  Admin hub (31 Oct 2026): one place for the admin tools.
  Opened from the "Admin" button on Home and in the top bar.
  Data entry and Invoices moved back to Home (31 Oct 2026). Full access sees Settings, Timeline, Sitemap. Administrator also sees Users, User activity, Rauf picture.
*/
const TOOLS = [
  ['/users', '👥', 'Users', 'Create users, 4 access levels, online now / last seen', 'owner'],
  ['/activity', '👁', 'User activity', 'Logins, pages opened, buttons pressed, every change (old → new)', 'owner'],
  ['/settings', '⚙️', 'Settings', 'Inventory categories, bills and app settings', 'admin'],
  ['/timeline', '🕒', 'Timeline', 'Everything built and changed in the app, day by day', 'admin'],
  ['/sitemap', '🗺', 'Sitemap', 'Every page of the app as a searchable tree', 'admin'],
];

function AdminPage() {
  const { isOwner } = useUser();
  const list = TOOLS.filter((t) => t[4] === 'admin' || isOwner);
  return (
    <>
      <div className="page-tools"><Link href="/" className="crumb">← Home</Link></div>
      <h1>🛡 Admin</h1>
      <p className="sub">Users, activity, settings and other admin tools in one place.</p>
      <div className="adm-grid">
        {list.map(([href, ico, label, sub]) => (
          <Link key={href} href={href} className="adm-tile">
            <span className="adm-ico" aria-hidden="true">{ico}</span>
            <span className="adm-tx"><b>{label}</b><small>{sub}</small></span>
            <span className="adm-go" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
      {isOwner && <div style={{ marginTop: 22 }}><RaufPicturePanel /></div>}
    </>
  );
}

export default function Page() {
  return <AuthGate ownerOnly><AdminPage /></AuthGate>;
}
