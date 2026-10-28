'use client';

// Noor: the Group Summary AI assistant.
// Animated face (blinks, listens, thinks, talks), can be dragged anywhere, English and Roman Urdu,
// polite female voice, hands-free Talk mode that waits for 3 seconds of silence before answering.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';

const SILENCE_MS = 3000;
const NO_SPEECH_MS = 12000;
const POS_KEY = 'noor-pos';
const SET_KEY = 'noor-settings';
const CHAT_KEY = 'noor-chat';

const TXT = {
  en: {
    status: { idle: 'Online', listening: 'Listening...', thinking: 'Thinking...', speaking: 'Speaking...' },
    starters: ['Give me a quick summary', 'Which company spent the most?', 'What needs my attention?', 'How much is unpaid?', 'Compare with last month'],
    placeholder: 'Ask Noor anything', listenPh: 'Listening... speak now', silence: 'I will answer after 3 seconds of silence',
    talkOn: 'Talk mode on: just speak, I will reply and listen again', talk: 'Talk', hint: 'Hi, I am Noor 👋 Drag me anywhere',
    micBlocked: 'The microphone is blocked. Please allow the microphone for this site in the browser settings, then try again.',
    noMic: 'This browser cannot listen. Please use Google Chrome or Microsoft Edge.'
  },
  ru: {
    status: { idle: 'Online', listening: 'Sun rahi hoon...', thinking: 'Soch rahi hoon...', speaking: 'Bol rahi hoon...' },
    starters: ['Mukhtasar summary bataiye', 'Sab se zyada kharcha kis company ka hai?', 'Kin cheezon par tawajjo chahiye?', 'Kitna payment baqi hai?', 'Pichle mahine se muqabla kariye'],
    placeholder: 'Noor se kuch bhi poochiye', listenPh: 'Sun rahi hoon... boliye', silence: '3 second khamoshi ke baad jawab doongi',
    talkOn: 'Talk mode on: bas boliye, main jawab de kar phir sunoongi', talk: 'Baat', hint: 'Assalam o Alaikum, main Noor hoon 👋 Mujhe kahin bhi le jayein',
    micBlocked: 'Microphone band hai. Browser settings mein is site ke liye microphone allow kariye, phir dobara try kariye.',
    noMic: 'Yeh browser sun nahi sakta. Google Chrome ya Microsoft Edge use kariye.'
  }
};

const FEMALE = /(female|woman|zira|aria|jenny|sonia|libby|hazel|susan|samantha|victoria|karen|moira|tessa|fiona|serena|veena|heera|neerja|kalpana|swara|lekha|ananya|aditi|raveena|salli|joanna|kendra|kimberly|ivy|emma|amy|natasha|ava|allison|michelle|nicky|catherine|clara|google uk english female|google us english|google हिन्दी|google english \(india\))/i;
const MALE = /(\bmale\b|david|mark|george|ravi|hemant|prabhat|daniel|alex|fred|rishi|guy|ryan|madhur|thomas|james|william|brian|matthew|justin|joey|andrew|christopher|eric|roger|steffan|google uk english male)/i;

function bestVoice(lang) {
  const all = window.speechSynthesis?.getVoices() || [];
  const L = (v) => (v.lang || '').toLowerCase().replace('_', '-');
  const score = (v, want) => {
    let s = 0;
    if (FEMALE.test(v.name)) s += 6;
    if (MALE.test(v.name)) s -= 12;
    if (/natural|online|neural|premium|enhanced/i.test(v.name)) s += 3;
    if (/google/i.test(v.name)) s += 2;
    want.forEach((w, i) => { if (L(v).startsWith(w)) s += 8 - i * 2; });
    return s;
  };
  const want = lang === 'ru' ? ['en-in', 'hi-in', 'ur', 'en-gb', 'en-us'] : ['en-gb', 'en-us', 'en-in', 'en'];
  const pool = all.filter((v) => want.some((w) => L(v).startsWith(w)) || L(v).startsWith('en'));
  const best = pool.sort((a, b) => score(b, want) - score(a, want))[0];
  return best ? { voice: best, female: FEMALE.test(best.name) && !MALE.test(best.name) } : { voice: null, female: false };
}

