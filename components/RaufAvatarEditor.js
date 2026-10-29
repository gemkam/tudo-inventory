'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_AVATAR, useRaufAvatar, useAvatarSaver } from '@/lib/raufAvatar';

/*
  Change Rauf's (AI assistant) picture. Administrator only.
  Choose a photo -> drag to move, slider / mouse wheel to zoom, ↺ ↻ to rotate -> round preview -> Save.
  Saved as a 400 x 400 JPEG (square, shown in a circle).
  Also: "Use default photo" and "Use drawn face".
*/
const VIEW = 280; // crop box size on screen
const OUT = 400; // saved picture size

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as a picture.'));
    img.src = src;
  });
}

// draw the picture on a canvas of size `size` using zoom, offset (in VIEW pixels) and rotation
function paint(ctx, img, size, { zoom, x, y, rot }) {
  const k = size / VIEW;
  const turned = rot % 180 !== 0;
  const w = turned ? img.height : img.width;
  const h = turned ? img.width : img.height;
  const scale = (VIEW / Math.min(w, h)) * zoom * k;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2 + x * k, size / 2 + y * k);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

// keep the picture covering the whole crop box
function clampPos(img, zoom, rot, x, y) {
  if (!img) return { x: 0, y: 0 };
  const turned = rot % 180 !== 0;
  const w = turned ? img.height : img.width;
  const h = turned ? img.width : img.height;
  const s = (VIEW / Math.min(w, h)) * zoom;
  const mx = Math.max(0, (w * s - VIEW) / 2);
  const my = Math.max(0, (h * s - VIEW) / 2);
  return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
}

export default function RaufAvatarEditor({ onClose }) {
  const current = useRaufAvatar();
  const { busy, save } = useAvatarSaver();
  const [img, setImg] = useState(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0, rot: 0 });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // redraw the crop box
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = VIEW * ratio; c.height = VIEW * ratio;
    paint(c.getContext('2d'), img, VIEW * ratio, view);
  }, [img, view]);

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(''); setDone('');
    if (!f.type.startsWith('image/')) { setError('Please choose a picture file (JPG, PNG, WEBP).'); return; }
    if (f.size > 15 * 1024 * 1024) { setError('Picture is too big (more than 15 MB).'); return; }
    const url = URL.createObjectURL(f);
    try {
      setImg(await loadImage(url));
      setView({ zoom: 1, x: 0, y: 0, rot: 0 });
    } catch (err) { setError(err.message); }
  }

  // start from the picture in use now (so it can be re-cropped)
  async function editCurrent() {
    setError(''); setDone('');
    try {
      setImg(await loadImage(current.kind === 'photo' ? current.src : DEFAULT_AVATAR));
      setView({ zoom: 1, x: 0, y: 0, rot: 0 });
    } catch (err) { setError(err.message); }
  }

  const setZoom = useCallback((z) => {
    setView((v) => {
      const zoom = Math.min(5, Math.max(1, z));
      return { ...v, zoom, ...clampPos(img, zoom, v.rot, v.x, v.y) };
    });
  }, [img]);

  function rotate(d) {
    setView((v) => {
      const rot = (v.rot + d + 360) % 360;
      return { ...v, rot, ...clampPos(img, v.zoom, rot, v.x, v.y) };
    });
  }

  function onDown(e) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  }
  function onMove(e) {
    if (!drag.current) return;
    const d = drag.current;
    setView((v) => ({ ...v, ...clampPos(img, v.zoom, v.rot, d.x + e.clientX - d.px, d.y + e.clientY - d.py) }));
  }
  function onUp() { drag.current = null; }
  function onWheel(e) {
    if (!img) return;
    setZoom(view.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  function nudge(dx, dy) {
    setView((v) => ({ ...v, ...clampPos(img, v.zoom, v.rot, v.x + dx, v.y + dy) }));
  }

  async function saveCrop() {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = OUT; c.height = OUT;
    paint(c.getContext('2d'), img, OUT, view);
    const data = c.toDataURL('image/jpeg', 0.88);
    const r = await save(data);
    if (r.error) { setError(r.error); return; }
    setDone('Saved. Rauf has the new picture on every page.');
    setImg(null);
  }

  async function saveSpecial(value, text) {
    setError(''); setDone('');
    const r = await save(value);
    if (r.error) { setError(r.error); return; }
    setDone(text);
    setImg(null);
  }

  const body = (
    <div className="modal-back rav-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal rav-modal" role="dialog" aria-modal="true" aria-label="Rauf picture">
        <h2>🤖 Rauf picture (AI assistant)</h2>

        {error && <div className="error">{error}</div>}
        {done && <div className="ok-msg">{done}</div>}

        {!img && (
          <div className="rav-now">
            <span className="rav-round">
              {current.kind === 'photo'
                ? <img src={current.src} alt="Rauf picture now" />
                : <span className="rav-drawn">Drawn face</span>}
            </span>
            <div className="rav-now-txt">
              <b>Picture in use now</b>
              <small>{current.kind === 'drawn' ? 'The drawn face' : current.src === DEFAULT_AVATAR ? 'Default photo' : 'Your uploaded photo'}</small>
            </div>
          </div>
        )}

        {img && (
          <div className="rav-crop">
            <div
              className="rav-box"
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onWheel={onWheel}
              tabIndex={0}
              aria-label="Crop area. Drag or use arrow keys to move the picture."
              onKeyDown={(e) => {
                const m = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
                if (m) { e.preventDefault(); nudge(...m); }
                if (e.key === '+' || e.key === '=') setZoom(view.zoom * 1.1);
                if (e.key === '-') setZoom(view.zoom / 1.1);
              }}
            >
              <canvas ref={canvasRef} style={{ width: VIEW, height: VIEW }} />
              <span className="rav-mask" aria-hidden="true" />
            </div>
            <p className="rav-help">Drag to move · slider or mouse wheel to zoom. Keep the face inside the circle.</p>
            <div className="rav-tools">
              <button type="button" className="btn" onClick={() => setZoom(view.zoom / 1.15)} aria-label="Zoom out">−</button>
              <input type="range" min="1" max="5" step="0.01" value={view.zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
              <button type="button" className="btn" onClick={() => setZoom(view.zoom * 1.15)} aria-label="Zoom in">＋</button>
              <button type="button" className="btn" onClick={() => rotate(-90)} title="Turn left" aria-label="Turn left">↺</button>
              <button type="button" className="btn" onClick={() => rotate(90)} title="Turn right" aria-label="Turn right">↻</button>
              <button type="button" className="btn" onClick={() => setView({ zoom: 1, x: 0, y: 0, rot: 0 })}>Reset</button>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

        <div className="rav-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>📷 Choose new photo</button>
          {!img && current.kind === 'photo' && <button type="button" className="btn" onClick={editCurrent} disabled={busy}>✂️ Crop current photo</button>}
          {!img && current.src !== DEFAULT_AVATAR && <button type="button" className="btn" onClick={() => saveSpecial(null, 'Back to the default photo.')} disabled={busy}>Use default photo</button>}
          {!img && current.kind !== 'drawn' && <button type="button" className="btn" onClick={() => saveSpecial('drawn', 'Rauf now uses the drawn face.')} disabled={busy}>Use drawn face</button>}
        </div>

        <div className="modal-actions">
          {img && <button type="button" className="btn" onClick={() => setImg(null)} disabled={busy}>Cancel crop</button>}
          {img
            ? <button type="button" className="btn in" onClick={saveCrop} disabled={busy}>{busy ? 'Saving…' : 'OK, save picture'}</button>
            : <button type="button" className="btn in" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
