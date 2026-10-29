'use client';

import { useState } from 'react';
import { useUser } from '@/components/AuthGate';
import { DEFAULT_AVATAR, useRaufAvatar } from '@/lib/raufAvatar';
import RaufAvatarEditor from '@/components/RaufAvatarEditor';

// Admin dashboard box (Users page and Settings): shows Rauf's picture and opens the crop editor.
// Only the Administrator sees it.
export default function RaufPicturePanel() {
  const user = useUser();
  const pic = useRaufAvatar();
  const [open, setOpen] = useState(false);
  if (!user?.isOwner) return null;

  return (
    <section className="panel rav-panel">
      <span className="rav-round sm">
        {pic.kind === 'photo' ? <img src={pic.src} alt="Rauf picture" /> : <span className="rav-drawn">Drawn</span>}
      </span>
      <div className="rav-panel-txt">
        <h2>🤖 AI assistant picture</h2>
        <p className="sub">
          Rauf&apos;s display picture on every page ({pic.kind === 'drawn' ? 'drawn face' : pic.src === DEFAULT_AVATAR ? 'default photo' : 'uploaded photo'}).
          Upload a new photo and crop it, or switch back to the default.
        </p>
      </div>
      <button type="button" className="btn in" onClick={() => setOpen(true)}>📷 Change picture</button>
      {open && <RaufAvatarEditor onClose={() => setOpen(false)} />}
    </section>
  );
}
