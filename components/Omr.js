// Omani Rial: new currency symbol + amount with 3 decimals (0.800, 1.000)
export function fmt3(v) {
  const n = Math.round(Number(v || 0) * 1000) / 1000;
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function OmrSign() {
  return <i className="omr-sign" role="img" aria-label="OMR" />;
}

export default function Omr({ v, className = '' }) {
  return <span className={`omr ${className}`}><OmrSign />{fmt3(v)}</span>;
}
