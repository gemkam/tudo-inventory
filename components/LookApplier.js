'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { LOOK_KEY, LOOK_CACHE, parseLook, lookCss, applyTexts } from '@/lib/look';

/*
  Puts the Administrator's look (Power Editor tabs 🎨 Styles, 📐 Layout, ✏️ Texts; lib/look.js) on every page for every user.
  Cached per device so it shows at once; the saved copy is read again after login and on every page change.
  The Power Editor sends 'tudo-look-preview' (detail = look) to show changes before they are saved.
*/
export default function LookApplier() {
  const path = usePathname() || '/';
  const look = useRef(null);
  const busy = useRef(false);

  function paint() {
    const L = look.current;
    if (!L) return;
    let tag = document.getElementById('tudo-look');
    if (!tag) { tag = document.createElement('style'); tag.id = 'tudo-look'; document.head.appendChild(tag); }
    const css = lookCss(L);
    if (tag.textContent !== css) tag.textContent = css;
    busy.current = true;
    try { applyTexts(L.texts, window.location.pathname); } catch { /* never break the page */ }
    busy.current = false;
  }

  useEffect(() => {
    try { const c = localStorage.getItem(LOOK_CACHE); if (c) { look.current = parseLook(c); paint(); } } catch { /* ignore */ }
    const onPreview = (e) => { look.current = parseLook(e.detail); paint(); };
    window.addEventListener('tudo-look-preview', onPreview);
    // texts again whenever the page changes its words
    let t = null;
    const obs = new MutationObserver(() => {
      if (busy.current || !look.current?.texts?.length) return;
      clearTimeout(t); t = setTimeout(paint, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { window.removeEventListener('tudo-look-preview', onPreview); obs.disconnect(); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    sb().from('app_settings').select('value').eq('key', LOOK_KEY).maybeSingle().then(({ data }) => {
      if (!live) return;
      const L = parseLook(data?.value || '{}');
      look.current = L;
      try { localStorage.setItem(LOOK_CACHE, JSON.stringify(L)); } catch { /* ignore */ }
      paint();
    });
    const t = setTimeout(paint, 300);
    return () => { live = false; clearTimeout(t); };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
