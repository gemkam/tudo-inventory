'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

/*
  "📲 Add to my phone" on the Driver trip form (/entry). Puts a "Tudo Trips" icon on the phone's home screen
  that opens straight on the form (logged in stays logged in).
  Android Chrome: the real install box (beforeinstallprompt). iPhone Safari: short steps (Share → Add to Home Screen).
  Hidden when the form is already opened from the icon. Admin also gets "Send link to drivers" (WhatsApp).
*/
const LINK = 'https://tudo-inventory.vercel.app/entry';

export default function InstallApp({ isOffice }) {
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

  const waText = `Tudo Trips (driver trip form)\n\nOpen this link on your phone:\n${LINK}\n\nLog in with your username and password\n\nThen press 📲 Add to my phone\nThe Tudo Trips icon will come on your home screen`;

  return (
    <>
      {!installed && <button type="button" className="btn in ia-btn" onClick={install}>📲 Add to my phone</button>}
      {isOffice && <a className="btn ia-btn" href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer">📤 Send link to drivers</a>}
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
