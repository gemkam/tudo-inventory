'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';

const UserCtx = createContext({ isAdmin: false, name: '' });

export function useUser() {
  return useContext(UserCtx);
}

function readUser(session) {
  const u = session?.user;
  if (!u) return null;
  const name = u.user_metadata?.display_name || (u.email || '').split('@')[0];
  return { isAdmin: u.app_metadata?.role === 'admin', name };
}

export default function AuthGate({ children, adminOnly = false }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const supabase = sb();
    supabase.auth.getSession().then(({ data }) => {
      const u = readUser(data.session);
      if (!u) router.replace('/login');
      else setUser(u);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function switchUser() {
    await sb().auth.signOut();
    router.replace('/login');
  }

  if (!user) return <div className="loading">Loading...</div>;

  const nav = [
    ['/', 'Home'],
    ['/log', 'Stock log'],
    ['/bills', 'Bills'],
    ...(user.isAdmin ? [['/settings', 'Settings']] : [])
  ];

  return (
    <UserCtx.Provider value={user}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">Tudo Office Inventory</Link>
          <nav className="topnav">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className={path === href ? 'active' : ''}>{label}</Link>
            ))}
            <span className="who">
              {user.name}{user.isAdmin ? '' : ' (view only)'}
            </span>
            <button className="btn small switch" onClick={switchUser}>Switch user</button>
          </nav>
        </div>
      </header>
      <main className="page">
        {adminOnly && !user.isAdmin
          ? <div className="error">Only Administrator can open this page.</div>
          : children}
      </main>
    </UserCtx.Provider>
  );
}
