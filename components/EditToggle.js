'use client';

import { requestEditPassword, lockEdit } from '@/lib/editLock';
import CloseEdit from '@/components/CloseEdit';

// Small Edit / Done button for a section header. Turning Edit on asks the edit password (lib/editLock.js); Done locks again.
// While Edit is on, a red "✕ Close Edit" button shows next to it (close={false} hides it where the page has its own).
export default function EditToggle({ on, onClick, show = true, close = true }) {
  if (!show) return null;
  return (
    <>
      <button type="button" className={`btn small ${on ? 'in' : ''}`} onClick={async (e) => { if (on) { lockEdit(); onClick(e); return; } if (await requestEditPassword()) onClick(e); }} aria-pressed={on}>
        {on ? '✓ Done' : '✏️ Edit'}
      </button>
      {on && close && <CloseEdit small onClose={onClick} />}
    </>
  );
}
