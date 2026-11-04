'use client';
// Scene under the opening animation (1 Nov 2026, realistic version): an Oman highway at work.
//   · Background: layered Hajar mountains in haze, desert sand, a modern glass office tower (Tudo Num Group)
//     whose ground floor shows staff at their desks typing while charts grow, a manager presenting a rising chart
//   · Highway: two carriageways with lane markings, steel guard rail, street lights, a green road sign, date palms
//   · Traffic (each vehicle its own smooth layer, see .is-veh in app/globals.css):
//       - MODERN CITY tractor-trailer (with the Modern City logo) driving right in the near lane
//       - TUDO NUM GROUP container truck driving left on the far side
//       - a white pickup overtaking in the inner lane
// Pure SVG + CSS (is-sc-* / is-veh classes in app/globals.css). Drawn in a 1600 x 380 box.
// 4 Nov 2026: vehicles sit on .is-road (screen sized) instead of the wide stage, so they never start off screen.

const SKIN = ['#c98d62', '#e0ac82', '#a8714c', '#d79b70'];

/* One person sitting at a desk, typing, with a monitor whose bar chart grows */
function Worker({ x, y, shirt, skin, hair = '#2b2b2b', delay = 0 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M14 44 h22 v30 h-4 v-26 h-14 z" fill="#3d4a57" />
      <rect x="12" y="74" width="30" height="5" rx="2" fill="#2c3640" />
      <path d="M26 79 v12 M18 92 h16" stroke="#2c3640" strokeWidth="3" strokeLinecap="round" />
      <rect x="40" y="66" width="86" height="6" rx="2" fill="#b98f5e" />
      <rect x="44" y="72" width="4" height="22" fill="#8f6c43" />
      <rect x="118" y="72" width="4" height="22" fill="#8f6c43" />
      <rect x="82" y="26" width="42" height="30" rx="3" fill="#1c2a38" />
      <rect x="85" y="29" width="36" height="24" rx="1.5" fill="#eaf4ff" className="is-sc-screen" style={{ animationDelay: `${delay}ms` }} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={89 + i * 8} y={33 + (3 - i) * 4} width="5" height={17 - (3 - i) * 4} rx="1"
          fill={i === 3 ? '#13836b' : '#1d5fd1'} className="is-sc-bar" style={{ animationDelay: `${1500 + delay + i * 140}ms` }} />
      ))}
      <rect x="100" y="56" width="6" height="10" fill="#1c2a38" />
      <rect x="94" y="64" width="18" height="3" rx="1" fill="#1c2a38" />
      <rect x="62" y="62" width="22" height="4" rx="1" fill="#8796a3" />
      <rect x="48" y="58" width="7" height="8" rx="1.5" fill="#fff" stroke="#c9d3da" />
      <path d="M18 46 q0 -14 12 -14 h6 q10 0 10 14 v22 h-28 z" fill={shirt} />
      <rect x="20" y="66" width="34" height="8" rx="4" fill="#2f3d4c" />
      <rect x="48" y="66" width="8" height="26" rx="4" fill="#2f3d4c" />
      <circle cx="33" cy="22" r="9" fill={skin} />
      <path d="M24 21 q1 -11 10 -10 q8 1 8 9 q-4 -4 -9 -3 q-5 1 -9 4 z" fill={hair} />
      <g className="is-sc-arm" style={{ animationDelay: `${delay}ms` }}>
        <path d="M36 40 q10 8 26 20" stroke={shirt} strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="64" cy="61" r="3.5" fill={skin} />
      </g>
    </g>
  );
}

/* A real-looking wheel: tyre, sidewall, alloy rim with lug nuts (the rim turns) */
function Wheel({ cx, cy, r = 17, id }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r} fill="#15181b" />
      <circle r={r - 3} fill="#262a2f" />
      <g className="is-sc-wheel">
        <circle r={r * 0.62} fill={`url(#${id}Rim)`} stroke="#7d868f" strokeWidth="1" />
        <circle r={r * 0.24} fill="#59626b" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <circle key={a} cx={Math.cos((a * Math.PI) / 180) * r * 0.4} cy={Math.sin((a * Math.PI) / 180) * r * 0.4} r={r * 0.07} fill="#3a4148" />
        ))}
        <rect x={-r * 0.06} y={-r * 0.6} width={r * 0.12} height={r * 0.2} fill="#9aa3ab" />
      </g>
    </g>
  );
}

