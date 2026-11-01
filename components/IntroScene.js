'use client';
// Scene under the opening animation (1 Nov 2026): Tudo Num Group at work.
//   · Logistics: Tudo Num trucks with trailers drive across the road both ways (wheels turning, lane lines moving)
//   · Office: a glass office building, cut open, with staff at their desks typing while charts grow on their
//     screens, and a manager presenting a rising line chart on the whiteboard
//   · Oman touch: Hajar mountains, city skyline and palm trees in the background
// Pure SVG + CSS (is-sc-* classes in app/globals.css), nothing to download. Drawn in a 1600 x 380 box that
// fills the bottom of the screen (on phones the middle part shows).

const SKIN = ['#c98d62', '#e0ac82', '#a8714c', '#d79b70'];

/* One person sitting at a desk, typing, with a monitor whose bar chart grows */
function Worker({ x, y, shirt, skin, hair = '#2b2b2b', delay = 0 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* chair */}
      <path d="M14 44 h22 v30 h-4 v-26 h-14 z" fill="#3d4a57" />
      <rect x="12" y="74" width="30" height="5" rx="2" fill="#2c3640" />
      <path d="M26 79 v12 M18 92 h16" stroke="#2c3640" strokeWidth="3" strokeLinecap="round" />
      {/* desk */}
      <rect x="40" y="66" width="86" height="6" rx="2" fill="#c9a979" />
      <rect x="44" y="72" width="4" height="22" fill="#a88a5c" />
      <rect x="118" y="72" width="4" height="22" fill="#a88a5c" />
      {/* monitor */}
      <rect x="82" y="26" width="42" height="30" rx="3" fill="#1c2a38" />
      <rect x="85" y="29" width="36" height="24" rx="1.5" fill="#eaf4ff" className="is-sc-screen" style={{ animationDelay: `${delay}ms` }} />
      <g className="is-sc-bars">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={89 + i * 8} y={33 + (3 - i) * 4} width="5" height={17 - (3 - i) * 4} rx="1"
            fill={i === 3 ? '#13836b' : '#1d5fd1'} className="is-sc-bar" style={{ animationDelay: `${1500 + delay + i * 140}ms` }} />
        ))}
      </g>
      <rect x="100" y="56" width="6" height="10" fill="#1c2a38" />
      <rect x="94" y="64" width="18" height="3" rx="1" fill="#1c2a38" />
      {/* keyboard + cup */}
      <rect x="62" y="62" width="22" height="4" rx="1" fill="#8796a3" />
      <rect x="48" y="58" width="7" height="8" rx="1.5" fill="#fff" stroke="#c9d3da" />
      {/* person */}
      <path d="M18 46 q0 -14 12 -14 h6 q10 0 10 14 v22 h-28 z" fill={shirt} />
      <rect x="20" y="66" width="34" height="8" rx="4" fill="#2f3d4c" />
      <rect x="48" y="66" width="8" height="26" rx="4" fill="#2f3d4c" />
      <circle cx="33" cy="22" r="9" fill={skin} />
      <path d="M24 21 q1 -11 10 -10 q8 1 8 9 q-4 -4 -9 -3 q-5 1 -9 4 z" fill={hair} />
      {/* typing arm (moves) */}
      <g className="is-sc-arm" style={{ animationDelay: `${delay}ms` }}>
        <path d="M36 40 q10 8 26 20" stroke={shirt} strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="64" cy="61" r="3.5" fill={skin} />
      </g>
    </g>
  );
}

/* A truck with trailer, facing right. `label` on the trailer side. */
function Truck({ cab = '#1d5fd1', trailer = '#ffffff', stripe = '#13836b', label = 'TUDO NUM LOGISTICS', container = false, mirrored = false }) {
  return (
    <g className="is-sc-bounce">
      <ellipse cx="170" cy="92" rx="175" ry="7" fill="rgba(0,0,0,.18)" />
      {/* trailer */}
      {container ? (
        <g>
          <rect x="0" y="10" width="250" height="66" rx="3" fill={trailer} />
          {Array.from({ length: 16 }).map((_, i) => <rect key={i} x={8 + i * 15} y="14" width="3" height="58" fill="rgba(0,0,0,.12)" />)}
          <rect x="0" y="10" width="250" height="66" rx="3" fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="2" />
          <text x="125" y="50" textAnchor="middle" className="is-sc-tr-label" fill="#fff" transform={mirrored ? 'translate(250 0) scale(-1 1)' : undefined}>{label}</text>
        </g>
      ) : (
        <g>
          <rect x="0" y="8" width="250" height="68" rx="4" fill={trailer} stroke="#c6d2db" strokeWidth="2" />
          <rect x="0" y="58" width="250" height="8" fill={stripe} />
          <rect x="0" y="66" width="250" height="3" fill="#c99a3b" />
          <text x="125" y="44" textAnchor="middle" className="is-sc-tr-label" fill="#1d3f6e">{label}</text>
        </g>
      )}
      <rect x="0" y="76" width="262" height="6" fill="#2c3640" />
      {/* cab */}
      <path d="M262 30 h40 q14 0 20 14 l10 22 v16 h-70 z" fill={cab} />
      <path d="M296 36 h8 q9 0 13 10 l6 14 h-27 z" fill="#cfe6ff" />
      <rect x="262" y="62" width="70" height="4" fill="rgba(255,255,255,.35)" />
      <rect x="326" y="70" width="10" height="6" rx="2" fill="#ffd36b" className="is-sc-light" />
      <rect x="256" y="20" width="6" height="40" rx="2" fill="#8796a3" />
      {/* wheels */}
      {[30, 62, 200, 232, 286, 318].map((cx) => (
        <g key={cx} transform={`translate(${cx} 86)`}>
          <circle r="13" fill="#1b2229" />
          <g className="is-sc-wheel">
            <circle r="6" fill="#aab6c0" />
            <path d="M0 -6 V6 M-6 0 H6" stroke="#5c6975" strokeWidth="2" />
          </g>
        </g>
      ))}
    </g>
  );
}

