'use client';

import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { CHAIRMEN, canOpenChairman, hasAccess } from '@/lib/chairmen';

/* 👑 Chairman (6 Nov 2026): one button per chairman (lib/chairmen.js) */
function ChairmanPage() {
  const user = useUser();
  const list = CHAIRMEN.filter((c) => canOpenChairman(user, c.key));
  return (
    <>
      <h1>👑 Chairman</h1>
      <p className="sub">Tudo Num Group chairmen.</p>
      {list.length === 0 ? <p className="empty">This page is only for the chairmen and the Administrator.</p> : (
        <div className="adm-grid">
          {list.map((c) => (
            <Link key={c.key} href={`/chairman/${c.key}`} className="adm-tile">
              <span className="adm-ico" aria-hidden="true">👑</span>
              <span className="adm-tx"><b>{c.name}</b><small>{c.companies === 'all' ? 'Chairman · Full access · All companies' : hasAccess(c) ? 'Chairman · Full access' : 'Chairman · No access yet'}</small></span>
              <span className="adm-go" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate><ChairmanPage /></AuthGate>;
}
