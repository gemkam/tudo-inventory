'use client';

import { monthKey, monthLabel } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowanceStory } from '@/lib/transport';
import AllowanceNotes from '@/components/AllowanceNotes';
import { useSalaryLabels } from '@/lib/labels';
import { omrInWords } from '@/lib/words';
import Omr from '@/components/Omr';

/*
  The salary slip paper (one driver, one month). Used by the slip page (/transport/salary/<id>)
  and inside the trip sheet (Salary slip button). entries: the driver's transport_entries,
  salaries: the driver's transport_salaries. forwardRef-free: pass paperId to find it for the PDF.
*/
export const COMPANY = {
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

export default function SalarySlipPaper({ driver, salaries, entries, month, paperId }) {
  const salLabels = useSalaryLabels();
  const id = driver.id;
  const sal = salaries.find((s) => monthKey(s.month) === month) || null;
  if (!sal) return null;
  const trips = entries.filter((e) => monthKey(e.entry_date) === month && n(e.rent) > 0).length;
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
  const slipNo = month ? `SAL-${month.replace('-', '')}-${String(driver.sort || 1).padStart(2, '0')}` : '';

  return (
    <article className="slip-paper" id={paperId}>
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

      {(() => {
        const story = allowanceStory(entries, salaries, id, month);
        // driver allowance paid with this salary, month by month, with the calculation (e.g. 10.000 + 15.000 = 25.000)
        const linked = entries.filter((e) => sal && e.allowance_salary_id === sal.id && n(e.driver_allowance))
          .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
        const byMonth = {};
        linked.forEach((e) => { const k = monthKey(e.entry_date); (byMonth[k] = byMonth[k] || []).push(n(e.driver_allowance)); });
        const groups = Object.keys(byMonth).sort().map((k) => ({ k, parts: byMonth[k], amt: byMonth[k].reduce((t, v) => t + v, 0) }));
        const totalPaid = groups.reduce((t, g) => t + g.amt, 0);
        const rest = { ...story, carriedHere: [] };
        const hasRest = rest.paidLater.length || rest.unpaidNow.n || rest.prevUnpaid.length || rest.waiting.n;
        if (!groups.length && !hasRest) return null;
        return (
          <div className="slip-allow">
            <b>Driver allowance paid with this salary</b>
            {groups.length > 0 && (
              <table className="slip-calc">
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.k}>
                      <td>{monthLabel(g.k)} trips{g.k < month ? ' (previous balance)' : ''}</td>
                      <td className="calc">{g.parts.length > 1 ? g.parts.map((v) => m3(v)).join(' + ') : ''}</td>
                      <td className="num">{m3(g.amt)}</td>
                    </tr>
                  ))}
                </tbody>
                {groups.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total driver allowance paid</td>
                      <td className="calc">{groups.map((g) => m3(g.amt)).join(' + ')}</td>
                      <td className="num">{m3(totalPaid)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {hasRest ? <AllowanceNotes story={rest} month={month} /> : null}
          </div>
        );
      })()}

      <div className="slip-net">
        <div>
          <span>Net pay</span>
          <small>{omrInWords(net)}</small>
        </div>
        <strong><Omr v={net} /></strong>
      </div>

      <p className="slip-foot">This is a computer generated salary slip from Tudo Num Office Systems.</p>
    </article>
  );
}
