'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { TIMELINE, countItems, TIMELINE_TOTAL } from '@/lib/timeline';

/* Timeline: chronological hierarchy of the site (Day > Module > what was built). Data in lib/timeline.js. CSS tl-* + sm-* in globals.css */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const showDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

function TimelinePage() {
  const [query, setQuery] = useState('');
  const [newest, setNewest] = useState(true);
  const [openKey, setOpenKey] = useState(1); // changes force all <details> open / closed
  const [allOpen, setAllOpen] = useState(true);
  const q = query.trim().toLowerCase();

  // Day number counted from the first day (21 Oct = Day 1)
  const days = useMemo(() => {
    const list = TIMELINE.map((d, i) => ({ ...d, n: i + 1 }))
      .map((d) => ({
        ...d,
        groups: d.groups
          .map(([mod, items]) => [mod, items.filter(([t, what, p]) => !q || `${d.title} ${mod} ${t} ${what} ${p} ${d.date} ${shortDate(d.date)}`.toLowerCase().includes(q))])
          .filter(([, items]) => items.length)
      }))
      .filter((d) => d.groups.length);
    return newest ? list.reverse() : list;
  }, [q, newest]);

  const first = TIMELINE[0].date;
  const last = TIMELINE[TIMELINE.length - 1].date;
  const toggleAll = () => { setAllOpen((v) => !v); setOpenKey((k) => k + 1); };

  return (
    <div className="sm-page tl-page">
      <div className="sm-head">
        <h1>🕒 Timeline</h1>
        <p>How Tudo Num Office Systems was built, day by day: from the notebook plan on {shortDate(first)} to {shortDate(last)}. {TIMELINE.length} days, {TIMELINE_TOTAL} steps.</p>
        <div className="tl-tools">
          <input type="search" className="sm-search" placeholder="Find, e.g. salary, Rauf, invoice, 28 Oct" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn small" onClick={() => setNewest((v) => !v)}>{newest ? '⬆ Oldest first' : '⬇ Newest first'}</button>
          <button className="btn small" onClick={toggleAll}>{allOpen ? '⊟ Fold all' : '⊞ Open all'}</button>
          <Link href="/sitemap" className="btn small">🗺 Sitemap</Link>
        </div>
      </div>

      {days.length ? (
        <ol className="tl-days" key={openKey}>
          {days.map((d) => (
            <li key={d.date} className="tl-day">
              <span className="tl-dot" aria-hidden="true">{d.n}</span>
              <details open={allOpen}>
                <summary className="tl-dayhead">
                  <b className="tl-dayno">Day {d.n}</b>
                  <span className="tl-date">{showDate(d.date)}</span>
                  <span className="tl-title">{d.title}</span>
                  <i className="tl-count">{countItems(d)} {countItems(d) === 1 ? 'step' : 'steps'}</i>
                </summary>
                <ul className="sm-kids tl-groups">
                  {d.groups.map(([mod, items]) => (
                    <li key={mod} className="sm-branch">
                      <details open={allOpen}>
                        <summary><span className="sm-row"><span className="sm-name tl-mod">{mod}</span><i className="tl-count">{items.length}</i></span></summary>
                        <ul className="sm-kids">
                          {items.map(([t, what, p]) => (
                            <li key={`${t}${what}`} className="sm-leaf">
                              <span className={`sm-row${q ? ' hit' : ''}`}>
                                {t && <code className="tl-time">{t}</code>}
                                {p ? <Link href={p} className="sm-name tl-what">{what}</Link> : <span className="tl-what">{what}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      ) : <p className="muted">Nothing matches that.</p>}
    </div>
  );
}

export default function Page() {
  return <AuthGate><TimelinePage /></AuthGate>;
}
