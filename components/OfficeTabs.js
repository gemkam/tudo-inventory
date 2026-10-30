'use client';

import Link from 'next/link';
import { COMPANIES } from '@/lib/expenses';

/*
  Office Expense company tabs shown on every Transport page (Transport now lives inside Office Expense as the 4th tab).
  Rendered by components/AuthGate.js above the Transport pages. Same look as the tabs on /expenses (co-switch CSS).
*/
export default function OfficeTabs() {
  return (
    <div className="co-switch office-tabs no-print" role="tablist" aria-label="Office Expense">
      {COMPANIES.map((c) => <Link key={c.key} href={`/expenses?co=${c.key}`} role="tab" className="co-tab">{c.short}</Link>)}
      <span className="co-tab on" role="tab" aria-selected="true">🚚 Transport</span>
      <Link href="/expenses/summary" className="co-tab co-sum">📊 Group Summary</Link>
    </div>
  );
}
