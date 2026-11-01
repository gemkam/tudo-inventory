'use client';

import { useEffect, useState } from 'react';

/*
  Side menu open / closed (1 Nov 2026). Open = a full menu column on the LEFT, the page moves right (nothing is
  covered). Closed = a thin icon strip. The choice is remembered on this device (localStorage "tudo-side").
  Sets the class "side-closed" on <html>; CSS in app/globals.css ("Side menu column").
*/
export default function SideToggle() {
  const [closed, setClosed] = useState(true);
  useEffect(() => {
    let c = true; /* 1 Nov 2026: starts as the thin strip that opens on mouse hover; « / ☰ pins it open */
    try { c = localStorage.getItem('tudo-side') !== 'open'; } catch { /* ignore */ }
    setClosed(c);
    document.documentElement.classList.toggle('side-closed', c);
  }, []);
  function toggle() {
    const c = !closed;
    setClosed(c);
    document.documentElement.classList.toggle('side-closed', c);
    try { localStorage.setItem('tudo-side', c ? 'closed' : 'open'); } catch { /* ignore */ }
  }
  return (
    <button type="button" className="tsn-toggle" onClick={toggle} aria-expanded={!closed} title={closed ? 'Keep the menu open' : 'Close the menu (it opens when the mouse is on it)'} aria-label={closed ? 'Keep the menu open' : 'Close the menu'}>
      {closed ? '☰' : '«'}
    </button>
  );
}
