'use client';

import { useEffect, useRef, useState } from 'react';

/* Categorical order (validated palette, fixed order, never cycled) */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const BAR = '#0a6654';
export const BAR_MUTED = 'rgba(10, 102, 84, 0.38)';

/* Shared floating tooltip */
function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, html) => setTip({ x: e.clientX, y: e.clientY, html });
  const hide = () => setTip(null);
  const node = tip ? (
    <div className="rp-tooltip" style={{ left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220), top: tip.y - 54 }}>
      {tip.html}
    </div>
  ) : null;
  return { show, hide, node };
}

/* Donut with legend. slices: [{ label, value, color }] */
export function Donut({ slices, fmt = (v) => v, centerBig, centerSmall, onPick }) {
  const click = (i) => (onPick ? { onClick: () => onPick(i, slices[i]), style: { cursor: 'pointer' } } : {});
  const { show, hide, node } = useTip();
  const total = slices.reduce((t, s) => t + (s.value > 0 ? s.value : 0), 0);
  const cx = 100, cy = 100, r = 78, w = 26;
  let a0 = -Math.PI / 2;
  const p = (a) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const arcs = [];
  if (total > 0) {
    slices.forEach((s, i) => {
      if (!(s.value > 0)) return;
      const frac = s.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const tipText = <><b>{s.label}</b><br />{fmt(s.value)} · {Math.round(frac * 100)}%</>;
      if (frac >= 0.999) {
        arcs.push(<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={w} onMouseMove={(e) => show(e, tipText)} onMouseLeave={hide} {...click(i)} />);
      } else {
        arcs.push(<path key={i} d={`M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`} fill="none" stroke={s.color} strokeWidth={w} onMouseMove={(e) => show(e, tipText)} onMouseLeave={hide} {...click(i)} />);
        arcs.push(<line key={`g${i}`} x1={cx + (r - w / 2 - 1) * Math.cos(a1)} y1={cy + (r - w / 2 - 1) * Math.sin(a1)} x2={cx + (r + w / 2 + 1) * Math.cos(a1)} y2={cy + (r + w / 2 + 1) * Math.sin(a1)} stroke="#ffffff" strokeWidth="2.5" />);
      }
      a0 = a1;
    });
  }
  return (
    <div className="rp-donut-wrap">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${centerSmall}: ${centerBig}`}>
        {total > 0 ? arcs : <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--grid-line)" strokeWidth={w} />}
        <text x={cx} y={cy + 2} textAnchor="middle" fill="var(--ink)" fontSize="24" fontWeight="700" fontFamily="var(--body)">{centerBig}</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fill="var(--muted)" fontSize="12" fontFamily="var(--body)">{centerSmall}</text>
      </svg>
      <div className="rp-legend">
        {slices.map((s, i) => (
          <div className={`rp-leg-row${onPick ? ' pickable' : ''}`} key={s.label} {...click(i)}>
            <span className="rp-leg-dot" style={{ background: s.color }} />
            <span className="rp-leg-name">{s.label}</span>
            <span className="rp-leg-val"><b>{total ? Math.round((Math.max(s.value, 0) / total) * 100) : 0}%</b> · {fmt(s.value)}</span>
          </div>
        ))}
      </div>
      {node}
    </div>
  );
}

/* Vertical bars, one series, best bar highlighted. Negative values drop below the baseline. */
export function Bars({ labels, values, fmt = (v) => v, highlight = -1, labelAll = false, height = 200, onPick }) {
  const ref = useRef(null);
  const [W, setW] = useState(640);
  const { show, hide, node } = useTip();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxAbs = Math.max(0, ...values.map((v) => Math.abs(v)));
  if (!maxAbs) return <div ref={ref} className="rp-empty">Nothing to show for this period yet.</div>;
  const hasNeg = values.some((v) => v < 0);
  const H = height, top = 22, bottom = 26;
  const plot = H - top - bottom;
  const posMax = Math.max(0, ...values);
  const negMax = Math.max(0, ...values.map((v) => -v));
  const scale = plot / (posMax + negMax);
  const base = top + posMax * scale;
  const n = values.length, slot = W / n, bw = Math.min(46, slot - 4);
  return (
    <div className="rp-bars" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
        <line x1="0" y1={base} x2={W} y2={base} stroke="var(--line-strong)" strokeWidth="1" />
        {values.map((v, i) => {
          const x = i * slot + (slot - bw) / 2;
          const h = Math.abs(v) * scale;
          const y = v >= 0 ? base - h : base;
          const col = i === highlight ? BAR : BAR_MUTED;
          const rr = Math.min(4, h, bw / 2);
          const d = v >= 0
            ? `M ${x} ${base} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + bw - rr} Q ${x + bw} ${y} ${x + bw} ${y + rr} V ${base} Z`
            : `M ${x} ${base} V ${base + h - rr} Q ${x} ${base + h} ${x + rr} ${base + h} H ${x + bw - rr} Q ${x + bw} ${base + h} ${x + bw} ${base + h - rr} V ${base} Z`;
          const showLbl = labels.length <= 12 || i === highlight || i % 2 === 0;
          return (
            <g key={i}>
              {h > 0 && <path d={d} fill={v < 0 ? (i === highlight ? '#c0392b' : 'rgba(192,57,43,.45)') : col} />}
              {v !== 0 && (labelAll || i === highlight) && (
                <text x={x + bw / 2} y={v >= 0 ? y - 6 : base + h + 13} textAnchor="middle" fontSize="11.5" fontWeight={i === highlight ? 700 : 500} fill={i === highlight ? 'var(--ink)' : 'var(--muted)'}>{fmt(v)}</text>
              )}
              {showLbl && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fontWeight={i === highlight ? 700 : 400} fill={i === highlight ? 'var(--ink)' : 'var(--muted)'}>{labels[i]}</text>}
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, <><b>{labels[i]}</b><br />{fmt(v)}</>)} onMouseLeave={hide} onClick={onPick ? () => onPick(i) : undefined} style={onPick ? { cursor: 'pointer' } : undefined} />
            </g>
          );
        })}
        {hasNeg && <text x="4" y={base - 4} fontSize="10" fill="var(--muted)">0</text>}
      </svg>
      {node}
    </div>
  );
}

/* Two series side by side per label (e.g. In vs Out, Work vs Expenses). */
export function PairBars({ labels, a, b, aLabel, bLabel, aColor = SERIES[0], bColor = SERIES[1], fmt = (v) => v, height = 210, onPick }) {
  const ref = useRef(null);
  const [W, setW] = useState(640);
  const { show, hide, node } = useTip();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(0, ...a, ...b);
  if (!max) return <div ref={ref} className="rp-empty">Nothing to show for this period yet.</div>;
  const H = height, top = 22, bottom = 26, plot = H - top - bottom;
  const n = labels.length, slot = W / n, bw = Math.min(28, (slot - 10) / 2);
  const bar = (x, v, color, key, label) => {
    const h = (v / max) * plot, y = H - bottom - h, rr = Math.min(4, h, bw / 2);
    return h > 0 ? <path key={key} d={`M ${x} ${H - bottom} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + bw - rr} Q ${x + bw} ${y} ${x + bw} ${y + rr} V ${H - bottom} Z`} fill={color}><title>{label}</title></path> : null;
  };
  return (
    <div className="rp-bars" ref={ref}>
      <div className="rp-mini-legend">
        <span><i style={{ background: aColor }} />{aLabel}</span>
        <span><i style={{ background: bColor }} />{bLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
        <line x1="0" y1={H - bottom} x2={W} y2={H - bottom} stroke="var(--line-strong)" strokeWidth="1" />
        {labels.map((l, i) => {
          const x0 = i * slot + (slot - (bw * 2 + 2)) / 2;
          return (
            <g key={l}>
              {bar(x0, a[i], aColor, 'a', aLabel)}
              {bar(x0 + bw + 2, b[i], bColor, 'b', bLabel)}
              <text x={i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{l}</text>
              <rect x={i * slot} y="0" width={slot} height={H} fill="transparent" onMouseMove={(e) => show(e, <><b>{l}</b><br />{aLabel}: {fmt(a[i])}<br />{bLabel}: {fmt(b[i])}</>)} onMouseLeave={hide} onClick={onPick ? () => onPick(i) : undefined} style={onPick ? { cursor: 'pointer' } : undefined} />
            </g>
          );
        })}
      </svg>
      {node}
    </div>
  );
}

/* Horizontal bars for ranked lists with long names. rows: [{ label, value, sub }] */
export function HBars({ rows, fmt = (v) => v, color = BAR, onPick }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!max) return <div className="rp-empty">Nothing to show for this period yet.</div>;
  return (
    <div className="rp-hbars">
      {rows.map((r, i) => (
        <div className={`rp-hbar${onPick ? ' pickable' : ''}`} key={r.label} title={`${r.label}: ${fmt(r.value)}`} onClick={onPick ? () => onPick(i, r) : undefined}>
          <span className="rp-hbar-name">{r.label}</span>
          <span className="rp-hbar-track">
            <span className="rp-hbar-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: i === 0 ? color : BAR_MUTED }} />
          </span>
          <span className="rp-hbar-val">{fmt(r.value)}{r.sub ? <small> {r.sub}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}
