'use client';

import PrintColumns from '@/components/PrintColumns';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import RaufAssistant from '@/components/NoorAssistant';
import { RaufCtx, defaultGreeting } from '@/components/RaufContext';
import ThemeMenu from '@/components/ThemeMenu';
import { startActivity, logPage, endActivity } from '@/lib/activity';

/*
  Access levels (stored in the user's app_metadata.role):
  admin  = Administrator: everything, plus managing users
  editor = Full access: see and edit everything
  viewer = View only
  entry  = Data entry: only the Transport entry form, cannot see saved data
*/
export const ROLES = {
  admin: { label: 'Administrator', short: 'Admin' },
  editor: { label: 'Full access', short: 'Full access' },
  viewer: { label: 'View only', short: 'View only' },
  entry: { label: 'Data entry', short: 'Data entry' }
};

const UserCtx = createContext({ isAdmin: false, isOwner: false, role: '', name: '' });

export function useUser() {
  return useContext(UserCtx);
}

function readUser(session) {
  const u = session?.user;
  if (!u) return null;
  const role = u.app_metadata?.role || 'viewer';
  const name = u.user_metadata?.display_name || (u.email || '').split('@')[0];
  return {
    id: u.id,
    name,
    role,
    isOwner: role === 'admin', // can manage users
    isAdmin: role === 'admin' || role === 'editor', // can edit data (name kept for existing pages)
    canRead: role === 'admin' || role === 'editor' || role === 'viewer',
    isEntry: role === 'entry'
  };
}

export default function AuthGate({ children, adminOnly = false, ownerOnly = false, entryPage = false, wide = false, theme = '' }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState(null);
  const [pageAi, setPageAi] = useState(null);
  const raufValue = useMemo(() => ({ setPageAi }), []);
  const greet = useMemo(() => defaultGreeting(user?.name ? user.name.charAt(0).toUpperCase() + user.name.slice(1) : ''), [user?.name]);

  useEffect(() => {
    if (!theme) return undefined;
    document.body.classList.add(`theme-${theme}`);
    return () => document.body.classList.remove(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    const supabase = sb();
    supabase.auth.getSession().then(({ data }) => {
      const u = readUser(data.session);
      if (!u) router.replace('/login');
      else if (u.isEntry && !entryPage) router.replace('/entry'); // data entry users only see the entry form
      else setUser(u);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router, entryPage]);

  // Activity log for the Administrator (/activity)
  useEffect(() => {
    if (user) startActivity(user);
  }, [user]);

  useEffect(() => {
    if (user && path) logPage(path);
  }, [user, path]);

  async function switchUser() {
    await endActivity('logout');
    await sb().auth.signOut();
    router.replace('/login');
  }

  if (!user) return <div className="loading">Loading...</div>;

  const nav = user.isEntry ? [['/entry', 'Data entry']] : [['/', 'Home']];
  // Phone / tablet: quick buttons next to Home (on Home the alerts list pushes the tiles far down)
  const quick = user.canRead ? [['/transport', '🚚 Transport'], ['/inventory', '📦 Inventory'], ['/expenses', '🧾 Office Expense']] : [];

  let blocked = '';
  if (ownerOnly && !user.isOwner) blocked = 'Only Administrator can open this page.';
  else if (adminOnly && !user.isAdmin) blocked = 'You need Full access to open this page.';

  return (
    <UserCtx.Provider value={user}>
      <RaufCtx.Provider value={raufValue}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={user.isEntry ? '/entry' : '/'} className="brand">Tudo Num Office Systems</Link>
          <nav className="topnav">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}>{label}</Link>
            ))}
            {quick.map(([href, label]) => (
              <Link key={href} href={href} className={`nav-quick${path === href || (path.startsWith(`${href}/`)) ? ' active' : ''}`}>{label}</Link>
            ))}
          </nav>
          <div className="top-user">
            <ThemeMenu />
            <span className="who">
              {user.name} <small className="who-role">· {ROLES[user.role]?.short || user.role}</small>
            </span>
            <button className="btn small switch" onClick={switchUser}>Switch user</button>
          </div>
        </div>
      </header>
      <main className={`page${wide ? ' wide' : ''}`}>
        {blocked ? <div className="error">{blocked}</div> : children}
      </main>
      {user.canRead && !blocked && <PrintColumns />}
      {user.canRead && (
        <RaufAssistant
          context={pageAi?.context || ''}
          greeting={pageAi?.greeting || greet}
          alertCount={pageAi?.alertCount || 0}
          page={path}
          canChangePic={user.isOwner}
        />
      )}
      </RaufCtx.Provider>
    </UserCtx.Provider>
  );
}