/* Text / logos on a mirrored truck are flipped back so they stay readable */
const flip = (on, cx) => (on ? `translate(${2 * cx} 0) scale(-1 1)` : undefined);

/*
  Tractor-trailer, facing right, ground at y=150, length ~ x 0..566.
  kind = 'box'  → white box trailer with branding (Modern City)
  kind = 'container' → flatbed with a 40 ft shipping container (Tudo Num Group)
*/
function Truck({ id, kind = 'box', cab = '#f4f6f8', cabDark = '#c9d1d8', mirrored = false }) {
  return (
    <g className="is-sc-bounce">
      <defs>
        <linearGradient id={`${id}Box`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".75" stopColor="#eef1f4" /><stop offset="1" stopColor="#d6dce2" />
        </linearGradient>
        <linearGradient id={`${id}Ctr`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a64b0" /><stop offset="1" stopColor="#173f78" />
        </linearGradient>
        <linearGradient id={`${id}Cab`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={cab} /><stop offset="1" stopColor={cabDark} />
        </linearGradient>
        <linearGradient id={`${id}Glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9fc3e0" /><stop offset=".55" stopColor="#4d6f8c" /><stop offset="1" stopColor="#25394b" />
        </linearGradient>
        <linearGradient id={`${id}Chrome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f9fa" /><stop offset=".35" stopColor="#b9c2ca" /><stop offset=".6" stopColor="#eef1f3" /><stop offset="1" stopColor="#7c8790" />
        </linearGradient>
        <radialGradient id={`${id}Rim`}>
          <stop offset="0" stopColor="#f2f4f6" /><stop offset=".7" stopColor="#b5bec6" /><stop offset="1" stopColor="#8a949d" />
        </radialGradient>
        <radialGradient id={`${id}Shadow`}>
          <stop offset="0" stopColor="#000" stopOpacity=".38" /><stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="285" cy="151" rx="300" ry="9" fill={`url(#${id}Shadow)`} />

      {/* ---------- trailer ---------- */}
      {kind === 'box' ? (
        <g>
          <rect x="0" y="10" width="404" height="104" rx="3" fill={`url(#${id}Box)`} stroke="#b9c3cc" strokeWidth="1.5" />
          {Array.from({ length: 15 }).map((_, i) => <rect key={i} x={26 + i * 25.5} y="12" width="1" height="100" fill="rgba(0,0,0,.05)" />)}
          <rect x="0" y="10" width="404" height="4" fill="#ffffff" />
          <rect x="0" y="92" width="404" height="9" fill="#1f3f73" />
          <rect x="0" y="101" width="404" height="3" fill="#c99a3b" />
          <g transform={flip(mirrored, 202)}>
            <image href="/modern-city-logo.png" x="18" y="26" width="168" height="59" preserveAspectRatio="xMidYMid meet" />
            <rect x="196" y="28" width="1.5" height="56" fill="#c9d1d8" />
            <text x="208" y="54" className="is-veh-big" fill="#1f3f73">MODERN CITY</text>
            <text x="209" y="70" className="is-veh-small" fill="#4d5d6c">FOR EXPRESS SERVICES LLC</text>
            <text x="209" y="84" className="is-veh-small" fill="#13836b">LOGISTICS · TRANSPORT</text>
          </g>
          {/* rear doors hinge + lights */}
          <rect x="0" y="12" width="5" height="100" fill="#c3ccd4" />
          <rect x="1" y="104" width="6" height="8" fill="#c0392b" />
        </g>
      ) : (
        <g>
          {/* 40 ft container on a flatbed */}
          <rect x="4" y="12" width="396" height="98" rx="2" fill={`url(#${id}Ctr)`} />
          {Array.from({ length: 33 }).map((_, i) => <rect key={i} x={10 + i * 12} y="15" width="5" height="92" fill="rgba(255,255,255,.07)" />)}
          <rect x="4" y="12" width="396" height="98" rx="2" fill="none" stroke="#10305d" strokeWidth="3" />
          <rect x="4" y="12" width="396" height="4" fill="rgba(255,255,255,.25)" />
          <g transform={flip(mirrored, 202)}>
            <rect x="34" y="30" width="118" height="66" rx="6" fill="#ffffff" opacity=".95" />
            <image href="/brand-base.png" x="38" y="32" width="110" height="62" preserveAspectRatio="xMidYMid meet" />
            <text x="168" y="62" className="is-veh-big ctr" fill="#ffffff">TUDO NUM GROUP</text>
            <text x="170" y="82" className="is-veh-small" fill="#cfe0f5">OMAN · GLOBAL LOGISTICS</text>
          </g>
          <rect x="0" y="110" width="404" height="6" fill="#2b3036" />
        </g>
      )}
      {/* trailer chassis, side guard, landing gear */}
      <rect x="0" y="114" width="404" height="8" fill="#22272c" />
      <rect x="110" y="122" width="150" height="5" rx="1" fill="#9aa3ab" />
      <rect x="110" y="127" width="150" height="2" fill="#6b747c" />
      <rect x="196" y="122" width="5" height="22" fill="#3a4148" /><rect x="190" y="142" width="17" height="4" fill="#3a4148" />
      {/* trailer mudguards + wheels (tri-axle) */}
      <path d="M278 133 a22 22 0 0 1 44 0 M316 133 a22 22 0 0 1 44 0 M354 133 a22 22 0 0 1 44 0" fill="none" stroke="#1b1f23" strokeWidth="5" />
      <Wheel cx={300} cy={133} id={id} /><Wheel cx={338} cy={133} id={id} /><Wheel cx={376} cy={133} id={id} />
      <rect x="392" y="122" width="10" height="20" fill="#111" />

      {/* ---------- tractor ---------- */}
      <rect x="400" y="112" width="166" height="12" fill="#22272c" />
      {/* exhaust stack */}
      <rect x="452" y="-8" width="7" height="122" rx="3" fill={`url(#${id}Chrome)`} />
      <rect x="450" y="-10" width="11" height="6" rx="2" fill="#5d666e" />
      {/* roof air deflector + cab */}
      <path d="M470 22 Q474 -2 512 -6 L546 -6 Q554 -6 554 4 L554 14 L470 22 Z" fill={`url(#${id}Cab)`} stroke="#b4bec7" />
      <path d="M466 26 Q466 14 480 14 L548 14 Q560 14 562 26 L566 92 Q566 112 556 116 L470 116 Q462 116 462 104 Z" fill={`url(#${id}Cab)`} stroke="#aab4bd" strokeWidth="1.5" />
      {/* windscreen + side window */}
      <path d="M544 22 L556 22 Q562 22 563 30 L565 64 L546 64 Z" fill={`url(#${id}Glass)`} />
      <path d="M498 24 L538 24 L540 62 L498 62 Q494 62 494 56 L494 30 Q494 24 498 24 Z" fill={`url(#${id}Glass)`} />
      <path d="M502 28 L520 28 L506 58 L500 58 Z" fill="rgba(255,255,255,.25)" />
      {/* door, handle, steps */}
      <path d="M492 22 L542 22 L544 104 L492 104 Z" fill="none" stroke="#9aa5af" strokeWidth="1.2" />
      <rect x="532" y="70" width="8" height="3" rx="1" fill="#6b747c" />
      <rect x="500" y="106" width="30" height="4" rx="1" fill="#5d666e" />
      {/* brand stripe on cab */}
      <rect x="464" y="78" width="100" height="6" fill={kind === 'box' ? '#1f3f73' : '#13836b'} />
      <rect x="464" y="84" width="100" height="2" fill="#c99a3b" />
      {/* mirror */}
      <rect x="565" y="26" width="3" height="30" fill="#2b3036" /><rect x="566" y="30" width="8" height="20" rx="2" fill="#2b3036" />
      {/* grille, headlight, bumper */}
      <rect x="560" y="70" width="6" height="24" fill="#3a4148" />
      <rect x="556" y="96" width="12" height="7" rx="2" fill="#fff6d6" className="is-sc-light" />
      <rect x="548" y="106" width="20" height="10" rx="2" fill="#2b3036" />
      {/* chrome fuel tank */}
      <rect x="470" y="114" width="56" height="18" rx="9" fill={`url(#${id}Chrome)`} stroke="#8a949d" strokeWidth=".8" />
      {/* tractor mudguards + wheels */}
      <path d="M402 133 a22 22 0 0 1 44 0 M436 133 a22 22 0 0 1 44 0 M524 133 a22 22 0 0 1 44 0" fill="none" stroke="#1b1f23" strokeWidth="5" />
      <Wheel cx={424} cy={133} id={id} /><Wheel cx={458} cy={133} id={id} /><Wheel cx={546} cy={133} id={id} />
    </g>
  );
}

/* White double-cab pickup, facing right, ground at y=70 */
function Pickup({ id }) {
  return (
    <g className="is-sc-bounce">
      <defs>
        <linearGradient id={`${id}Body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#cfd6dd" />
        </linearGradient>
        <linearGradient id={`${id}Glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9c8e2" /><stop offset="1" stopColor="#2e4558" />
        </linearGradient>
        <radialGradient id={`${id}Rim`}><stop offset="0" stopColor="#f2f4f6" /><stop offset="1" stopColor="#8a949d" /></radialGradient>
        <radialGradient id={`${id}Shadow`}><stop offset="0" stopColor="#000" stopOpacity=".35" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="71" rx="106" ry="5" fill={`url(#${id}Shadow)`} />
      <path d="M2 34 L2 56 Q2 60 6 60 L194 60 Q200 60 200 54 L200 42 Q200 36 192 34 L166 30 L142 10 Q138 6 130 6 L90 6 Q84 6 82 12 L80 34 Z" fill={`url(#${id}Body)`} stroke="#aab4bd" strokeWidth="1.2" />
      <path d="M90 12 L112 12 L112 32 L86 32 Z" fill={`url(#${id}Glass)`} />
      <path d="M116 12 L136 12 L158 32 L116 32 Z" fill={`url(#${id}Glass)`} />
      <rect x="2" y="30" width="78" height="4" fill="#c3ccd4" />
      <text x="100" y="50" textAnchor="middle" className="is-veh-pick" fill="#13836b">TUDO NUM</text>
      <rect x="190" y="38" width="9" height="6" rx="2" fill="#fff6d6" />
      <rect x="2" y="40" width="5" height="8" fill="#c0392b" />
      <rect x="176" y="54" width="24" height="7" rx="2" fill="#7c8790" />
      <path d="M26 60 a18 18 0 0 1 36 0 M140 60 a18 18 0 0 1 36 0" fill="#2b3036" />
      <Wheel cx={44} cy={58} r={13} id={id} /><Wheel cx={158} cy={58} r={13} id={id} />
    </g>
  );
}

/* Date palm with a ringed trunk and layered fronds */
function Palm({ x, y, s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className="is-sc-palm">
        <path d="M-5 0 Q2 -50 -2 -96 L4 -96 Q9 -50 5 0 Z" fill="url(#isTrunk)" />
        {Array.from({ length: 11 }).map((_, i) => <path key={i} d={`M-5 ${-8 - i * 8} q5 3 10 0`} stroke="#7a5c3a" strokeWidth="1.4" fill="none" />)}
        <g transform="translate(1 -98)">
          {[-160, -130, -100, -75, -50, -20, 10, 200, 230, 260].map((a, i) => (
            <path key={i} transform={`rotate(${a})`} d="M0 0 Q30 -10 58 6 Q30 -2 0 4 Z" fill={i % 2 ? '#4f8f5e' : '#3d7a4d'} />
          ))}
          <circle r="5" fill="#8a6a3e" />
        </g>
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
            <linearGradient id="isSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" /><stop offset=".5" stopColor="#eaf3fa" stopOpacity=".8" /><stop offset="1" stopColor="#f7efe2" />
            </linearGradient>
            <radialGradient id="isSun" cx="1260" cy="150" r="320" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff3d1" stopOpacity=".95" /><stop offset="1" stopColor="#fff3d1" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="isMtFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7d1da" /><stop offset="1" stopColor="#dfe5ea" /></linearGradient>
            <linearGradient id="isMtMid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b9a68e" /><stop offset="1" stopColor="#d8c8b0" /></linearGradient>
            <linearGradient id="isMtNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9c8266" /><stop offset="1" stopColor="#c9b192" /></linearGradient>
            <linearGradient id="isSand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ecdcbc" /><stop offset="1" stopColor="#dcc59d" /></linearGradient>
            <linearGradient id="isAsphalt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4b545c" /><stop offset=".5" stopColor="#3d454c" /><stop offset="1" stopColor="#353c42" /></linearGradient>
            <pattern id="isGrain" width="7" height="7" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill="transparent" /><circle cx="1" cy="2" r=".6" fill="rgba(255,255,255,.07)" /><circle cx="5" cy="5" r=".5" fill="rgba(0,0,0,.12)" /><circle cx="4" cy="1" r=".4" fill="rgba(255,255,255,.05)" />
            </pattern>
            <linearGradient id="isTower" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8fb3cf" /><stop offset=".45" stopColor="#cfe2f0" /><stop offset=".55" stopColor="#e9f3fa" /><stop offset="1" stopColor="#7fa2bf" />
            </linearGradient>
            <linearGradient id="isTowerSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6c8ea9" /><stop offset="1" stopColor="#58789a" /></linearGradient>
            <linearGradient id="isReflect" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".45" stopColor="#fff" stopOpacity=".28" /><stop offset=".55" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="isRoom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff9ea" /><stop offset="1" stopColor="#f1e6cd" /></linearGradient>
            <linearGradient id="isTrunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8b6a43" /><stop offset="1" stopColor="#a7835a" /></linearGradient>
            <linearGradient id="isRail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eef1f3" /><stop offset=".5" stopColor="#a9b3bb" /><stop offset="1" stopColor="#d8dee3" /></linearGradient>
            <linearGradient id="isFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="1" /></linearGradient>
          </defs>

          {/* sky + sun haze */}
          <rect x="0" y="0" width="1600" height="250" fill="url(#isSky)" />
          <rect x="0" y="0" width="1600" height="260" fill="url(#isSun)" />

          {/* Hajar mountains: far haze, mid rock, near ridge */}
          <g className="is-sc-back">
            <path d="M0 236 L60 196 L110 210 L180 160 L240 186 L300 140 L360 178 L430 150 L500 196 L560 168 L640 120 L700 160 L760 142 L840 186 L900 150 L980 172 L1040 128 L1110 168 L1170 146 L1240 190 L1310 152 L1380 176 L1450 134 L1520 172 L1600 150 L1600 240 L0 240 Z" fill="url(#isMtFar)" />
            <path d="M0 240 L70 206 L120 220 L200 182 L260 204 L320 176 L390 210 L450 190 L520 222 L600 196 L680 214 L760 186 L830 220 L910 194 L980 214 L1060 180 L1130 212 L1200 192 L1280 222 L1350 196 L1430 216 L1500 190 L1600 214 L1600 244 L0 244 Z" fill="url(#isMtMid)" />
            <path d="M200 182 L230 196 L214 199 Z M760 186 L790 200 L772 202 Z M1060 180 L1090 196 L1072 198 Z M1500 190 L1530 204 L1512 205 Z" fill="rgba(255,255,255,.35)" />
            <path d="M0 246 L90 226 L170 236 L260 220 L360 238 L470 226 L560 240 L700 230 L820 242 L950 228 L1080 240 L1200 226 L1330 240 L1460 230 L1600 240 L1600 250 L0 250 Z" fill="url(#isMtNear)" opacity=".85" />
          </g>

          {/* desert */}
          <rect x="0" y="246" width="1600" height="24" fill="url(#isSand)" />
          {[60, 140, 330, 470, 980, 1090, 1240, 1420, 1540].map((sx, i) => (
            <ellipse key={i} cx={sx} cy={258 + (i % 3) * 3} rx={6 + (i % 4) * 2} ry="2.5" fill="#a9a06a" opacity=".55" />
          ))}

          {/* Tudo Num Group office tower (centred so phones see all of it) */}
          <g className="is-sc-office">
            <path d="M880 92 L940 104 L940 262 L880 262 Z" fill="url(#isTowerSide)" />
            <rect x="560" y="24" width="320" height="238" fill="url(#isTower)" />
            {Array.from({ length: 8 }).map((_, i) => <rect key={`v${i}`} x={560 + i * 40} y="24" width="2" height="152" fill="rgba(40,70,100,.35)" />)}
            {Array.from({ length: 6 }).map((_, i) => <rect key={`h${i}`} x="560" y={48 + i * 26} width="320" height="2" fill="rgba(40,70,100,.3)" />)}
            {[[0, 1], [2, 4], [3, 2], [4, 6], [1, 6], [5, 3]].map(([row, col], i) => (
              <rect key={`l${i}`} x={562 + col * 40} y={50 + row * 26} width="38" height="24" fill="#fff1c4" className="is-sc-win" style={{ animationDelay: `${700 + i * 160}ms` }} />
            ))}
            <rect x="560" y="24" width="320" height="152" fill="url(#isReflect)" />
            <rect x="556" y="14" width="328" height="12" fill="#e9eef2" stroke="#b9c6d0" />
            <rect x="642" y="-4" width="156" height="20" rx="3" fill="#ffffff" stroke="#c7d4de" />
            <text x="720" y="11" textAnchor="middle" className="is-sc-sign">TUDO NUM GROUP</text>
            {/* ground floor: glass front, staff at work */}
            <rect x="560" y="176" width="320" height="86" fill="url(#isRoom)" />
            <g transform="translate(566 178) scale(0.82)">
              <Worker x={0} y={0} shirt="#1d5fd1" skin={SKIN[0]} delay={0} />
              <Worker x={126} y={0} shirt="#13836b" skin={SKIN[1]} hair="#4a3426" delay={300} />
              {/* manager at the screen with a rising line chart */}
              <g transform="translate(256 -8)">
                <rect x="0" y="0" width="80" height="54" rx="3" fill="#1c2a38" />
                <rect x="4" y="4" width="72" height="44" fill="#f4f9ff" />
                <path d="M10 42 H72 M10 42 V8" stroke="#c9d3da" strokeWidth="1.5" />
                <polyline points="12,38 26,32 38,34 50,22 60,18 70,9" fill="none" stroke="#13836b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="is-sc-line" />
                <circle cx="70" cy="9" r="3.5" fill="#c99a3b" className="is-sc-dot" />
                <rect x="36" y="54" width="8" height="40" fill="#9aa7b2" />
              </g>
              <g transform="translate(342 18)">
                <path d="M8 22 q0 -12 12 -12 h4 q10 0 10 12 v34 h-26 z" fill="#2f3d4c" />
                <path d="M12 56 h8 v36 h-8 z M24 56 h8 v36 h-8 z" fill="#1f2a35" />
                <circle cx="22" cy="0" r="9" fill={SKIN[2]} />
                <path d="M13 -1 q1 -11 10 -10 q8 1 8 9 q-6 -3 -18 1z" fill="#1d1d1d" />
                <g className="is-sc-point"><path d="M12 18 q-14 -10 -26 -22" stroke="#2f3d4c" strokeWidth="7" strokeLinecap="round" fill="none" /><circle cx="-15" cy="-5" r="3.5" fill={SKIN[2]} /></g>
              </g>
            </g>
            {[640, 720, 800].map((mx) => <rect key={mx} x={mx} y="176" width="2" height="86" fill="rgba(40,70,100,.4)" />)}
            <rect x="560" y="176" width="320" height="86" fill="url(#isReflect)" />
            <rect x="560" y="174" width="320" height="3" fill="#b9c6d0" />
          </g>

          {/* palms */}
          <Palm x={500} y={266} s={1.0} />
          <Palm x={930} y={266} s={0.9} />
          <Palm x={160} y={266} s={0.85} />
          <Palm x={1360} y={266} s={1.05} />

          {/* street lights on the far side */}
          {[80, 420, 1020, 1460].map((lx) => (
            <g key={lx}>
              <rect x={lx} y="150" width="4" height="118" fill="#8d979f" />
              <path d={`M${lx + 2} 152 q2 -10 28 -10`} stroke="#8d979f" strokeWidth="3" fill="none" />
              <rect x={lx + 24} y="140" width="16" height="5" rx="2" fill="#5d666e" />
            </g>
          ))}

          {/* road sign */}
          <g transform="translate(1180 186)">
            <rect x="8" y="40" width="4" height="44" fill="#8d979f" /><rect x="96" y="40" width="4" height="44" fill="#8d979f" />
            <rect x="0" y="0" width="108" height="44" rx="4" fill="#1d6b45" stroke="#fff" strokeWidth="2" />
            <text x="10" y="18" className="is-sc-road">MUSCAT ←</text><text x="98" y="18" textAnchor="end" className="is-sc-road">25</text>
            <text x="10" y="36" className="is-sc-road">SOHAR →</text><text x="98" y="36" textAnchor="end" className="is-sc-road">210</text>
          </g>

          {/* guard rail (far side) */}
          <rect x="0" y="258" width="1600" height="7" fill="url(#isRail)" />
          {Array.from({ length: 41 }).map((_, i) => <rect key={i} x={i * 40} y="262" width="3" height="10" fill="#7c8790" />)}

          {/* highway: two carriageways */}
          <rect x="0" y="270" width="1600" height="82" fill="url(#isAsphalt)" />
          <rect x="0" y="270" width="1600" height="82" fill="url(#isGrain)" />
          <rect x="0" y="272" width="1600" height="2" fill="#e8c35a" />
          <line x1="0" y1="289" x2="1600" y2="289" stroke="#e9ecef" strokeWidth="2" strokeDasharray="38 34" opacity=".9" />
          <rect x="0" y="306" width="1600" height="5" fill="#9aa3ab" />
          <rect x="0" y="305" width="1600" height="1.5" fill="#e8c35a" /><rect x="0" y="311" width="1600" height="1.5" fill="#e8c35a" />
          <line x1="0" y1="329" x2="1600" y2="329" stroke="#e9ecef" strokeWidth="2.4" strokeDasharray="44 38" opacity=".9" />
          <rect x="0" y="348" width="1600" height="2.5" fill="#f1f3f5" />
          {/* kerb + near sand */}
          <rect x="0" y="352" width="1600" height="6" fill="#d6dbe0" />
          {Array.from({ length: 40 }).map((_, i) => <rect key={i} x={i * 40} y="352" width="20" height="6" fill={i % 2 ? '#1f2a35' : '#f3f5f7'} opacity=".55" />)}
          <rect x="0" y="358" width="1600" height="22" fill="url(#isSand)" />
          <rect x="0" y="352" width="1600" height="28" fill="url(#isFade)" />
        </svg>

      </div>

      {/* Vehicles (4 Nov 2026): own layer the size of the screen, so on a phone or PC both trucks are already in view
          when the intro starts and the two trailers cross each other in front of the office tower (~2.3 s) */}
      <div className="is-road">
        {/* far carriageway: Tudo Num container truck driving left */}
        <div className="is-veh t2"><svg viewBox="-24 -14 600 172"><g transform="translate(552 0) scale(-1 1)"><Truck id="tv2" kind="container" mirrored cab="#e9edf1" cabDark="#b9c3cc" /></g></svg></div>
        {/* inner near lane: white pickup overtaking */}
        <div className="is-veh t3"><svg viewBox="-6 2 212 74"><Pickup id="tv3" /></svg></div>
        {/* outer near lane: Modern City tractor-trailer driving right */}
        <div className="is-veh t1"><svg viewBox="-24 -14 600 172"><Truck id="tv1" kind="box" cab="#ffffff" cabDark="#c9d1d8" /></svg></div>
      </div>
    </div>
  );
}
