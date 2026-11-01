'use client';
// Opening animation (1 Nov 2026).
// Plays once per browser tab when the app is first opened:
//   1. dark stage fades in (moving light in the theme colour), the Tudo Num Group logo comes into focus
//      and its green arrow draws itself up
//   2. "TUDO NUM GROUP" letters rise one by one out of a blur, then a light runs across them
//   3. "OFFICE SYSTEMS" closes in from wide letter spacing, gold lines draw out on both sides
//   4. "Powered by KS TECH LLC" rises at the bottom with a glowing line
//   5. everything fades away and the normal page comes forward
// Tap / click / any key skips it. Not shown to people who ask their phone for less motion.
// The overlay is in the server HTML so the page never flashes before it; INTRO_BOOT
// (lib/intro.js, run in app/layout.js <head>) hides it at once if it already played in this tab.
import { useEffect, useRef, useState } from 'react';
import { INTRO_KEY as KEY } from '@/lib/intro';

const OUT_AT = 5400;   // ms after open when the fade out starts
const OUT_MS = 900;    // length of the fade out


function Letters({ text, start, step, glint, className }) {
  let i = 0;
  return (
    <span className={className} aria-hidden="true">
      {text.split('').map((ch, k) => {
        if (ch === ' ') return <span key={k} className="is-gap" />;
        const d = start + step * i;
        const g = glint != null ? glint + 40 * i : null;
        i += 1;
        return (
          <span key={k} className="is-ch" style={{ animationDelay: g != null ? `${d}ms, ${g}ms` : `${d}ms` }}>{ch}</span>
        );
      })}
    </span>
  );
}

export default function IntroSplash() {
  const [state, setState] = useState('play'); // play | out | gone
  const timers = useRef([]);
  const leaving = useRef(false);

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    timers.current.forEach(clearTimeout);
    const root = document.documentElement;
    setState('out');
    root.classList.remove('intro-playing');   // page underneath comes forward while the splash fades
    timers.current.push(setTimeout(() => {
      root.classList.add('intro-done');
      setState('gone');
    }, OUT_MS));
  };

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('intro-done')) { setState('gone'); return undefined; }
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode: plays each time */ }
    root.classList.add('intro-playing');
    timers.current.push(setTimeout(leave, OUT_AT));
    const onKey = () => leave();
    window.addEventListener('keydown', onKey);
    return () => {
      timers.current.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'gone') return null;

  return (
    <div className={`intro-splash${state === 'out' ? ' is-out' : ''}`} role="presentation" onClick={leave}>
      <div className="is-aurora" aria-hidden="true">
        <i className="a1" /><i className="a2" /><i className="a3" />
      </div>
      <div className="is-grid" aria-hidden="true" />
      <div className="is-vignette" aria-hidden="true" />

      <div className="is-center">
        <div className="is-logo-wrap">
          <span className="is-halo" aria-hidden="true" />
          <span className="is-logo" role="img" aria-label="Tudo Num Group">
            <img className="is-lg-base" src="/brand-base.png" alt="" />
            <img className="is-lg-arrow" src="/brand-arrow.png" alt="" />
            <span className="is-logo-shine" aria-hidden="true" />
          </span>
        </div>

        <h1 className="is-title" aria-label="Tudo Num Group">
          <Letters text="TUDO NUM GROUP" start={1450} step={55} glint={2750} className="is-title-in" />
        </h1>

        <div className="is-sub" aria-label="Office Systems">
          <span className="is-line l" aria-hidden="true" />
          <span className="is-sub-text" aria-hidden="true">OFFICE SYSTEMS</span>
          <span className="is-line r" aria-hidden="true" />
        </div>
      </div>

      <div className="is-powered" aria-label="Powered by KS TECH LLC">
        <span className="is-pw-small">Powered by</span>
        <Letters text="KS TECH LLC" start={3650} step={45} className="is-pw-name" />
        <span className="is-pw-glow" aria-hidden="true" />
      </div>

      <span className="is-skip" aria-hidden="true">Tap to skip</span>
    </div>
  );
}
