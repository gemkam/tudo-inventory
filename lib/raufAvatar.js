'use client';

import { useCallback, useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

/*
  Rauf's display picture (the AI assistant).
  Stored in table app_settings, key "rauf.avatar" (only the Administrator can change it, RLS is_admin()).
    - no row          -> default photo /rauf-avatar.jpg
    - "drawn"         -> the old drawn (cartoon) face
    - "data:image..." -> a picture the Administrator uploaded and cropped
*/
export const AVATAR_KEY = 'rauf.avatar';
export const DEFAULT_AVATAR = '/rauf-avatar.jpg';
const EVENT = 'rauf-avatar-changed';
const CACHE = 'tudo-rauf-avatar';

function readCache() {
  try { return localStorage.getItem(CACHE); } catch { return null; }
}
function writeCache(v) {
  try { if (v === null) localStorage.removeItem(CACHE); else localStorage.setItem(CACHE, v); } catch { /* ignore */ }
}

// value -> what to show: { kind: 'photo', src } or { kind: 'drawn' }
export function avatarView(value) {
  if (value === 'drawn') return { kind: 'drawn' };
  if (value && value.startsWith('data:image')) return { kind: 'photo', src: value };
  return { kind: 'photo', src: DEFAULT_AVATAR };
}

export function useRaufAvatar() {
  const [value, setValue] = useState(null);

  useEffect(() => {
    const cached = readCache();
    if (cached) setValue(cached === '__default' ? null : cached);
    let alive = true;
    sb().from('app_settings').select('value').eq('key', AVATAR_KEY).maybeSingle()
      .then(({ data, error }) => {
        if (!alive || error) return;
        const v = data?.value || null;
        setValue(v);
        writeCache(v || '__default');
      })
      .catch(() => {});
    const onChange = (e) => setValue(e.detail ?? null);
    window.addEventListener(EVENT, onChange);
    return () => { alive = false; window.removeEventListener(EVENT, onChange); };
  }, []);

  return avatarView(value);
}

// value: data URL, "drawn", or null (= default photo)
export async function saveRaufAvatar(value) {
  const s = sb();
  const res = value
    ? await s.from('app_settings').upsert({ key: AVATAR_KEY, value, updated_at: new Date().toISOString() })
    : await s.from('app_settings').delete().eq('key', AVATAR_KEY);
  if (res.error) return { error: res.error.message };
  writeCache(value || '__default');
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  return { ok: true };
}

export function useAvatarSaver() {
  const [busy, setBusy] = useState(false);
  const save = useCallback(async (value) => {
    setBusy(true);
    const r = await saveRaufAvatar(value);
    setBusy(false);
    return r;
  }, []);
  return { busy, save };
}
