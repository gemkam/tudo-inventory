'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

/*
  "⋯ More" papers box for one box of the driver trip form (Diesel, Toll / others, Gate pass, Exit fee, Empty container fee,
  Container wash, Vehicle wash, Delivery order). Same idea as the Documents Checklist:
    📎 Import document · 🗂 Import documents (several) · per file 👁 View · ⬇ Download · 🖨 Print · ✏️ Edit (rename) · 🗑 Delete
  Files: private bucket "trip-files" (folder = trip id / box). Records in transport_entries.attachments[<kind>] through the
  database functions driver_add_file / driver_file_action, so a driver's Delete only MARKS the file deleted:
  the Administrator still sees it under "Deleted" (who and when) with View, Restore and Remove for good.
  View opens inside the app with ✕ Close (no new Chrome tab).
*/

const BUCKET = 'trip-files';
const ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx';
const MAX = 15 * 1024 * 1024;
const safe = (name) => String(name || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-80) || 'file';
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const isPdf = (f) => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || '');
const isImg = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name || '');
const iconOf = (f) => (isPdf(f) ? '📕' : isImg(f) ? '🖼' : '📄');
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Portal({ children }) {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(true); }, []);
  return ok ? createPortal(children, document.body) : null;
}

async function blobUrl(f) {
  const { data, error } = await sb().storage.from(BUCKET).download(f.path);
  if (error || !data) throw new Error(error?.message || 'file not found');
  const type = f.type || (isPdf(f) ? 'application/pdf' : data.type);
  return URL.createObjectURL(type && type !== data.type ? new Blob([data], { type }) : data);
}

