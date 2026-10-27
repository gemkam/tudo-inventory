'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';

/*
  Date box that always shows DAY / MONTH / YEAR (dd/mm/yyyy), whatever the phone or browser language.
  value / onChange use 'YYYY-MM-DD' (or '' when empty). The 📅 button opens the normal calendar.
*/
const toText = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function toIso(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  const dd = Number(d), mm = Number(mo), yy = Number(y);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* Typing helper: adds the slashes as you type 27102026 -> 27/10/2026 */
function mask(raw, prev) {
  const deleting = raw.length < prev.length;
  let digits = raw.replace(/[^\d]/g, '').slice(0, 8);
  if (deleting) return raw.replace(/[^\d/]/g, '');
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  else if (digits.length === 2) out += '/';
  if (digits.length > 4) out += `/${digits.slice(4)}`;
  else if (digits.length === 4) out += '/';
  return out;
}

const DateInput = forwardRef(function DateInput({ value, onChange, onPicked, className = '', id, required, autoFocus, onKeyDown, onBlur, disabled, placeholder = 'dd/mm/yyyy' }, ref) {
  const [text, setText] = useState(toText(value));
  const pickRef = useRef(null);
  const inRef = useRef(null);
  const picking = useRef(false);

  useEffect(() => { setText(toText(value)); }, [value]);
  useEffect(() => {
    if (!ref) return;
    if (typeof ref === 'function') ref(inRef.current); else ref.current = inRef.current;
  }, [ref]);

  function change(e) {
    const t = mask(e.target.value, text);
    setText(t);
    if (!t) { onChange?.(''); return; }
    const iso = toIso(t);
    if (iso) onChange?.(iso);
  }

  function openPicker() {
    const el = pickRef.current;
    if (!el) return;
    picking.current = true;
    try { el.showPicker(); } catch { el.click(); }
  }

  return (
    <span className={`date-in ${className}`}>
      <input
        ref={inRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={change}
        onKeyDown={onKeyDown}
        onFocus={() => { picking.current = false; }}
        onBlur={(e) => { if (picking.current) return; if (text && !toIso(text)) setText(toText(value)); onBlur?.(e); }}
        required={required}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={placeholder}
      />
      <button type="button" className="date-pick" onMouseDown={(e) => e.preventDefault()} onClick={openPicker} tabIndex={-1} aria-label="Open calendar" disabled={disabled}>📅</button>
      <input
        ref={pickRef}
        type="date"
        className="date-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        onChange={(e) => { picking.current = false; onChange?.(e.target.value); setText(toText(e.target.value)); onPicked?.(e.target.value); }}
      />
    </span>
  );
});

export default DateInput;
export { toText as isoToDmy, toIso as dmyToIso };