// Split the "NEXT: a | b" line off the answer
function splitNext(text) {
  const lines = String(text || '').trim().split('\n');
  const i = lines.findIndex((l) => /^\s*next\s*:/i.test(l));
  if (i < 0) return { body: text.trim(), next: [] };
  const next = lines[i].replace(/^\s*next\s*:/i, '').split('|').map((x) => x.replace(/[*"]/g, '').trim()).filter(Boolean).slice(0, 3);
  return { body: lines.filter((_, j) => j !== i).join('\n').replace(/\*\*/g, '').trim(), next };
}

function TypeText({ text, fresh, onTick }) {
  const [n, setN] = useState(fresh ? 0 : text.length);
  useEffect(() => {
    if (!fresh) return undefined;
    const step = Math.max(1, Math.ceil(text.length / 70));
    const t = setInterval(() => setN((v) => { const nv = Math.min(text.length, v + step); if (nv >= text.length) clearInterval(t); return nv; }), 18);
    return () => clearInterval(t);
  }, [text, fresh]);
  useEffect(() => { onTick?.(); }, [n, onTick]);
  return <>{text.slice(0, n)}{n < text.length && <span className="noor-caret" />}</>;
}

// Noor's face: a friendly young woman in a hijab (hijab follows the chosen theme colour)
function Avatar({ mode, uid }) {
  const g = (n) => `${n}-${uid}`;
  return (
    <svg className="noor-svg" viewBox="9 8 82 82" aria-hidden="true">
      <defs>
        <radialGradient id={g('bg')} cx="50%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dff1ec" />
        </radialGradient>
        <linearGradient id={g('hj')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brown-hover)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brown-deep)' }} />
        </linearGradient>
        <radialGradient id={g('sk')} cx="50%" cy="40%" r="65%">
          <stop offset="0" stopColor="#ffe3cf" />
          <stop offset="1" stopColor="#f2c4a4" />
        </radialGradient>
        <clipPath id={g('clip')}><circle cx="50" cy="50" r="50" /></clipPath>
      </defs>
      <g clipPath={`url(#${g('clip')})`}>
        <rect width="100" height="100" fill={`url(#${g('bg')})`} />
        {/* shoulders and hijab */}
        <path d="M8 104 C10 82 26 74 50 74 C74 74 90 82 92 104 Z" fill={`url(#${g('hj')})`} />
        <path d="M50 12 C28 12 20 30 21 50 C22 68 32 80 50 82 C68 80 78 68 79 50 C80 30 72 12 50 12 Z" fill={`url(#${g('hj')})`} />
        <path d="M31 70 C38 80 62 80 69 70 C66 84 58 90 50 90 C42 90 34 84 31 70 Z" fill={`url(#${g('hj')})`} opacity=".9" />
        {/* face */}
        <ellipse cx="50" cy="50" rx="19" ry="22.5" fill={`url(#${g('sk')})`} />
        {/* eyebrows */}
        <path className="nf-brow" d="M38 41.5 Q42.5 38.8 46.5 41" fill="none" stroke="#6b4636" strokeWidth="1.6" strokeLinecap="round" />
        <path className="nf-brow" d="M53.5 41 Q57.5 38.8 62 41.5" fill="none" stroke="#6b4636" strokeWidth="1.6" strokeLinecap="round" />
        {/* eyes */}
        <g className="nf-eyes">
          <g className="nf-eye">
            <ellipse cx="42.3" cy="48.5" rx="3.3" ry="4" fill="#2a1f2d" />
            <circle className="nf-glint" cx="43.4" cy="47.2" r="1.25" fill="#fff" />
            <path d="M38.6 46.2 Q42.3 43.4 46 46.2" fill="none" stroke="#2a1f2d" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M38.8 46.4 L37.2 45.2" stroke="#2a1f2d" strokeWidth="1.1" strokeLinecap="round" />
          </g>
          <g className="nf-eye">
            <ellipse cx="57.7" cy="48.5" rx="3.3" ry="4" fill="#2a1f2d" />
            <circle className="nf-glint" cx="58.8" cy="47.2" r="1.25" fill="#fff" />
            <path d="M54 46.2 Q57.7 43.4 61.4 46.2" fill="none" stroke="#2a1f2d" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M61.2 46.4 L62.8 45.2" stroke="#2a1f2d" strokeWidth="1.1" strokeLinecap="round" />
          </g>
        </g>
        {/* cheeks and nose */}
        <ellipse cx="38" cy="57" rx="4" ry="2.4" fill="#ff7f96" opacity=".35" />
        <ellipse cx="62" cy="57" rx="4" ry="2.4" fill="#ff7f96" opacity=".35" />
        <path d="M50 51 Q48.6 55.5 50.6 56" fill="none" stroke="#d99a7c" strokeWidth="1.1" strokeLinecap="round" />
        {/* mouth: smile, or talking */}
        {mode === 'speaking'
          ? <ellipse className="nf-talk" cx="50" cy="63" rx="3.6" ry="2.6" fill="#b8435e" />
          : <path d={mode === 'thinking' ? 'M46.5 63 Q50 64 53.5 62.4' : 'M44.5 61.5 Q50 67 55.5 61.5'} fill="none" stroke="#b8435e" strokeWidth="1.8" strokeLinecap="round" />}
        {/* little sparkle pin on the hijab */}
        <path className="nf-pin" d="M72 34 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2z" fill="#fff" />
      </g>
    </svg>
  );
}

let faceId = 0;
function Face({ mode, size = 'big' }) {
  const [uid] = useState(() => `nf${++faceId}`);
  return (
    <span className={`noor-face ${size} m-${mode}`} aria-hidden="true">
      <span className="noor-aura" />
      <span className="noor-ring" />
      <span className="noor-core"><Avatar mode={mode} uid={uid} /></span>
      {size === 'big' && <><span className="noor-spark s1" /><span className="noor-spark s2" /><span className="noor-spark s3" /></>}
      {mode === 'listening' && <><span className="noor-wave w1" /><span className="noor-wave w2" /><span className="noor-wave w3" /></>}
    </span>
  );
}

export default function NoorAssistant({ context, greeting, alertCount = 0 }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('idle');
  const [lang, setLang] = useState('en');
  const [voiceOn, setVoiceOn] = useState(true);
  const [talk, setTalk] = useState(false);
  const [pos, setPos] = useState(null);
  const [panelStyle, setPanelStyle] = useState({});
  const [sheet, setSheet] = useState(false);
  const [silenceKey, setSilenceKey] = useState(0);
  const [heard, setHeard] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [hint, setHint] = useState(false);
  const [seen, setSeen] = useState(false);
  const [copied, setCopied] = useState(-1);

  const orbRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const recRef = useRef(null);
  const textRef = useRef('');
  const timers = useRef({});
  const want = useRef(false);
  const restarts = useRef(0);
  const run = useRef(0);
  const drag = useRef(null);
  const live = useRef({});
  const greeted = useRef(false);
  live.current = { msgs, lang, voiceOn, talk, context, mode };
  const t = TXT[lang];

  /* ---------- load and save ---------- */
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    try {
      const s = JSON.parse(localStorage.getItem(SET_KEY) || 'null');
      if (s?.lang) setLang(s.lang);
      if (typeof s?.voiceOn === 'boolean') setVoiceOn(s.voiceOn);
      const c = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null');
      if (Array.isArray(c)) setMsgs(c.slice(-20).map((m) => ({ ...m, fresh: false })));
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && Number.isFinite(p.x)) setPos(clampPos(p));
      if (!localStorage.getItem('noor-hint')) { setHint(true); localStorage.setItem('noor-hint', '1'); setTimeout(() => setHint(false), 7000); }
    } catch { /* ignore */ }
    return () => { stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { try { localStorage.setItem(SET_KEY, JSON.stringify({ lang, voiceOn })); } catch { /* ignore */ } }, [lang, voiceOn]);
  useEffect(() => { try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-20).map(({ fresh, ...m }) => m))); } catch { /* ignore */ } }, [msgs]);

  const scrollDown = useCallback(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, []);
  useEffect(() => { scrollDown(); }, [msgs, mode, open, scrollDown]);

  /* ---------- position: drag the orb anywhere ---------- */
  function clampPos(p) {
    const W = window.innerWidth; const H = window.innerHeight; const S = 72;
    return { x: Math.min(Math.max(8, p.x), W - S - 8), y: Math.min(Math.max(70, p.y), H - S - 8) };
  }
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const r = orbRef.current.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, x: r.left, y: r.top, moved: false };
    orbRef.current.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setHint(false);
    setPos(clampPos({ x: d.x + dx, y: d.y + dy }));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) { setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } return p; }); return; }
    toggle();
  }
  function onKeyDown(e) {
    const step = e.shiftKey ? 60 : 20;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    const r = orbRef.current.getBoundingClientRect();
    const p = clampPos({ x: r.left + mv[0], y: r.top + mv[1] });
    setPos(p);
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  }

  // Place the chat window next to the orb, on the side with more room
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const W = window.innerWidth; const H = window.innerHeight;
      if (W < 600) { setSheet(true); setPanelStyle({}); return; }
      setSheet(false);
      const r = orbRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = 390; const h = Math.min(600, H - 100);
      let left = r.left + r.width / 2 > W / 2 ? r.right - w : r.left;
      let top = r.top + r.height / 2 > H / 2 ? r.top - h - 14 : r.bottom + 14;
      left = Math.min(Math.max(12, left), W - w - 12);
      top = Math.min(Math.max(70, top), H - h - 12);
      setPanelStyle({ left, top, width: w, height: h });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, pos]);

  function toggle() {
    setHint(false);
    setSeen(true);
    const nv = !open;
    setOpen(nv);
    if (nv) {
      setTimeout(() => inputRef.current?.focus(), 80);
      // say hello once, the first time Noor is opened on this visit
      if (!greeted.current && voiceOn && !msgs.length) { greeted.current = true; speak(greeting?.[lang] || '', -2); }
    } else { stopAll(); setTalk(false); }
  }

  /* ---------- speaking (female voice) ---------- */
  function stopSpeaking() {
    run.current++;
    window.speechSynthesis?.cancel();
    setSpeakingIdx(-1);
  }

  function speak(text, idx = -1, then) {
    const synth = window.speechSynthesis;
    stopSpeaking();
    if (!synth || !text) { then?.(); return; }
    const my = ++run.current;
    const clean = String(text).replace(/[*_#`]/g, '').replace(/\bOMR\b/g, 'Rials').replace(/(\d),(\d{3})/g, '$1$2').replace(/%/g, ' percent');
    const parts = clean.split(/(?<=[.!?\n])\s+/).flatMap((p) => p.match(/.{1,170}(\s|$)/g) || [p]).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) { then?.(); return; }
    const { voice, female } = bestVoice(live.current.lang);
    setSpeakingIdx(idx);
    setMode('speaking');
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = live.current.lang === 'ru' ? 'en-IN' : 'en-GB';
      u.rate = 0.96;
      u.pitch = female ? 1.05 : 1.3; // softer if no female voice was found
      if (i === parts.length - 1) {
        const done = () => { if (my !== run.current) return; setSpeakingIdx(-1); setMode('idle'); then?.(); };
        u.onend = done; u.onerror = done;
      }
      synth.speak(u);
    });
  }

  /* ---------- listening: waits for 3 seconds of silence ---------- */
  function clearTimers() { Object.values(timers.current).forEach(clearTimeout); timers.current = {}; }

  function stopListening() {
    want.current = false;
    clearTimers();
    try { recRef.current?.abort(); } catch { /* ignore */ }
    recRef.current = null;
    setHeard(false);
    setMode((m) => (m === 'listening' ? 'idle' : m));
  }

  function stopAll() {
    stopListening();
    stopSpeaking();
    setMode('idle');
  }

  function startListening(fresh = true) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addBot(TXT[live.current.lang].noMic, true); setTalk(false); return; }
    stopSpeaking();
    clearTimers();
    try { recRef.current?.abort(); } catch { /* ignore */ }
    if (fresh) { restarts.current = 0; textRef.current = ''; setInput(''); setHeard(false); }
    want.current = true;
    let finished = false;
    const rec = new SR();
    rec.lang = live.current.lang === 'ru' ? 'en-IN' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const finish = () => {
      if (finished) return;
      finished = true;
      want.current = false;
      clearTimers();
      try { rec.stop(); } catch { /* ignore */ }
      setHeard(false);
      const q = textRef.current.trim();
      if (q) send(q); else setMode('idle');
    };

    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      textRef.current = text;
      setInput(text);
      setHeard(true);
      setSilenceKey((k) => k + 1);
      clearTimeout(timers.current.none);
      clearTimeout(timers.current.silence);
      timers.current.silence = setTimeout(finish, SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        finished = true; want.current = false; clearTimers(); setTalk(false); setMode('idle');
        addBot(TXT[live.current.lang].micBlocked, true);
      }
    };
    rec.onend = () => {
      if (finished) return;
      if (textRef.current.trim()) {
        // the browser stopped by itself while we were waiting for the 3 seconds: keep waiting, then send
        if (!timers.current.silence) finish();
        return;
      }
      if (want.current && restarts.current < 5) { restarts.current++; startListening(false); return; }
      want.current = false; setMode('idle'); setTalk(false);
    };

    timers.current.none = setTimeout(() => { if (!textRef.current.trim()) { finished = true; stopListening(); setTalk(false); } }, NO_SPEECH_MS);
    recRef.current = rec;
    setMode('listening');
    try { rec.start(); navigator.vibrate?.(30); } catch { /* already started */ }
  }

  /* ---------- asking the AI ---------- */
  function addBot(content, error = false) {
    setMsgs((m) => [...m, { role: 'assistant', content, error, fresh: true }]);
  }

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || live.current.mode === 'thinking') return;
    stopListening();
    stopSpeaking();
    setInput('');
    const next = [...live.current.msgs, { role: 'user', content: q }];
    setMsgs(next);
    setMode('thinking');
    try {
      const { data } = await sb().auth.getSession();
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify({ scope: 'group', lang: live.current.lang, context: live.current.context, messages: next.filter((m) => !m.error).slice(-8).map(({ role, content }) => ({ role, content })) })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Noor could not answer right now. Please try again.');
      const { body, next: follow } = splitNext(out.answer);
      const idx = next.length;
      setMsgs((m) => [...m, { role: 'assistant', content: body, next: follow, fresh: true }]);
      const after = () => { if (live.current.talk) setTimeout(() => startListening(true), 350); };
      if (live.current.voiceOn || live.current.talk) speak(body, idx, after);
      else { setMode('idle'); after(); }
    } catch (e) {
      setMode('idle');
      addBot(e.message, true);
      setTalk(false);
    }
  }

  function toggleTalk() {
    if (talk) { setTalk(false); stopAll(); return; }
    setTalk(true);
    live.current.talk = true;
    startListening(true);
  }

  function micOnce() {
    if (mode === 'listening') { stopListening(); setTalk(false); return; }
    startListening(true);
  }

  function changeLang(l) {
    if (l === lang) return;
    stopAll();
    setTalk(false);
    setLang(l);
  }

  async function copy(text, i) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(-1), 1400); } catch { /* ignore */ }
  }

  const last = [...msgs].reverse().find((m) => m.role === 'assistant' && !m.error);
  const status = t.status[mode] + (talk && mode === 'idle' ? ' · Talk mode' : '');
  const orbStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <>
      <button
        ref={orbRef}
        type="button"
        className={`noor-orb m-${mode} ${open ? 'is-open' : ''}`}
        style={orbStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        aria-label={open ? 'Close Noor, the AI assistant' : 'Open Noor, the AI assistant. Drag or use arrow keys to move.'}
        title="Noor · AI assistant (drag to move)"
      >
        <Face mode={mode} />
        {!seen && alertCount > 0 && <span className="noor-badge">{alertCount}</span>}
        {hint && <span className="noor-hint">{t.hint}</span>}
      </button>

      {open && (
        <section className={`noor-panel ${sheet ? 'sheet' : ''}`} style={panelStyle} role="dialog" aria-label="Noor, Group Summary AI assistant">
          <header className="noor-head">
            <Face mode={mode} size="small" />
            <div className="noor-who">
              <div className="noor-name">Noor <span className="noor-tag">AI</span></div>
              <div className={`noor-status s-${mode}`}><span className="noor-dot" />{status}</div>
            </div>
            <div className="noor-actions">
              <button type="button" className={`noor-ic ${voiceOn ? 'on' : ''}`} onClick={() => { if (voiceOn) stopSpeaking(); setVoiceOn((v) => !v); }} aria-pressed={voiceOn} title={voiceOn ? 'Voice on: Noor reads answers aloud' : 'Voice off'}>
                {voiceOn ? '🔊' : '🔇'}
              </button>
              {msgs.length > 0 && <button type="button" className="noor-ic" onClick={() => { stopAll(); setMsgs([]); }} title="Clear chat" aria-label="Clear chat">🗑</button>}
              <button type="button" className="noor-ic" onClick={toggle} title="Close" aria-label="Close">✕</button>
            </div>
          </header>

          <div className="noor-lang" role="group" aria-label="Language">
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => changeLang('en')} aria-pressed={lang === 'en'}>English</button>
            <button type="button" className={lang === 'ru' ? 'on' : ''} onClick={() => changeLang('ru')} aria-pressed={lang === 'ru'}>Roman Urdu</button>
          </div>

          <div className="noor-list" ref={listRef} aria-live="polite">
            <div className="noor-msg bot greet">
              {greeting?.[lang]}
              {speakingIdx === -2 && <button type="button" className="noor-mini on" onClick={() => { stopSpeaking(); setMode('idle'); }}>■ Stop</button>}
            </div>
            {msgs.length === 0 && (
              <div className="noor-chips">
                {t.starters.map((s) => <button key={s} type="button" className="noor-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`noor-msg ${m.role === 'user' ? 'me' : 'bot'} ${m.error ? 'err' : ''}`}>
                {m.role === 'assistant' && !m.error ? <TypeText text={m.content} fresh={m.fresh} onTick={scrollDown} /> : m.content}
                {m.role === 'assistant' && !m.error && (
                  <span className="noor-tools">
                    <button type="button" className={`noor-mini ${speakingIdx === i ? 'on' : ''}`} onClick={() => (speakingIdx === i ? (stopSpeaking(), setMode('idle')) : speak(m.content, i))}>
                      {speakingIdx === i ? '■ Stop' : '🔊 Listen'}
                    </button>
                    <button type="button" className="noor-mini" onClick={() => copy(m.content, i)}>{copied === i ? '✓ Copied' : '⧉ Copy'}</button>
                  </span>
                )}
              </div>
            ))}
            {mode === 'thinking' && <div className="noor-msg bot typing" aria-label="Thinking"><i /><i /><i /></div>}
            {mode !== 'thinking' && last?.next?.length > 0 && msgs[msgs.length - 1] === last && (
              <div className="noor-chips follow">
                {last.next.map((s) => <button key={s} type="button" className="noor-chip" onClick={() => send(s)}>↳ {s}</button>)}
              </div>
            )}
          </div>

          {mode === 'listening' && (
            <div className="noor-caption">
              <span className="noor-eq"><b /><b /><b /><b /><b /><b /><b /></span>
              <span className="noor-cap-text">{heard ? input : t.listenPh}</span>
              {heard && (
                <span className="noor-count" key={silenceKey} title={t.silence}>
                  <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle className="run" cx="18" cy="18" r="15" /></svg>
                </span>
              )}
            </div>
          )}
          {talk && mode !== 'listening' && <div className="noor-talknote">{t.talkOn}</div>}

          <form className="noor-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <button type="button" className={`noor-talk ${talk ? 'on' : ''}`} onClick={toggleTalk} aria-pressed={talk} title="Hands-free: speak, Noor answers, then listens again">
              <span className="noor-talk-dot" />{t.talk}
            </button>
            <button type="button" className={`noor-mic ${mode === 'listening' && !talk ? 'live' : ''}`} onClick={micOnce} aria-label={mode === 'listening' ? 'Stop listening' : 'Speak one question'} title="Speak one question">
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
            </button>
            <input
              ref={inputRef}
              className="noor-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'listening' ? t.listenPh : t.placeholder}
              aria-label="Your question"
              autoComplete="off"
            />
            <button type="submit" className="noor-send" disabled={mode === 'thinking' || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor" /></svg>
            </button>
          </form>
        </section>
      )}
    </>
  );
}
