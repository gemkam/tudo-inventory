'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { Viewer } from '@/components/DocFiles';
import SlipPaper from '@/components/SlipPaper';
import { slipPdf, monthName, m3 } from '@/lib/salarySlips';
import { VAPID_PUBLIC, keyBytes } from '@/lib/push';

/*
  Employee's own salary slip shortcut (Personnel > 📤 Link), no login. /s/<slip_token>
  - RPC public_staff_slip: name, company and every APPROVED monthly slip (table salary_slips). Drafts never show.
  - Latest month open; month buttons for older ones; ⬇ Download PDF; "Revised" when the office changed it.
  - 📲 Add to my phone: own icon "<Name> Salary" (manifest app/s/[token]/manifest.webmanifest, public/sw.js).
  - 🔔 Notify me: phone notification when a new or revised slip is approved (slip_push_subs, /api/slip-push).
  - Older uploaded slip files (staff-files bucket, slip/<token>/) still listed under "Other files".
*/
const BUCKET = 'staff-files';
const isImg = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '');

export default function StaffSlipLink() {
  const { token } = useParams();
  const [info, setInfo] = useState(undefined); // undefined = loading, null = not valid
  const [pick, setPick] = useState('');
  const [viewing, setViewing] = useState(null);
  const [msg, setMsg] = useState('');
  const [installEvt, setInstallEvt] = useState(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  const [bell, setBell] = useState('');
  const flash = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); }, []);

  const load = useCallback(() => {
    sb().rpc('public_staff_slip', { p_token: String(token || '') }).then(({ data, error }) => setInfo(error ? null : data || null));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  // opened again from the icon or the notification: fresh slips
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [load]);

  useEffect(() => {
    try { navigator.serviceWorker?.register('/sw.js'); } catch { /* ignore */ }
    setStandalone(!!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone));
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    if (typeof Notification !== 'undefined') setBell(Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : '');
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  // keep the phone's notification registration fresh when already allowed
  useEffect(() => {
    if (bell === 'on' && info) subscribe(true);
  }, [bell, info]); // eslint-disable-line react-hooks/exhaustive-deps

  async function install() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => null); setInstallEvt(null); } else setHelp(true);
  }

  async function subscribe(quiet = false) {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { if (!quiet) flash(ios ? 'On iPhone: first add this page to your Home Screen, open it from the icon, then tap 🔔 again.' : 'This phone cannot show notifications here.'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setBell(perm === 'denied' ? 'blocked' : ''); if (!quiet) flash('Notifications not allowed. You can still open your slips here any time.'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
      const { data } = await sb().rpc('public_save_push', { p_token: String(token), p_sub: sub.toJSON() });
      setBell(data ? 'on' : '');
      if (!quiet) flash(data ? '🔔 Done. You will get a message when your salary slip is ready.' : 'Could not turn on notifications.');
    } catch (e) { if (!quiet) flash(`Could not turn on notifications: ${e.message}`); }
  }

  async function download(f) {
    const { data, error } = await sb().storage.from(BUCKET).download(f.path);
    if (error || !data) { flash(`Could not download: ${error?.message || 'not found'}`); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = f.name || 'salary-slip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const co = info ? COMPANIES.find((c) => c.key === info.company) : null;
  const slips = info && Array.isArray(info.slips) ? info.slips : [];
  const cur = slips.find((s) => s.month === pick) || slips[0] || null;
  const files = info && Array.isArray(info.files) ? [...info.files].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner"><span className="brand">{co ? co.short : 'Tudo Num'} · My Salary</span></div>
      </header>
      <main className="page ss-page">
        {info === undefined && <div className="loading">Loading...</div>}
        {info === null && (
          <div className="card ss-card">
            <h1>Link not working</h1>
            <p className="muted">This salary slip link is turned off or wrong. Please ask the office.</p>
          </div>
        )}
        {info && (
          <>
            <div className="ss-who ss-hello"><b>{info.name}</b><span>{info.designation}</span></div>

            <div className="ss-actions">
              {!standalone && <button type="button" className="btn in" onClick={install}>📲 Add to my phone</button>}
              {bell !== 'on' && <button type="button" className="btn" onClick={() => subscribe(false)} disabled={bell === 'blocked'}>{bell === 'blocked' ? '🔕 Notifications blocked' : '🔔 Notify me'}</button>}
              {bell === 'on' && <span className="ss-bell">🔔 Notifications on</span>}
            </div>

            {slips.length > 1 && (
              <div className="ss-months" role="tablist" aria-label="Month">
                {slips.map((s) => (
                  <button key={s.month} type="button" className={cur?.month === s.month ? 'on' : ''} onClick={() => setPick(s.month)}>
                    {monthName(s.month)}{s.version > 1 ? ' · Revised' : ''}
                  </button>
                ))}
              </div>
            )}

            {cur ? (
              <>
                <SlipPaper s={cur} />
                <div className="ss-actions">
                  <button type="button" className="btn in ss-big" onClick={() => slipPdf(cur)}>⬇ Download PDF · {monthName(cur.month)}</button>
                </div>
                <p className="muted ss-small">Net pay OMR {m3(cur.net)}. Questions about your slip: please ask the office.</p>
              </>
            ) : (
              <div className="card ss-card"><p className="muted" style={{ margin: 0 }}>No salary slip yet. When the office approves your slip it shows here{bell === 'on' ? ' and your phone tells you' : ''}.</p></div>
            )}

            {files.length > 0 && (
              <div className="card ss-card" style={{ marginTop: 14 }}>
                <h2 style={{ marginTop: 0 }}>📄 Other files</h2>
                <div className="ss-files">
                  {files.map((f) => (
                    <div key={f.path} className="ss-file">
                      <span>{isImg(f) ? '🖼' : '📕'} <b>{f.name}</b>{f.at && <small>{new Date(f.at).toLocaleDateString('en-GB')}</small>}</span>
                      <span className="ss-btns">
                        <button type="button" className="btn small" onClick={() => setViewing(f)}>👁 View</button>
                        <button type="button" className="btn small in" onClick={() => download(f)}>⬇ Download</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {help && (
          <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setHelp(false); }}>
            <div className="modal" role="dialog" aria-modal="true">
              <h2>Add My Salary to your phone</h2>
              {ios ? (
                <ol className="ia-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> (square with arrow) at the bottom.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
              ) : (
                <ol className="ia-steps"><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu (top right).</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>
              )}
              <p className="muted">Then open your slips any time from the <b>Salary</b> icon. No password needed.</p>
              <div className="modal-actions"><button type="button" className="btn in" onClick={() => setHelp(false)}>OK</button></div>
            </div>
          </div>
        )}
        {viewing && <Viewer file={viewing} bucket={BUCKET} onClose={() => setViewing(null)} flash={flash} />}
        {msg && <div className="toast ok" role="status">{msg}</div>}
      </main>
    </>
  );
}
