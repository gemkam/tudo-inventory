'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { monthKey, monthLabel } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable } from '@/lib/transport';
import { useSalaryLabels } from '@/lib/labels';
import { useShare } from '@/components/ShareModal';
import SalarySlipPaper from '@/components/SalarySlip';

const COMPANY = {
  name: 'MODERN CITY FOR EXPRESS SERVICES LLC',
  cr: 'CR No. 1404742',
  vat: 'VAT Registration No. OM11008665',
  address: 'PO Box 149, PC 133, Sultanate of Oman',
  web: 'www.tudonumgroup.com'
};

const n = (v) => Number(v || 0);
const m3 = (v) => n(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function SlipPage() {
  const { id } = useParams();
  const params = useSearchParams();
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [salaries, setSalaries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const { open: openShare, modal } = useShare();
  const salLabels = useSalaryLabels();

  useEffect(() => {
    (async () => {
      const s = sb();
      const [d, sal, e] = await Promise.all([
        s.from('transport_drivers').select('*').eq('id', id).single(),
        s.from('transport_salaries').select('*').eq('driver_id', id).order('month'),
        s.from('transport_entries').select('id, driver_id, entry_date, rent, driver_allowance, allowance_status, allowance_salary_id').eq('driver_id', id)
      ]);
      if (d.error) { setError('Driver not found.'); return; }
      setDriver(d.data);
      setSalaries(sal.data || []);
      setEntries(e.data || []);
    })();
  }, [id]);

  const months = useMemo(() => [...new Set(salaries.map((s) => monthKey(s.month)))].sort(), [salaries]);
  const wanted = params.get('m');
  const month = wanted && months.includes(wanted) ? wanted : months[months.length - 1];
  const sal = salaries.find((s) => monthKey(s.month) === month) || null;

  if (error) return <div className="error">{error}</div>;
  if (!driver) return <div className="loading">Loading salary slip...</div>;

  const earnings = SALARY_FIELDS
    .filter(([k]) => k !== 'allowance_carried' || n(sal?.[k]))
    .map(([k]) => [k, salLabels.label(k)])
    .map(([k, label]) => [k === 'allowance_carried' && sal?.allowance_carried_note ? `${label} (${sal.allowance_carried_note})` : label, n(sal?.[k])]);
  const special = n(sal?.special_allowance);
  if (special) earnings.push([salLabels.label('special_allowance'), special]);
  const gross = salaryTotal(sal) + special;
  const deductions = [[salLabels.label('advance_deduction'), n(sal?.advance_deduction)]];
  const totalDed = deductions.reduce((t, [, v]) => t + v, 0);
  const net = salaryPayable(sal);

  function share() {
    openShare({
      title: `Salary slip ${driver.name} ${monthLabel(month)}`,
      text: [
        `Salary slip: ${driver.name}`,
        `Month: ${monthLabel(month)}`,
        `Gross earnings: ${m3(gross)} OMR`,
        `Deductions: ${m3(totalDed)} OMR`,
        `Net pay: ${m3(net)} OMR`,
        COMPANY.name
      ].join('\n')
    });
  }

  return (
    <>
      <div className="page-tools no-print">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="slip-month">Month</label>
            <select id="slip-month" value={month || ''} onChange={(e) => router.replace(`/transport/salary/${id}?m=${e.target.value}`)}>
              {months.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
            </select>
          </div>
          <button type="button" className="btn in" onClick={() => window.print()} disabled={!sal}>Print / PDF</button>
          <button type="button" className="btn ghost" onClick={share} disabled={!sal}>Share</button>
        </div>
      </div>

      {!sal ? (
        <div className="panel"><p className="empty">No salary saved for {driver.name} yet. Add it in Transport → Salary.</p></div>
      ) : (
        <SalarySlipPaper driver={driver} salaries={salaries} entries={entries} month={month} />
      )}
      {modal}
    </>
  );
}

export default function Page() {
  return <AuthGate><Suspense fallback={<div className="loading">Loading...</div>}><SlipPage /></Suspense></AuthGate>;
}
