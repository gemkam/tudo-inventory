/*
  App look set by the Administrator in Admin > 🛠 Power Editor (tabs 🎨 Styles, 📐 Layout, ✏️ Texts). Same for every user.
  Saved in app_settings key "look" as JSON { styles: [rule], layout: [rule], texts: [text] }, cached per device in
  localStorage "tudo-look". Applied by components/LookApplier.js (inside AuthGate):
    - styles / layout -> one <style id="tudo-look"> with !important rules (wins over globals.css and the colour theme)
    - texts -> page heading, intro line or any exact text replaced in place (text nodes only, so React keeps working)
  rule = { id, target, custom (CSS selector when target = custom), prop, value }
  text = { id, page ('*' = every page, '/expenses' or '/transport*' = that page and below), which ('h1' | 'sub' | 'any'), from, to }
*/

export const LOOK_KEY = 'look';
export const LOOK_CACHE = 'tudo-look';
export const EMPTY_LOOK = { styles: [], layout: [], texts: [] };

export const TARGETS = [
  ['app', 'Whole app (all text)', 'body'],
  ['page', 'Page area', 'main.page'],
  ['h1', 'Page headings', 'main h1'],
  ['h2', 'Section titles', 'main h2'],
  ['sub', 'Intro lines (under the heading)', 'main .sub'],
  ['company-head', 'Heading card (All Companies pages)', '.company-head'],
  ['btn', 'Buttons', '.btn'],
  ['tabs', 'Company tabs', '.co-switch'],
  ['toolbar', 'Toolbars', '.page-tools .tools'],
  ['tiles', 'Number cards (Total amount, KPIs)', '.rp-tile, .kpi, .stat'],
  ['thead', 'Table headings', 'main table thead th'],
  ['td', 'Table cells', 'main table td'],
  ['topbar', 'Top bar', 'header.tbx'],
  ['brand', 'Top bar name and logo', '.tbx-brand'],
  ['crumbs', 'Breadcrumbs (Home › ...)', 'nav.bc'],
  ['home-hero', 'Home heading', '.home-hero'],
  ['home-grid', 'Home tiles area', '.home-grid'],
  ['home-tiles', 'Home tiles', '.hub-tile'],
  ['alerts', 'Home alerts box', '.alerts-col'],
  ['powered', 'Powered by KS TECH line', '.powered-by'],
  ['watermark', 'Watermark', '.watermark'],
  ['rauf', 'Rauf button', '.noor-orb'],
  ['custom', 'Other (type a CSS selector)', '']
];

export const FONTS = ['Work Sans', 'Fraunces', 'Georgia', 'Arial', 'Tahoma', 'Verdana', 'Times New Roman', 'Courier New', 'system-ui'];

/* [key, label, kind, extra] kind: color | px | select | number | yes */
export const STYLE_PROPS = [
  ['color', 'Text colour', 'color'],
  ['background', 'Background colour', 'color'],
  ['font-family', 'Font', 'select', FONTS],
  ['font-size', 'Text size (px)', 'px'],
  ['font-weight', 'Bold', 'select', ['400 Normal', '500 Medium', '600 Semi bold', '700 Bold', '800 Extra bold']],
  ['font-style', 'Italic', 'select', ['normal', 'italic']],
  ['text-transform', 'Capital letters', 'select', ['none', 'uppercase', 'capitalize', 'lowercase']],
  ['letter-spacing', 'Letter spacing (px)', 'px'],
  ['border-radius', 'Corner roundness (px)', 'px'],
  ['border-color', 'Border colour', 'color'],
  ['box-shadow', 'Shadow', 'select', ['none', 'soft', 'strong']],
  ['opacity', 'See-through (0 to 1)', 'number']
];

export const LAYOUT_PROPS = [
  ['hide', 'Hide it', 'yes'],
  ['max-width', 'Width (px)', 'px'],
  ['min-height', 'Height at least (px)', 'px'],
  ['padding', 'Space inside (px)', 'px'],
  ['gap', 'Space between items (px)', 'px'],
  ['margin-top', 'Space above (px)', 'px'],
  ['margin-bottom', 'Space below (px)', 'px'],
  ['columns', 'Columns side by side', 'number'],
  ['text-align', 'Align text', 'select', ['left', 'center', 'right']],
  ['position', 'Stay on top while scrolling', 'select', ['sticky', 'static']]
];

export const TEXT_WHICH = [['h1', 'Page heading'], ['sub', 'Intro line'], ['any', 'Any text (exact words)']];

export const propList = (kind) => (kind === 'layout' ? LAYOUT_PROPS : STYLE_PROPS);
export const propOf = (kind, key) => propList(kind).find((p) => p[0] === key);
export const targetOf = (key) => TARGETS.find((t) => t[0] === key);

