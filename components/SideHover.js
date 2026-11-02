'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/*
  Side menu open / close on a PC (2 Nov 2026). Adds the class "open" to the side menu (.page.has-side > .tsn)
  while the mouse is on it (or keyboard focus is inside it), removes it when the mouse leaves, when a page /
  tab is picked, and on every page change. CSS: "Side menu on a PC, the ONLY rules" in app/globals.css.
*/
export default function SideHover() {
  const path = usePathname();
  useEffect(() => {
    const el = document.querySelector('.page.has-side > .tsn');
    if (!el) return undefined;
    const open = () => el.classList.add('open');
    const close = () => el.classList.remove('open');
    const onClick = (e) => {
      // a page or tab was picked (not a folder head that just opens its list): close and drop focus
      if (e.target.closest('a, .tsn-btn:not(.tsn-head)')) { close(); try { document.activeElement?.blur(); } catch { /* ignore */ } }
    };
    const onFocusOut = (e) => { if (!el.contains(e.relatedTarget) && !el.matches(':hover')) close(); };
    const onKeyFocus = () => { if (el.matches(':focus-visible, :has(:focus-visible)')) open(); };
    close();
    el.addEventListener('mouseenter', open);
    el.addEventListener('mouseleave', close);
    el.addEventListener('click', onClick);
    el.addEventListener('focusin', onKeyFocus);
    el.addEventListener('focusout', onFocusOut);
    return () => {
      el.removeEventListener('mouseenter', open);
      el.removeEventListener('mouseleave', close);
      el.removeEventListener('click', onClick);
      el.removeEventListener('focusin', onKeyFocus);
      el.removeEventListener('focusout', onFocusOut);
    };
  }, [path]);
  return null;
}
