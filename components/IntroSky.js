'use client';
// Opening animation extras (4 Nov 2026), used by components/IntroSplash.js:
//   IntroSky   = a tall sky behind everything. At the start only its lower half shows (day blue fading to the white
//                horizon over the office scene); when the camera tilts up it slides down and the upper half shows:
//                deep night blue with twinkling stars, a faint Milky Way and one shooting star.
//   IntroCrowd = dark silhouettes of people at the bottom, clapping, with a few phone lights, while
//                "Powered by KS TECH LLC" comes in.
// Positions come from a fixed seed so the server HTML and the browser draw the same stars (no hydration warning).
// Styles: "Intro story v3" block at the end of app/globals.css (is-sky-*, is-star, is-crowd, is-cl-*).

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const STARS = (() => {
  const r = rng(20261104);
  const out = [];
  for (let i = 0; i < 170; i += 1) {
    const top = Math.pow(r(), 1.25) * 46;          // more stars high up, fewer near the horizon
    const big = r() < 0.08;
    out.push({
      left: (r() * 100).toFixed(2),
      top: top.toFixed(2),
      size: big ? (2.4 + r() * 1.4).toFixed(1) : (0.8 + r() * 1.5).toFixed(1),
      big,
      dur: (1.6 + r() * 3.2).toFixed(2),
      delay: (r() * -5).toFixed(2),               // negative = already twinkling when it appears
      dim: (0.35 + r() * 0.5).toFixed(2),
      warm: r() < 0.18,
    });
  }
  return out;
})();

export function IntroSky() {
  return (
    <div className="is-sky" aria-hidden="true">
      <span className="is-sky-milky" />
      {STARS.map((s, i) => (
        <i
          key={i}
          className={`is-star${s.big ? ' big' : ''}${s.warm ? ' warm' : ''}`}
          style={{
            left: `${s.left}%`, top: `${s.top}%`, width: `${s.size}px`, height: `${s.size}px`,
            animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s`, '--dim': s.dim,
          }}
        />
      ))}
      <span className="is-shoot" />
    </div>
  );
}

/* one person in the dark: head, shoulders, arms raised with the hands clapping above the head (or holding a phone up) */
function Person({ x, y, s, tone, delay, speed, phone }) {
  const anim = { animationDelay: `${delay}ms`, animationDuration: `${speed}ms` };
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-30 140 L-30 46 Q-30 26 -13 24 L13 24 Q30 26 30 46 L30 140 Z" fill={tone} />
      <rect x="-5" y="14" width="10" height="13" fill={tone} />
      <ellipse cx="0" cy="5" rx="11" ry="13" fill={tone} />
      <path d="M-10 -3 Q0 -12 10 -3" stroke="rgba(130,170,240,.4)" strokeWidth="1.6" fill="none" />
      {/* upper arms (still) */}
      <path d="M-22 34 L-28 4" stroke={tone} strokeWidth="9" strokeLinecap="round" />
      {phone ? (
        <>
          <path d="M22 34 L26 2 L24 -24" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x="18" y="-44" width="12" height="19" rx="2" fill="#0b1220" />
          <rect x="19.5" y="-42.5" width="9" height="15" rx="1" className="is-phone" style={{ animationDelay: `${delay}ms` }} />
          <g className="is-cl-l" style={anim}>
            <path d="M-28 4 L-10 -22" stroke={tone} strokeWidth="8" strokeLinecap="round" />
            <ellipse cx="-7" cy="-26" rx="4.5" ry="6.5" fill={tone} />
          </g>
        </>
      ) : (
        <>
          <path d="M22 34 L28 4" stroke={tone} strokeWidth="9" strokeLinecap="round" />
          <g className="is-cl-l" style={anim}>
            <path d="M-28 4 L-8 -22" stroke={tone} strokeWidth="8" strokeLinecap="round" />
            <ellipse cx="-4.5" cy="-27" rx="4.5" ry="6.5" fill={tone} />
          </g>
          <g className="is-cl-r" style={anim}>
            <path d="M28 4 L8 -22" stroke={tone} strokeWidth="8" strokeLinecap="round" />
            <ellipse cx="4.5" cy="-27" rx="4.5" ry="6.5" fill={tone} />
          </g>
        </>
      )}
    </g>
  );
}

const CROWD = (() => {
  const r = rng(77);
  const back = [];
  const front = [];
  for (let x = -20; x < 1640; x += 44 + r() * 16) {
    back.push({ x, y: 104 + r() * 12, s: 0.82 + r() * 0.14, delay: Math.round(r() * 400), speed: Math.round(300 + r() * 120), phone: r() < 0.12 });
  }
  for (let x = 0; x < 1640; x += 54 + r() * 16) {
    front.push({ x: x + 20, y: 168 + r() * 14, s: 1.18 + r() * 0.2, delay: Math.round(r() * 400), speed: Math.round(280 + r() * 110), phone: r() < 0.08 });
  }
  return { back, front };
})();

export function IntroCrowd() {
  return (
    <div className="is-crowd" aria-hidden="true">
      <span className="is-crowd-glow" />
      <svg viewBox="0 0 1600 260" preserveAspectRatio="xMidYMax slice">
        <g>{CROWD.back.map((p, i) => <Person key={`b${i}`} {...p} tone="#0e1d3d" />)}</g>
        <g>{CROWD.front.map((p, i) => <Person key={`f${i}`} {...p} tone="#060c1a" />)}</g>
      </svg>
    </div>
  );
}
