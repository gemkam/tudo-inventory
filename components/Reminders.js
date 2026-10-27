'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import { todayISO } from '@/lib/sheet';
import { buildReminders, fmtD, whenText } from '@/lib/reminders';

const POP_KEY = 'tudo-alarm-seen';

function AlarmClock({ ringing }) {
  return (
    <svg className={`alarm ${ringing ? 'ringing' : ''}`} viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
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

const ICON = { pay: '💳', maintain: '🔧', renew: '📄' };

/* Home page reminders: PDC to pay, maintenance due, insurance / mulkiya renewals */
export default function Reminders() {
  const [list, setList] = useState(null);
  const [popup, setPopup] = useState(false);

  useEffect(() => {
    (async () => {
      const s = sb();
      const [v, m] = await Promise.all([
        s.from('transport_vehicles').select('id, name, part, plate_no, insurance_expiry, mulkiya_expiry'),
        s.from('vehicle_maintenance').select('*')
      ]);
      if (v.error || m.error) { setList([]); return; }
      const r = buildReminders(v.data || [], m.data || []);
      setList(r);
      // Daily alarm pop-up once a day while something is 3 days away or overdue
      if (r.some((x) => x.urgent)) {
        let seen = '';
        try { seen = localStorage.getItem(POP_KEY) || ''; } catch { /* ignore */ }
        if (seen !== todayISO()) setPopup(true);
      }
    })();
  }, []);

  function closePopup() {
    try { localStorage.setItem(POP_KEY, todayISO()); } catch { /* ignore */ }
    setPopup(false);
  }

  if (!list || list.length === 0) return null;
  const urgent = list.filter((x) => x.urgent);

  return (
    <>
      <section className={`reminders ${urgent.length ? 'has-urgent' : ''}`} aria-label="Reminders">
        <div className="rem-head">
          <AlarmClock ringing={urgent.length > 0} />
          <div>
            <h2>Reminders</h2>
            <p>{urgent.length ? `${urgent.length} need attention now` : 'Coming up this week'} · {list.length} total</p>
          </div>
          <Link href="/transport/vehicles#maintenance" className="btn small">Open vehicles</Link>
        </div>
        <ul className="rem-list">
          {list.map((r) => (
            <li key={r.key} className={r.urgent ? 'urgent' : ''}>
              <span className="rem-ico" aria-hidden="true">{ICON[r.kind]}</span>
              <span className="rem-text"><b>{r.title}</b><small>{r.detail}</small></span>
              <span className="rem-when"><b>{whenText(r.left)}</b><small>{fmtD(r.date)}</small></span>
            </li>
          ))}
        </ul>
      </section>

      {popup && (
        <div className="modal-back alarm-pop" role="dialog" aria-modal="true" aria-label="Reminder alarm" onClick={closePopup}>
          <div className="modal alarm-card" onClick={(e) => e.stopPropagation()}>
            <AlarmClock ringing />
            <h2>Reminder</h2>
            <ul className="rem-list">
              {urgent.map((r) => (
                <li key={r.key} className="urgent">
                  <span className="rem-ico" aria-hidden="true">{ICON[r.kind]}</span>
                  <span className="rem-text"><b>{r.title}</b><small>{r.detail}</small></span>
                  <span className="rem-when"><b>{whenText(r.left)}</b><small>{fmtD(r.date)}</small></span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <Link href="/transport/vehicles#maintenance" className="btn" onClick={closePopup}>Open vehicles</Link>
              <button type="button" className="btn in" onClick={closePopup}>OK, remind me tomorrow</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
