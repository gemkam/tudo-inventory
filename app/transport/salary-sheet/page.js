'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { monthKey, monthStart, monthLabel, fmtAmt, num, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowancePlan, allowanceStory } from '@/lib/transport';
import AllowanceNotes from '@/components/AllowanceNotes';
import { PayCard, PaySection, PayRow, AmountInput, BalanceBox, PaySummary, money } from '@/components/PayCard';
import { hasPaidCols, driverBalance } from '@/lib/payBalance';
import { useSalaryLabels } from '@/lib/labels';
import { omrInWords } from '@/lib/words';
import { fmtD } from '@/lib/reminders';

/*
  Driver salary sheet (/transport/salary-sheet?m=YYYY-MM): all drivers of one month, Modern City letterhead.
  VERTICAL layout: one card per driver (rows top to bottom), net payable, paid, and the UNPAID BALANCE
  (this month not paid + earlier months not paid + driver allowance of trips not paid yet).
  Short totals table under the cards, net in words, signature lines. Print A4 portrait (2 cards across), Excel.
  Full access can create missing salaries and type the amount paid (needs supabase/salary-paid.sql).
*/

const n = (v) => Number(v || 0);
const COMPANY = {
  name: 'MODERN CITY FOR EXPRESS SERVICES L.L.C',
  line1: 'CR No. 1404742 · VAT Registration No. OM11008665',
  line2: 'P.O. Box 149, PC 133, Al Khuwair, Sultanate of Oman · www.tudonumgroup.com'
};
const short = (k) => monthLabel(k).replace(/^(\w{3})\w*/, '$1');

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

  const tracked = salaries.some(hasPaidCols);
  const salOf = (id) => salaries.find((x) => x.driver_id === id && monthKey(x.month) === month);
  const rows = useMemo(() => (drivers || [])
    .filter((d) => salOf(d.id) || d.status !== 'Inactive')
    .map((d) => ({ d, s: salOf(d.id), bal: driverBalance(salaries, entries, d.id, month) })), [drivers, salaries, entries, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const withSal = rows.filter((r) => r.s);
  const missing = rows.filter((r) => !r.s && r.d.status !== 'Inactive');
  const owedNoSal = missing.filter((r) => r.bal.total > 0.0005);
  const showCarried = withSal.some((r) => n(r.s.allowance_carried));
  const fields = SALARY_FIELDS.filter(([k]) => k !== 'allowance_carried' || showCarried);
  const sum = (fn) => num(withSal.reduce((t, r) => t + fn(r.s), 0));
  const netTotal = sum(salaryPayable);
  const balTotal = num(rows.reduce((t, r) => t + r.bal.total, 0));

  async function createMissing() {
    setBusy(true);
    const made = [];
    const skipped = [];
    for (const { d } of missing) {
      const plan = allowancePlan(entries, d.id, month);
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
      text: [made.length ? `Created for ${made.join(', ')}.` : '', skipped.length ? `Not created: ${skipped.join('; ')}.` : ''].filter(Boolean).join(' ')
    });
    load();
  }

  async function savePaid(s, v) {
    const patch = { paid_amount: v, paid_on: v ? (s.paid_on || todayISO()) : null };
    setSalaries((l) => l.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('transport_salaries').update(patch).eq('id', s.id);
    if (error) { setMsg({ kind: 'warn', text: error.message }); load(); return; }
    setMsg({ kind: 'ok', text: 'Payment saved.' });
  }

  async function doExcel() {
    const head = ['S.No', 'Driver', 'Resident Card', 'Vehicle', ...fields.map(([k]) => label(k)), 'Total', label('advance_deduction'), label('special_allowance'), 'Net payable',
      ...(tracked ? ['Paid', 'This month not paid', 'Earlier months not paid'] : []), 'Driver allowance not paid', 'Unpaid balance', 'Signature'];
    const body = withSal.map(({ d, s, bal }, i) => [i + 1, d.name, d.resident_card || '', d.vehicle_no || '', ...fields.map(([k]) => num(s[k])), salaryTotal(s), num(s.advance_deduction), num(s.special_allowance), salaryPayable(s),
      ...(tracked ? [num(s.paid_amount), bal.thisMonth, bal.earlierTotal] : []), bal.allowance.total, bal.total, '']);
    body.push(['', 'TOTAL', '', '', ...fields.map(([k]) => sum((s) => n(s[k]))), sum(salaryTotal), sum((s) => n(s.advance_deduction)), sum((s) => n(s.special_allowance)), netTotal,
      ...(tracked ? [sum((s) => n(s.paid_amount)), num(withSal.reduce((t, r) => t + r.bal.thisMonth, 0)), num(withSal.reduce((t, r) => t + r.bal.earlierTotal, 0))] : []),
      num(withSal.reduce((t, r) => t + r.bal.allowance.total, 0)), num(withSal.reduce((t, r) => t + r.bal.total, 0)), '']);
    const numCols = head.map((_, i) => i).filter((i) => i >= 4 && i < head.length - 1);
    await exportExcel(`Driver salary sheet ${month} ${exportStamp()}.xlsx`, [{
      name: 'Salary sheet', title: `Driver Salary Sheet · ${monthLabel(month)}`, subtitle: 'Modern City for Express Services LLC · Transport Division',
      head, rows: body, numCols, widths: head.map((h, i) => (i === 1 ? 20 : i === 0 ? 6 : i === head.length - 1 ? 16 : 13))
    }]);
  }

  if (!drivers || !month) return <div className="loading">Loading salary sheet...</div>;

  const balLines = (bal) => [
    [`${monthLabel(month)} salary not paid`, bal.thisMonth],
    [`Earlier months salary not paid (${bal.earlier.map((x) => short(x.month)).join(', ')})`, bal.earlierTotal],
    [`Driver allowance not paid (${bal.allowance.months.map((x) => `${short(x.month)}: ${x.trips} trip${x.trips > 1 ? 's' : ''}`).join(', ')})`, bal.allowance.total]
  ];

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
      {!tracked && withSal.length > 0 && <div className="ss-msg warn no-print">Salary payments are not recorded yet. Run <b>supabase/salary-paid.sql</b> once in Supabase so you can type what was paid. Until then only unpaid driver allowance is in the balance.</div>}
      {missing.length > 0 && !isAdmin && <p className="muted no-print">No salary yet for {missing.map((r) => r.d.name).join(', ')}.</p>}

      <article className="ss-paper pc-paper">
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

        <div className="pc-kpis">
          <div><span>Net payable {short(month)}</span><b>{money(netTotal)}</b></div>
          {tracked && <div><span>Paid</span><b>{money(sum((s) => n(s.paid_amount)))}</b></div>}
          <div className={balTotal > 0.0005 ? 'due' : 'ok'}><span>Total unpaid balance</span><b>{balTotal > 0.0005 ? money(balTotal) : 'Nil'}</b></div>
        </div>

        {withSal.length === 0 ? (
          <p className="ss-empty">No salaries for {monthLabel(month)} yet.{isAdmin && missing.length ? ' Press "Create salary" above.' : ''}</p>
        ) : (
          <div className="pc-grid">
            {withSal.map(({ d, s, bal }, i) => (
              <PayCard key={d.id} no={i + 1} title={d.name} href={`/transport/salary-sheet/${d.id}`}
                meta={[['Resident Card', d.resident_card], ['Vehicle', d.vehicle_no]]}>
                <PaySection title="Salary">
                  {fields.map(([k]) => (
                    <PayRow key={k} label={label(k)} value={n(s[k]) ? s[k] : null}
                      note={k === 'allowance_carried' ? s.allowance_carried_note : undefined} />
                  ))}
                  <div className="pc-notes"><AllowanceNotes story={allowanceStory(entries, salaries, d.id, month)} month={month} compact /></div>
                  <PayRow label="Total salary" value={salaryTotal(s)} kind="total" />
                </PaySection>
                <PaySection title="Deduction and additions">
                  <PayRow label={label('advance_deduction')} value={s.advance_deduction} kind="minus" />
                  <PayRow label={label('special_allowance')} value={s.special_allowance} kind="plus" />
                </PaySection>
                <PayRow label="Net payable" value={salaryPayable(s)} kind="net" />
                {hasPaidCols(s) && (
                  <PayRow label="Paid" kind="paid" note={s.paid_on ? `on ${fmtD(s.paid_on)}` : undefined}>
                    {isAdmin ? (
                      <span className="pc-pay no-print-in">
                        <AmountInput value={s.paid_amount} onSave={(v) => savePaid(s, v)} />
                        {n(s.paid_amount) < salaryPayable(s) && <button type="button" className="btn small in no-print" onClick={() => savePaid(s, salaryPayable(s))}>✓ Full</button>}
                      </span>
                    ) : (s.paid_amount == null ? '–' : money(s.paid_amount))}
                  </PayRow>
                )}
                <BalanceBox total={bal.total} tracked={bal.tracked} lines={balLines(bal)} />
                <div className="pc-sign"><span>Signature</span><i /></div>
              </PayCard>
            ))}
          </div>
        )}

        {owedNoSal.length > 0 && (
          <div className="pc-extra">
            <b>Also owed (no salary made for {monthLabel(month)} yet):</b>
            {owedNoSal.map(({ d, bal }) => <span key={d.id}>{d.name}: {money(bal.total)} OMR</span>)}
          </div>
        )}

        {withSal.length > 0 && (
          <>
            <h3 className="pc-h3">Totals</h3>
            <PaySummary tracked={tracked} rows={withSal.map(({ d, s, bal }) => ({ key: d.id, name: d.name, net: salaryPayable(s), paid: hasPaidCols(s) ? n(s.paid_amount) : null, balance: bal.total }))} />
            <p className="ss-words"><b>Net payable in words:</b> {omrInWords(netTotal)}</p>
          </>
        )}

        <footer className="ss-sign">
          <div><span>Prepared by</span><i />{name ? <small>{name}</small> : null}</div>
          <div><span>Checked by</span><i /></div>
          <div><span>Approved by</span><i /></div>
        </footer>
        <p className="ss-stamp">Printed {new Date().toLocaleDateString('en-GB')} · Tudo Num Office Systems</p>
      </article>

      <p className="note no-print">Net payable = Total − {label('advance_deduction')} + {label('special_allowance')}. Unpaid balance = this month not paid + earlier months not paid + driver allowance of trips not paid yet. To change a driver&apos;s amounts use the <Link href="/transport/drivers">Drivers page</Link> (Salary receipts) or the driver&apos;s own salary sheet.</p>
    </>
  );
}

export default function Page() {
  return <AuthGate wide><SheetPage /></AuthGate>;
}
