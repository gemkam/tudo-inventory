'use client';

import { lockEdit } from '@/lib/editLock';

/* ✕ Close Edit (Kamran 4 Nov 2026): shown next to every Edit while it is on. Turns editing off and all Edit buttons with it,
   and locks the edit password again. Red outline, fills red on hover (.dx-close in globals.css). */
export default function CloseEdit({ onClose, small = false, disabled = false }) {
  return (
    <button type="button" className={`btn dx-close${small ? ' small' : ''}`} disabled={disabled} title="Stop editing: all Edit buttons turn off"
      onClick={(e) => { lockEdit(); onClose(e); }}>✕ Close Edit</button>
  );
}
