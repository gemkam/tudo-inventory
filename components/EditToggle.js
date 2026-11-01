'use client';

import { requestEditPassword, lockEdit } from '@/lib/editLock';

// Small Edit / Done button for a section header. Turning Edit on asks the edit password (lib/editLock.js); Done locks again.
export default function EditToggle({ on, onClick, show = true }) {
  if (!show) return null;
  return (
    <button type="button" className={`btn small ${on ? 'in' : ''}`} onClick={async (e) => { if (on) { lockEdit(); onClick(e); return; } if (await requestEditPassword()) onClick(e); }} aria-pressed={on}>
      {on ? '✓ Done' : '✏️ Edit'}
    </button>
  );
}
