// Small animated trailer truck driving towards the viewer (front view on a road)
export default function TruckAnim() {
  return (
    <span className="truck-anim" aria-hidden="true">
      <svg viewBox="0 0 160 110" width="160" height="110">
        <defs>
          <linearGradient id="ta-road" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".22" />
          </linearGradient>
          <radialGradient id="ta-light" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#fff6c8" stopOpacity=".95" />
            <stop offset="1" stopColor="#fff6c8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* road going to the horizon */}
        <polygon points="76,28 84,28 150,110 10,110" fill="url(#ta-road)" />
        <g className="ta-dashes" stroke="#fff" strokeOpacity=".75" strokeLinecap="round">
          <line x1="80" y1="34" x2="80" y2="40" strokeWidth="1" />
          <line x1="80" y1="52" x2="80" y2="64" strokeWidth="1.8" />
          <line x1="80" y1="80" x2="80" y2="100" strokeWidth="2.8" />
        </g>

        {/* the truck (front view), scales up as it comes closer */}
        <g className="ta-truck">
          {/* trailer box behind the cab */}
          <rect x="54" y="20" width="52" height="40" rx="2" fill="#f2f5f4" stroke="#c9d3cf" />
          <rect x="54" y="20" width="52" height="5" fill="#d9e2de" />
          {/* cab */}
          <rect x="58" y="34" width="44" height="40" rx="5" fill="currentColor" />
          <rect x="58" y="34" width="44" height="40" rx="5" fill="#fff" fillOpacity=".08" />
          {/* windscreen */}
          <path d="M62 39 h36 a2 2 0 0 1 2 2 v11 h-40 v-11 a2 2 0 0 1 2-2z" fill="#bfe3f2" />
          <path d="M64 41 l10 0 -6 10 h-6z" fill="#fff" fillOpacity=".55" />
          <line x1="80" y1="39" x2="80" y2="52" stroke="currentColor" strokeWidth="1.2" />
          {/* mirrors */}
          <rect x="52" y="41" width="5" height="9" rx="1.5" fill="#2b3634" />
          <rect x="103" y="41" width="5" height="9" rx="1.5" fill="#2b3634" />
          {/* grille */}
          <rect x="68" y="56" width="24" height="10" rx="1.5" fill="#26302e" />
          <g stroke="#7d8a86" strokeWidth=".8">
            <line x1="68.5" y1="59" x2="91.5" y2="59" />
            <line x1="68.5" y1="62" x2="91.5" y2="62" />
          </g>
          {/* headlights with glow */}
          <circle className="ta-glow" cx="63.5" cy="61" r="9" fill="url(#ta-light)" />
          <circle className="ta-glow" cx="96.5" cy="61" r="9" fill="url(#ta-light)" />
          <rect className="ta-lamp" x="60" y="58.5" width="7" height="5" rx="1.5" fill="#fff8d6" />
          <rect className="ta-lamp" x="93" y="58.5" width="7" height="5" rx="1.5" fill="#fff8d6" />
          {/* bumper and plate */}
          <rect x="57" y="68" width="46" height="5" rx="1.5" fill="#cfd8d5" />
          <rect x="74" y="68.8" width="12" height="3.4" rx=".6" fill="#ffd34d" />
          {/* wheels */}
          <rect x="59" y="73" width="8" height="8" rx="2" fill="#1d2523" />
          <rect x="93" y="73" width="8" height="8" rx="2" fill="#1d2523" />
          <ellipse cx="80" cy="82" rx="26" ry="2.5" fill="#000" fillOpacity=".25" />
        </g>
      </svg>
    </span>
  );
}
