'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

/*
  "Upload the documents" cell of the Documents Checklist (app/docs/page.js).
  The cell lists the file names (tap a name to view) and one "⋯ More" button. More opens a box with:
    📎 Import document (one file) · 📎 Import documents (several at once)
    and for every file: 👁 View · ⬇ Download · 🖨 Print · ✏️ Edit · 🗑 Delete
  View opens INSIDE the app (PDF / photo viewer with ✕ Close, Download, Print, Esc closes), not a new Chrome tab.
  Files: private Supabase Storage bucket "doc-files" (folder = checklist row id); list in doc_checklist.files
  [{ path, name, size, type, at, by }]. Picking works from a computer or a phone (Files, Photos, Camera).
  Import / Edit / Delete: Administrator and Full access. View / Download / Print: everyone who can read.
  Old text notes (doc_checklist.notes) still show small under the files.
*/

const BUCKET = 'doc-files';
const ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt';
const MAX = 15 * 1024 * 1024;
const stop = (e) => e.stopPropagation();
const safe = (name) => String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file';
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isPdf = (f) => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || '');
const isImg = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name || '');
const iconOf = (f) => (isPdf(f) ? '📕' : isImg(f) ? '🖼' : '📄');

function Portal({ children }) {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(true); }, []);
  return ok ? createPortal(children, document.body) : null;
}

/* the file as a same-site link (blob:), so it can be shown, printed and downloaded inside the app */
async function getBlobUrl(f) {
  const { data, error } = await sb().storage.from(BUCKET).download(f.path);
  if (error || !data) throw new Error(error?.message || 'file not found');
  const type = f.type || (isPdf(f) ? 'application/pdf' : data.type);
  return URL.createObjectURL(type && type !== data.type ? new Blob([data], { type }) : data);
}

