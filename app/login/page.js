'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';

// Usernames are mapped to internal login emails, e.g. "Momin" -> momin@tudo.local
const DOMAIN = '@tudo.local';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(false); // came here after Logout

  useEffect(() => {
    try { setOut(new URLSearchParams(window.location.search).get('out') === '1'); } catch { /* ignore */ }
    sb().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/');
    });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const name = username.trim().toLowerCase().replace(/\s+/g, '');
    if (!name) return;
    setBusy(true);
    const { error } = await sb().auth.signInWithPassword({ email: name + DOMAIN, password });
    setBusy(false);
    if (error) {
      setError('Username or password is wrong. Please check and try again.');
      return;
    }
    router.replace('/');
  }

  return (
    <div className="login">
      <form className="login-card panel" onSubmit={submit}>
        <h1>Tudo Num Office Systems</h1>
        {out && <div className="logout-note">✅ You have logged out. Nothing is shown until you log in again.</div>}
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. Administrator" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
      </form>
    </div>
  );
}
