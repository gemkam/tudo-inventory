'use client';

// Small Edit / Done button for a section header
export default function EditToggle({ on, onClick, show = true }) {
  if (!show) return null;
  return (
    <button type="button" className={`btn small ${on ? 'in' : ''}`} onClick={onClick} aria-pressed={on}>
      {on ? '✓ Done' : '✏️ Edit'}
    </button>
  );
}
