'use client';

import TableCards, { ViewSwitch } from '@/components/TableCards';
import Breadcrumbs from '@/components/Breadcrumbs';
import TransportSideNav, { showTransportSide } from '@/components/TransportSideNav';
import ExpenseSideNav, { showExpenseSide } from '@/components/ExpenseSideNav';
import PrintColumns from '@/components/PrintColumns';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sb, setAppRole } from '@/lib/supabase';
import RaufAssistant from '@/components/NoorAssistant';
import { RaufCtx, defaultGreeting } from '@/components/RaufContext';
import ThemeMenu from '@/components/ThemeMenu';
import OfficeTabs from '@/components/OfficeTabs';
import BackToTop from '@/components/BackToTop';
import { startActivity, logPage, endActivity } from '@/lib/activity';

/*
  Access levels (stored in the user's app_metadata.role):
  admin  = Administrator: everything, plus managing users
  editor = Full access: see and edit everything
  viewer = View only
  entry  = Data entry: sees everything, adds and edits data on every page, cannot delete, no Admin panel
  driver = Driver: only his own Driver trip form (open trips, amounts, papers, Trip complete), nothing else
  (31 Oct 2026: the old Data entry level was split into Data entry and Driver. In code, user.isEntry = the Driver level,
  the one locked to /entry.)
*/
export const ROLES = {
  admin: { label: 'Administrator', short: 'Admin' },
  editor: { label: 'Full access', short: 'Full access' },
  viewer: { label: 'View only', short: 'View only' },
  entry: { label: 'Data entry', short: 'Data entry' },
  driver: { label: 'Driver', short: 'Driver' }
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
    isAdmin: role === 'admin' || role === 'editor' || role === 'entry', // can add / edit data (name kept for existing pages)
    canDelete: role === 'admin' || role === 'editor', // Data entry cannot delete
    canRead: role === 'admin' || role === 'editor' || role === 'viewer' || role === 'entry',
    isDataEntry: role === 'entry',
    isEntry: role === 'driver' // the Driver level: only the Driver trip form
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
      setAppRole(u?.role || '');
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

  // Every page opens at the top (no jumping to the middle)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    if (window.location.hash) return undefined;
    window.scrollTo(0, 0);
    const t = setTimeout(() => window.scrollTo(0, 0), 60);
    return () => clearTimeout(t);
  }, [path]);

  async function switchUser() {
    await endActivity('logout');
    await sb().auth.signOut();
    router.replace('/login');
  }

  if (!user) return <div className="loading">Loading...</div>;

  const nav = user.isEntry ? [['/entry', 'Data entry', 'entry']] : [['/', 'Home', 'home'], ['/sitemap', 'Sitemap', 'map'], ['/timeline', 'Timeline', 'clock']];
  // Phone / tablet: quick buttons next to Home (on Home the alerts list pushes the tiles far down)
  // Transport lives inside Office Expense (4th tab), so it has no top bar button of its own
  const quick = user.canRead ? [['/inventory', 'Inventory', 'box'], ['/expenses', 'Office Expense', 'receipt']] : [];
  // Buttons that used to sit at the bottom of Home (31 Oct 2026): now in the top bar
  // Settings, Users and Activity live inside Admin (/admin) since 31 Oct 2026
  // Full access (editor): everything except the Admin panel; only the Administrator gets the Admin button (31 Oct 2026)
  if (user.isAdmin) quick.push(['/expenses/docs', 'Invoices', 'invoice'], ['/entry', 'Data entry', 'entry']);
  if (user.isOwner) quick.push(['/admin', 'Admin', 'shield']);

  let blocked = '';
  if (ownerOnly && !user.isOwner) blocked = 'Only Administrator can open this page.';
  else if (adminOnly && !user.isAdmin) blocked = 'You need Full access to open this page.';

  return (
    <UserCtx.Provider value={user}>
      <RaufCtx.Provider value={raufValue}>
      <header className="topbar tbx">
        <div className="tbx-inner">
          <div className="tbx-row">
            <Link href={user.isEntry ? '/entry' : '/'} className="tbx-brand" aria-label="Tudo Num Office Systems, home">
              <span className="tbx-logo"><img src="/tudonum-logo-lg.png" alt="" /></span>
              <span className="tbx-name">
                <b>Tudo Num</b>
                <small>Office Systems</small>
              </span>
            </Link>
            {/* 🖨 Print with column choice, next to the company name (moved here from bottom-left, 31 Oct 2026) */}
            {user.canRead && !blocked && <PrintColumns top />}
            <div className="tbx-tools">
              {user.canRead && !user.isEntry && <span className="tbx-view"><ViewSwitch /></span>}
              <ThemeMenu />
              <AccountMenu user={user} onLogout={switchUser} showView={user.canRead && !user.isEntry} />
            </div>
          </div>
          <nav className={`tbx-nav n${nav.length + quick.length}`} aria-label="Main">
            {nav.map(([href, label, ico]) => (
              <Link key={href} href={href === '/sitemap' && path !== '/sitemap' ? `/sitemap?from=${encodeURIComponent(path)}` : href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}>
                <Ico name={ico} /><span>{label}</span>
              </Link>
            ))}
            {quick.length > 0 && <i className="tbx-sep" aria-hidden="true" />}
            {quick.map(([href, label, ico]) => (
              <Link key={href} href={href} className={path === href || (href === '/admin' && ['/settings', '/users', '/activity'].some((x) => path.startsWith(x))) || (path.startsWith(`${href}/`) && !(href === '/expenses' && path === '/expenses/docs')) || (href === '/expenses' && (path.startsWith('/transport') || path === '/docs')) ? 'active' : ''}>
                <Ico name={ico} /><span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {!blocked && !user.isEntry && (showTransportSide(path) || showExpenseSide(path)) ? (
        <main className="page wide has-side">
          {showTransportSide(path) ? <TransportSideNav isAdmin={user.isAdmin} /> : <ExpenseSideNav isAdmin={user.isAdmin} />}
          <div className="side-main"><Breadcrumbs />{showTransportSide(path) && <OfficeTabs />}{children}</div>
        </main>
      ) : (
        <main className={`page${wide ? ' wide' : ''}`}>
          {blocked ? <div className="error">{blocked}</div> : <><Breadcrumbs />{children}</>}
        </main>
      )}
      {/* 🖨 Print with column choice now sits in the top bar next to the company name (PrintColumns top). */}
      <BackToTop />
      {user.canRead && !blocked && <TableCards />}
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

/* Line icons for the top bar (follow the text colour) */
const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></>,
  map: <><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  truck: <><path d="M2 6h11v10H2z" /><path d="M13 9h4.5L21 12.5V16h-8z" /><circle cx="6" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /></>,
  box: <><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  receipt: <><path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  entry: <><path d="M8 4h8v3H8z" /><path d="M16 5.5h2.5V21h-13V5.5H8" /><path d="M9 12h6M9 16h4" /></>,
  invoice: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v3h3" /><path d="M9 11h6M9 15h6M9 7h3" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.4 0 4 1.5 4.5 4.5" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  swap: <><path d="M7 4 3 8l4 4" /><path d="M3 8h13" /><path d="m17 12 4 4-4 4" /><path d="M21 16H8" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>
};

function Ico({ name }) {
  return (
    <svg className="tbx-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* Round button with the user's first letter; opens name, role, Switch user, Logout */
function AccountMenu({ user, onLogout, showView }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const role = ROLES[user.role]?.label || user.role;
  const display = user.name ? user.name.charAt(0).toUpperCase() + user.name.slice(1) : '';
  return (
    <div className="tbx-acct" ref={boxRef}>
      <button type="button" className={`tbx-me${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title={`${display} · ${role}`}>
        <span className="tbx-av">{display.charAt(0) || '?'}</span>
        <span className="tbx-me-text"><b>{display}</b><small>{ROLES[user.role]?.short || user.role}</small></span>
        <svg className="tbx-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="tbx-pop" role="menu">
          <div className="tbx-pop-who">
            <span className="tbx-av big">{display.charAt(0) || '?'}</span>
            <span><b>{display}</b><small>{role}</small></span>
          </div>
          {showView && <div className="tbx-pop-view"><small>View</small><ViewSwitch /></div>}
          <button type="button" role="menuitem" onClick={onLogout}><Ico name="swap" /> Switch user</button>
          <button type="button" role="menuitem" className="out" onClick={onLogout}><Ico name="logout" /> Logout</button>
        </div>
      )}
    </div>
  );
}
