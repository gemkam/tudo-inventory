'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isRightPassword } from '@/lib/editLock';

/* Admin password (5 Nov 2026, Kamran): the Admin area opens only after the password.
   No Enter needed: Admin opens the moment the right password is typed. */
const ADMIN_PATHS = ['/admin', '/settings', '/users', '/activity'];
export const isAdminArea = (path = '') => ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export default function AdminLock({ onOpen }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(t); }, []);

  async function typed(v) {
    setVal(v); setErr('');
    if (v && await isRightPassword(v)) onOpen();
  }
  async function submit(e) {
    e.preventDefault();
    if (await isRightPassword(val)) onOpen();
    else { setErr('Wrong password'); setVal(''); inputRef.current?.focus(); }
  }

  return (
    <div className="card" style={{ maxWidth: 380, margin: '40px auto', padding: 24, display: 'grid', gap: 12, textAlign: 'center' }}>
      <h2 style={{ margin: 0 }}>🔒 Admin password</h2>
      <p className="muted" style={{ margin: 0 }}>Type the password. Admin opens by itself when it is right.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <input ref={inputRef} className="drv-input" type="password" inputMode="numeric" autoComplete="off"
          value={val} onChange={(e) => typed(e.target.value)} aria-label="Admin password" style={{ textAlign: 'center' }} />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <Link href="/" className="btn ghost">Cancel</Link>
          <button type="submit" className="btn in">Open</button>
        </div>
      </form>
    </div>
  );
}
