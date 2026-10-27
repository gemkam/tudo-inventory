'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import AuthGate from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { monthKey, monthLabel } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable } from '@/lib/transport';
import { omrInWords } from '@/lib/words';
import { useShare } from '@/components/ShareModal';
import Omr from '@/components/Omr';

const COMPANY = {
  name: 'MODERN CITY FOR EXPRESS SERVICES LLC',
  cr: 'CR No. 1404742',
  vat: 'VAT Registration No. OM11008665',
  address: 'PO Box 149, PC 133, Sultanate of Oman',
  web: 'www.tudonumgroup.com'
};

const n = (v) => Number(v || 0);
const m3 = (v) => n(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const lastDay = (key) => { const [y, mo] = key.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '');

function SlipPage() {
  const { id } = useParams();
  const params = useSearchParams();
  const router = useRouter();
  const [driver, setDriver] = useState(null);
  const [salaries, setSalaries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const { open: openShare, modal } = useShare();

  useEffect(() => {
    (async () => {
      const s = sb();
      const [d, sal, e] = await Promise.all([
        s.from('transport_drivers').select('*').eq('id', id).single(),
        s.from('transport_salaries').select('*').eq('driver_id', id).order('month'),
        s.from('transport_entries').select('entry_date, rent, driver_allowance, allowance_status').eq('driver_id', id)
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

  const trips = entries.filter((e) => monthKey(e.entry_date) === month && n(e.rent) > 0).length;
  const earnings = SALARY_FIELDS.map(([k, label]) => [label, n(sal?.[k])]);
  const special = n(sal?.special_allowance);
  if (special) earnings.push(['Special allowance', special]);
  const gross = salaryTotal(sal) + special;
  const deductions = [['Advance deduction', n(sal?.advance_deduction)]];
  const totalDed = deductions.reduce((t, [, v]) => t + v, 0);
  const net = salaryPayable(sal);
  const slipNo = month ? `SAL-${month.replace('-', '')}-${String(driver.sort || 1).padStart(2, '0')}` : '';

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
        <article className="slip-paper">
          <div className="slip-topline" aria-hidden="true" />
          <header className="slip-head">
            <img src="/tudonum-logo.png" alt="Tudo Num" className="slip-logo" />
            <div>
              <div className="slip-co">{COMPANY.name}</div>
              <div className="slip-co-line">{COMPANY.cr}<i>·</i>{COMPANY.vat}</div>
              <div className="slip-co-line">{COMPANY.address}<i>·</i>{COMPANY.web}</div>
            </div>
          </header>
          <div className="slip-rule" aria-hidden="true" />

          <div className="slip-title">
            <h1>SALARY SLIP</h1>
            <p>For the month of <b>{monthLabel(month)}</b></p>
          </div>

          <dl className="slip-info">
            <div><dt>Employee name</dt><dd>{driver.name}</dd></div>
            <div><dt>Resident Card No.</dt><dd>{driver.resident_card || '–'}</dd></div>
            <div><dt>Designation</dt><dd>Driver</dd></div>
            <div><dt>Vehicle No.</dt><dd>{driver.vehicle_no || '–'}</dd></div>
            <div><dt>Slip No.</dt><dd>{slipNo}</dd></div>
            <div className="wide"><dt>Pay period</dt><dd>01.{month.slice(5)}.{month.slice(0, 4)} to {dmy(lastDay(month))}</dd></div>
            <div><dt>Trips this month</dt><dd>{trips}</dd></div>
          </dl>

          <div className="slip-tables">
            <table className="slip-t">
              <thead><tr><th>Earnings</th><th className="num">Amount (OMR)</th></tr></thead>
              <tbody>
                {earnings.map(([label, v]) => <tr key={label}><td>{label}</td><td className="num">{m3(v)}</td></tr>)}
              </tbody>
              <tfoot><tr><td>Gross earnings</td><td className="num">{m3(gross)}</td></tr></tfoot>
            </table>
            <table className="slip-t">
              <thead><tr><th>Deductions</th><th className="num">Amount (OMR)</th></tr></thead>
              <tbody>
                {deductions.map(([label, v]) => <tr key={label}><td>{label}</td><td className="num">{m3(v)}</td></tr>)}
              </tbody>
              <tfoot><tr><td>Total deductions</td><td className="num">{m3(totalDed)}</td></tr></tfoot>
            </table>
          </div>

          <div className="slip-net">
            <div>
              <span>Net pay</span>
              <small>{omrInWords(net)}</small>
            </div>
            <strong><Omr v={net} /></strong>
          </div>

          <p className="slip-foot">This is a computer generated salary slip from Tudo Num Office Systems.</p>
        </article>
      )}
      {modal}
    </>
  );
}

export default function Page() {
  return <AuthGate><Suspense fallback={<div className="loading">Loading...</div>}><SlipPage /></Suspense></AuthGate>;
}
