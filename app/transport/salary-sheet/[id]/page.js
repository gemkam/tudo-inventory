'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import DriverDesk from '@/components/DriverDesk';
import Omr from '@/components/Omr';
import DateInput from '@/components/DateInput';
import { useViewMode } from '@/lib/viewMode';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, monthKey, monthStart, monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable } from '@/lib/transport';
import { useSalaryLabels, SALARY_EXTRA_LABELS } from '@/lib/labels';
import { fmtD } from '@/lib/reminders';
import AllowanceNotes from '@/components/AllowanceNotes';
import { allowanceStory } from '@/lib/transport';
import { PayCard, PaySection, PayRow, AmountInput, BalanceBox, money } from '@/components/PayCard';
import { hasPaidCols, driverBalance, salaryDue } from '@/lib/payBalance';

/*
  One driver's own salary sheet (/transport/salary-sheet/<driver id>).
  Letterhead + driver details, salary detail of every month (create, edit, open slip: components/DriverDesk with full columns),
  trip sheet tab, and this driver's OWN other expenses (transport_extras of this driver only).
  Replaces the Salary detail and Other expenses sections that used to be on the main Transport page.
  Salary by month is shown VERTICALLY: one card per month (latest first) with net payable, paid and the
  UNPAID BALANCE (salary not paid + driver allowance of trips not paid yet). Paid needs supabase/salary-paid.sql.
*/
const short = (k) => monthLabel(k).replace(/^(\w{3})\w*/, '$1');

const n = (v) => Number(v || 0);

