/*
  App colour theme: Day / Night mode plus a colour pair (one dark + one light).
  Saved per device in localStorage under "tudo-theme".
  The same logic runs as an inline script in app/layout.js before the page paints (no flash).
*/

export const THEME_KEY = 'tudo-theme';

// Ready-made pairs: [name, dark colour, light colour]
export const PALETTES = [
  ['Emerald', '#13836b', '#e4f3ed'],
  ['Teal', '#0f7d8c', '#e3f3f5'],
  ['Ocean', '#2463a8', '#e6eef8'],
  ['Royal', '#5b4bb0', '#ece9f8'],
  ['Maroon', '#9b2d42', '#f7e8eb'],
  ['Amber', '#a26a14', '#f8efdf'],
  ['Slate', '#45596b', '#e9eef2'],
  ['Olive', '#5d7a2c', '#edf3e2']
];

export const DEFAULT_THEME = { mode: 'light', dark: PALETTES[0][1], light: PALETTES[0][2] };

// Self-contained so it can also be stringified into the inline <head> script
export function applyTheme(t) {
  var hex = function (h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var v = parseInt(h, 16);
    if (isNaN(v) || h.length !== 6) return null;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  var mix = function (a, b, p) { return a.map(function (x, i) { return Math.round(x + (b[i] - x) * p); }); };
  var css = function (c) { return '#' + c.map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); };
  var W = [255, 255, 255], K = [0, 0, 0];
  var D = hex(t && t.dark) || [19, 131, 107];
  var L = hex(t && t.light) || [228, 243, 237];
  var night = t && t.mode === 'dark';
  var root = document.documentElement;
  var v = {};

  if (!night) {
    v['--brown'] = css(D);
    v['--brown-hover'] = css(mix(D, W, 0.12));
    v['--brown-deep'] = css(mix(D, K, 0.3));
    v['--bg'] = css(mix(L, W, 0.45));
    v['--grid-head'] = css(L);
    v['--tint'] = css(mix(L, D, 0.04));
    v['--row-alt'] = css(mix(L, W, 0.65));
    v['--row-hover'] = css(mix(L, W, 0.25));
    v['--hint-bg'] = css(mix(L, W, 0.5));
    v['--sel'] = css(mix(L, D, 0.18));
    v['--line'] = css(mix(L, D, 0.12));
    v['--line-strong'] = css(mix(L, D, 0.2));
    v['--grid-line'] = css(mix(L, D, 0.08));
    v['--frame'] = css(mix(L, D, 0.28));
    v['--surface'] = '#ffffff';
    v['--row'] = '#ffffff';
    v['--panel'] = '#ffffff';
    v['--card'] = '#ffffff';
    v['--cream'] = '#ffffff';
    v['--ink'] = '#1c2a25';
    v['--muted'] = '#5d6e67';
    v['--pill-line'] = '#d6dde1';
    v['--heading'] = css(D);
  } else {
    var base = mix(D, [12, 16, 15], 0.88);
    v['--brown'] = css(mix(D, W, 0.12));
    v['--brown-hover'] = css(mix(D, W, 0.24));
    v['--brown-deep'] = css(mix(D, K, 0.25));
    v['--bg'] = css(base);
    v['--surface'] = css(mix(base, W, 0.05));
    v['--row'] = v['--surface'];
    v['--panel'] = v['--surface'];
    v['--card'] = v['--surface'];
    v['--cream'] = '#ffffff';
    v['--grid-head'] = css(mix(base, D, 0.35));
    v['--tint'] = css(mix(base, D, 0.28));
    v['--row-alt'] = css(mix(base, W, 0.08));
    v['--row-hover'] = css(mix(base, D, 0.22));
    v['--hint-bg'] = css(mix(base, W, 0.07));
    v['--sel'] = css(mix(base, D, 0.45));
    v['--line'] = css(mix(base, W, 0.14));
    v['--line-strong'] = css(mix(base, W, 0.2));
    v['--grid-line'] = css(mix(base, W, 0.1));
    v['--frame'] = css(mix(base, W, 0.24));
    v['--ink'] = '#e6eeeb';
    v['--muted'] = '#a3b4ae';
    v['--pill-line'] = css(mix(base, W, 0.2));
    v['--heading'] = css(mix(D, W, 0.55));
  }
  // Watermark: chosen colour, strength set by its contrast with the page background
  var lum = function (c) {
    var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  var bgc = hex(v['--bg']);
  var wm = night ? mix(D, W, 0.65) : mix(D, K, 0.15);
  var a = lum(wm), b = lum(bgc);
  var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  v['--wm-color'] = css(wm);
  v['--wm-opacity'] = String(Math.min(0.38, Math.max(0.12, (night ? 1 : 1.15) / ratio)).toFixed(3));
  v['--shadow-rgb'] = mix(D, K, 0.5).join(', ');
  v['--accent-light'] = css(L);

  Object.keys(v).forEach(function (k) { root.style.setProperty(k, v[k]); });
  root.setAttribute('data-theme', night ? 'dark' : 'light');
  root.style.colorScheme = night ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', css(night ? mix(D, W, 0.12) : D));
}

export function readTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
    if (t && t.dark && t.light) return { ...DEFAULT_THEME, ...t };
  } catch { /* ignore */ }
  return { ...DEFAULT_THEME };
}

export function saveTheme(t) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch { /* ignore */ }
  applyTheme(t);
  window.dispatchEvent(new CustomEvent('tudo-theme', { detail: t }));
}

// Inline script for <head>: applies the saved theme before the first paint
export const THEME_BOOT = `(function(){try{var t=JSON.parse(localStorage.getItem('${THEME_KEY}')||'null')||${JSON.stringify(DEFAULT_THEME)};(${applyTheme.toString()})(t);}catch(e){}})();`;
