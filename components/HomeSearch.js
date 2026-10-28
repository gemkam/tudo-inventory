'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';

/*
  ✨ AI Search on the Home page. Searches the whole app (app/api/app-search):
  documents and licenses, transport trips and salaries, office expense of the 3 companies,
  inventory, bills, invoices and alerts. Answers in a few lines with links to the right pages.
  While typing it also shows quick page shortcuts (no AI needed).
*/

const PAGES = [
  ['📋 Documents Checklist', '/docs', 'documents docs checklist license licence cr vat tax card chamber agreement mulkiya expiry renew'],
  ['🏛️ Govt License', '/docs?tab=govt', 'govt government license licence construction investment transport brokerage real estate'],
  ['🏢 Company Docs', '/docs?tab=company', 'company cr paper vat certificate tax card chamber commerce office agreement'],
  ['🚗 Cars Docs', '/docs?tab=car', 'car cars mulkiya registration'],
  ['🚛 Heavy Vehicles Docs', '/docs?tab=heavy', 'heavy truck trailer lowbed unit mulkiya'],
  ['🪪 Employee Docs', '/docs?tab=employee', 'employee passport visa resident card labour'],
  ['🚚 Transport Expense', '/transport', 'transport trips diesel toll salary summary'],
  ['👤 Drivers', '/transport/drivers', 'drivers driver resident card visa mobile salary receipt'],
  ['📑 Driver salary sheet', '/transport/salary-sheet', 'salary sheet payroll driver salaries'],
  ['🚛 Vehicles and Maintenance', '/transport/vehicles', 'vehicles voc mulkiya maintenance tyre pdc service'],
  ['📊 Transport Reports', '/transport/reports', 'transport reports profit'],
  ['🧾 Transport Invoice', '/transport/invoice', 'invoice transport tax interim'],
  ['💼 Office Expense: Modern City', '/expenses?co=modern-city', 'office expense modern city bills'],
  ['💼 Office Expense: Abu Wasif', '/expenses?co=abu-wasif', 'office expense abu wasif bills'],
  ['💼 Office Expense: Sumptuosity', '/expenses?co=sumptuosity', 'office expense sumptuosity bills'],
  ['📈 Group Summary', '/expenses/summary', 'group summary budget cash flow unpaid'],
  ['🧾 Invoices and Receipts', '/expenses/docs', 'invoice receipt payment'],
  ['📦 Inventory', '/inventory', 'inventory stock office supplies kitchen sanitary'],
  ['📦 Inventory Reports', '/inventory/reports', 'inventory reports'],
  ['💡 Utility Bills', '/bills', 'bills electricity water internet dispenser'],
  ['📝 Stock log', '/log', 'stock log history']
];
const EXAMPLES = ['What expires this month?', 'Expired licenses of Modern City', 'Money to pay', 'Low stock items', 'Unpaid bills of Abu Wasif'];

export default function HomeSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null); // { busy } | { answer, links } | { error }
  const inRef = useRef(null);

  const quick = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length || res) return [];
    return PAGES.filter(([label, , keys]) => {
      const hay = `${label} ${keys}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    }).slice(0, 5);
  }, [q, res]);

  async function ask(text) {
    const query = String(text ?? q).trim();
    if (!query) { inRef.current?.focus(); return; }
    setQ(query);
    setRes({ busy: true });
    try {
      const { data } = await sb().auth.getSession();
      const r = await fetch('/api/app-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
        body: JSON.stringify({ query })
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { setRes({ error: out.error || 'AI Search could not answer.' }); return; }
      setRes({ answer: out.answer || 'No answer.', links: out.links || [] });
    } catch {
      setRes({ error: 'No connection. Please try again.' });
    }
  }

  function clear() { setQ(''); setRes(null); inRef.current?.focus(); }

  return (
    <div className="hs">
      <form className="hs-bar" role="search" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <span className="hs-ico" aria-hidden="true">✨</span>
        <input
          ref={inRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); if (res && !res.busy) setRes(null); }}
          placeholder="AI Search the whole app: documents, licenses, trips, bills, stock..."
          aria-label="AI Search the whole app"
        />
        {q && <button type="button" className="hs-x" onClick={clear} aria-label="Clear">×</button>}
        <button type="submit" className="btn in" disabled={res?.busy}>{res?.busy ? 'Searching...' : 'Search'}</button>
      </form>

      {!q && !res && (
        <div className="hs-examples">
          {EXAMPLES.map((x) => <button key={x} type="button" className="rp-chip" onClick={() => ask(x)}>{x}</button>)}
        </div>
      )}

      {quick.length > 0 && (
        <div className="hs-quick">
          <small>Go to:</small>
          {quick.map(([label, href]) => <Link key={href} href={href} className="rp-chip">{label}</Link>)}
          <small className="muted">or press Search to ask AI</small>
        </div>
      )}

      {res?.busy && <div className="hs-card"><span className="hs-dots" aria-label="Searching"><i /><i /><i /></span> Looking through the whole app...</div>}
      {res?.error && <div className="hs-card err" role="status">⚠️ {res.error}</div>}
      {res?.answer && (
        <div className="hs-card" role="status">
          <div className="hs-answer">{res.answer.split('\n').filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}</div>
          {res.links.length > 0 && (
            <div className="hs-links">
              {res.links.map((l) => <Link key={l.href} href={l.href} className="btn small">{l.label} →</Link>)}
            </div>
          )}
          <button type="button" className="al-link hs-close" onClick={clear}>✕ Close</button>
        </div>
      )}
    </div>
  );
}
