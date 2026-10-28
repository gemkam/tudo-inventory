'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import { todayISO } from '@/lib/sheet';
import { buildReminders, fmtD, whenText, daysLeft } from '@/lib/reminders';

/*
  Home page right column: numbered alert bubbles (1, 2, 3...).
  1. Vehicle reminders (PDC to pay, service due, VOC / Mulkiya renewals), as before.
  2. Payment words: any description with "Bank Transfer", "Cash", "PDC" or "Cheque"
     (trip sheets, office bills, vehicle maintenance). A date written in the text (03/11/2026) becomes the due date.
  Each bubble has × to close it. Closed alerts are kept per user (table alert_dismissals) and can be brought back.
*/

const POP_KEY = 'tudo-alarm-seen';
const LOCAL_KEY = 'tudo-closed-alerts';
const WORDS = /\b(bank\s*transfer|cash|pdc|cheque)\b/i;
const ICON = { pay: '💳', maintain: '🔧', renew: '📄', word: '📝' };
const CO = { 'modern-city': 'Modern City', 'abu-wasif': 'Abu Wasif', sumptuosity: 'Sumptuosity' };
const f3 = (v) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function wordLabel(text) {
  const m = String(text || '').match(WORDS);
  if (!m) return '';
  const w = m[1].toLowerCase().replace(/\s+/g, ' ');
  return w === 'pdc' ? 'PDC' : w === 'bank transfer' ? 'Bank Transfer' : w === 'cash' ? 'Cash' : 'Cheque';
}