export function parseLook(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { styles: Array.isArray(v?.styles) ? v.styles : [], layout: Array.isArray(v?.layout) ? v.layout : [], texts: Array.isArray(v?.texts) ? v.texts : [] };
  } catch { return { ...EMPTY_LOOK }; }
}

const clean = (s) => String(s ?? '').replace(/[{}<>;]/g, '').trim();

function decl(prop, value) {
  const v = clean(value);
  if (prop === 'hide') return v && v !== 'no' ? 'display: none' : '';
  if (v === '') return '';
  const px = (x) => (/^-?\d+(\.\d+)?$/.test(x) ? `${x}px` : x);
  switch (prop) {
    case 'font-size': case 'letter-spacing': case 'border-radius': case 'max-width': case 'min-height':
    case 'padding': case 'gap': case 'margin-top': case 'margin-bottom':
      return `${prop}: ${px(v)}`;
    case 'font-family': return `font-family: "${v}", system-ui, sans-serif`;
    case 'font-weight': return `font-weight: ${v.split(' ')[0]}`;
    case 'box-shadow': return `box-shadow: ${v === 'soft' ? '0 4px 14px rgba(0,0,0,.08)' : v === 'strong' ? '0 10px 30px rgba(0,0,0,.18)' : 'none'}`;
    case 'columns': { const n = Math.max(1, Math.min(8, parseInt(v, 10) || 1)); return `display: grid; grid-template-columns: repeat(${n}, minmax(0, 1fr))`; }
    case 'position': return v === 'sticky' ? 'position: sticky; top: 0; z-index: 50' : 'position: static';
    case 'border-color': return `border-color: ${v}; border-style: solid`;
    default: return `${prop}: ${v}`;
  }
}

export function selectorOf(rule) {
  if (rule.target === 'custom') return clean(rule.custom);
  return targetOf(rule.target)?.[2] || '';
}

export function lookCss(look) {
  const out = [];
  for (const r of [...(look.styles || []), ...(look.layout || [])]) {
    if (r.off) continue;
    const sel = selectorOf(r);
    const d = decl(r.prop, r.value);
    if (!sel || !d) continue;
    out.push(`${sel} { ${d.split(';').map((x) => x.trim()).filter(Boolean).map((x) => `${x} !important`).join('; ')}; }`);
  }
  return out.join('\n');
}

const ORIG = typeof WeakMap !== 'undefined' ? new WeakMap() : null; // text node -> { orig, set }
// the page's own words; if React changed the node since we set it, its new words are the original
const origOf = (n) => { const r = ORIG.get(n); return r && n.nodeValue === r.set ? r.orig : n.nodeValue; };

const pageMatch = (rulePage, path) => {
  const p = String(rulePage || '*').trim();
  if (p === '*' || p === '') return true;
  if (p.endsWith('*')) return path.startsWith(p.slice(0, -1));
  return path === p;
};

function textNodes(root) {
  const list = [];
  if (!root) return list;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('script,style,textarea,input,select,option,[contenteditable="true"],.pw-noreplace') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
  return list;
}

function setNode(n, value) {
  const orig = origOf(n);
  ORIG.set(n, { orig, set: value });
  if (n.nodeValue !== value) n.nodeValue = value;
}

/* replace texts on the current page; text nodes are only changed in place (never removed) so React is not upset */
export function applyTexts(texts, path) {
  if (typeof document === 'undefined' || !ORIG) return;
  const main = document.querySelector('main');
  const touched = new Set();
  for (const t of texts || []) {
    if (t.off || !pageMatch(t.page, path) || String(t.to ?? '') === '' && t.which !== 'any') continue;
    if (t.which === 'h1' || t.which === 'sub') {
      const el = main && main.querySelector(t.which === 'h1' ? 'h1' : '.sub');
      if (!el) continue;
      const nodes = textNodes(el).filter((n) => origOf(n).trim() !== '');
      if (!nodes.length) continue;
      nodes.forEach((n, i) => { setNode(n, i === 0 ? t.to : ''); touched.add(n); });
    } else if (t.which === 'any' && String(t.from || '').trim()) {
      const from = String(t.from).trim();
      for (const n of textNodes(document.body)) {
        const o = origOf(n);
        if (o.trim() === from) { const lead = o.match(/^\s*/)[0]; const tail = o.match(/\s*$/)[0]; setNode(n, `${lead}${t.to ?? ''}${tail}`); touched.add(n); }
      }
    }
  }
  // put back texts whose rule was removed
  for (const n of textNodes(document.body)) {
    if (touched.has(n) || !ORIG.has(n)) continue;
    const r = ORIG.get(n); ORIG.delete(n);
    if (n.nodeValue === r.set && r.set !== r.orig) n.nodeValue = r.orig;
  }
}
