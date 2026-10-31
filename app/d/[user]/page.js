'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { useLang, LangSwitch } from '@/lib/i18n';

/*
  Personal driver link, e.g. https://tudo-inventory.vercel.app/d/saif (sent by WhatsApp from the Driver trip form).
  1. Opened inside WhatsApp: tells the driver to open it in Chrome / Safari (apps cannot be added from inside WhatsApp).
  2. One big "📲 Install Saif Trips" button: puts the icon on the phone (Android: one tap + Install; iPhone: 3 steps shown).
     As soon as the phone allows it, a full-screen "Tap here to install" appears; iPhone shows its 3 steps by itself.
     Phones always ask the person to confirm (one tap); no website can add an icon silently.
  3. Log in once: username is already filled in, only the password is typed. He stays logged in.
  4. The icon opens this page, which goes straight to his own Driver trip form (/entry shows only his name).
  Someone logged in as another user (e.g. the office testing) sees who is logged in and can switch.
*/
const DOMAIN = '@tudo.local';
const nice = (u) => String(u || '').replace(/[^a-z0-9._-]/gi, '').toLowerCase().slice(0, 30);
const cap = (u) => u.charAt(0).toUpperCase() + u.slice(1);

export default function DriverLink() {
  const { user } = useParams();
  const router = useRouter();
  const u = nice(user);
  const { t, ur } = useLang();
  const [state, setState] = useState('loading'); // loading | login | other
  const [other, setOther] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [standalone, setStandalone] = useState(false);
  const [env, setEnv] = useState({ ios: false, inApp: false });
  const [help, setHelp] = useState(false);
  const [ask, setAsk] = useState(false); // full-screen "tap to install" as soon as the phone allows it
  const [done, setDone] = useState(false);
  const [out, setOut] = useState(false); // came here after Logout

  useEffect(() => {
    try { navigator.serviceWorker?.register('/sw.js'); } catch { /* ignore */ }
    try { setOut(new URLSearchParams(window.location.search).get('out') === '1'); } catch { /* ignore */ }
    const ua = navigator.userAgent || '';
    setEnv({ ios: /iphone|ipad|ipod/i.test(ua), inApp: /WhatsApp|FBAN|FBAV|Instagram|; wv\)/i.test(ua) });
    setStandalone(!!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone));
    // no preventDefault: Chrome may also show its own "Add to Home screen" bar by itself
    const onPrompt = (e) => { setPrompt(e); setAsk(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    sb().auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email || '';
      if (!email) { setState('login'); return; }
      if (email === `${u}${DOMAIN}`) { router.replace('/entry'); return; }
      setOther(email.replace(DOMAIN, '')); setState('other');
    });
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [u, router]);

  async function install() {
    setAsk(false);
    if (prompt) {
      try { prompt.prompt(); const r = await prompt.userChoice; if (r?.outcome === 'accepted') setDone(true); } catch { setHelp(true); }
      setPrompt(null);
    } else setHelp(true);
  }
  useEffect(() => {
    const onDone = () => setDone(true);
    window.addEventListener('appinstalled', onDone);
    // iPhone has no install box: show the 3 steps by itself the first time
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone) {
      try { if (!localStorage.getItem('tudo-ios-help')) { setHelp(true); localStorage.setItem('tudo-ios-help', '1'); } } catch { /* ignore */ }
    }
    return () => window.removeEventListener('appinstalled', onDone);
  }, []);

  async function login(e) {
    e.preventDefault();
    setError('');
    if (!password) return;
    setBusy(true);
    const { error: err } = await sb().auth.signInWithPassword({ email: u + DOMAIN, password });
    setBusy(false);
    if (err) { setError(t('Password is wrong. Please try again or ask the office.')); return; }
    router.replace('/entry');
  }

  async function switchUser() {
    await sb().auth.signOut();
    setOther(''); setState('login');
  }

  return (
    <div className={`dl-page${ur ? ' ur' : ''}`} dir={ur ? 'rtl' : 'ltr'}>
      <div className="dl-card">
        <img src="/icons/trips-192.png" alt="" className="dl-logo" />
        <h1>{cap(u)} Trips</h1>
        <p className="dl-sub">{ur ? t('Driver trip form sub') : 'Tudo Num · Driver trip form'}</p>
        <LangSwitch className="big" />

        {env.inApp && !standalone && (
          <div className="dl-warn">
            <b>{t(env.ios ? 'Open in Safari first' : 'Open in Chrome first')}</b>
            <span>{t(env.ios ? 'Tap the ⋮ menu (top right) and choose Open in Safari.' : 'Tap the ⋮ menu (top right) and choose Open in Chrome.')}</span>
          </div>
        )}

        {!standalone && (
          <button type="button" className="dl-install" onClick={install}>
            <span aria-hidden="true">📲</span> {ur ? `${t('Install')} · ${cap(u)} Trips` : `Install ${cap(u)} Trips`}
            <small>{t('puts the icon on your phone')}</small>
          </button>
        )}

        {state === 'loading' && <p className="dl-sub">{t('Please wait...')}</p>}

        {out && state === 'login' && <div className="logout-note">{ur ? '✅ آپ لاگ آؤٹ ہو گئے ہیں۔ دوبارہ کھولنے کے لیے پاس ورڈ لکھیں۔' : '✅ You have logged out. Type your password to open again.'}</div>}
        {state === 'login' && (
          <form className="dl-login" onSubmit={login}>
            <div className="dl-user">👤 {u}</div>
            <label htmlFor="dl-pass">{t('Your password')}</label>
            <input id="dl-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Password')} dir="ltr" />
            {error && <div className="dl-err">{error}</div>}
            <button type="submit" className="dl-go" disabled={busy}>{busy ? t('Opening trips...') : t('Open my trips ➜')}</button>
            <input type="hidden" autoComplete="username" value={u} readOnly />
          </form>
        )}

        {state === 'other' && (
          <div className="dl-login">
            <p className="dl-sub">This phone is logged in as <b>{other}</b>, not <b>{u}</b>.</p>
            <button type="button" className="dl-go" onClick={switchUser}>Log in as {u}</button>
            <button type="button" className="dl-link" onClick={() => router.replace('/entry')}>Keep {other} and open the form</button>
          </div>
        )}
      </div>

      {ask && !standalone && !done && (
        <button type="button" className="dl-ask" onClick={install}>
          <img src="/icons/trips-192.png" alt="" />
          <b>{t('Tap here to install')}<br />{cap(u)} Trips</b>
          <span>{t('Then press Install on the box that opens')}</span>
        </button>
      )}
      {done && <div className="dl-done">✅ {cap(u)} Trips {ur ? t('is on your phone. Use the icon from now on.') : 'is on your phone. Use the icon from now on.'}</div>}
      {help && (
        <div className="dl-help" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
          <div className="dl-help-box">
            <h2>{ur ? t('Add to your phone') : `Add ${cap(u)} Trips to your phone`}</h2>
            {ur ? <p className="dl-steps-ur">{t(env.ios ? 'ios steps' : 'android steps')}</p> : env.ios ? (
              <ol><li>Open this link in <b>Safari</b>.</li><li>Tap <b>Share ⬆️</b> at the bottom.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
            ) : (
              <ol><li>Open this link in <b>Chrome</b>.</li><li>Tap <b>⋮</b> (top right).</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.</li></ol>
            )}
            <button type="button" className="dl-go" onClick={() => setHelp(false)}>{t('OK')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
