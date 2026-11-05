/*
  Edit password (1 Nov 2026): every Edit button asks for the edit password once; then editing stays open until
  ✓ Done (lockEdit) or another page is opened (AuthGate locks again on page change).
  Only the SHA-256 of the password is kept here. This is a lock against changes by mistake, not real security:
  who may change data is still decided by the access level (Users page / database rules).
*/
const HASH = '7353fcc007f672472639e4f64e78bee10444912a846ccc9b14221dc0170aa5ce';
let unlocked = false;

export const isEditUnlocked = () => unlocked;
export function lockEdit() { unlocked = false; }

/* true when the text is the password; does NOT open editing (used by the Admin lock) */
export async function isRightPassword(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '').trim()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === HASH;
}

export async function checkEditPassword(text) {
  if (await isRightPassword(text)) { unlocked = true; return true; }
  return false;
}

/* resolves true when the password is right (or already unlocked), false when cancelled */
export function requestEditPassword() {
  if (unlocked || typeof window === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent('tudo-edit-password', { detail: resolve })));
}

/* run fn only after the password */
export async function withEditPassword(fn) {
  if (await requestEditPassword()) fn();
}