/* first date written in the text: 03/11/2026, 3-11-26, 03.11.2026 */
function dateInText(text) {
  const m = String(text || '').match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  const dd = Number(d), mm = Number(mo), yy = Number(y);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function AlarmClock({ ringing }) {
  return (
    <svg className={`alarm ${ringing ? 'ringing' : ''}`} viewBox="0 0 64 64" width="34" height="34" aria-hidden="true">
      <g className="alarm-bells" fill="currentColor">
        <path d="M14 8a10 10 0 0 0-8 15l12-11a10 10 0 0 0-4-4z" />
        <path d="M50 8a10 10 0 0 1 8 15L46 12a10 10 0 0 1 4-4z" />
      </g>
      <g className="alarm-body">
        <circle cx="32" cy="35" r="20" fill="currentColor" />
        <circle cx="32" cy="35" r="15.5" fill="#fff" />
        <path d="M32 24v11l7 5" stroke="#1d2523" strokeWidth="3" strokeLinecap="round" fill="none" />
        <circle cx="32" cy="35" r="2" fill="#1d2523" />
        <path d="M18 54l-4 5M46 54l4 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </g>
      {ringing && (
        <g className="alarm-waves" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M4 34c-2-5-2-10 0-15" />
          <path d="M60 34c2-5 2-10 0-15" />
        </g>
      )}
    </svg>
  );
}

export default function AlertsPanel() {
  const [all, setAll] = useState(null);
  const [closed, setClosed] = useState(new Set());
  const [useLocal, setUseLocal] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [popup, setPopup] = useState(false);

  const load = useCallback(async () => {
    const s = sb();
    const q = (p) => p.then((r) => r.data || []).catch(() => []);
    const [veh, maint, te, drv, exp, dis] = await Promise.all([
      q(s.from('transport_vehicles').select('id, name, part, plate_no, voc_expiry, mulkiya_expiry')),
      q(s.from('vehicle_maintenance').select('*')),
      q(s.from('transport_entries').select('id, driver_id, entry_date, description, from_place, to_place, rent, maintenance, diesel, toll')),
      q(s.from('transport_drivers').select('id, name')),
      q(s.from('exp_entries').select('id, company, entry_date, description, paid, unpaid, source').is('source', null)),
      s.from('alert_dismissals').select('key')
    ]);

    // closed alerts: per user in the database, or on this device if that table cannot be used
    let shut = [];
    if (dis.error) {
      setUseLocal(true);
      try { shut = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { shut = []; }
    } else shut = (dis.data || []).map((x) => x.key);
    setClosed(new Set(shut));

    const out = buildReminders(veh, maint).map((r) => ({ ...r, icon: ICON[r.kind], href: '/transport/vehicles#maintenance' }));

    const drvName = Object.fromEntries(drv.map((d) => [d.id, d.name]));
    const vehName = Object.fromEntries(veh.map((v) => [v.id, `${v.name || ''} ${v.plate_no || ''}`.trim()]));
    const addWord = (key, text, rowDate, amount, where, href) => {
      const word = wordLabel(text);
      if (!word) return;
      const due = dateInText(text);
      const left = due ? daysLeft(due) : null;
      out.push({
        key, kind: 'word', icon: ICON.word, href,
        title: `${word}${amount ? `: ${f3(amount)} OMR` : ''}`,
        detail: `${String(text).trim()} · ${where}`,
        date: due || rowDate, left, dated: Boolean(due), urgent: due ? left <= 3 : false
      });
    };
    te.forEach((e) => {
      const amt = Number(e.maintenance) || Number(e.rent) || Number(e.diesel) || Number(e.toll) || 0;
      addWord(`word-te-${e.id}`, e.description, e.entry_date, amt, `${drvName[e.driver_id] || 'Driver'} trip sheet, ${fmtD(e.entry_date)}`, `/transport/${e.driver_id}`);
    });
    exp.forEach((r) => addWord(`word-exp-${r.id}`, r.description, r.entry_date, Number(r.unpaid) || Number(r.paid) || 0, `${CO[r.company] || r.company} office expense, ${fmtD(r.entry_date)}`, `/expenses?co=${r.company}`));
    maint.forEach((m) => addWord(`word-vm-${m.id}`, [m.work, m.notes].filter(Boolean).join(' · '), m.work_date, Number(m.amount) || 0, `${vehName[m.vehicle_id] || 'Vehicle'} maintenance, ${fmtD(m.work_date)}`, '/transport/vehicles#maintenance'));

    // most urgent first; payment words without a date go last (newest first)
    out.sort((a, b) => {
      const la = a.left ?? 9999, lb = b.left ?? 9999;
      if (la !== lb) return la - lb;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    setAll(out);

    if (out.some((x) => x.urgent && !shut.includes(x.key))) {
      let seen = '';
      try { seen = localStorage.getItem(POP_KEY) || ''; } catch { /* ignore */ }
      if (seen !== todayISO()) setPopup(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = useMemo(() => (all || []).filter((a) => !closed.has(a.key)), [all, closed]);
  const shut = useMemo(() => (all || []).filter((a) => closed.has(a.key)), [all, closed]);
  const urgent = open.filter((a) => a.urgent);

  function saveLocal(next) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }
  async function closeOne(key) {
    const next = new Set(closed); next.add(key); setClosed(next);
    if (useLocal) { saveLocal(next); return; }
    const { error } = await sb().from('alert_dismissals').upsert({ key }, { onConflict: 'user_id,key' });
    if (error) { setUseLocal(true); saveLocal(next); }
  }
  async function bringBack(key) {
    const next = new Set(closed); next.delete(key); setClosed(next);
    if (useLocal) { saveLocal(next); return; }
    await sb().from('alert_dismissals').delete().eq('key', key);
  }
  function closePopup() {
    try { localStorage.setItem(POP_KEY, todayISO()); } catch { /* ignore */ }
    setPopup(false);
  }

  const when = (a) => (a.left === null || a.left === undefined ? (a.date ? `entered ${fmtD(a.date)}` : '') : whenText(a.left));

  return (
    <aside className={`alerts-col ${urgent.length ? 'has-urgent' : ''}`} aria-label="Alerts">
      <div className="al-head">
        <AlarmClock ringing={urgent.length > 0} />
        <div>
          <h2>Alerts {all && <span className="al-count">{open.length}</span>}</h2>
          <p>{all === null ? 'Checking...' : urgent.length ? `${urgent.length} need attention now` : open.length ? 'Tap × to close one' : 'Nothing needs attention'}</p>
        </div>
      </div>

      <ol className="al-list">
        {open.map((a, i) => (
          <li key={a.key} className={`al-bubble ${a.urgent ? 'urgent' : ''} k-${a.kind}`}>
            <span className="al-no" aria-hidden="true">{i + 1}</span>
            <Link href={a.href || '#'} className="al-body">
              <b><span aria-hidden="true">{a.icon}</span> {a.title}</b>
              <small>{a.detail}</small>
              {when(a) && <em className="al-when">{when(a)}{a.dated || a.kind !== 'word' ? ` · ${fmtD(a.date)}` : ''}</em>}
            </Link>
            <button type="button" className="al-x" onClick={() => closeOne(a.key)} aria-label={`Close alert ${i + 1}`} title="Close this alert">×</button>
          </li>
        ))}
      </ol>
      {all && !open.length && <p className="al-empty">✓ All clear</p>}

      {shut.length > 0 && (
        <div className="al-closed">
          <button type="button" className="al-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Hide closed' : `Show closed (${shut.length})`}
          </button>
          {showClosed && (
            <ul>
              {shut.map((a) => (
                <li key={a.key}>
                  <span>{a.title}</span>
                  <button type="button" className="al-link" onClick={() => bringBack(a.key)}>Bring back</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {popup && urgent.length > 0 && (
        <div className="modal-back alarm-pop" role="dialog" aria-modal="true" aria-label="Reminder alarm" onClick={closePopup}>
          <div className="modal alarm-card" onClick={(e) => e.stopPropagation()}>
            <AlarmClock ringing />
            <h2>Reminder</h2>
            <ul className="rem-list">
              {urgent.map((r) => (
                <li key={r.key} className="urgent">
                  <span className="rem-ico" aria-hidden="true">{r.icon}</span>
                  <span className="rem-text"><b>{r.title}</b><small>{r.detail}</small></span>
                  <span className="rem-when"><b>{whenText(r.left)}</b><small>{fmtD(r.date)}</small></span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn in" onClick={closePopup}>OK, remind me tomorrow</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
