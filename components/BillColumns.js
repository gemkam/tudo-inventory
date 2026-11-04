'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';
import { BUILTIN, newColKey } from '@/lib/billColumns';

/*
  ▥ Columns box for Bills (Kamran 4 Nov 2026): rename any column, ＋ add a column with its name,
  🗑 delete an added column, ↶ Undo. Every change saves by itself (onChange) and goes on the page Undo list.
  The standard columns can be renamed but not deleted (the sums and VAT need them).
*/
export default function BillColumns({ cfg, onChange, onClose, onUndo, canUndo, busy }) {
  const [names, setNames] = useState({});
  const [cols, setCols] = useState(cfg.cols);
  const [fresh, setFresh] = useState('');
  const [mounted, setMounted] = useState(false);
  const addRef = useRef(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { setNames(Object.fromEntries(BUILTIN.map(([k, d]) => [k, cfg.names[k] || d]))); setCols(cfg.cols); }, [cfg]);

  const renameBuiltin = (k, def) => {
    const t = String(names[k] || '').trim();
    if (!t) { setNames((m) => ({ ...m, [k]: cfg.names[k] || def })); return; }
    if (t === (cfg.names[k] || def)) return;
    onChange({ ...cfg, names: { ...cfg.names, [k]: t } }, `rename column "${cfg.names[k] || def}" to "${t}"`);
  };
  const renameCol = (i) => {
    const t = String(cols[i]?.name || '').trim();
    const old = cfg.cols[i];
    if (!old) return;
    if (!t) { setCols(cfg.cols); return; }
    if (t === old.name) return;
    onChange({ ...cfg, cols: cfg.cols.map((c, j) => (j === i ? { ...c, name: t } : c)) }, `rename column "${old.name}" to "${t}"`);
  };
  const removeCol = (i) => {
    const old = cfg.cols[i];
    onChange({ ...cfg, cols: cfg.cols.filter((_, j) => j !== i) }, `delete column "${old.name}"`);
  };
  const addCol = async () => {
    const t = fresh.trim();
    if (!t) { addRef.current?.focus(); return; }
    const ok = await onChange({ ...cfg, cols: [...cfg.cols, { key: newColKey(), name: t }] }, `add column "${t}"`);
    if (ok) { setFresh(''); addRef.current?.focus(); }
  };
  const enter = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } };

  if (!mounted) return null;
  return createPortal(
    <Modal title="Columns of the Bills table" onClose={onClose}>
      <div className="dp-man bc-man">
        <p className="muted dp-note">Type a new name and leave the box (or press Enter) to save. Added columns show in every company's Bills; type their values right in the table in Edit.</p>
        <div className="bc-cap">Your columns</div>
        <ol className="dp-list">
          {cols.map((c, i) => (
            <li key={c.key}>
              <input className="br-in" value={c.name} disabled={busy} onChange={(e) => setCols((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                onBlur={() => renameCol(i)} onKeyDown={enter} />
              <button type="button" className="btn small ghost danger-text" disabled={busy} onClick={() => removeCol(i)} aria-label={`Delete column ${c.name}`}>🗑</button>
            </li>
          ))}
          {!cols.length && <li className="muted">No added columns yet.</li>}
        </ol>
        <div className="dp-add">
          <input ref={addRef} className="br-in" value={fresh} placeholder="New column name" disabled={busy}
            onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCol(); } }} />
          <button type="button" className="btn" disabled={busy} onClick={addCol}>＋ Add column</button>
        </div>
        <div className="bc-cap" style={{ marginTop: 14 }}>Standard columns (rename only)</div>
        <ol className="dp-list bc-std">
          {BUILTIN.map(([k, d]) => (
            <li key={k}>
              <input className="br-in" value={names[k] ?? d} disabled={busy} onChange={(e) => setNames((m) => ({ ...m, [k]: e.target.value }))}
                onBlur={() => renameBuiltin(k, d)} onKeyDown={enter} />
              {cfg.names[k] ? <button type="button" className="btn small ghost" disabled={busy} title={`Back to "${d}"`}
                onClick={() => { const nx = { ...cfg.names }; delete nx[k]; onChange({ ...cfg, names: nx }, `column "${cfg.names[k]}" back to "${d}"`); }}>↺</button> : <span className="bc-pad" />}
            </li>
          ))}
        </ol>
        <div className="modal-actions dp-actions">
          <button type="button" className="btn ghost" disabled={busy || !canUndo} onClick={onUndo}>↶ Undo</button>
          <button type="button" className="btn" onClick={onClose}>✓ Done</button>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