/* Small delivery van, facing right */
function Van() {
  return (
    <g className="is-sc-bounce">
      <ellipse cx="62" cy="58" rx="66" ry="5" fill="rgba(0,0,0,.16)" />
      <path d="M0 10 h78 q10 0 16 10 l22 18 v16 h-116 z" fill="#ffffff" stroke="#c6d2db" strokeWidth="2" />
      <path d="M84 16 q6 0 10 6 l12 12 h-22 z" fill="#cfe6ff" />
      <rect x="0" y="40" width="116" height="5" fill="#13836b" />
      <text x="40" y="33" textAnchor="middle" className="is-sc-van-label" fill="#1d3f6e">TUDO NUM</text>
      {[24, 92].map((cx) => (
        <g key={cx} transform={`translate(${cx} 54)`}>
          <circle r="10" fill="#1b2229" />
          <g className="is-sc-wheel"><circle r="4.5" fill="#aab6c0" /><path d="M0 -4.5 V4.5 M-4.5 0 H4.5" stroke="#5c6975" strokeWidth="1.6" /></g>
        </g>
      ))}
    </g>
  );
}

function Palm({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="is-sc-palm">
      <path d="M0 0 q6 -40 -4 -80" stroke="#a88a5c" strokeWidth="7" fill="none" strokeLinecap="round" />
      <g transform="translate(-4 -80)" fill="#5fae8f">
        <path d="M0 0 q-30 -14 -52 4 q26 -6 52 -4z" />
        <path d="M0 0 q30 -14 52 4 q-26 -6 -52 -4z" />
        <path d="M0 0 q-20 -26 -40 -22 q22 4 40 22z" />
        <path d="M0 0 q20 -26 40 -22 q-22 4 -40 22z" />
        <path d="M0 0 q-6 -30 6 -38 q-2 18 -6 38z" />
      </g>
    </g>
  );
}

