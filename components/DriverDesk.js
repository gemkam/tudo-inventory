'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { monthKey, monthStart, monthLabel, fmtAmt, todayISO } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowancePlan, allowanceStory, monthShort } from '@/lib/transport';
import AllowanceNotes from '@/components/AllowanceNotes';
import { fmtD } from '@/lib/reminders';
import { useSalaryLabels } from '@/lib/labels';

/*
  Driver desk on the Drivers page: choose a driver by name and see
  1. Salary receipts: open the slip, edit, or create a month's receipt here.
     Trip allowance rule (lib/transport.js allowancePlan):
     - only allowance marked "Paid" goes on a receipt, each trip on ONE receipt (allowance_salary_id)
     - earlier months still not Paid must be marked Paid first (button here), then the receipt can be made
     - earlier months paid now show as their own line, e.g. "Sep 2026 trip allowance 25.000 paid in Oct 2026"
  2. Trip sheet: trips of the chosen month with totals, and a link to the full trip sheet.
  Saving a salary also goes to Modern City Office Expense by the database trigger.
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const EXTRA = [['advance_deduction', 'Advance deduction'], ['special_allowance', 'Special allowance']];
const AUTO = ['trip_allowance', 'allowance_carried']; // worked out from the trips, not typed
const route = (t) => [t.from_place, t.to_place].filter(Boolean).join(' → ') || t.description || 'Trip';

export default function DriverDesk({ drivers, canEdit, flash, fixedDriverId = '', full = false, onChange }) {
  const list = useMemo(() => [...(drivers || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [drivers]);
  const [driverId, setDriverId] = useState(fixedDriverId);
  useEffect(() => { if (fixedDriverId) setDriverId(fixedDriverId); }, [fixedDriverId]);
  const [view, setView] = useState('salary');
  const [salaries, setSalaries] = useState(null);
  const [trips, setTrips] = useState([]);
  const [tripMonth, setTripMonth] = useState('');
  const [form, setForm] = useState(null); // { id?, month, values }
  const [busy, setBusy] = useState(false);
  const salLabels = useSalaryLabels();

  useEffect(() => {
    if (!driverId && list.length) setDriverId((list.find((d) => d.status !== 'Inactive') || list[0]).id);
  }, [list, driverId]);

  const load = useCallback(async () => {
    if (!driverId) return;
    const s = sb();
    const [sal, e] = await Promise.all([
      s.from('transport_salaries').select('*').eq('driver_id', driverId).order('month', { ascending: false }),
      s.from('transport_entries').select('id, driver_id, entry_date, from_place, to_place, description, cargo, rent, received, driver_allowance, allowance_status, allowance_salary_id').eq('driver_id', driverId).order('entry_date', { ascending: false })
    ]);
    setSalaries(sal.data || []);
    setTrips(e.data || []);
    onChange?.(sal.data || []);
  }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSalaries(null); setTripMonth(''); load(); }, [load]);

  const driver = list.find((d) => d.id === driverId);
  const salMonth = Object.fromEntries((salaries || []).map((s) => [s.id, monthKey(s.month)]));
  const tripMonths = useMemo(() => [...new Set(trips.map((t) => monthKey(t.entry_date)))].filter(Boolean).sort().reverse(), [trips]);
  const tm = tripMonth || tripMonths[0] || monthKey(todayISO());
  const monthTrips = trips.filter((t) => tm === 'all' || monthKey(t.entry_date) === tm);
  const tot = (k) => r3(monthTrips.reduce((s, t) => s + n(t[k]), 0));

  const plan = useMemo(() => (form ? allowancePlan(trips, driverId, form.month, form.id || null) : null), [form, trips, driverId]);

  /* ---------- Mark trip allowance paid ---------- */
  async function markPaid(ids) {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await sb().from('transport_entries').update({ allowance_status: 'Paid' }).in('id', ids);
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    setTrips((l) => l.map((t) => (ids.includes(t.id) ? { ...t, allowance_status: 'Paid' } : t)));
    flash(ids.length === 1 ? 'Marked Paid' : `${ids.length} trips marked Paid`);
    load(); // the database puts paid allowance on this month's salary (if it exists) and fixes its amounts
  }

  /* Pay every open driver allowance up to this receipt's month WITH this receipt (e.g. September paid in October).
     The trips become Paid and the receipt amounts are worked out again by the database. */
  async function payWith(sal, ids) {
    if (!ids.length) return;
    setBusy(true);
    const { error } = await sb().from('transport_entries').update({ allowance_status: 'Paid', allowance_salary_id: sal.id }).in('id', ids);
    setBusy(false);
    if (error) { flash(error.message, 'err'); return; }
    flash(`Driver allowance paid with ${monthLabel(monthKey(sal.month))} salary`);
    load();
  }

  /* ---------- Salary form ---------- */
  function openNew() {
    const have = new Set((salaries || []).map((s) => monthKey(s.month)));
    let key = monthKey(todayISO());
    for (let i = 0; i < 12 && have.has(key); i++) {
      const [y, m] = key.split('-').map(Number);
      key = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
    }
    const prev = (salaries || [])[0];
    const values = {};
    SALARY_FIELDS.forEach(([k]) => { values[k] = AUTO.includes(k) ? 0 : n(prev?.[k]); });
    EXTRA.forEach(([k]) => { values[k] = 0; });
    setForm({ month: key, values });
  }
  function openEdit(s) {
    const values = {};
    [...SALARY_FIELDS, ...EXTRA].forEach(([k]) => { values[k] = n(s[k]); });
    setForm({ id: s.id, month: monthKey(s.month), values });
  }
  const setVal = (k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));
  const clash = form && !form.id && (salaries || []).find((s) => monthKey(s.month) === form.month);
  const blocked = false; // earlier unpaid allowance no longer blocks: it shows as "previous not paid" until paid

  async function saveForm() {
    if (!form?.month || !plan) return;
    const row = {};
    for (const [k] of [...SALARY_FIELDS, ...EXTRA]) {
      if (AUTO.includes(k)) continue;
      const v = Number(form.values[k] || 0);
      if (Number.isNaN(v) || v < 0) { flash('Amounts must be numbers, e.g. 200', 'err'); return; }
      row[k] = r3(v);
    }
    row.trip_allowance = plan.current;
    row.allowance_carried = plan.carried;
    row.allowance_carried_note = plan.note || null;
    setBusy(true);
    const res = form.id
      ? await sb().from('transport_salaries').update(row).eq('id', form.id).select().single()
      : await sb().from('transport_salaries').insert({ ...row, driver_id: driverId, month: monthStart(form.month) }).select().single();
    if (res.error) {
      setBusy(false);
      flash(/duplicate|unique/i.test(res.error.message) ? `${monthLabel(form.month)} salary already exists. Edit that one.` : res.error.message, 'err');
      return;
    }
    const sid = res.data.id;
    // link the paid trips to this receipt; unlink trips that no longer belong to it
    const s = sb();
    if (form.id) {
      const drop = trips.filter((t) => t.allowance_salary_id === sid && !plan.linkIds.includes(t.id)).map((t) => t.id);
      if (drop.length) await s.from('transport_entries').update({ allowance_salary_id: null }).in('id', drop);
    }
    if (plan.linkIds.length) await s.from('transport_entries').update({ allowance_salary_id: sid }).in('id', plan.linkIds);
    setBusy(false);
    setForm(null);
    flash(form.id ? 'Salary updated' : `Salary receipt created for ${monthLabel(form.month)}`);
    load();
  }

  if (!list.length) return null;
  const fv = form && plan ? { ...form.values, trip_allowance: plan.current, allowance_carried: plan.carried } : {};
  const fTotal = salaryTotal(fv);
  const fPay = salaryPayable(fv);

  return (
    <section className="panel dd">
      <div className="section-head dd-head">
        <h2>{fixedDriverId ? '💰 Salary detail' : '🧾 Salary receipts and trip sheet'}</h2>
        {!fixedDriverId && <label className="dd-pick">
          <span>Driver</span>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Choose driver">
            {list.map((d) => <option key={d.id} value={d.id}>{d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}</option>)}
          </select>
        </label>}
      </div>

      <div className="co-switch dd-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'salary'} className={view === 'salary' ? 'on' : ''} onClick={() => setView('salary')}>🧾 Salary receipts {salaries ? `(${salaries.length})` : ''}</button>
        <button type="button" role="tab" aria-selected={view === 'trips'} className={view === 'trips' ? 'on' : ''} onClick={() => setView('trips')}>🚚 Trip sheet ({trips.length})</button>
      </div>

      {salaries === null && <p className="muted">Loading...</p>}

      {salaries && view === 'salary' && (
        <>
          <div className="dd-bar">
            <p className="muted">{driver?.name}: {salaries.length ? `${salaries.length} salary receipts` : 'no salary yet'}{driver?.resident_card ? ` · Resident Card ${driver.resident_card}` : ''}</p>
            <span className="dd-actions">
              {!fixedDriverId && <Link href={`/transport/salary-sheet/${driverId}`} className="btn ghost">📑 {driver?.name || 'Driver'} salary sheet</Link>}
              {canEdit && <button type="button" className="btn in" onClick={openNew}>＋ Create salary receipt</button>}
            </span>
          </div>
          {salaries.length > 0 && (
            <div className="table-wrap">
              <table className="dc-table dd-table">
                <thead>
                  <tr><th>Month</th>{full && SALARY_FIELDS.filter(([k]) => !AUTO.includes(k)).map(([k]) => <th key={k} className="a-right">{salLabels.label(k)}</th>)}<th className="a-right">{salLabels.label('trip_allowance')}</th><th className="a-right">Total salary</th><th className="a-right">Deduction</th><th className="a-right">Special</th><th className="a-right">Payable</th><th>Receipt</th></tr>
                </thead>
                <tbody>
                  {salaries.map((s) => (
                    <tr key={s.id}>
                      <td><b>{monthLabel(monthKey(s.month))}</b></td>
                      {full && SALARY_FIELDS.filter(([k]) => !AUTO.includes(k)).map(([k]) => <td key={k} className="a-right">{n(s[k]) ? fmtAmt(s[k]) : '–'}</td>)}
                      <td className="a-right">
                        {fmtAmt(n(s.trip_allowance) + n(s.allowance_carried))}
                        <AllowanceNotes story={allowanceStory(trips, salaries, driverId, monthKey(s.month))} month={monthKey(s.month)} compact />
                      </td>
                      <td className="a-right">{fmtAmt(salaryTotal(s))}</td>
                      <td className="a-right">{n(s.advance_deduction) ? fmtAmt(s.advance_deduction) : '–'}</td>
                      <td className="a-right">{n(s.special_allowance) ? fmtAmt(s.special_allowance) : '–'}</td>
                      <td className="a-right"><b><Omr v={salaryPayable(s)} /></b></td>
                      <td>
                        <span className="row-links">
                          <Link href={`/transport/salary/${driverId}?m=${monthKey(s.month)}`}>🧾 Open slip</Link>
                          {canEdit && <button type="button" className="al-link" onClick={() => openEdit(s)}>✏️ Edit</button>}
                          {canEdit && (() => {
                            const st = allowanceStory(trips, salaries, driverId, monthKey(s.month));
                            const sumOf = (ids) => trips.filter((t) => ids.includes(t.id)).reduce((a, t) => a + n(t.driver_allowance), 0);
                            const m = monthShort(monthKey(s.month));
                            return (
                              <>
                                {st.prevOpenIds.length > 0 && (
                                  <button type="button" className="al-link dd-pay" disabled={busy} title="Earlier months' driver allowance becomes Paid, paid with this salary"
                                    onClick={() => payWith(s, st.prevOpenIds)}>💳 Pay previous {fmtAmt(sumOf(st.prevOpenIds))} in {m}</button>
                                )}
                                {st.nowOpenIds.length > 0 && (
                                  <button type="button" className="al-link dd-pay" disabled={busy} title="This month's driver allowance becomes Paid, paid with this salary"
                                    onClick={() => payWith(s, st.nowOpenIds)}>💳 Pay {m} allowance {fmtAmt(sumOf(st.nowOpenIds))}</button>
                                )}
                              </>
                            );
                          })()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Total ({salaries.length} months)</td>{full && SALARY_FIELDS.filter(([k]) => !AUTO.includes(k)).map(([k]) => <td key={k} className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s[k]), 0))}</td>)}<td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s.trip_allowance) + n(s.allowance_carried), 0))}</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + salaryTotal(s), 0))}</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s.advance_deduction), 0))}</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s.special_allowance), 0))}</td><td className="a-right"><b>{fmtAmt(salaries.reduce((t, s) => t + salaryPayable(s), 0))}</b></td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {salaries && view === 'trips' && (
        <>
          <div className="dd-bar">
            <select value={tm} onChange={(e) => setTripMonth(e.target.value)} aria-label="Month">
              {tripMonths.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
              {!tripMonths.includes(tm) && tm !== 'all' && <option value={tm}>{monthLabel(tm)}</option>}
              <option value="all">All months</option>
            </select>
            <Link href={`/transport/${driverId}`} className="btn in">📄 Open full trip sheet{canEdit ? ' / add trip' : ''}</Link>
          </div>
          <div className="kpi-row">
            <div className="kpi"><span>Trips</span><strong>{monthTrips.filter((t) => n(t.rent) > 0).length}</strong><small>{monthLabel(tm)}</small></div>
            <div className="kpi"><span>Work amount</span><strong><Omr v={tot('rent')} /></strong><small>rent</small></div>
            <div className="kpi"><span>Received</span><strong><Omr v={tot('received')} /></strong><small>balance {fmtAmt(tot('rent') - tot('received'))}</small></div>
            <div className="kpi"><span>Driver allowance</span><strong><Omr v={tot('driver_allowance')} /></strong><small>{monthTrips.filter((t) => n(t.driver_allowance) > 0 && t.allowance_status !== 'Paid').length} not paid</small></div>
          </div>
          {monthTrips.length === 0 ? <p className="muted">No trips in {monthLabel(tm)}.</p> : (
            <div className="table-wrap">
              <table className="dc-table dd-table">
                <thead>
                  <tr><th>Date</th><th>Route</th><th className="a-right">Rent</th><th className="a-right">Received</th><th className="a-right">Balance</th><th className="a-right">Allowance</th><th>
                    <span className="dd-st">Allowance status
                      {canEdit && (() => {
                        const open = monthTrips.filter((t) => n(t.driver_allowance) && t.allowance_status !== 'Paid');
                        return open.length > 1 ? (
                          <button type="button" className="btn small in" disabled={busy} onClick={() => markPaid(open.map((t) => t.id))}>
                            ✓ Mark all paid ({fmtAmt(open.reduce((a, t) => a + n(t.driver_allowance), 0))})
                          </button>
                        ) : null;
                      })()}
                    </span>
                  </th></tr>
                </thead>
                <tbody>
                  {monthTrips.map((t) => (
                    <tr key={t.id}>
                      <td>{fmtD(t.entry_date)}</td>
                      <td>{route(t)}</td>
                      <td className="a-right">{n(t.rent) ? fmtAmt(t.rent) : '–'}</td>
                      <td className="a-right">{n(t.received) ? fmtAmt(t.received) : '–'}</td>
                      <td className="a-right">{n(t.rent) - n(t.received) ? fmtAmt(n(t.rent) - n(t.received)) : '–'}</td>
                      <td className="a-right">{n(t.driver_allowance) ? fmtAmt(t.driver_allowance) : '–'}</td>
                      <td>
                        {n(t.driver_allowance) ? (
                          <span className="dd-st">
                            <span className={`tag ${t.allowance_status === 'Paid' ? 'ok' : 'warn'}`}>{t.allowance_status === 'Paid' ? 'Paid' : 'Not paid'}</span>
                            {t.allowance_salary_id && salMonth[t.allowance_salary_id] && <small>on {monthShort(salMonth[t.allowance_salary_id])} receipt</small>}
                            {canEdit && t.allowance_status !== 'Paid' && <button type="button" className="al-link" disabled={busy} onClick={() => markPaid([t.id])}>Mark paid</button>}
                          </span>
                        ) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {form && plan && (
        <Modal title={form.id ? `Edit salary: ${driver?.name}` : `New salary receipt: ${driver?.name}`} onClose={() => setForm(null)}>
          <div className="dd-form">
            <label className="dd-month">
              <span>Month</span>
              <input type="month" value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))} disabled={Boolean(form.id)} />
            </label>
            {clash && <p className="error" style={{ margin: 0 }}>{monthLabel(form.month)} already has a salary. <button type="button" className="al-link" onClick={() => openEdit(clash)}>Edit that one</button></p>}

            {plan.unpaidEarlier.length > 0 && (
              <div className="dd-check warn dd-col">
                <b>⚠ Previous driver allowance not paid. Pay it with this salary, or leave it (it stays as &quot;previous not paid&quot;).</b>
                <ul>
                  {plan.unpaidEarlier.map((t) => (
                    <li key={t.id}>
                      <span>{fmtD(t.entry_date)} · {route(t)}</span>
                      <b>{fmtAmt(t.driver_allowance)}</b>
                      <button type="button" className="btn small" disabled={busy} onClick={() => markPaid([t.id])}>Pay with this salary</button>
                    </li>
                  ))}
                </ul>
                {plan.unpaidEarlier.length > 1 && <button type="button" className="btn small in" disabled={busy} onClick={() => markPaid(plan.unpaidEarlier.map((t) => t.id))}>Pay all {plan.unpaidEarlier.length} with this salary</button>}
              </div>
            )}
            {!blocked && plan.carried > 0 && <div className="dd-check ok">✓ {plan.note}</div>}
            {plan.unpaidCurrent.length > 0 && (
              <div className="dd-check warn">
                <span>{monthShort(form.month)} not paid yet: <b>{fmtAmt(plan.unpaidCurrent.reduce((s, t) => s + n(t.driver_allowance), 0))}</b> ({plan.unpaidCurrent.length} trips). Goes on the receipt of the month it is paid.</span>
                <button type="button" className="btn small" disabled={busy} onClick={() => markPaid(plan.unpaidCurrent.map((t) => t.id))}>Mark paid now</button>
              </div>
            )}

            <div className="dd-grid">
              {[...SALARY_FIELDS, ...EXTRA].map(([k]) => [k, salLabels.label(k)]).map(([k, label]) => (
                <label key={k} className={AUTO.includes(k) ? 'auto' : ''}>
                  <span>{k === 'trip_allowance' ? `${label} ${monthShort(form.month)} (paid)` : label}</span>
                  {AUTO.includes(k)
                    ? <output>{fmtAmt(fv[k])}</output>
                    : <input type="number" inputMode="decimal" step="0.001" min="0" value={fv[k]} onChange={(e) => setVal(k, e.target.value)} />}
                </label>
              ))}
            </div>
            <div className="dd-sum">
              <span>Total salary <b>{fmtAmt(fTotal)}</b></span>
              <span>Payable <b><Omr v={fPay} /></b></span>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={saveForm} disabled={Boolean(clash) || blocked || busy}>{form.id ? 'Save changes' : 'Create receipt'}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
