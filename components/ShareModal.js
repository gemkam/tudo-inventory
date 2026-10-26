'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';

/* Share text (and an optional link) through the phone share menu, or WhatsApp / Email / Copy on a PC */
export function useShare() {
  const [share, setShare] = useState(null);
  async function open(payload) {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share(payload); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    setShare(payload);
  }
  const modal = share ? <ShareModal share={share} onClose={() => setShare(null)} /> : null;
  return { open, modal };
}

export default function ShareModal({ share, onClose }) {
  const [copied, setCopied] = useState(false);
  const full = share.url ? `${share.text}\n${share.url}` : share.text;
  async function copy() {
    try { await navigator.clipboard.writeText(full); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <Modal title={share.title || 'Share'} onClose={onClose}>
      <pre className="share-text">{full}</pre>
      <div className="share-btns">
        <a className="btn wa-btn" href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(share.title || '')}&body=${encodeURIComponent(full)}`}>Email</a>
        <button type="button" className="btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
    </Modal>
  );
}
