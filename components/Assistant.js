'use client';

import { useEffect, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';

const CONFIG = {
  inventory: {
    title: 'Inventory Assistant',
    hello: 'Assalam o Alaikum! Ask me anything about the stock. You can type or use the mic, in English, Roman Urdu or اردو.',
    examples: ['Sugar kitni baki hai?', 'Which items are low on stock?', 'Is mahine kya kya use hua?', 'ٹشو رول کتنے ہیں؟']
  },
  transport: {
    title: 'Transport Assistant',
    hello: 'Assalam o Alaikum! Ask me anything about trips, diesel, salaries and profit. You can type or use the mic, in English, Roman Urdu or اردو.',
    examples: ['Saif ka kitna expense hua?', 'How much is still to collect?', 'October ka profit kitna hai?', 'امان اللہ کی تنخواہ کتنی ہے؟']
  }
};

const MIC_LANGS = [
  ['en-US', 'EN'],
  ['ur-PK', 'اردو']
];

const hasUrdu = (t) => /[؀-ۿ]/.test(t);

export default function Assistant({ scope }) {
  const cfg = CONFIG[scope];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micLang, setMicLang] = useState('en-US');
  const [speak, setSpeak] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const recRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const heardRef = useRef('');

  useEffect(() => {
    setMicOk(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
    window.speechSynthesis?.getVoices();
    try {
      const saved = JSON.parse(localStorage.getItem(`assistant-${scope}`) || 'null');
      if (saved?.msgs) setMsgs(saved.msgs.slice(-20));
      if (saved?.micLang) setMicLang(saved.micLang);
      if (typeof saved?.speak === 'boolean') setSpeak(saved.speak);
    } catch { /* ignore */ }
  }, [scope]);

  useEffect(() => {
    try { localStorage.setItem(`assistant-${scope}`, JSON.stringify({ msgs: msgs.slice(-20), micLang, speak })); } catch { /* ignore */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, micLang, speak, scope]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else stopMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [speakingIdx, setSpeakingIdx] = useState(-1);

  // Pick a voice: Urdu script needs an Urdu voice; Roman Urdu sounds natural with a Hindi/Urdu voice; English uses English
  function pickVoice(text) {
    const voices = window.speechSynthesis.getVoices();
    const find = (code) => voices.find((v) => v.lang?.toLowerCase().replace('_', '-').startsWith(code));
    if (hasUrdu(text)) return { voice: find('ur'), lang: 'ur-PK', urdu: true };
    const roman = /\b(hai|hain|ka|ki|ke|kitna|kitni|kitne|mein|hua|hui|nahi|aur|baki|bacha|tak|wala|abhi|kul)\b/i.test(text);
    if (roman) return { voice: find('ur') || find('hi') || find('en'), lang: find('ur') ? 'ur-PK' : (find('hi') ? 'hi-IN' : 'en-US') };
    return { voice: find('en-gb') || find('en'), lang: 'en-US' };
  }

  // Online Urdu voice (used when the device has no Urdu voice, for example Chrome on Windows)
  const audioRef = useRef(null);
  const runRef = useRef(0);

  async function speakOnline(parts, idx) {
    const run = ++runRef.current;
    setSpeakingIdx(idx);
    const { data } = await sb().auth.getSession();
    const token = data.session?.access_token || '';
    // Fetch the first part, then fetch the next while the current one plays
    const load = (t) => fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: t, lang: 'ur' })
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The Urdu voice is not available right now.');
      return URL.createObjectURL(await r.blob());
    });
    try {
      let next = load(parts[0]);
      for (let i = 0; i < parts.length; i++) {
        const src = await next;
        if (run !== runRef.current) { URL.revokeObjectURL(src); return; }
        if (i + 1 < parts.length) next = load(parts[i + 1]);
        await new Promise((resolve, reject) => {
          const a = new Audio(src);
          audioRef.current = a;
          a.onended = resolve;
          a.onpause = resolve;
          a.onerror = () => reject(new Error('Could not play the Urdu voice.'));
          a.play().catch(reject);
        });
        URL.revokeObjectURL(src);
        if (run !== runRef.current) return;
      }
    } catch (e) {
      if (run === runRef.current) setMsgs((m) => [...m, { role: 'assistant', content: e.message, error: true }]);
    }
    if (run === runRef.current) setSpeakingIdx(-1);
  }

  // Read text aloud (in small parts so long answers are not cut off)
  function speakText(text, idx = -1) {
    if (typeof window === 'undefined') return;
    stopSpeaking();
    const clean = String(text).replace(/[*_#`]/g, '').replace(/\bOMR\b/g, hasUrdu(text) ? 'ریال' : 'Rials').replace(/(\d),(\d{3})/g, '$1$2');
    const parts = clean.split(/(?<=[.!?؟۔\n])\s+/).flatMap((p) => p.match(/.{1,180}(\s|$)/g) || [p]).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const synth = window.speechSynthesis;
    const { voice, lang, urdu } = synth ? pickVoice(clean) : { urdu: hasUrdu(clean) };
    if (urdu && !voice) { speakOnline(parts, idx); return; }
    if (!synth) return;
    setSpeakingIdx(idx);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 0.95;
      if (i === parts.length - 1) { u.onend = () => setSpeakingIdx(-1); u.onerror = () => setSpeakingIdx(-1); }
      synth.speak(u);
    });
  }

  function stopSpeaking() {
    runRef.current++;
    window.speechSynthesis?.cancel();
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    audioRef.current = null;
    setSpeakingIdx(-1);
  }

  function say(text, idx) {
    if (speak) speakText(text, idx);
  }

  // "padh ke batao", "sunao", "read it" etc: read the last answer again without asking the AI
  const READ_AGAIN = /^(please\s+)?(read( it)?( out| aloud| again)?|repeat|sunao|suna do|sunaao|padh ?ke (batao|sunao)|parh ?ke (batao|sunao)|پڑھ کے (بتاؤ|سناؤ)|پڑھ کر (بتاؤ|سناؤ)|سناؤ|سنا دو|دوبارہ سناؤ)[\s.!?؟۔]*$/i;

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setInput('');
    if (READ_AGAIN.test(q)) {
      const lastIdx = [...msgs].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'assistant' && !m.error);
      setMsgs((m) => [...m, { role: 'user', content: q }]);
      if (lastIdx) speakText(lastIdx.m.content, lastIdx.i);
      else setMsgs((m) => [...m, { role: 'assistant', content: 'There is no answer to read yet. Ask a question first.', error: true }]);
      return;
    }
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setBusy(true);
    try {
      const { data } = await sb().auth.getSession();
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify({ scope, messages: next.filter((m) => !m.error).slice(-8) })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${out.error || 'The assistant could not answer right now. Please try again.'}${out.detail ? `\n\nDetail: ${out.detail}` : ''}`);
      setMsgs((m) => [...m, { role: 'assistant', content: out.answer }]);
      say(out.answer, next.length);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message, error: true }]);
    }
    setBusy(false);
  }

  function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    stopSpeaking();
    const rec = new SR();
    rec.lang = micLang;
    rec.interimResults = true;
    rec.continuous = false;
    heardRef.current = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heardRef.current = text;
      setInput(text);
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMsgs((m) => [...m, { role: 'assistant', content: 'Microphone is blocked. Allow the microphone for this site in your browser settings, then try again.', error: true }]);
      }
    };
    rec.onend = () => {
      setListening(false);
      const heard = heardRef.current.trim();
      if (heard) send(heard);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stopMic() {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }

  function clearChat() {
    stopSpeaking();
    setMsgs([]);
  }

  return (
    <>
      <button
        type="button"
        className={`ai-fab ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? `Close ${cfg.title}` : `Open ${cfg.title}`}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
        ) : (
          <>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16v10H9l-5 4V5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="9" cy="10" r="1.2" fill="currentColor" /><circle cx="12" cy="10" r="1.2" fill="currentColor" /><circle cx="15" cy="10" r="1.2" fill="currentColor" /></svg>
            <span>Ask AI</span>
          </>
        )}
      </button>

      {open && (
        <section className="ai-panel" role="dialog" aria-label={cfg.title}>
          <header className="ai-head">
            <div>
              <div className="ai-title">{cfg.title}</div>
              <div className="ai-sub">{speak ? '🚗 Driving mode: answers are read aloud' : 'English · Roman Urdu · اردو'}</div>
            </div>
            <div className="ai-head-actions">
              <button type="button" className={`ai-icon ${speak ? 'on' : ''}`} onClick={() => { if (speak) stopSpeaking(); setSpeak((v) => !v); }} aria-pressed={speak} title={speak ? 'Driving mode on: answers are read aloud' : 'Driving mode: read every answer aloud'}>
                {speak ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                )}
              </button>
              {msgs.length > 0 && <button type="button" className="ai-icon" onClick={clearChat} title="Clear chat" aria-label="Clear chat">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>}
            </div>
          </header>

          <div className="ai-list" ref={listRef} aria-live="polite">
            <div className="ai-msg bot">{cfg.hello}</div>
            {msgs.length === 0 && (
              <div className="ai-examples">
                {cfg.examples.map((ex) => (
                  <button key={ex} type="button" className="ai-chip" dir="auto" onClick={() => send(ex)}>{ex}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role === 'user' ? 'me' : 'bot'} ${m.error ? 'err' : ''}`} dir="auto">
                {m.content}
                {m.role === 'assistant' && !m.error && (
                  <button
                    type="button"
                    className={`ai-listen ${speakingIdx === i ? 'on' : ''}`}
                    onClick={() => (speakingIdx === i ? stopSpeaking() : speakText(m.content, i))}
                    dir="ltr"
                  >
                    {speakingIdx === i ? '■ Stop' : '🔊 Listen'}
                  </button>
                )}
              </div>
            ))}
            {busy && <div className="ai-msg bot typing" aria-label="Thinking"><i /><i /><i /></div>}
          </div>

          <form className="ai-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            {micOk && (
              <div className="ai-mic-wrap">
                <button
                  type="button"
                  className={`ai-mic ${listening ? 'live' : ''}`}
                  onClick={() => (listening ? stopMic() : startMic())}
                  aria-label={listening ? 'Stop listening' : 'Speak your question'}
                  title={listening ? 'Listening... tap to stop' : 'Tap and speak'}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
                </button>
                <button type="button" className="ai-lang" onClick={() => setMicLang((l) => (l === 'en-US' ? 'ur-PK' : 'en-US'))} title="Microphone language">
                  {MIC_LANGS.find(([v]) => v === micLang)?.[1]}
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              id={`ai-input-${scope}`}
              className="ai-input"
              dir="auto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Listening...' : 'Type your question'}
              aria-label="Your question"
              autoComplete="off"
            />
            <button type="submit" className="ai-send" disabled={busy || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor" /></svg>
            </button>
          </form>
          {micOk && <div className="ai-foot">Mic: {micLang === 'en-US' ? 'English and Roman Urdu' : 'Urdu (answers in اردو)'} · tap EN / اردو to switch</div>}
        </section>
      )}
    </>
  );
}
