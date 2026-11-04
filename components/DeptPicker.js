'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';
import { useDepartments } from '@/lib/departments';

/*
  Department drop-down for Bills (Kamran 4 Nov 2026).
  - Shows every saved department of the company (Admin / Office, Construction, ...).
  - "＋ New department..." lets you type a new one; it is saved in the list by itself.
  - "⋯ More" opens the list manager: Add, Edit (rename), Delete, Undo. Every change saves by itself.
  Renaming or deleting changes only the list, not bills already saved.
*/
const NEW = '__new__';

export default function DeptPicker({ co, value, onChange, className = 'br-in', disabled = false, canManage = true }) {
  const { list, add } = useDepartments(co);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const options = value && !list.some((x) => x === value) ? [...list, value] : list;

  async function useNew() {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t) { setTyping(false); return; }
    const hit = list.find((x) => x.toLowerCase() === t.toLowerCase());
    onChange(hit || t);
    setTyping(false); setText('');
    if (!hit) { const r = await add(t); if (r?.error) setErr(r.error); }
  }

  return (
    <div className="dp-wrap" onClick={(e) => e.stopPropagation()}>
      {typing ? (
        <div className="dp-row">
          <input className={className} autoFocus value={text} placeholder="New department" disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); useNew(); } if (e.key === 'Escape') { e.stopPropagation(); setTyping(false); setText(''); } }} />
          <button type="button" className="btn small" onClick={useNew} title="Use and save in the list">✓</button>
          <button type="button" className="btn small ghost" onClick={() => { setTyping(false); setText(''); }} title="Cancel">✕</button>
        </div>
      ) : (
        <div className="dp-row">
          <select className={className} value={value || ''} disabled={disabled}
            onChange={(e) => { if (e.target.value === NEW) { setTyping(true); setText(''); } else onChange(e.target.value); }}>
            <option value="">No department</option>
            {options.map((x) => <option key={x} value={x}>{x}</option>)}
            {canManage && <option value={NEW}>＋ New department...</option>}
          </select>
          {canManage && <button type="button" className="btn small ghost dp-more" disabled={disabled} onClick={() => setOpen(true)} title="Add, edit or delete departments">⋯ More</button>}
        </div>
      )}
      {err && <div className="dp-err">{err}</div>}
      {open && <DeptManager co={co} value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeptManager({ co, value, onChange, onClose }) {
  const { list, save } = useDepartments(co);
  const [rows, setRows] = useState(list);
  const [fresh, setFresh] = useState('');
  const [undo, setUndo] = useState([]); // earlier lists, newest last
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const addRef = useRef(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!busy) setRows(list); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(next, note) {
    const clean = next.map((x) => String(x || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
    const lower = clean.map((x) => x.toLowerCase());
    if (lower.some((x, i) => lower.indexOf(x) !== i)) { setMsg({ k: 'err', t: 'This department is already in the list.' }); setRows(list); return false; }
    if (clean.join('|') === list.join('|')) { setRows(list); return true; }
    setBusy(true);
    const prev = list;
    const r = await save(clean);
    setBusy(false);
    if (r.error) { setMsg({ k: 'err', t: r.error }); setRows(prev); return false; }
    setUndo((u) => [...u.slice(-29), { list: prev, note }]);
    setMsg({ k: 'ok', t: `${note} Saved.` });
    return true;
  }

  async function addOne() {
    const t = fresh.trim();
    if (!t) { addRef.current?.focus(); return; }
    if (await commit([...list, t], `"${t}" added.`)) { setFresh(''); addRef.current?.focus(); }
  }

  async function rename(i) {
    const old = list[i];
    const t = String(rows[i] || '').trim();
    if (!t) { setRows(list); setMsg({ k: 'err', t: 'Name cannot be empty. Use 🗑 to delete.' }); return; }
    if (t === old) return;
    const next = [...list]; next[i] = t;
    if (await commit(next, `"${old}" changed to "${t}".`) && value === old) onChange(t);
  }

  async function remove(i) {
    const old = list[i];
    await commit(list.filter((_, j) => j !== i), `"${old}" deleted.`);
  }

  async function doUndo() {
    const step = undo[undo.length - 1];
    if (!step || busy) return;
    setBusy(true);
    const r = await save(step.list);
    setBusy(false);
    if (r.error) { setMsg({ k: 'err', t: r.error }); return; }
    setUndo((u) => u.slice(0, -1));
    setRows(step.list);
    setMsg({ k: 'ok', t: 'Undone.' });
  }

  if (!mounted) return null;
  return createPortal(
    <Modal title="Departments" onClose={onClose}>
      <div className="dp-man" onClick={(e) => e.stopPropagation()}>
        <p className="muted dp-note">Type to change a name (saves when you leave the box or press Enter). Changes here are for the list only: bills already saved keep their department.</p>
        <ol className="dp-list">
          {rows.map((x, i) => (
            <li key={`${i}-${list[i]}`}>
              <input className="br-in" value={x} disabled={busy}
                onChange={(e) => setRows((r) => r.map((y, j) => (j === i ? e.target.value : y)))}
                onBlur={() => rename(i)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setRows(list); } }} />
              <button type="button" className="btn small ghost danger-text" disabled={busy} onClick={() => remove(i)} aria-label={`Delete ${list[i]}`}>🗑</button>
            </li>
          ))}
          {!rows.length && <li className="muted">No departments. Add one below.</li>}
        </ol>
        <div className="dp-add">
          <input ref={addRef} className="br-in" value={fresh} placeholder="New department name" disabled={busy}
            onChange={(e) => setFresh(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOne(); } }} />
          <button type="button" className="btn" disabled={busy} onClick={addOne}>＋ Add</button>
        </div>
        {msg && <div className={msg.k === 'err' ? 'dp-err' : 'dp-ok'}>{msg.t}</div>}
        <div className="modal-actions dp-actions">
          <button type="button" className="btn ghost" disabled={busy || !undo.length} onClick={doUndo}>↶ Undo{undo.length ? ` (${undo.length})` : ''}</button>
          <button type="button" className="btn" onClick={onClose}>✓ Done</button>
        </div>
      </div>
    </Modal>,
    document.body
  );
}
