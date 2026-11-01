/* Phone notifications for the employee salary slip shortcut (public key; the private key is in the database). */
export const VAPID_PUBLIC = 'BNxCyua80hbb7KUTQInOc_kvhxeiV1XeEYu3WAFErQWI6GEwA130nRHJ-MiNIq_cqK1_7zPx42M4LL1FiHQd83A';

export function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