export default function IntroScene() {
  return (
    <div className="is-scene" aria-hidden="true">
      {/* the stage keeps the 1600 x 380 shape and covers the scene box; the vehicles are separate layers on it so
          the browser can slide them on the graphics card (smooth, no stutter) instead of redrawing the picture */}
      <div className="is-stage">
      <svg viewBox="0 0 1600 380" preserveAspectRatio="xMidYMax meet" className="is-stage-bg">
        <defs>
          <linearGradient id="isGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dbeaf6" />
            <stop offset="1" stopColor="#c4dbeb" />
          </linearGradient>
          <linearGradient id="isRoom" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf6" />
            <stop offset="1" stopColor="#f3efe3" />
          </linearGradient>
          <linearGradient id="isRoad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#56626d" />
            <stop offset="1" stopColor="#434e58" />
          </linearGradient>
          <linearGradient id="isFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Hajar mountains + skyline */}
        <g className="is-sc-back">
          <path d="M0 262 L90 190 L170 228 L270 150 L380 222 L470 176 L560 236 L700 168 L820 230 L930 160 L1050 220 L1160 172 L1280 236 L1380 186 L1490 226 L1600 178 V262 Z" fill="#e3ecf1" />
          <g fill="#d6e2ea">
            <rect x="60" y="200" width="40" height="62" /><rect x="104" y="180" width="30" height="82" /><rect x="138" y="214" width="46" height="48" />
            <rect x="960" y="196" width="36" height="66" /><rect x="1000" y="170" width="28" height="92" /><rect x="1032" y="206" width="52" height="56" />
            <rect x="1300" y="188" width="34" height="74" /><rect x="1338" y="210" width="50" height="52" /><rect x="1392" y="176" width="26" height="86" />
            <path d="M1110 262 v-70 l14 -18 l14 18 v70 z" />
          </g>
        </g>

        {/* office building, cut open (centred so phones show all of it) */}
        <g transform="translate(140 0)"><g className="is-sc-office">
          <rect x="400" y="34" width="520" height="230" rx="6" fill="url(#isGlass)" stroke="#b9cddc" strokeWidth="2" />
          {/* two upper floors, windows light up one by one */}
          {[44, 82].map((wy, row) => Array.from({ length: 12 }).map((_, i) => (
            <rect key={`${row}-${i}`} x={416 + i * 41.5} y={wy} width="32" height="28" rx="2" fill="#eef6fc" stroke="#c7d9e6"
              className={(i + row * 2) % 3 === 1 ? 'is-sc-win on' : 'is-sc-win'} style={{ animationDelay: `${600 + (i + row * 12) * 60}ms` }} />
          )))}
          <rect x="400" y="78" width="520" height="2" fill="#c7d9e6" />
          <rect x="400" y="116" width="520" height="4" fill="#b9cddc" />
          {/* sign on the roof */}
          <rect x="565" y="6" width="190" height="26" rx="5" fill="#ffffff" stroke="#c7d9e6" />
          <rect x="655" y="30" width="10" height="6" fill="#c7d9e6" />
          <text x="660" y="24" textAnchor="middle" className="is-sc-sign">TUDO NUM GROUP</text>
          {/* the open office floor */}
          <rect x="412" y="126" width="496" height="136" rx="3" fill="url(#isRoom)" stroke="#d9cfb6" />
          <rect x="412" y="252" width="496" height="10" fill="#e4dac2" />
          {/* ceiling lights */}
          {[470, 600, 730, 860].map((cx) => (
            <g key={cx}><rect x={cx - 18} y="128" width="36" height="4" rx="2" fill="#f7e7b5" /><path d={`M${cx - 18} 132 L${cx - 34} 180 H${cx + 34} L${cx + 18} 132 Z`} fill="rgba(255,230,160,.18)" /></g>
          ))}
          {/* plant */}
          <g transform="translate(886 212)"><rect x="-8" y="20" width="16" height="20" rx="3" fill="#c99a3b" /><path d="M0 20 q-16 -10 -14 -28 q8 10 14 28 q2 -24 14 -32 q2 18 -14 32" fill="#5fae8f" /></g>
          {/* staff at desks */}
          <Worker x={420} y={160} shirt="#1d5fd1" skin={SKIN[0]} delay={0} />
          <Worker x={556} y={160} shirt="#13836b" skin={SKIN[1]} hair="#4a3426" delay={300} />
          {/* manager at the whiteboard with a rising line chart */}
          <g transform="translate(700 140)">
            <rect x="0" y="0" width="150" height="86" rx="4" fill="#ffffff" stroke="#b9c4cc" strokeWidth="3" />
            <path d="M14 70 H138 M14 70 V12" stroke="#c9d3da" strokeWidth="2" />
            <polyline points="18,62 44,52 66,56 90,36 112,30 134,14" fill="none" stroke="#13836b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="is-sc-line" />
            <circle cx="134" cy="14" r="5" fill="#c99a3b" className="is-sc-dot" />
            <rect x="70" y="86" width="10" height="34" fill="#9aa7b2" />
          </g>
          <g transform="translate(856 168)">
            <path d="M8 22 q0 -12 12 -12 h4 q10 0 10 12 v34 h-26 z" fill="#2f3d4c" />
            <path d="M12 56 h8 v38 h-8 z M24 56 h8 v38 h-8 z" fill="#1f2a35" />
            <circle cx="22" cy="0" r="9" fill={SKIN[2]} />
            <path d="M13 -1 q1 -11 10 -10 q8 1 8 9 q-6 -3 -18 1z" fill="#1d1d1d" />
            <g className="is-sc-point"><path d="M12 18 q-14 -10 -26 -22" stroke="#2f3d4c" strokeWidth="7" strokeLinecap="round" fill="none" /><circle cx="-15" cy="-5" r="3.5" fill={SKIN[2]} /></g>
          </g>
        </g></g>

        {/* palms */}
        <Palm x={420} y={268} s={1.05} />
        <Palm x={1130} y={268} s={0.95} />
        <Palm x={1480} y={268} s={1.1} />
        <Palm x={130} y={268} s={0.9} />

        {/* road */}
        <rect x="0" y="262" width="1600" height="8" fill="#d5dde3" />
        <rect x="0" y="270" width="1600" height="78" fill="url(#isRoad)" />
        <line x1="0" y1="309" x2="1600" y2="309" stroke="#f2c14e" strokeWidth="4" strokeDasharray="44 30" />
        <rect x="0" y="348" width="1600" height="6" fill="#d5dde3" />
        <rect x="0" y="354" width="1600" height="26" fill="url(#isFade)" />

      </svg>
        {/* far lane: container truck going left */}
        <div className="is-veh t2"><svg viewBox="0 0 352 100"><g transform="translate(346 0) scale(-1 1)"><Truck cab="#13836b" trailer="#c99a3b" container mirrored label="TUDO NUM" /></g></svg></div>
        {/* near lane: Tudo Num trailer going right */}
        <div className="is-veh t1"><svg viewBox="-6 0 352 100"><Truck /></svg></div>
        {/* near lane: delivery van a little later */}
        <div className="is-veh t3"><svg viewBox="-4 0 124 64"><Van /></svg></div>
      </div>
    </div>
  );
}
