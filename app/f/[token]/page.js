'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { sb } from '@/lib/supabase';
import EntryForm from '@/components/EntryForm';

/* Public entry form opened from a shared link. No login. */
export default function PublicEntry() {
  const { token } = useParams();
  const [info, setInfo] = useState(undefined); // undefined = loading, null = not valid

  useEffect(() => {
    let alive = true;
    sb().rpc('public_entry_info', { p_token: String(token || '') }).then(({ data, error }) => {
      if (alive) setInfo(error ? null : data || null);
    });
    return () => { alive = false; };
  }, [token]);

  async function submit(row) {
    const { error } = await sb().rpc('public_add_entry', { p_token: String(token), p_entry: row });
    if (!error) return null;
    if (/link/i.test(error.message)) return 'This link has been turned off. Ask the Administrator for a new link.';
    return error.message;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Tudo Num Office Systems</span>
        </div>
      </header>
      <main className="page">
        {info === undefined && <div className="loading">Loading...</div>}
        {info === null && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <h1>Link not active</h1>
            <p className="sub">This entry link is wrong or has been turned off. Ask the Administrator to send a new one.</p>
          </div>
        )}
        {info && (
          <EntryForm
            drivers={info.drivers || []}
            lockedDriverId={info.driver_id || null}
            askName
            onSubmit={submit}
            intro="Fill in one trip or expense and press Save. It goes straight to the office. The form clears for the next one."
          />
        )}
      </main>
    </>
  );
}