function printUrl(url, f) {
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr);
  const later = () => setTimeout(() => fr.remove(), 60000);
  if (isPdf(f)) {
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { /* ignore */ } later(); };
    fr.src = url;
  } else {
    const doc = fr.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><style>@page{margin:10mm}html,body{margin:0}img{max-width:100%;max-height:100vh;display:block;margin:auto}</style></head><body><img src="${url}"></body></html>`);
    doc.close();
    const img = doc.querySelector('img');
    const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { /* ignore */ } later(); };
    if (img.complete) go(); else img.onload = go;
  }
}

function Viewer({ file, onClose }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const frameRef = useRef(null);
  useEffect(() => {
    let u = '';
    blobUrl(file).then((x) => { u = x; setUrl(x); }).catch((e) => setErr(e.message));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('dfv-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('dfv-open'); if (u) URL.revokeObjectURL(u); };
  }, [file, onClose]);
  const download = () => { const a = document.createElement('a'); a.href = url; a.download = file.name || 'paper'; document.body.appendChild(a); a.click(); a.remove(); };
  return (
    <Portal>
      <div className="dfv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dfv" role="dialog" aria-modal="true" aria-label={file.name}>
          <div className="dfv-bar">
            <b className="dfv-title">{iconOf(file)} {file.name}</b>
            <span className="dfv-tools">
              <button type="button" className="btn small" onClick={download} disabled={!url}>⬇ Download</button>
              {(isPdf(file) || isImg(file)) && <button type="button" className="btn small" disabled={!url}
                onClick={() => (isPdf(file) ? frameRef.current?.contentWindow?.print() : printUrl(url, file))}>🖨 Print</button>}
              <button type="button" className="btn small in dfv-close" onClick={onClose}>✕ Close</button>
            </span>
          </div>
          <div className="dfv-body">
            {err && <p className="dfv-msg">Could not open the file: {err}</p>}
            {!err && !url && <p className="dfv-msg">Opening...</p>}
            {url && isPdf(file) && <iframe ref={frameRef} src={url} title={file.name} className="dfv-frame" />}
            {url && isImg(file) && <img src={url} alt={file.name} className="dfv-img" />}
            {url && !isPdf(file) && !isImg(file) && <p className="dfv-msg">This file cannot be shown here. Press ⬇ Download.</p>}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/* tripId may be empty for a new trip: ensureTrip() saves the trip first and returns its id */
export default function TripFiles({ kind, label, tripId, files = [], locked, isOffice, ensureTrip, onChange, flash, userName }) {
  const oneRef = useRef(null);
  const manyRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const live = files.filter((f) => !f.deleted_at);
  const gone = files.filter((f) => f.deleted_at);
  const canChange = !locked || isOffice;

  async function pick(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    try {
      const id = tripId || await ensureTrip();
      if (!id) { setBusy(false); return; }
      let att = null;
      for (const file of list) {
        if (file.size > MAX) { flash(`${file.name} is bigger than 15 MB`, 'err'); continue; }
        const path = `${id}/${kind}/${Date.now()}-${safe(file.name)}`;
        const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
        if (up.error) { flash(`Upload failed: ${up.error.message}`, 'err'); continue; }
        const { data, error } = await sb().rpc('driver_add_file', { p_id: id, p_kind: kind, p_file: { path, name: file.name, size: file.size, type: file.type || '' } });
        if (error) { flash(error.message, 'err'); continue; }
        att = data;
      }
      if (att) { onChange(id, att); flash(`${label}: paper uploaded`); }
    } catch (err) { flash(err.message || 'Upload failed', 'err'); }
    setBusy(false);
  }

  async function action(f, act, name) {
    const { data, error } = await sb().rpc('driver_file_action', { p_id: tripId, p_kind: kind, p_path: f.path, p_action: act, p_name: name || null });
    if (error) { flash(error.message, 'err'); return false; }
    if (act === 'purge') await sb().storage.from(BUCKET).remove([f.path]);
    onChange(tripId, data);
    flash({ delete: 'Paper deleted (the office can still see it)', restore: 'Paper brought back', rename: 'Name changed', purge: 'Removed for good' }[act] || 'Done');
    return true;
  }

  async function download(f) {
    try { const u = await blobUrl(f); const a = document.createElement('a'); a.href = u; a.download = f.name || 'paper'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
    catch (e) { flash(`Could not download: ${e.message}`, 'err'); }
  }
  async function print(f) {
    if (!isPdf(f) && !isImg(f)) { flash('Only PDF and photos can be printed here. Download it first.', 'err'); return; }
    try { printUrl(await blobUrl(f), f); } catch (e) { flash(`Could not print: ${e.message}`, 'err'); }
  }
  const act = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="tf">
      <button type="button" className={`dfl-more${live.length ? ' has' : ''}`} onClick={() => setOpen(true)} disabled={busy}>
        {busy ? 'Uploading...' : `⋯ More${live.length ? ` (${live.length})` : ''}`}
      </button>
      {isOffice && gone.length > 0 && <span className="tf-gone" title="Papers the driver deleted">🗑 {gone.length} deleted</span>}
      <input ref={oneRef} type="file" accept={ACCEPT} hidden onChange={pick} />
      <input ref={manyRef} type="file" accept={ACCEPT} multiple hidden onChange={pick} />

      {open && (
        <Portal>
          <Modal title={`${label}: papers`} onClose={() => setOpen(false)}>
            {canChange ? (
              <div className="dfm-imports">
                <button type="button" className="dfm-big" onClick={act(() => oneRef.current?.click())}>📎 Import document<small>one paper or photo</small></button>
                <button type="button" className="dfm-big" onClick={act(() => manyRef.current?.click())}>🗂 Import documents<small>more than one at once</small></button>
              </div>
            ) : <p className="muted" style={{ marginTop: 0 }}>This trip is completed. Ask the office to add or change papers.</p>}
            {!live.length && <p className="muted" style={{ margin: '4px 0 0' }}>No paper yet.</p>}
            <div className="dfm-list">
              {live.map((f) => (
                <div key={f.path} className="dfm-file">
                  <div className="dfm-name">{iconOf(f)} <b>{f.name}</b><small>{[f.size ? sizeText(f.size) : '', f.by ? `by ${f.by}` : '', when(f.at)].filter(Boolean).join(' · ')}</small></div>
                  <div className="dfm-btns">
                    <button type="button" className="dfl-btn" onClick={act(() => setViewing(f))}>👁 View</button>
                    <button type="button" className="dfl-btn" onClick={act(() => download(f))}>⬇ Download</button>
                    <button type="button" className="dfl-btn" onClick={act(() => print(f))}>🖨 Print</button>
                    {canChange && <button type="button" className="dfl-btn" onClick={act(() => setEdit({ f, name: f.name }))}>✏️ Edit</button>}
                    {canChange && <button type="button" className="dfl-btn danger" onClick={act(() => setDel(f))}>🗑 Delete</button>}
                  </div>
                </div>
              ))}
            </div>
            {isOffice && gone.length > 0 && (
              <>
                <h3 className="tf-gone-head">🗑 Deleted ({gone.length}), only the office sees this</h3>
                <div className="dfm-list">
                  {gone.map((f) => (
                    <div key={f.path} className="dfm-file tf-deleted">
                      <div className="dfm-name">{iconOf(f)} <b>{f.name}</b><small>Uploaded by {f.by || '?'} {when(f.at)} · <b>Deleted by {f.deleted_by || '?'} {when(f.deleted_at)}</b></small></div>
                      <div className="dfm-btns">
                        <button type="button" className="dfl-btn" onClick={act(() => setViewing(f))}>👁 View</button>
                        <button type="button" className="dfl-btn" onClick={act(() => action(f, 'restore'))}>↶ Restore</button>
                        <button type="button" className="dfl-btn danger" onClick={act(() => action(f, 'purge'))}>Remove for good</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setOpen(false)}>✕ Close</button></div>
          </Modal>
        </Portal>
      )}
      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}
      {edit && (
        <Portal>
          <Modal title="Edit paper name" onClose={() => setEdit(null)}>
            <label className="dfl-label">Name
              <input className="drv-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <p className="muted" style={{ margin: '10px 0 0' }}>Wrong paper? Delete it and import the right one.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button type="button" className="btn in" onClick={async () => { if (await action(edit.f, 'rename', edit.name)) setEdit(null); }}>Save</button>
            </div>
          </Modal>
        </Portal>
      )}
      {del && (
        <Portal>
          <Modal title="Delete this paper?" onClose={() => setDel(null)}>
            <p style={{ margin: 0 }}>Delete <b>{del.name}</b>?{isOffice ? '' : ' The office will still see that it was deleted.'}</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={async () => { const f = del; setDel(null); await action(f, 'delete'); }}>Delete</button>
            </div>
          </Modal>
        </Portal>
      )}
    </div>
  );
}