function Viewer({ file, onClose, flash }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const frameRef = useRef(null);
  useEffect(() => {
    let u = '';
    getBlobUrl(file).then((x) => { u = x; setUrl(x); }).catch((e) => setErr(e.message));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('dfv-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('dfv-open'); if (u) URL.revokeObjectURL(u); };
  }, [file, onClose]);

  const canShow = isPdf(file) || isImg(file);
  function download() {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = file.name || 'document'; document.body.appendChild(a); a.click(); a.remove();
  }
  function print() {
    try {
      if (isPdf(file)) frameRef.current?.contentWindow?.print();
      else printBlob(url, file, flash);
    } catch { flash('Could not print here. Download it and print from the file.', 'err'); }
  }

  return (
    <Portal>
      <div className="dfv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dfv" role="dialog" aria-modal="true" aria-label={file.name}>
          <div className="dfv-bar">
            <b className="dfv-title">{iconOf(file)} {file.name}</b>
            <span className="dfv-tools">
              <button type="button" className="btn small" onClick={download} disabled={!url}>⬇ Download</button>
              {canShow && <button type="button" className="btn small" onClick={print} disabled={!url}>🖨 Print</button>}
              <button type="button" className="btn small in dfv-close" onClick={onClose} aria-label="Close">✕ Close</button>
            </span>
          </div>
          <div className="dfv-body">
            {err && <p className="dfv-msg">Could not open the file: {err}</p>}
            {!err && !url && <p className="dfv-msg">Opening...</p>}
            {url && isPdf(file) && <iframe ref={frameRef} src={url} title={file.name} className="dfv-frame" />}
            {url && isImg(file) && <img src={url} alt={file.name} className="dfv-img" />}
            {url && !canShow && <p className="dfv-msg">This type of file (Word, Excel...) cannot be shown here. Press ⬇ Download to open it on your device.</p>}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* print a PDF or photo without opening a new tab: a hidden frame inside the app */
function printBlob(url, f, flash) {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr);
  const cleanup = () => setTimeout(() => fr.remove(), 60000);
  if (isPdf(f)) {
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { flash('Could not print. Use View, then Print.', 'err'); } cleanup(); };
    fr.src = url;
  } else {
    const doc = fr.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><title>${String(f.name).replace(/</g, '')}</title><style>@page{margin:10mm}html,body{margin:0}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style></head><body><img src="${url}"></body></html>`);
    doc.close();
    const img = doc.querySelector('img');
    const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { /* ignore */ } cleanup(); };
    if (img.complete) go(); else img.onload = go;
  }
}

export default function DocFiles({ row, canEdit, userName, onSave, flash }) {
  const files = Array.isArray(row.files) ? row.files : [];
  const oneRef = useRef(null);
  const manyRef = useRef(null);
  const replaceRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [edit, setEdit] = useState(null); // { index, name }
  const [del, setDel] = useState(null); // index
  const title = [row.owner, row.doc_name].filter(Boolean).join(' · ') || 'Documents';

  async function upload(file) {
    if (file.size > MAX) { flash(`${file.name} is bigger than 15 MB. Please send a smaller copy.`, 'err'); return null; }
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

  async function download(f) {
    try {
      flash('Downloading...');
      const url = await getBlobUrl(f);
      const a = document.createElement('a');
      a.href = url; a.download = f.name || 'document'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { flash(`Could not download: ${e.message}`, 'err'); }
  }

  async function print(f) {
    if (!isPdf(f) && !isImg(f)) { flash('Only PDF and photos can be printed here. Download it and print from the file.', 'err'); return; }
    try { flash('Preparing to print...'); printBlob(await getBlobUrl(f), f, flash); } catch (e) { flash(`Could not print: ${e.message}`, 'err'); }
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

  const act = (fn) => () => { setMore(false); fn(); };

  return (
    <div className="dfl" onMouseDown={stop} onClick={stop} onDoubleClick={stop} onKeyDown={stop}>
      {files.map((f, i) => (
        <button key={f.path || i} type="button" className="dfl-name" onClick={() => setViewing(f)}
          title={`View ${f.name}${f.size ? ` · ${sizeText(f.size)}` : ''}${f.by ? ` · by ${f.by}` : ''}`}>
          {iconOf(f)} {f.name}
        </button>
      ))}
      {!files.length && <span className="muted dfl-none">No document yet</span>}
      <button type="button" className="dfl-more" onClick={() => setMore(true)} disabled={busy}>
        {busy ? 'Uploading...' : `⋯ More${files.length ? ` (${files.length})` : ''}`}
      </button>
      <input ref={oneRef} type="file" accept={ACCEPT} hidden onChange={onPick} />
      <input ref={manyRef} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
      <input ref={replaceRef} type="file" accept={ACCEPT} hidden onChange={onReplace} />
      {row.notes && <small className="dfl-note" title="Old note">{row.notes}</small>}

      {more && (
        <Portal>
          <Modal title={title} onClose={() => setMore(false)}>
            {canEdit && (
              <div className="dfm-imports">
                <button type="button" className="dfm-big" onClick={act(() => oneRef.current?.click())}>📎 Import document<small>one file</small></button>
                <button type="button" className="dfm-big" onClick={act(() => manyRef.current?.click())}>🗂 Import documents<small>more than one file at once</small></button>
              </div>
            )}
            {files.length === 0 && <p className="muted" style={{ margin: '4px 0 0' }}>No document uploaded yet.</p>}
            <div className="dfm-list">
              {files.map((f, i) => (
                <div key={f.path || i} className="dfm-file">
                  <div className="dfm-name">{iconOf(f)} <b>{f.name}</b><small>{[f.size ? sizeText(f.size) : '', f.by ? `by ${f.by}` : '', f.at ? new Date(f.at).toLocaleDateString('en-GB') : ''].filter(Boolean).join(' · ')}</small></div>
                  <div className="dfm-btns">
                    <button type="button" className="dfl-btn" onClick={act(() => setViewing(f))}>👁 View</button>
                    <button type="button" className="dfl-btn" onClick={act(() => download(f))}>⬇ Download</button>
                    <button type="button" className="dfl-btn" onClick={act(() => print(f))}>🖨 Print</button>
                    {canEdit && <button type="button" className="dfl-btn" onClick={act(() => setEdit({ index: i, name: f.name }))}>✏️ Edit</button>}
                    {canEdit && <button type="button" className="dfl-btn danger" onClick={act(() => setDel(i))}>🗑 Delete</button>}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setMore(false)}>✕ Close</button></div>
          </Modal>
        </Portal>
      )}

      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} flash={flash} />}

      {edit && (
        <Portal>
          <Modal title="Edit document" onClose={() => setEdit(null)}>
            <label className="dfl-label">Document name
              <input className="drv-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }} />
            </label>
            <p className="muted" style={{ margin: '10px 0 0' }}>To put a new copy (for example after renewal), press Replace file.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="btn ghost" onClick={() => replaceRef.current?.click()} disabled={busy}>{busy ? 'Uploading...' : '📎 Replace file'}</button>
              <button type="button" className="btn in" onClick={saveEdit}>Save name</button>
            </div>
          </Modal>
        </Portal>
      )}
      {del !== null && (
        <Portal>
          <Modal title="Delete document?" onClose={() => setDel(null)}>
            <p style={{ margin: 0 }}>Delete <b>{files[del]?.name}</b>? The file is removed for good.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={confirmDelete}>Delete</button>
            </div>
          </Modal>
        </Portal>
      )}
    </div>
  );
}
