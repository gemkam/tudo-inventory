'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { monthKey, monthStart, monthLabel, fmtAmt, num, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowancePlan } from '@/lib/transport';
import { useSalaryLabels } from '@/lib/labels';
import { omrInWords } from '@/lib/words';

/*
  Driver salary sheet (/transport/salary-sheet?m=YYYY-MM): all drivers of one month on one sheet
  with Modern City letterhead, every salary column, totals, net in words, signature column and signature lines.
  Print (A4 landscape) and Excel. Full access can create the missing salaries of the month
  (same rule as the Drivers page: fixed amounts from the latest month, only Paid driver allowance, earlier months must be Paid).
*/

const n = (v) => Number(v || 0);
const COMPANY = {
  name: 'MODERN CITY FOR EXPRESS SERVICES L.L.C',
  line1: 'CR No. 1404742 · VAT Registration No. OM11008665',
  line2: 'P.O. Box 149, PC 133, Al Khuwair, Sultanate of Oman · www.tudonumgroup.com'
};

function SheetPage() {
  const { isAdmin, name } = useUser();
  const { label } = useSalaryLabels();
  const [drivers, setDrivers] = useState(null);
  const [salaries, setSalaries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const s = sb();
    const [d, sa, e] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_salaries').select('*'),
      s.from('transport_entries').select('id, driver_id, entry_date, driver_allowance, allowance_status, allowance_salary_id')
    ]);
    setDrivers(d.data || []);
    setSalaries(sa.data || []);
    setEntries(e.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const set = new Set([...salaries.map((x) => monthKey(x.month)), monthKey(todayISO())]);
    return [...set].filter(Boolean).sort().reverse();
  }, [salaries]);

  useEffect(() => {
    if (month || !drivers) return;
    const want = new URLSearchParams(window.location.search).get('m');
    const latest = salaries.map((x) => monthKey(x.month)).sort().pop();
    setMonth(want && /^\d{4}-\d{2}$/.test(want) ? want : latest || monthKey(todayISO()));
  }, [drivers, salaries, month]);

  function pickMonth(k) {
    setMonth(k);
    setMsg(null);
    try { window.history.replaceState(null, '', `/transport/salary-sheet?m=${k}`); } catch { /* ignore */ }
  }

  const salOf = (id) => salaries.find((x) => x.driver_id === id && monthKey(x.month) === month);
  const rows = useMemo(() => (drivers || [])
    .filter((d) => salOf(d.id) || d.status !== 'Inactive')
    .map((d) => ({ d, s: salOf(d.id) })), [drivers, salaries, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const withSal = rows.filter((r) => r.s);
  const missing = rows.filter((r) => !r.s && r.d.status !== 'Inactive');
  const showCarried = withSal.some((r) => n(r.s.allowance_carried));
  const fields = SALARY_FIELDS.filter(([k]) => k !== 'allowance_carried' || showCarried);
  const sum = (fn) => num(withSal.reduce((t, r) => t + fn(r.s), 0));
  const netTotal = sum(salaryPayable);

  async function createMissing() {
    setBusy(true);
    const made = [];
    const skipped = [];
    for (const { d } of missing) {
      const plan = allowancePlan(entries, d.id, month);
      if (plan.unpaidEarlier.length) { skipped.push(`${d.name} (earlier driver allowance not marked Paid)`); continue; }
      const prev = salaries.filter((x) => x.driver_id === d.id && monthKey(x.month) < month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
      const row = { driver_id: d.id, month: monthStart(month), advance_deduction: 0, special_allowance: 0 };
      ['basic', 'room_rent', 'utilities', 'mobile', 'travel_food'].forEach((k) => { row[k] = num(prev?.[k] || 0); });
      row.trip_allowance = plan.current;
      row.allowance_carried = plan.carried;
      row.allowance_carried_note = plan.note || null;
      const { data, error } = await sb().from('transport_salaries').insert(row).select().single();
      if (error) { skipped.push(`${d.name} (${error.message})`); continue; }
      if (plan.linkIds.length) await sb().from('transport_entries').update({ allowance_salary_id: data.id }).in('id', plan.linkIds);
      made.push(d.name);
    }
    setBusy(false);
    setMsg({
      kind: skipped.length ? 'warn' : 'ok',
      text: [made.length ? `Created for ${made.join(', ')}.` : '', skipped.length ? `Not created: ${skipped.join('; ')}. Use Drivers page > Salary receipts to mark Paid.` : ''].filter(Boolean).join(' ')
    });
    load();
  }

  async function doExcel() {
    const head = ['S.No', 'Driver', 'Resident Card', 'Vehicle', ...fields.map(([k]) => label(k)), 'Total', label('advance_deduction'), label('special_allowance'), 'Net payable', 'Signature'];
    const body = withSal.map(({ d, s }, i) => [i + 1, d.name, d.resident_card || '', d.vehicle_no || '', ...fields.map(([k]) => num(s[k])), salaryTotal(s), num(s.advance_deduction), num(s.special_allowance), salaryPayable(s), '']);
    body.push(['', 'TOTAL', '', '', ...fields.map(([k]) => sum((s) => n(s[k]))), sum(salaryTotal), sum((s) => n(s.advance_deduction)), sum((s) => n(s.special_allowance)), netTotal, '']);
    const numCols = head.map((_, i) => i).filter((i) => i >= 4 && i < head.length - 1);
    await exportExcel(`Driver salary sheet ${month} ${exportStamp()}.xlsx`, [{
      name: 'Salary sheet', title: `Driver Salary Sheet · ${monthLabel(month)}`, subtitle: 'Modern City for Express Services LLC · Transport Division',
      head, rows: body, numCols, widths: head.map((h, i) => (i === 1 ? 20 : i === 0 ? 6 : i === head.length - 1 ? 16 : 13))
    }]);
  }

  if (!drivers || !month) return <div className="loading">Loading salary sheet...</div>;

  return (
    <>
      <div className="page-tools no-print">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <select className="ss-month" value={month} onChange={(e) => pickMonth(e.target.value)} aria-label="Month">
            {months.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
          </select>
          {isAdmin && missing.length > 0 && (
            <button type="button" className="btn in" onClick={createMissing} disabled={busy}>{busy ? 'Creating...' : `＋ Create salary for ${missing.length} driver${missing.length > 1 ? 's' : ''}`}</button>
          )}
          <button type="button" className="btn ghost" onClick={() => window.print()} disabled={!withSal.length}>🖨 Print</button>
          <button type="button" className="btn ghost" onClick={doExcel} disabled={!withSal.length}>Export Excel</button>
        </div>
      </div>

      <div className="ds-pick no-print">
        <b>Each driver&apos;s own salary sheet:</b>
        {[...drivers].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((d) => (
          <Link key={d.id} href={`/transport/salary-sheet/${d.id}`} className="rp-chip">📑 {d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}</Link>
        ))}
      </div>

      {msg && <div className={`ss-msg ${msg.kind} no-print`} role="status">{msg.text}</div>}
      {missing.length > 0 && !isAdmin && <p className="muted no-print">No salary yet for {missing.map((r) => r.d.name).join(', ')}.</p>}

      <article className="ss-paper">
        <header className="ss-head">
          <img src="/modern-city-logo.png" alt="Modern City" />
          <div>
            <b>{COMPANY.name}</b>
            <span>{COMPANY.line1}</span>
            <span>{COMPANY.line2}</span>
          </div>
        </header>
        <h1 className="ss-title">All Drivers Salary Sheet <span>{monthLabel(month)}</span></h1>
        <p className="ss-sub">Transport Division · {withSal.length} driver{withSal.length === 1 ? '' : 's'}{missing.length ? ` · not yet made: ${missing.map((r) => r.d.name).join(', ')}` : ''}</p>

        {withSal.length === 0 ? (
          <p className="ss-empty">No salaries for {monthLabel(month)} yet.{isAdmin && missing.length ? ' Press "Create salary" above.' : ''}</p>
        ) : (
          <div className="table-wrap">
            <table className="ss-table">
              <thead>
                <tr>
                  <th>S.No</th><th className="l">Driver</th><th className="l">Resident Card</th><th className="l">Vehicle</th>
                  {fields.map(([k]) => <th key={k}>{label(k)}</th>)}
                  <th className="hi">Total</th><th>{label('advance_deduction')}</th><th>{label('special_allowance')}</th><th className="hi">Net payable</th><th className="sig">Signature</th>
                </tr>
              </thead>
              <tbody>
                {withSal.map(({ d, s }, i) => (
                  <tr key={d.id}>
                    <td className="c">{i + 1}</td>
                    <td className="l"><Link href={`/transport/salary-sheet/${d.id}`} className="ss-name"><b>{d.name}</b></Link></td>
                    <td className="l">{d.resident_card || '–'}</td>
                    <td className="l">{d.vehicle_no || '–'}</td>
                    {fields.map(([k]) => (
                      <td key={k}>
                        {n(s[k]) ? fmtAmt(s[k]) : '–'}
                        {k === 'allowance_carried' && s.allowance_carried_note && <small className="ss-note">{s.allowance_carried_note}</small>}
                      </td>
                    ))}
                    <td className="hi">{fmtAmt(salaryTotal(s))}</td>
                    <td>{n(s.advance_deduction) ? `−${fmtAmt(s.advance_deduction)}` : '–'}</td>
                    <td>{n(s.special_allowance) ? fmtAmt(s.special_allowance) : '–'}</td>
                    <td className="hi"><b>{fmtAmt(salaryPayable(s))}</b></td>
                    <td className="sig" />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="l">TOTAL (OMR)</td>
                  {fields.map(([k]) => <td key={k}>{fmtAmt(sum((s) => n(s[k])))}</td>)}
                  <td className="hi">{fmtAmt(sum(salaryTotal))}</td>
                  <td>{sum((s) => n(s.advance_deduction)) ? `−${fmtAmt(sum((s) => n(s.advance_deduction)))}` : '–'}</td>
                  <td>{fmtAmt(sum((s) => n(s.special_allowance)))}</td>
                  <td className="hi"><b>{fmtAmt(netTotal)}</b></td>
                  <td className="sig" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {withSal.length > 0 && <p className="ss-words"><b>Net payable in words:</b> {omrInWords(netTotal)}</p>}

        <footer className="ss-sign">
          <div><span>Prepared by</span><i />{name ? <small>{name}</small> : null}</div>
          <div><span>Checked by</span><i /></div>
          <div><span>Approved by</span><i /></div>
        </footer>
        <p className="ss-stamp">Printed {new Date().toLocaleDateString('en-GB')} · Tudo Num Office Systems</p>
      </article>

      <p className="note no-print">Net payable = Total − {label('advance_deduction')} + {label('special_allowance')}. To change a driver&apos;s amounts use the <Link href="/transport/drivers">Drivers page</Link> (Salary receipts) or the Salary detail on <Link href="/transport">Transport</Link>.</p>
    </>
  );
}

export default function Page() {
  return <AuthGate wide><SheetPage /></AuthGate>;
}
