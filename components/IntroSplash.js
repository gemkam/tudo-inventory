'use client';
// Opening animation (1 Nov 2026, white look).
// Plays every time the MAIN page (/) is opened or refreshed, and again from the "▶ Intro" button on the Home page:
//   0. at the bottom, the logistics + office scene (components/IntroScene.js): trucks with trailers drive across,
//      staff work at their desks in the Tudo Num office
//   1. white stage fades in (soft moving light), the Tudo Num Group logo comes into focus
//      and its green arrow draws itself up, a shine runs over it
//   2. "TUDO NUM GROUP" letters rise one by one out of a blur, then a light runs across them
//   3. "OFFICE SYSTEMS" closes in from wide letter spacing, gold lines draw out on both sides
//   4. "Powered by KS TECH LLC" rises at the bottom with a glowing line
//   5. everything fades away and the normal page comes forward
// Tap / click / any key skips it. Not shown to people who ask their device for less motion.
// The overlay is in the server HTML so the page never flashes before it; INTRO_BOOT
// (lib/intro.js, run in app/layout.js <head>) hides it at once on every page except the main page.
import { useEffect, useRef, useState } from 'react';
import { INTRO_REPLAY } from '@/lib/intro';
import IntroScene from '@/components/IntroScene';

const OUT_AT = 8800;   // ms after open when the fade out starts (KS TECH LLC done by ~5.8s, then holds 3 s)
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
  const [run, setRun] = useState(0);           // changes on replay so every CSS animation starts again
  const timers = useRef([]);
  const leaving = useRef(false);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    clear();
    const root = document.documentElement;
    setState('out');
    root.classList.remove('intro-playing');   // page underneath comes forward while the splash fades
    timers.current.push(setTimeout(() => {
      root.classList.add('intro-done');
      setState('gone');
    }, OUT_MS));
  };

  const start = () => {
    clear();
    leaving.current = false;
    const root = document.documentElement;
    root.classList.remove('intro-done');
    root.classList.add('intro-playing');
    setRun((r) => r + 1);
    setState('play');
    timers.current.push(setTimeout(leave, OUT_AT));
  };

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('intro-done')) setState('gone');
    else { root.classList.add('intro-playing'); timers.current.push(setTimeout(leave, OUT_AT)); }

    const onKey = () => { if (!leaving.current && root.classList.contains('intro-playing')) leave(); };
    const onReplay = () => start();
    window.addEventListener('keydown', onKey);
    window.addEventListener(INTRO_REPLAY, onReplay);
    return () => {
      clear();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(INTRO_REPLAY, onReplay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'gone') return null;

  return (
    <div key={run} className={`intro-splash${state === 'out' ? ' is-out' : ''}`} role="presentation" onClick={leave}>
      <div className="is-aurora" aria-hidden="true">
        <i className="a1" /><i className="a2" /><i className="a3" />
      </div>
      <IntroScene />

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
        <Letters text="KS TECH LLC" start={4950} step={55} className="is-pw-name" />
        <span className="is-pw-glow" aria-hidden="true" />
      </div>

      <span className="is-skip" aria-hidden="true">Tap to skip</span>
    </div>
  );
}

// Small button for the Home page that plays the opening animation again.
export function IntroReplayButton() {
  return (
    <button
      type="button"
      className="intro-replay no-print"
      onClick={() => window.dispatchEvent(new Event(INTRO_REPLAY))}
      title="Play the opening animation"
    >
      ▶ Intro
    </button>
  );
}
