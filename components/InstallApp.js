'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

/*
  "📲 Add to my phone" on the Driver trip form (/entry). Puts a "Tudo Trips" icon on the phone's home screen
  that opens straight on the form (logged in stays logged in).
  Android Chrome: the real install box (beforeinstallprompt). iPhone Safari: short steps (Share → Add to Home Screen).
  Hidden when the form is already opened from the icon. Admin also gets "Send link to drivers" (WhatsApp).
*/

export default function InstallApp({ isOffice, driverLinks = [] }) {
  const [sendOpen, setSendOpen] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try { navigator.serviceWorker?.register('/sw.js'); } catch { /* ignore */ }
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
    setInstalled(!!standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onDone = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onDone);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onDone); };
  }, []);

  async function install() {
    if (prompt) {
      prompt.prompt();
      const r = await prompt.userChoice.catch(() => null);
      if (r?.outcome === 'accepted') setInstalled(true);
      setPrompt(null);
    } else setHelp(true);
  }


  return (
    <>
      {!installed && <button type="button" className="btn in ia-btn" onClick={install}>📲 Add to my phone</button>}
      {isOffice && <button type="button" className="btn ia-btn" onClick={() => setSendOpen(true)}>📤 Send link to drivers</button>}
      {sendOpen && (
        <Modal title="Send each driver his own link" onClose={() => setSendOpen(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Each link opens only that driver's form. He taps Install, types his password once, and gets his own icon.</p>
          <div className="ia-links">
            {driverLinks.map((d) => {
              const url = d.user ? `https://tudo-inventory.vercel.app/d/${d.user}` : '';
              const text = `Salam ${d.name}\n\nThis is your Tudo trips link\n${url}\n\nOpen it in Chrome\nTap Install ${d.user ? d.user.charAt(0).toUpperCase() + d.user.slice(1) : ''} Trips\nType your password once\n\nThen use the icon on your phone for every trip`;
              return (
                <div key={d.id} className="ia-link">
                  <div><b>{d.name}</b><small>{url || 'No login yet: create one on the Users page (Data entry, pick this driver)'}</small></div>
                  {url && (
                    <span className="ia-link-btns">
                      <a className="btn small in" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">📤 WhatsApp</a>
                      <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(url); }}>📋 Copy</button>
                    </span>
                  )}
                </div>
              );
            })}
            {!driverLinks.length && <p className="muted">Only the Administrator can see the drivers' usernames.</p>}
          </div>
          <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setSendOpen(false)}>Close</button></div>
        </Modal>
      )}
      {help && (
        <Modal title="Add Tudo Trips to your phone" onClose={() => setHelp(false)}>
          {ios ? (
            <ol className="ia-steps">
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap the <b>Share</b> button (square with arrow ⬆️) at the bottom.</li>
              <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </ol>
          ) : (
            <ol className="ia-steps">
              <li>Open this page in <b>Chrome</b>.</li>
              <li>Tap the <b>⋮</b> menu (top right).</li>
              <li>Tap <b>Add to Home screen</b> or <b>Install app</b>, then <b>Install</b>.</li>
            </ol>
          )}
          <p className="muted" style={{ margin: '8px 0 0' }}>The <b>Tudo Trips</b> icon opens this form straight away. You stay logged in.</p>
          <div className="modal-actions"><button type="button" className="btn in" onClick={() => setHelp(false)}>OK</button></div>
        </Modal>
      )}
    </>
  );
}
