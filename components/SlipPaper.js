'use client';

import { companyInfo, m3, monthName } from '@/lib/salarySlips';
import { omrInWords } from '@/lib/words';

/* One monthly salary slip on screen (Personnel > Salary slips view, and the employee's own link /s/<token>). */
export default function SlipPaper({ s }) {
  if (!s) return null;
  const co = companyInfo(s.company);
  const ded = (s.deductions || []).filter((x) => Number(x.amount));
  return (
    <article className="ssp">
      <div className="ssp-top" aria-hidden="true" />
      <header className="ssp-head">
        {co?.logo && <span className="ssp-logo"><img src={co.logo} alt="" /></span>}
        <div>
          <b>{co?.name || s.company}</b>
          {co && <small>{co.cr} · {co.address}</small>}
        </div>
      </header>
      <h2 className="ssp-title">SALARY SLIP<small>{monthName(s.month)}</small></h2>
      {s.version > 1 && <p className="ssp-rev">Revised on {s.revised_at ? new Date(s.revised_at).toLocaleDateString('en-GB') : ''}{s.revise_reason ? `: ${s.revise_reason}` : ''}</p>}
      <dl className="ssp-who">
        <div><dt>Employee</dt><dd>{s.name}</dd></div>
        <div><dt>Designation</dt><dd>{s.designation || '–'}</dd></div>
        {s.pay_days != null && <div><dt>Pay days</dt><dd>{s.pay_days} of 30</dd></div>}
        {s.pay_days != null && <div><dt>Absent · Half · Leave</dt><dd>{Number(s.absent)} · {Number(s.half)} · {Number(s.leave)}</dd></div>}
      </dl>
      <div className="ssp-cols">
        <table>
          <thead><tr><th>Earnings</th><th>OMR</th></tr></thead>
          <tbody>
            {(s.earnings || []).map((e, i) => <tr key={i}><td>{e.label}</td><td>{m3(e.amount)}</td></tr>)}
            {s.transport_allow && <tr><td>Transport</td><td>Yes</td></tr>}
          </tbody>
          <tfoot><tr><td>Total earnings</td><td>{m3(s.gross)}</td></tr></tfoot>
        </table>
        <table>
          <thead><tr><th>Deductions</th><th>OMR</th></tr></thead>
          <tbody>
            {ded.map((d, i) => <tr key={i}><td>{d.label}</td><td>{m3(d.amount)}</td></tr>)}
            {!ded.length && <tr><td className="muted">No deductions</td><td>0.000</td></tr>}
          </tbody>
          <tfoot><tr><td>Total deductions</td><td>{m3(s.deduction_total)}</td></tr></tfoot>
        </table>
      </div>
      <div className="ssp-net"><span>NET PAY</span><b>OMR {m3(s.net)}</b></div>
      <p className="ssp-words">{omrInWords(s.net)}</p>
      {s.note && <p className="ssp-note">Note: {s.note}</p>}
    </article>
  );
}
