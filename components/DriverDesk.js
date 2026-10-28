'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { monthKey, monthStart, monthLabel, fmtAmt, todayISO } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable } from '@/lib/transport';
import { fmtD } from '@/lib/reminders';

/*
  Driver desk on the Drivers page: choose a driver by name and see
  1. Salary receipts (every month): open the slip, edit it, or create a new month's salary here.
     A new month copies the fixed amounts of the latest month and takes the trip allowance from that month's trips.
  2. Trip sheet: trips of the chosen month with totals, and a link to the full trip sheet.
  Saving a salary also goes to Modern City Office Expense by the database trigger (same as the Transport page).
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const EXTRA = [['advance_deduction', 'Advance deduction'], ['special_allowance', 'Special allowance']];

export default function DriverDesk({ drivers, canEdit, flash }) {
  const list = useMemo(() => [...(drivers || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [drivers]);
  const [driverId, setDriverId] = useState('');
  const [view, setView] = useState('salary');
  const [salaries, setSalaries] = useState(null);
  const [trips, setTrips] = useState([]);
  const [tripMonth, setTripMonth] = useState('');
  const [form, setForm] = useState(null); // { id?, month, values }

  useEffect(() => {
    if (!driverId && list.length) setDriverId((list.find((d) => d.status !== 'Inactive') || list[0]).id);
  }, [list, driverId]);

  const load = useCallback(async () => {
    if (!driverId) return;
    const s = sb();
    const [sal, e] = await Promise.all([
      s.from('transport_salaries').select('*').eq('driver_id', driverId).order('month', { ascending: false }),
      s.from('transport_entries').select('id, entry_date, from_place, to_place, description, cargo, rent, received, driver_allowance, allowance_status, diesel, toll').eq('driver_id', driverId).order('entry_date', { ascending: false })
    ]);
    setSalaries(sal.data || []);
    setTrips(e.data || []);
  }, [driverId]);
  useEffect(() => { setSalaries(null); setTripMonth(''); load(); }, [load]);

  const driver = list.find((d) => d.id === driverId);
  const tripMonths = useMemo(() => [...new Set(trips.map((t) => monthKey(t.entry_date)))].filter(Boolean).sort().reverse(), [trips]);
  const tm = tripMonth || tripMonths[0] || monthKey(todayISO());
  const monthTrips = trips.filter((t) => tm === 'all' || monthKey(t.entry_date) === tm);
  const tot = (k) => r3(monthTrips.reduce((s, t) => s + n(t[k]), 0));
  const allowanceFor = (key) => r3(trips.filter((t) => monthKey(t.entry_date) === key).reduce((s, t) => s + n(t.driver_allowance), 0));

  /* ---------- Salary form ---------- */
  function openNew() {
    const have = new Set((salaries || []).map((s) => monthKey(s.month)));
    let key = monthKey(todayISO());
    // first month (from this month going back) that has no salary yet
    for (let i = 0; i < 12 && have.has(key); i++) {
      const [y, m] = key.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 2, 1));
      key = d.toISOString().slice(0, 7);
    }
    const prev = (salaries || [])[0];
    const values = {};
    SALARY_FIELDS.forEach(([k]) => { values[k] = k === 'trip_allowance' ? allowanceFor(key) : n(prev?.[k]); });
    EXTRA.forEach(([k]) => { values[k] = 0; });
    setForm({ month: key, values });
  }
  function openEdit(s) {
    const values = {};
    [...SALARY_FIELDS, ...EXTRA].forEach(([k]) => { values[k] = n(s[k]); });
    setForm({ id: s.id, month: monthKey(s.month), values });
  }
  function setMonth(key) {
    setForm((f) => ({ ...f, month: key, values: { ...f.values, trip_allowance: allowanceFor(key) } }));
  }
  function setVal(k, v) {
    setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));
  }
  const clash = form && !form.id && (salaries || []).find((s) => monthKey(s.month) === form.month);

  async function saveForm() {
    if (!form?.month) { flash('Choose the month', 'err'); return; }
    const row = {};
    for (const [k] of [...SALARY_FIELDS, ...EXTRA]) {
      const v = Number(form.values[k] || 0);
      if (Number.isNaN(v) || v < 0) { flash('Amounts must be numbers, e.g. 200', 'err'); return; }
      row[k] = r3(v);
    }
    let res;
    if (form.id) res = await sb().from('transport_salaries').update({ ...row, month: monthStart(form.month) }).eq('id', form.id).select().single();
    else res = await sb().from('transport_salaries').insert({ ...row, driver_id: driverId, month: monthStart(form.month) }).select().single();
    if (res.error) { flash(/duplicate|unique/i.test(res.error.message) ? `${monthLabel(form.month)} salary already exists. Edit that one.` : res.error.message, 'err'); return; }
    setForm(null);
    flash(form.id ? 'Salary updated' : `Salary receipt created for ${monthLabel(form.month)}`);
    load();
  }

  if (!list.length) return null;
  const fv = form?.values || {};
  const fTotal = salaryTotal(fv);
  const fPay = salaryPayable(fv);

  return (
    <section className="panel dd">
      <div className="section-head dd-head">
        <h2>🧾 Salary receipts and trip sheet</h2>
        <label className="dd-pick">
          <span>Driver</span>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Choose driver">
            {list.map((d) => <option key={d.id} value={d.id}>{d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}</option>)}
          </select>
        </label>
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
            {canEdit && <button type="button" className="btn in" onClick={openNew}>＋ Create salary receipt</button>}
          </div>
          {salaries.length > 0 && (
            <div className="table-wrap">
              <table className="dc-table dd-table">
                <thead>
                  <tr><th>Month</th><th className="a-right">Total salary</th><th className="a-right">Advance deduction</th><th className="a-right">Special allowance</th><th className="a-right">Payable</th><th>Receipt</th></tr>
                </thead>
                <tbody>
                  {salaries.map((s) => (
                    <tr key={s.id}>
                      <td><b>{monthLabel(monthKey(s.month))}</b></td>
                      <td className="a-right">{fmtAmt(salaryTotal(s))}</td>
                      <td className="a-right">{n(s.advance_deduction) ? fmtAmt(s.advance_deduction) : '–'}</td>
                      <td className="a-right">{n(s.special_allowance) ? fmtAmt(s.special_allowance) : '–'}</td>
                      <td className="a-right"><b><Omr v={salaryPayable(s)} /></b></td>
                      <td>
                        <span className="row-links">
                          <Link href={`/transport/salary/${driverId}?m=${monthKey(s.month)}`}>🧾 Open slip</Link>
                          {canEdit && <button type="button" className="al-link" onClick={() => openEdit(s)}>✏️ Edit</button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Total ({salaries.length} months)</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + salaryTotal(s), 0))}</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s.advance_deduction), 0))}</td><td className="a-right">{fmtAmt(salaries.reduce((t, s) => t + n(s.special_allowance), 0))}</td><td className="a-right"><b>{fmtAmt(salaries.reduce((t, s) => t + salaryPayable(s), 0))}</b></td><td /></tr>
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
                  <tr><th>Date</th><th>Route</th><th>Description</th><th className="a-right">Rent</th><th className="a-right">Received</th><th className="a-right">Balance</th><th className="a-right">Allowance</th><th>Allowance status</th></tr>
                </thead>
                <tbody>
                  {monthTrips.map((t) => (
                    <tr key={t.id}>
                      <td>{fmtD(t.entry_date)}</td>
                      <td>{[t.from_place, t.to_place].filter(Boolean).join(' → ') || '–'}</td>
                      <td>{t.description || t.cargo || ''}</td>
                      <td className="a-right">{n(t.rent) ? fmtAmt(t.rent) : '–'}</td>
                      <td className="a-right">{n(t.received) ? fmtAmt(t.received) : '–'}</td>
                      <td className="a-right">{n(t.rent) - n(t.received) ? fmtAmt(n(t.rent) - n(t.received)) : '–'}</td>
                      <td className="a-right">{n(t.driver_allowance) ? fmtAmt(t.driver_allowance) : '–'}</td>
                      <td>{n(t.driver_allowance) ? <span className={`tag ${t.allowance_status === 'Paid' ? 'ok' : 'warn'}`}>{t.allowance_status || 'Not paid'}</span> : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {form && (
        <Modal title={form.id ? `Edit salary: ${driver?.name}` : `New salary receipt: ${driver?.name}`} onClose={() => setForm(null)}>
          <div className="dd-form">
            <label className="dd-month">
              <span>Month</span>
              <input type="month" value={form.month} onChange={(e) => setMonth(e.target.value)} disabled={Boolean(form.id)} />
            </label>
            {clash && <p className="error" style={{ margin: 0 }}>{monthLabel(form.month)} already has a salary. <button type="button" className="al-link" onClick={() => openEdit(clash)}>Edit that one</button></p>}
            <div className="dd-grid">
              {[...SALARY_FIELDS, ...EXTRA].map(([k, label]) => (
                <label key={k}>
                  <span>{label}{k === 'trip_allowance' ? <small> (from trips: {fmtAmt(allowanceFor(form.month))})</small> : ''}</span>
                  <input type="number" inputMode="decimal" step="0.001" min="0" value={fv[k]} onChange={(e) => setVal(k, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="dd-sum">
              <span>Total salary <b>{fmtAmt(fTotal)}</b></span>
              <span>Payable <b><Omr v={fPay} /></b></span>
            </div>
            <p className="note" style={{ margin: 0 }}>{form.id ? '' : 'Fixed amounts are copied from the latest month. '}Payable = total minus advance deduction plus special allowance. It also goes to Modern City Office Expense.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={saveForm} disabled={Boolean(clash)}>{form.id ? 'Save changes' : 'Create receipt'}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
