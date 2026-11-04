'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import SalarySlips from '@/components/SalarySlips';
import AddCompany from '@/components/AddCompany';
import SendSlipLink from '@/components/SendSlipLink';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';

/*
  All Companies > 💰 Salary (/expenses/salary?co=, 1 Nov 2026). Tab next to 🧾 Invoices.
  Every month: salary calculation of every employee (Office, Site from Personnel + Attendance; Drivers from the
  Transport salary sheet), Salary Credited (green when paid, "All Employees Salary Paid"), the slips (Generate,
  check, Approve, Regenerate, Deductions, revisions) and 📤 the employee's link (made once, never changes).
  Same data as Personnel > Employees (tables exp_staff, transport_drivers, salary_slips, salary_credits).
*/
function SalaryPage() {
  const { isAdmin, name: me } = useUser();
  const [co, setCo] = useState('');
  const [staff, setStaff] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [send, setSend] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    try { const k = new URLSearchParams(window.location.search).get('co') || ''; if (COMPANIES.some((c) => c.key === k)) setCo(k); } catch { /* ignore */ }
    Promise.all([
      sb().from('exp_staff').select('*').is('archived_at', null).order('company').order('sort').order('name'),
      sb().from('transport_drivers').select('*').is('archived_at', null).order('sort').order('name')
    ]).then(([a, b]) => { setStaff(a.data || []); setDrivers(b.data || []); });
  }, []);
  function pick(k) {
    setCo(k);
    try { window.history.replaceState(null, '', k ? `/expenses/salary?co=${k}` : '/expenses/salary'); } catch { /* ignore */ }
  }

  const C = COMPANIES.find((c) => c.key === co);
  const tabs = (
    <div className="co-switch no-print" role="tablist" aria-label="Company">
      <button type="button" role="tab" aria-selected={!co} className={!co ? 'on' : ''} onClick={() => pick('')}>All</button>
      {COMPANIES.map((c) => <button key={c.key} type="button" role="tab" aria-selected={co === c.key} className={co === c.key ? 'on' : ''} onClick={() => pick(c.key)}>{c.short}</button>)}
      <Link href="/transport" className="co-tab co-tr">🚚 Transport</Link>
      <Link href="/docs" className="co-tab co-sum">📋 Checklist</Link>
      <Link href={`/expenses/docs?${co ? `co=${co}&` : ''}kind=receipt`} className="co-tab">🧾 Bills</Link>
      <span className="co-tab on" role="tab" aria-selected="true">💰 Salary</span>
      <Link href="/expenses/vat" className="co-tab co-sum co-vat">🧾 VAT return</Link>
      {isAdmin && <AddCompany flash={flash} onAdded={(k) => pick(k)} />}
    </div>
  );

  return (
    <>
      <div className="company-head ch-top">
        <span className="company-name">{C ? C.name : 'All Companies'}</span>
        <h1>💰 Salary</h1>
        <p className="sub">Monthly salary of every employee and driver · Salary Credited · Salary slips · Currency: OMR</p>
      </div>
      {staff === null ? <div className="loading">Loading...</div> : (
        <SalarySlips staff={staff} drivers={drivers} me={me} isAdmin={isAdmin} flash={flash} co={co} tabs={tabs}
          onSend={(x) => setSend(x)} />
      )}
      {send && (
        <SendSlipLink table={send.table} row={send.row} flash={flash} onClose={() => setSend(null)}
          onChanged={(row) => {
            (send.table === 'exp_staff' ? setStaff : setDrivers)((l) => l.map((x) => (x.id === row.id ? row : x)));
            setSend({ ...send, row });
          }} />
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><SalaryPage /></AuthGate>;
}
