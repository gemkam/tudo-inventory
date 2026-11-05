'use client';

import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';
import { checks } from '@/lib/groupTools';
import { todayISO } from '@/lib/sheet';
import { GROUP_SOURCES } from '@/lib/groupSummary';

/*
  🔁 Double work (5 Nov 2026): the old Reports & Summary "Checks" tab, moved into the Home Alerts box
  as its own tab. Same rules (lib/groupTools.js checks): same bill number twice, same amount on the same
  day, maintenance on a trip sheet and on the Vehicles page, high diesel, received more than rent,
  trips not paid after 60 days, trips with no diesel. All companies + Transport.
*/

const labelOf = (key) => GROUP_SOURCES.find((s) => s.key === key)?.label || key;

export function useDoubleWork() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const s = sb();
      const [e, te, ma, dr] = await Promise.all([
        s.from('exp_entries').select('id, company, entry_date, bill_no, description, head, paid, unpaid, source_kind'),
        s.from('transport_entries').select('id, entry_date, driver_id, from_place, to_place, description, rent, received, diesel, maintenance'),
        s.from('vehicle_maintenance').select('*'),
        s.from('transport_drivers').select('id, name')
      ]);
      if (!live) return;
      const data = { exp: e.data || [], te: te.data || [], maint: ma.data || [] };
      const drivers = dr.data || [];
      const companies = [...new Set([...GROUP_SOURCES.map((x) => x.key), ...data.exp.map((b) => b.company)])];
      const pick = companies.includes('transport') ? companies : [...companies, 'transport'];
      const driverName = (id) => drivers.find((d) => d.id === id)?.name || '';
      try { setList(checks({ data, pick, today: todayISO(), labelOf, driverName })); } catch { setList([]); }
    })();
    return () => { live = false; };
  }, []);
  return list;
}

export function DoubleWorkList({ list }) {
  const [open, setOpen] = useState(null);
  if (list === null) return <p className="al-empty">Checking...</p>;
  if (!list.length) return <p className="al-empty">✓ No double work found</p>;
  return (
    <>
      <ol className="al-list">
        {list.map((c, i) => (
          <li key={i} className={`al-bubble dw-${c.level}`}>
            <span className="al-no" aria-hidden="true">{i + 1}</span>
            <button type="button" className="al-body dw-btn" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <b><span aria-hidden="true">{c.icon}</span> {c.title}</b>
              {open === i
                ? <ul className="dw-lines">{c.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
                : <small>Tap to see the entries</small>}
            </button>
            <span className="dw-arrow" aria-hidden="true">{open === i ? '▲' : '▼'}</span>
          </li>
        ))}
      </ol>
      <p className="dw-note">Same bill twice, same amount same day, maintenance on trip sheet and Vehicles page, high diesel, received more than rent, unpaid after 60 days, trips with no diesel.</p>
    </>
  );
}
