'use client';
// Opening animation. Plays every time the MAIN page (/) is opened or refreshed, and again from the "▶ Intro" button
// on the Home page. Tap / click / any key skips it.
//
// Story v3 (4 Nov 2026, Kamran):
//   0.0 s  the office scene is on screen at once and BOTH trucks are already in view (also on phones),
//          driving towards each other on the highway in front of the Tudo Num office tower
//   ~2.3 s the two trailers cross each other in front of the building
//   2.6 s  the camera tilts up: the scene slides down, the sky turns from day blue to deep night blue
//          with twinkling stars, a faint Milky Way and a shooting star (components/IntroSky.js)
//   3.4 s  the Tudo Num Group logo (on a white card) comes into focus, TUDO NUM GROUP, OFFICE SYSTEMS
//   6.4 s  a crowd rises at the bottom and claps while "Powered by" and then "KS TECH LLC" appear
//   ~12 s  everything fades and the normal page comes forward
// The overlay is in the server HTML so the page never flashes before it; INTRO_BOOT
// (lib/intro.js, run in app/layout.js <head>) hides it at once on every page except the main page.
// Styles: "Intro story v3" block at the end of app/globals.css (older intro blocks above it still give the base look).
import { useEffect, useRef, useState } from 'react';
import { INTRO_REPLAY } from '@/lib/intro';
import IntroScene from '@/components/IntroScene';
import { IntroSky, IntroCrowd } from '@/components/IntroSky';

const CAM_AT = 2600;    // trailers have just crossed: camera goes up
const BRAND_AT = 3400;  // logo part starts (its own animation delays count from here)
const OUT_AT = 12000;   // KS TECH LLC done ~6.4 s after BRAND_AT, holds ~2 s, then fade out
const OUT_MS = 900;     // length of the fade out

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
  const [phase, setPhase] = useState('scene'); // scene | cam | brand
  const timers = useRef([]);
  const leaving = useRef(false);

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const schedule = () => {
    timers.current.push(
      setTimeout(() => setPhase('cam'), CAM_AT),
      setTimeout(() => setPhase('brand'), BRAND_AT),
      setTimeout(leave, OUT_AT),
    );
  };

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
    setPhase('scene');
    schedule();
  };

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains('intro-done')) setState('gone');
    else {
      root.classList.add('intro-playing');
      schedule();
    }

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

  const camUp = phase !== 'scene';

  return (
    <div
      key={run}
      className={`intro-splash story v3 ph-${phase}${camUp ? ' cam-up' : ''}${state === 'out' ? ' is-out' : ''}`}
      role="presentation"
      onClick={leave}
    >
      <IntroSky />
      <IntroScene />

      {phase === 'brand' && (<>
        <div className="is-center">
          <div className="is-logo-wrap">
            <span className="is-halo" aria-hidden="true" />
            <span className="is-logo-card">
              <span className="is-logo" role="img" aria-label="Tudo Num Group">
                <img className="is-lg-base" src="/brand-base.png" alt="" />
                <img className="is-lg-arrow" src="/brand-arrow.png" alt="" />
                <span className="is-logo-shine" aria-hidden="true" />
              </span>
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

          <div className="is-powered" aria-label="Powered by KS TECH LLC">
            <span className="is-pw-small">Powered by</span>
            <Letters text="KS TECH LLC" start={4900} step={60} className="is-pw-name" />
            <span className="is-pw-glow" aria-hidden="true" />
          </div>
        </div>

        <IntroCrowd />
      </>)}

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
