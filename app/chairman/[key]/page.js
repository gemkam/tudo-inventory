'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import { COMPANIES } from '@/lib/expenses';
import { chairmanOf, canOpenChairman } from '@/lib/chairmen';

/* 👑 One chairman's page (6 Nov 2026): which companies he has access to */
function OneChairman() {
  const { key } = useParams();
  const user = useUser();
  const c = chairmanOf(key);
  if (!c) return <p className="empty">Chairman not found. <Link href="/chairman">Back to Chairman</Link></p>;
  if (!canOpenChairman(user, c.key)) return <p className="empty">This page is only for {c.name} and the Administrator.</p>;

  const all = c.companies === 'all';
  const cos = all ? COMPANIES : COMPANIES.filter((x) => (c.companies || []).includes(x.key));

  return (
    <>
      <h1>👑 {c.name}</h1>
      <p className="sub">Chairman · {all ? 'Full access · All companies' : cos.length ? 'Full access' : 'No access yet'}</p>
      {c.approvals && (
        <div className="adm-grid" style={{ marginBottom: 18 }}>
          <Link href={`/chairman/${c.key}/approvals`} className="adm-tile">
            <span className="adm-ico" aria-hidden="true">✅</span>
            <span className="adm-tx"><b>Approvals</b><small>Bills verified by Rauf, waiting for {c.name} to approve</small></span>
            <span className="adm-go" aria-hidden="true">›</span>
          </Link>
        </div>
      )}
      {cos.length === 0 ? (
        <p className="empty">{c.name} has no access yet. His company will be added later.</p>
      ) : (
        <div className="adm-grid">
          {cos.map((x) => (
            <Link key={x.key} href={`/expenses?co=${x.key}`} className="adm-tile">
              <span className="adm-ico" aria-hidden="true">🏢</span>
              <span className="adm-tx"><b>{x.name || x.short}</b><small>Full access</small></span>
              <span className="adm-go" aria-hidden="true">›</span>
            </Link>
          ))}
          {all && (
            <Link href="/transport" className="adm-tile">
              <span className="adm-ico" aria-hidden="true">🚚</span>
              <span className="adm-tx"><b>Transport</b><small>Full access</small></span>
              <span className="adm-go" aria-hidden="true">›</span>
            </Link>
          )}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate><OneChairman /></AuthGate>;
}
