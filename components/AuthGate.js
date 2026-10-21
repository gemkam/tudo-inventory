'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';

const NAV = [
  ['/', 'Home'],
  ['/log', 'Stock log'],
  ['/bills', 'Bills'],
  ['/settings', 'Settings']
];

export default function AuthGate({ children }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = sb();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login');
      else setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function logout() {
    await sb().auth.signOut();
    router.replace('/login');
  }

  if (!ready) return <div className="loading">Loading...</div>;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">Tudo Office Inventory</Link>
          <nav className="topnav">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className={path === href ? 'active' : ''}>{label}</Link>
            ))}
            <button className="link-btn" onClick={logout}>Log out</button>
          </nav>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
