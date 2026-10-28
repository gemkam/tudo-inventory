'use client';

import { useEffect, useRef, useState } from 'react';
import { PALETTES, DEFAULT_THEME, readTheme, saveTheme } from '@/lib/theme';

/* Top bar: Day / Night button + colour chooser (a dark and a light colour together) */
export default function ThemeMenu() {
  const [t, setT] = useState(DEFAULT_THEME);
  const [open, setOpen] = useState(false);
  const [popStyle, setPopStyle] = useState(null);
  const boxRef = useRef(null);
  const colBtnRef = useRef(null);

  // Keep the colour box fully on the screen, whatever the window width
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = colBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = window.innerWidth; const H = window.innerHeight;
      const w = Math.min(286, W - 16);
      const left = Math.min(Math.max(8, r.right - w), W - w - 8);
      const top = r.bottom + 10;
      setPopStyle({ position: 'fixed', left, top, right: 'auto', width: w, maxHeight: Math.max(220, H - top - 12), overflowY: 'auto' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    setT(readTheme());
    const onTheme = (e) => setT(e.detail);
    window.addEventListener('tudo-theme', onTheme);
    return () => window.removeEventListener('tudo-theme', onTheme);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const update = (patch) => {
    const next = { ...t, ...patch };
    setT(next);
    saveTheme(next);
  };

  const night = t.mode === 'dark';
  const isActive = (d, l) => t.dark.toLowerCase() === d && t.light.toLowerCase() === l;

  return (
    <div className="theme-menu" ref={boxRef}>
      <button
        type="button"
        className="theme-btn"
        onClick={() => update({ mode: night ? 'light' : 'dark' })}
        aria-label={night ? 'Switch to day mode' : 'Switch to night mode'}
        title={night ? 'Day mode' : 'Night mode'}
      >
        {night ? (
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" fill="currentColor" /></svg>
        )}
      </button>
      <button
        type="button"
        ref={colBtnRef}
        className={`theme-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Choose colours"
        title="Colours"
      >
        <span className="theme-dot" style={{ background: `linear-gradient(135deg, ${t.dark} 50%, ${t.light} 50%)` }} />
      </button>

      {open && (
        <div className="theme-pop" role="dialog" aria-label="Colours" style={popStyle || { visibility: 'hidden' }}>
          <div className="theme-pop-head">Appearance</div>
          <div className="theme-mode" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" aria-checked={!night} className={!night ? 'on' : ''} onClick={() => update({ mode: 'light' })}>☀️ Day</button>
            <button type="button" role="radio" aria-checked={night} className={night ? 'on' : ''} onClick={() => update({ mode: 'dark' })}>🌙 Night</button>
          </div>

          <div className="theme-pop-head">Colour pairs</div>
          <div className="theme-grid">
            {PALETTES.map(([name, d, l]) => (
              <button
                key={name}
                type="button"
                className={`theme-swatch ${isActive(d, l) ? 'on' : ''}`}
                onClick={() => update({ dark: d, light: l })}
                aria-pressed={isActive(d, l)}
                title={name}
              >
                <span className="sw"><i style={{ background: d }} /><i style={{ background: l }} /></span>
                <small>{name}</small>
              </button>
            ))}
          </div>

          <div className="theme-pop-head">Your own colours</div>
          <div className="theme-custom">
            <label>
              <input type="color" value={t.dark} onChange={(e) => update({ dark: e.target.value })} />
              <span>Dark<small>{t.dark}</small></span>
            </label>
            <label>
              <input type="color" value={t.light} onChange={(e) => update({ light: e.target.value })} />
              <span>Light<small>{t.light}</small></span>
            </label>
          </div>

          <button type="button" className="theme-reset" onClick={() => update({ ...DEFAULT_THEME, mode: t.mode })}>Reset to default</button>
        </div>
      )}
    </div>
  );
}
