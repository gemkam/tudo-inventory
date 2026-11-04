'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { checkEditPassword } from '@/lib/editLock';

/* The "Edit password" box (one for the whole app, mounted by AuthGate). Opened by requestEditPassword(). */
export default function EditPasswordHost() {
  const [req, setReq] = useState(null); // resolve function
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    const on = (e) => { setReq(() => e.detail); setVal(''); setErr(''); };
    window.addEventListener('tudo-edit-password', on);
    return () => window.removeEventListener('tudo-edit-password', on);
  }, []);
  useEffect(() => { if (req) setTimeout(() => inputRef.current?.focus(), 30); }, [req]);
  if (!req) return null;
  const close = (ok) => { const r = req; setReq(null); r(ok); };
  async function submit(e) {
    e.preventDefault();
    if (await checkEditPassword(val)) close(true);
    else { setErr('Wrong password'); setVal(''); inputRef.current?.focus(); }
  }
  // 4 Nov 2026 (Kamran): no need to press Enter / Unlock, the edit options open as soon as the right password is typed
  async function typed(v) {
    setVal(v); setErr('');
    if (v && await checkEditPassword(v)) close(true);
  }
  return (
    <Modal title="🔒 Edit password" onClose={() => close(false)}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Type the edit password. Editing opens by itself when it is right.</p>
        <input ref={inputRef} className="drv-input" type="password" inputMode="numeric" autoComplete="off" value={val} onChange={(e) => typed(e.target.value)} aria-label="Edit password" />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => close(false)}>Cancel</button>
          <button type="submit" className="btn in">Unlock</button>
        </div>
      </form>
    </Modal>
  );
}
