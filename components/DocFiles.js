'use client';

import { useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

/*
  "Upload the documents" cell of the Documents Checklist (app/docs/page.js), 31 Oct 2026.
  📎 Import document: pick a file from the computer, or on a phone from Files, Photos or the camera (PDF, photo, Word, Excel).
  Files go to the private Supabase Storage bucket "doc-files" (folder = checklist row id); the list is kept in doc_checklist.files
  as [{ path, name, size, type, at, by }]. Each file: 👁 View (opens a 10-minute private link), ✏️ Edit (rename or replace the file),
  🗑 Delete. Old text notes (doc_checklist.notes) are still shown small under the files.
  Only Administrator / Full access can import, edit or delete; everyone who can read can View.
*/

const BUCKET = 'doc-files';
const ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt';
const MAX = 15 * 1024 * 1024;
const stop = (e) => e.stopPropagation();
const safe = (name) => String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file';
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const iconOf = (f) => (/pdf/i.test(f.type || f.name) ? '📕' : /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name) ? '🖼' : '📄');

export default function DocFiles({ row, canEdit, userName, onSave, flash }) {
  const files = Array.isArray(row.files) ? row.files : [];
  const pickRef = useRef(null);
  const replaceRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null); // { index, name }
  const [del, setDel] = useState(null); // index

  async function upload(file) {
    if (file.size > MAX) { flash('File is bigger than 15 MB. Please send a smaller copy.', 'err'); return null; }
    const path = `${row.id}/${Date.now()}-${safe(file.name)}`;
    const { error } = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) { flash(`Upload failed: ${error.message}`, 'err'); return null; }
    return { path, name: file.name, size: file.size, type: file.type || '', at: new Date().toISOString(), by: userName || '' };
  }

  async function onPick(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    flash(`Uploading ${list.length} file${list.length === 1 ? '' : 's'}...`);
    const added = [];
    for (const f of list) { const x = await upload(f); if (x) added.push(x); }
    setBusy(false);
    if (added.length) { await onSave([...files, ...added]); flash(`${added.length} document${added.length === 1 ? '' : 's'} uploaded`); }
  }

  async function view(f) {
    const w = window.open('', '_blank');
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(f.path, 600);
    if (error || !data?.signedUrl) { w?.close(); flash(`Could not open: ${error?.message || 'file not found'}`, 'err'); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  }

  async function saveEdit() {
    const name = (edit.name || '').trim();
    if (!name) { flash('Type a name', 'err'); return; }
    await onSave(files.map((f, i) => (i === edit.index ? { ...f, name } : f)));
    setEdit(null);
    flash('Document renamed');
  }

  async function onReplace(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !edit) return;
    setBusy(true);
    const x = await upload(file);
    setBusy(false);
    if (!x) return;
    const old = files[edit.index];
    const name = (edit.name || '').trim() && edit.name !== old.name ? edit.name.trim() : file.name;
    await onSave(files.map((f, i) => (i === edit.index ? { ...x, name } : f)));
    if (old?.path) await sb().storage.from(BUCKET).remove([old.path]);
    setEdit(null);
    flash('Document replaced');
  }

  async function confirmDelete() {
    const f = files[del];
    setDel(null);
    if (!f) return;
    await onSave(files.filter((_, i) => i !== del));
    const { error } = await sb().storage.from(BUCKET).remove([f.path]);
    flash(error ? `Removed from the list (file: ${error.message})` : 'Document deleted', error ? 'err' : 'ok');
  }

  return (
    <div className="dfl" onMouseDown={stop} onClick={stop} onDoubleClick={stop}>
      {files.map((f, i) => (
        <div key={f.path || i} className="dfl-file">
          <span className="dfl-name" title={`${f.name}${f.size ? ` · ${sizeText(f.size)}` : ''}${f.by ? ` · by ${f.by}` : ''}`}>{iconOf(f)} {f.name}</span>
          <span className="dfl-btns">
            <button type="button" className="dfl-btn" onClick={() => view(f)} title="View">👁 View</button>
            {canEdit && <button type="button" className="dfl-btn" onClick={() => setEdit({ index: i, name: f.name })} title="Edit">✏️ Edit</button>}
            {canEdit && <button type="button" className="dfl-btn danger" onClick={() => setDel(i)} title="Delete">🗑 Delete</button>}
          </span>
        </div>
      ))}
      {!files.length && !canEdit && <span className="muted">No document</span>}
      {canEdit && (
        <>
          <button type="button" className="dfl-import" onClick={() => pickRef.current?.click()} disabled={busy}>{busy ? 'Uploading...' : '📎 Import document'}</button>
          <input ref={pickRef} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
        </>
      )}
      {row.notes && <small className="dfl-note" title="Old note">{row.notes}</small>}

      {edit && (
        <Modal title="Edit document" onClose={() => setEdit(null)}>
          <label className="dfl-label">Document name
            <input className="drv-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} />
          </label>
          <p className="muted" style={{ margin: '10px 0 0' }}>To put a new copy (for example after renewal), press Replace file.</p>
          <input ref={replaceRef} type="file" accept={ACCEPT} hidden onChange={onReplace} />
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button type="button" className="btn ghost" onClick={() => replaceRef.current?.click()} disabled={busy}>{busy ? 'Uploading...' : '📎 Replace file'}</button>
            <button type="button" className="btn in" onClick={saveEdit}>Save name</button>
          </div>
        </Modal>
      )}
      {del !== null && (
        <Modal title="Delete document?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{files[del]?.name}</b>? The file is removed for good.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