function DriverSheet() {
  const { id } = useParams();
  const router = useRouter();
  const { isAdmin } = useUser();
  const { label, rename } = useSalaryLabels();
  const [names, setNames] = useState(null); // row-name editor values
  const [drivers, setDrivers] = useState(null);
  const [extras, setExtras] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [editSal, setEditSal] = useState(null);
  const [undo, setUndo] = useState({});
  const [view] = useViewMode('cards');
  const [editMode, setEditMode] = useState(false);
  const [del, setDel] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, ex, en] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_extras').select('*').eq('driver_id', id).order('month', { ascending: false }).order('created_at'),
      s.from('transport_entries').select('id, driver_id, entry_date, driver_allowance, allowance_status, allowance_salary_id').eq('driver_id', id)
    ]);
    setDrivers(d.data || []);
    setExtras(ex.data || []);
    setEntries(en.data || []);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const loadEntries = useCallback(async () => {
    const { data } = await sb().from('transport_entries').select('id, driver_id, entry_date, driver_allowance, allowance_status, allowance_salary_id').eq('driver_id', id);
    if (data) setEntries(data);
  }, [id]);

  const driver = useMemo(() => (drivers || []).find((d) => d.id === id), [drivers, id]);
  const sorted = useMemo(() => [...(drivers || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [drivers]);

  /* ---------- Other expenses (this driver only) ---------- */
  async function addExtra() {
    const { data, error } = await sb().from('transport_extras')
      .insert({ driver_id: id, month: monthStart(monthKey(todayISO())), description: 'Other expense', amount: 0 }).select().single();
    if (error) { flash(error.message, 'err'); return; }
    setExtras((l) => [data, ...l]);
    flash('Line added. Type the description and amount.');
  }
  async function saveExtra(row, key, value) {
    let patch;
    if (key === 'month') patch = { month: value ? monthStart(monthKey(value)) : row.month };
    else if (key === 'description') patch = { description: value || 'Other expense' };
    else patch = { [key]: value };
    setExtras((l) => l.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('transport_extras').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }
  async function confirmDelete() {
    const { error } = await sb().from('transport_extras').delete().eq('id', del.id);
    if (error) { flash(error.message, 'err'); return; }
    setExtras((l) => l.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Deleted');
  }

  /* Every change on a month card can be undone (↶ Undo, step by step, until the page is reloaded) */
  async function saveSal(sal, patch, okText = 'Saved', record = true) {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, sal[k] ?? null]));
    if (Object.keys(patch).every((k) => (patch[k] ?? null) === before[k])) return;
    setSalaries((l) => l.map((x) => (x.id === sal.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('transport_salaries').update(patch).eq('id', sal.id);
    if (error) { flash(error.message, 'err'); setSalaries((l) => l.map((x) => (x.id === sal.id ? { ...x, ...before } : x))); return; }
    if (record) setUndo((u) => ({ ...u, [sal.id]: [...(u[sal.id] || []), before] }));
    flash(okText);
  }
  function savePaid(sal, v) {
    return saveSal(sal, { paid_amount: v, paid_on: v ? (sal.paid_on || todayISO()) : null }, v ? 'Payment saved' : 'Marked not paid');
  }
  async function undoSal(sal) {
    const stack = undo[sal.id] || [];
    if (!stack.length) return;
    const prev = stack[stack.length - 1];
    setUndo((u) => ({ ...u, [sal.id]: stack.slice(0, -1) }));
    await saveSal(sal, prev, 'Undone', false);
  }

  async function doExcel() {
    const fields = SALARY_FIELDS.filter(([k]) => k !== 'allowance_carried' || salaries.some((s) => n(s.allowance_carried)));
    const tracked = salaries.some(hasPaidCols);
    const salRows = [...salaries].sort((a, b) => String(b.month).localeCompare(String(a.month))).map((s) => [
      monthLabel(monthKey(s.month)), ...fields.map(([k]) => num(s[k])), salaryTotal(s), num(s.advance_deduction), num(s.special_allowance), salaryPayable(s), ...(tracked ? [num(s.paid_amount), Math.max(0, salaryDue(s))] : []), s.allowance_carried_note || ''
    ]);
    const exRows = extras.map((x) => [monthLabel(monthKey(x.month)), x.description || '', num(x.amount)]);
    await exportExcel(`${driver?.name || 'Driver'} salary sheet ${exportStamp()}.xlsx`, [
      {
        name: 'Salary detail', title: `Salary sheet · ${driver?.name}`, subtitle: `Modern City for Express Services LLC · Transport Division · Resident Card ${driver?.resident_card || '-'}`,
        head: ['Month', ...fields.map(([k]) => label(k)), 'Total', label('advance_deduction'), label('special_allowance'), 'Net payable', ...(tracked ? ['Paid', 'Not paid'] : []), 'Note'],
        rows: salRows, numCols: [...fields.map((_, i) => i + 1), fields.length + 1, fields.length + 2, fields.length + 3, fields.length + 4, ...(tracked ? [fields.length + 5, fields.length + 6] : [])],
        widths: [16, ...fields.map(() => 13), 13, 13, 13, 14, ...(tracked ? [13, 13] : []), 34]
      },
      { name: 'Other expenses', title: `Other expenses · ${driver?.name}`, subtitle: 'Trailer rent and anything not tied to a trip', head: ['Month', 'Description', 'Amount (OMR)'], rows: exRows, numCols: [2], widths: [16, 36, 14] }
    ]);
    flash('Excel file downloaded');
  }

  if (!drivers) return <div className="loading">Loading salary sheet...</div>;
  if (!driver) return <div className="error">Driver not found. <Link href="/transport/drivers">Open Drivers</Link></div>;

  const paidTotal = salaries.reduce((t, s) => t + salaryPayable(s), 0);
  const extraTotal = extras.reduce((t, x) => t + n(x.amount), 0);
  const nowKey = monthKey(todayISO());
  const lastKey = [nowKey, ...salaries.map((x) => monthKey(x.month))].sort().pop();
  const bal = driverBalance(salaries, entries, id, lastKey);
  const byMonth = [...salaries].sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const showCarried = salaries.some((x) => n(x.allowance_carried));
  const cardFields = SALARY_FIELDS.filter(([k]) => k !== 'allowance_carried' || showCarried);

  return (
    <>
      <div className="page-tools no-print">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <select className="ss-month" value={id} onChange={(e) => router.push(`/transport/salary-sheet/${e.target.value}`)} aria-label="Choose driver">
            {sorted.map((d) => <option key={d.id} value={d.id}>{d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}</option>)}
          </select>
          <Link href={`/transport/${id}`} className="btn">📄 Trip sheet</Link>
          <Link href="/transport/salary-sheet" className="btn ghost">📑 All drivers (one month)</Link>
          {isAdmin && <button type="button" className="btn ghost" onClick={() => setNames(Object.fromEntries([...SALARY_FIELDS, ...SALARY_EXTRA_LABELS].map(([k]) => [k, label(k)])))}>✏️ Row names</button>}
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
        </div>
      </div>

      <div className="ss-paper ds-paper pc-paper">
        <header className="ss-head">
          <img src="/modern-city-logo.png" alt="Modern City" />
          <div>
            <b>MODERN CITY FOR EXPRESS SERVICES L.L.C</b>
            <span>CR No. 1404742 · VAT Registration No. OM11008665</span>
            <span>P.O. Box 149, PC 133, Al Khuwair, Sultanate of Oman · www.tudonumgroup.com</span>
          </div>
        </header>
        <h1 className="ss-title">Salary Sheet <span>{driver.name}</span></h1>
        <dl className="ds-info">
          <div><dt>Resident Card</dt><dd>{driver.resident_card || '–'}</dd></div>
          <div><dt>Vehicle</dt><dd>{driver.vehicle_no || '–'}</dd></div>
          <div><dt>Mobile</dt><dd>{driver.phone || '–'}</dd></div>
          <div><dt>Resident Card expiry</dt><dd>{fmtD(driver.resident_card_expiry) || '–'}</dd></div>
          <div><dt>Status</dt><dd>{driver.status || 'Active'}</dd></div>
        </dl>
        <div className="kpi-row">
          <div className="kpi"><span>Salary months</span><strong>{salaries.length}</strong><small>receipts</small></div>
          <div className="kpi"><span>Salary paid (all months)</span><strong><Omr v={paidTotal} /></strong><small>net payable</small></div>
          <div className="kpi"><span>Other expenses</span><strong><Omr v={extraTotal} /></strong><small>{extras.length} lines</small></div>
          <div className="kpi hero"><span>Total cost of driver</span><strong><Omr v={paidTotal + extraTotal} /></strong><small>salary + other</small></div>
          <div className={`kpi ${bal.total > 0.0005 ? 'kpi-due' : ''}`}><span>Unpaid balance</span><strong>{bal.total > 0.0005 ? <Omr v={bal.total} /> : 'Nil ✓'}</strong><small>{bal.tracked ? 'salary + allowance not paid' : 'driver allowance not paid'}</small></div>
        </div>
        <BalanceBox total={bal.total} tracked={bal.tracked} lines={[
          [`${monthLabel(lastKey)} salary not paid`, bal.thisMonth],
          [`Earlier months salary not paid (${bal.earlier.map((x) => short(x.month)).join(', ')})`, bal.earlierTotal],
          [`Driver allowance not paid (${bal.allowance.months.map((x) => `${short(x.month)}: ${x.trips} trip${x.trips > 1 ? 's' : ''}`).join(', ')})`, bal.allowance.total]
        ]} missingNote="Salary payments are not recorded yet (run supabase/salary-paid.sql). Only unpaid driver allowance is counted." />

        {byMonth.length > 0 && (
          <>
            <h3 className="pc-h3">Salary by month</h3>
            {view === 'cards' ? (
            <div className="pc-grid">
              {byMonth.map((s) => {
                const k = monthKey(s.month);
                const due = salaryDue(s);
                const editing = isAdmin && editSal === s.id;
                return (
                  <PayCard key={s.id} title={monthLabel(k)} className={editing ? 'editing' : ''} badge={due == null ? null : due > 0.0005 ? <span className="pc-tag due">Not paid {money(due)}</span> : <span className="pc-tag ok">Paid ✓</span>}>
                    {isAdmin && (
                      <div className="pc-act no-print">
                        <button type="button" className={`btn small ${editing ? 'in' : ''}`} onClick={() => setEditSal(editing ? null : s.id)}>{editing ? '✓ Done' : '✏️ Edit'}</button>
                        {(undo[s.id] || []).length > 0 && <button type="button" className="btn small ghost" onClick={() => undoSal(s)}>↶ Undo{undo[s.id].length > 1 ? ` (${undo[s.id].length})` : ''}</button>}
                        {hasPaidCols(s) && due > 0.0005 && <button type="button" className="btn small in" onClick={() => savePaid(s, salaryPayable(s))}>✓ Mark paid</button>}
                        {hasPaidCols(s) && s.paid_amount != null && <button type="button" className="btn small ghost" onClick={() => savePaid(s, null)}>✗ Not paid</button>}
                      </div>
                    )}
                    <PaySection title="Salary">
                      {cardFields.map(([f]) => {
                        const auto = f === 'trip_allowance' || f === 'allowance_carried';
                        return (
                          <PayRow key={f} label={label(f)} value={n(s[f]) ? s[f] : null}
                            note={f === 'allowance_carried' ? s.allowance_carried_note : editing && auto ? 'from trips (Mark paid on trip sheet)' : undefined}>
                            {editing && !auto ? <AmountInput value={s[f]} onSave={(v) => saveSal(s, { [f]: v ?? 0 })} /> : undefined}
                          </PayRow>
                        );
                      })}
                      <div className="pc-notes"><AllowanceNotes story={allowanceStory(entries, salaries, id, k)} month={k} compact /></div>
                      <PayRow label="Total salary" value={salaryTotal(s)} kind="total" />
                    </PaySection>
                    <PaySection title="Deduction and additions">
                      <PayRow label={label('advance_deduction')} value={s.advance_deduction} kind="minus">
                        {editing ? <AmountInput value={s.advance_deduction} onSave={(v) => saveSal(s, { advance_deduction: v ?? 0 })} /> : undefined}
                      </PayRow>
                      <PayRow label={label('special_allowance')} value={s.special_allowance} kind="plus">
                        {editing ? <AmountInput value={s.special_allowance} onSave={(v) => saveSal(s, { special_allowance: v ?? 0 })} /> : undefined}
                      </PayRow>
                    </PaySection>
                    <PayRow label="Net payable" value={salaryPayable(s)} kind="net" />
                    {hasPaidCols(s) && (
                      <>
                        <PayRow label="Paid" kind="paid" value={s.paid_amount}>
                          {editing ? <AmountInput value={s.paid_amount} onSave={(v) => savePaid(s, v)} /> : (s.paid_amount == null ? '–' : undefined)}
                        </PayRow>
                        {(editing || s.paid_on) && (
                          <PayRow label="Paid on">
                            {editing ? <DateInput value={s.paid_on || ''} onChange={(v) => saveSal(s, { paid_on: v || null })} /> : fmtD(s.paid_on)}
                          </PayRow>
                        )}
                      </>
                    )}
                    {due != null && <PayRow label="Not paid" value={Math.max(0, due)} kind={due > 0.0005 ? 'due' : 'total'} />}
                  </PayCard>
                );
              })}
            </div>
            ) : (
            <div className="table-wrap no-cards">
              <table className="ss-table">
                <thead>
                  <tr>
                    <th className="l">Month</th>
                    {cardFields.map(([f]) => <th key={f}>{label(f)}</th>)}
                    <th className="hi">Total</th><th>{label('advance_deduction')}</th><th>{label('special_allowance')}</th><th className="hi">Net payable</th>
                    <th>Paid</th><th>Paid on</th><th className="hi">Not paid</th>{isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {byMonth.map((s) => {
                    const due = salaryDue(s);
                    return (
                      <tr key={s.id}>
                        <td className="l"><b>{monthLabel(monthKey(s.month))}</b></td>
                        {cardFields.map(([f]) => <td key={f}>{n(s[f]) ? fmtAmt(s[f]) : '–'}</td>)}
                        <td className="hi">{fmtAmt(salaryTotal(s))}</td>
                        <td>{n(s.advance_deduction) ? `−${fmtAmt(s.advance_deduction)}` : '–'}</td>
                        <td>{n(s.special_allowance) ? fmtAmt(s.special_allowance) : '–'}</td>
                        <td className="hi"><b>{fmtAmt(salaryPayable(s))}</b></td>
                        <td>{isAdmin && hasPaidCols(s) ? <AmountInput value={s.paid_amount} width={95} onSave={(v) => savePaid(s, v)} /> : (s.paid_amount == null ? '–' : fmtAmt(s.paid_amount))}</td>
                        <td>{fmtD(s.paid_on) || '–'}</td>
                        <td className="hi">{due == null ? '–' : due > 0.0005 ? <b className="neg">{fmtAmt(due)}</b> : 'Paid ✓'}</td>
                        {isAdmin && (
                          <td className="c">
                            {(undo[s.id] || []).length > 0 && <button type="button" className="btn small ghost" onClick={() => undoSal(s)}>↶ Undo</button>}
                            {hasPaidCols(s) && due > 0.0005 && <button type="button" className="btn small in" onClick={() => savePaid(s, salaryPayable(s))}>✓ Paid</button>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}
      </div>

      <DriverDesk drivers={drivers} canEdit={isAdmin} flash={flash} fixedDriverId={id} onChange={(list) => { setSalaries(list); loadEntries(); }} />

      <section className="panel ds-extras">
        <div className="section-head">
          <h2>🧾 Other expenses · {driver.name}</h2>
          <span className="note">Trailer rent and anything not tied to a trip</span>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>
        <DataGrid
          columns={[
            { key: 'month', label: 'Month', type: 'date', width: 170, render: (r) => monthLabel(monthKey(r.month)) },
            { key: 'description', label: 'Description', type: 'text', width: 320 },
            { key: 'amount', label: 'Amount (OMR)', type: 'number', min: 0, width: 150, render: (r) => fmtAmt(r.amount) }
          ]}
          rows={extras}
          canEdit={canChange}
          onSave={saveExtra}
          onAdd={addExtra}
          addLabel="+ Add expense"
          onDelete={(r) => setDel(r)}
          emptyText="No other expenses for this driver."
          footer={{ month: `${extras.length} ${extras.length === 1 ? 'entry' : 'entries'}`, amount: fmtAmt(extraTotal) }}
          flash={flash}
        />
        {canChange && <p className="note">Month: type any date in that month, e.g. 01/10/2026.</p>}
      </section>

      {del && (
        <Modal title="Delete expense?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <strong>{del.description}</strong> ({fmtAmt(del.amount)} OMR, {monthLabel(monthKey(del.month))})?</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
      {names && (
        <Modal title="Salary row names" onClose={() => setNames(null)}>
          <p className="note" style={{ margin: '0 0 10px' }}>Rename any salary row. It changes for every driver, the slips and the sheets. Leave empty for the standard name.</p>
          <div className="dd-grid">
            {Object.keys(names).map((k) => (
              <label key={k}>
                <span className="muted">{k === 'trip_allowance' ? 'Driver allowance' : k.replace(/^_/, '').replace(/_/g, ' ')}</span>
                <input type="text" value={names[k]} onChange={(e) => setNames((m) => ({ ...m, [k]: e.target.value }))} style={{ textAlign: 'left' }} />
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setNames(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={async () => {
              for (const [k, v] of Object.entries(names)) {
                if (v.trim() === label(k)) continue;
                const r = await rename(k, v);
                if (r.error) { flash(r.error, 'err'); return; }
              }
              setNames(null);
              flash('Row names saved');
            }}>Save names</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DriverSheet /></AuthGate>;
}
