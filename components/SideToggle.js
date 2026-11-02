'use client';

import { useEffect } from 'react';

/*
  Side menu « / ☰ button: retired 2 Nov 2026. The side menu on a PC now opens when the mouse is on it and closes
  when it leaves (components/SideHover.js). Kept as an empty component so the menus that import it still work;
  it also clears the old "side-closed" setting so it can no longer interfere.
*/
export default function SideToggle() {
  useEffect(() => {
    document.documentElement.classList.remove('side-closed');
    try { localStorage.removeItem('tudo-side'); } catch { /* ignore */ }
  }, []);
  return null;
}
