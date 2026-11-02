'use client';

import { TARGETS, STYLE_PROPS, LAYOUT_PROPS, TEXT_WHICH, propOf } from '@/lib/look';
import { SITEMAP } from '@/lib/sitemap';

/*
  Rule tables of the Power Editor tabs 🎨 Styles, 📐 Layout and ✏️ Texts (look in lib/look.js).
  onChange(newList) gets the whole new list; the page keeps the Undo steps and Save.
*/

const newId = () => Math.random().toString(36).slice(2, 10);

function pagesOf(node, out = []) {
  const [name, path, , , kids] = node;
  if (path && !path.includes(':')) out.push([path, name]);
  (kids || []).forEach((k) => pagesOf(k, out));
  return out;
}
const PAGES = pagesOf(SITEMAP);

function ValueBox({ kind, prop, value, onChange }) {
  const p = propOf(kind, prop);
  if (!p) return <input value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  const [, , type, extra] = p;
  if (type === 'color') {
    return (
      <span className="lk-color">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#13836b'} onChange={(e) => onChange(e.target.value)} />
        <input value={value || ''} placeholder="#13836b" onChange={(e) => onChange(e.target.value)} />
      </span>
    );
  }
  if (type === 'select') return <select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">Choose</option>{extra.map((x) => <option key={x} value={x}>{x}</option>)}</select>;
  if (type === 'yes') return <select value={value || 'yes'} onChange={(e) => onChange(e.target.value)}><option value="yes">Yes, hide</option><option value="no">No, show</option></select>;
  return <input inputMode="decimal" value={value || ''} placeholder={type === 'px' ? 'e.g. 16' : 'e.g. 3'} onChange={(e) => onChange(e.target.value.replace(/[^\d.%-]/g, ''))} />;
}

export function RuleTable({ kind, list, onChange }) {
  const props = kind === 'layout' ? LAYOUT_PROPS : STYLE_PROPS;
  const set = (id, k, v) => onChange(list.map((r) => (r.id === id ? { ...r, [k]: v, ...(k === 'prop' ? { value: '' } : {}) } : r)));
  const add = () => onChange([...list, { id: newId(), target: kind === 'layout' ? 'page' : 'h1', custom: '', prop: props[0][0], value: kind === 'layout' && props[0][2] === 'yes' ? 'yes' : '' }]);
  return (
    <div className="lk-box">
      <div className="lk-bar">
        <span className="muted">{kind === 'layout' ? 'Width, spacing, columns, hide or show parts of the app.' : 'Colours, fonts, sizes, corners and shadows.'} Changes show at once; press 💾 Save for everyone.</span>
        <button type="button" className="btn" onClick={add}>＋ Add {kind === 'layout' ? 'layout rule' : 'style'}</button>
      </div>
      {list.length === 0 ? <p className="muted lk-empty">Nothing yet. Press ＋ Add.</p> : (
        <table className="lk-t">
          <thead><tr><th>On</th><th>What</th><th>Setting</th><th>Value</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.off ? 'off' : ''}>
                <td><input type="checkbox" checked={!r.off} onChange={(e) => set(r.id, 'off', !e.target.checked)} aria-label="Use this rule" /></td>
                <td>
                  <select value={r.target} onChange={(e) => set(r.id, 'target', e.target.value)}>
                    {TARGETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  {r.target === 'custom' && <input className="lk-sel" value={r.custom || ''} placeholder=".my-class, main h3" onChange={(e) => set(r.id, 'custom', e.target.value)} />}
                </td>
                <td>
                  <select value={r.prop} onChange={(e) => set(r.id, 'prop', e.target.value)}>
                    {props.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </td>
                <td><ValueBox kind={kind} prop={r.prop} value={r.value} onChange={(v) => set(r.id, 'value', v)} /></td>
                <td><button type="button" className="cd-x" onClick={() => onChange(list.filter((x) => x.id !== r.id))} aria-label="Delete rule">🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function TextTable({ list, onChange }) {
  const set = (id, k, v) => onChange(list.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const add = () => onChange([...list, { id: newId(), page: '/', which: 'h1', from: '', to: '' }]);
  return (
    <div className="lk-box">
      <div className="lk-bar">
        <span className="muted">Change a page heading, its intro line, or any words in the app (e.g. a button name). Type the page or pick it; &quot;*&quot; = every page, &quot;/transport*&quot; = Transport and its pages.</span>
        <button type="button" className="btn" onClick={add}>＋ Add text</button>
      </div>
      {list.length === 0 ? <p className="muted lk-empty">Nothing yet. Press ＋ Add text.</p> : (
        <table className="lk-t">
          <thead><tr><th>On</th><th>Page</th><th>Which text</th><th>Words now (exact)</th><th>New words</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.off ? 'off' : ''}>
                <td><input type="checkbox" checked={!r.off} onChange={(e) => set(r.id, 'off', !e.target.checked)} aria-label="Use this text" /></td>
                <td><input list="lk-pages" value={r.page} onChange={(e) => set(r.id, 'page', e.target.value)} /></td>
                <td><select value={r.which} onChange={(e) => set(r.id, 'which', e.target.value)}>{TEXT_WHICH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td>{r.which === 'any' ? <input value={r.from} placeholder="e.g. Payment receipts" onChange={(e) => set(r.id, 'from', e.target.value)} /> : <span className="muted">whole {r.which === 'h1' ? 'heading' : 'intro line'}</span>}</td>
                <td>{r.which === 'any' || r.which === 'h1' ? <input value={r.to} onChange={(e) => set(r.id, 'to', e.target.value)} /> : <textarea rows={2} value={r.to} onChange={(e) => set(r.id, 'to', e.target.value)} />}</td>
                <td><button type="button" className="cd-x" onClick={() => onChange(list.filter((x) => x.id !== r.id))} aria-label="Delete text">🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <datalist id="lk-pages">
        <option value="*">Every page</option>
        {PAGES.map(([p, name]) => <option key={p} value={p}>{name}</option>)}
      </datalist>
    </div>
  );
}
