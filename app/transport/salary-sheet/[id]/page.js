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
import { sb } from '@/lib/supabase';
import { num, fmtAmt, monthKey, monthStart, monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable } from '@/lib/transport';
import { useSalaryLabels, SALARY_EXTRA_LABELS } from '@/lib/labels';
import { fmtD } from '@/lib/reminders';

/*
  One driver's own salary sheet (/transport/salary-sheet/<driver id>).
  Letterhead + driver details, salary detail of every month (create, edit, open slip: components/DriverDesk with full columns),
  trip sheet tab, and this driver's OWN other expenses (transport_extras of this driver only).
  Replaces the Salary detail and Other expenses sections that used to be on the main Transport page.
*/

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
    const [d, ex] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_extras').select('*').eq('driver_id', id).order('month', { ascending: false }).order('created_at')
    ]);
    setDrivers(d.data || []);
    setExtras(ex.data || []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

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

  async function doExcel() {
    const fields = SALARY_FIELDS.filter(([k]) => k !== 'allowance_carried' || salaries.some((s) => n(s.allowance_carried)));
    const salRows = [...salaries].sort((a, b) => String(b.month).localeCompare(String(a.month))).map((s) => [
      monthLabel(monthKey(s.month)), ...fields.map(([k]) => num(s[k])), salaryTotal(s), num(s.advance_deduction), num(s.special_allowance), salaryPayable(s), s.allowance_carried_note || ''
    ]);
    const exRows = extras.map((x) => [monthLabel(monthKey(x.month)), x.description || '', num(x.amount)]);
    await exportExcel(`${driver?.name || 'Driver'} salary sheet ${exportStamp()}.xlsx`, [
      {
        name: 'Salary detail', title: `Salary sheet · ${driver?.name}`, subtitle: `Modern City for Express Services LLC · Transport Division · Resident Card ${driver?.resident_card || '-'}`,
        head: ['Month', ...fields.map(([k]) => label(k)), 'Total', label('advance_deduction'), label('special_allowance'), 'Net payable', 'Note'],
        rows: salRows, numCols: [...fields.map((_, i) => i + 1), fields.length + 1, fields.length + 2, fields.length + 3, fields.length + 4],
        widths: [16, ...fields.map(() => 13), 13, 13, 13, 14, 34]
      },
      { name: 'Other expenses', title: `Other expenses · ${driver?.name}`, subtitle: 'Trailer rent and anything not tied to a trip', head: ['Month', 'Description', 'Amount (OMR)'], rows: exRows, numCols: [2], widths: [16, 36, 14] }
    ]);
    flash('Excel file downloaded');
  }

  if (!drivers) return <div className="loading">Loading salary sheet...</div>;
  if (!driver) return <div className="error">Driver not found. <Link href="/transport/drivers">Open Drivers</Link></div>;

  const paidTotal = salaries.reduce((t, s) => t + salaryPayable(s), 0);
  const extraTotal = extras.reduce((t, x) => t + n(x.amount), 0);

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

      <div className="ss-paper ds-paper">
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
        </div>
      </div>

      <DriverDesk drivers={drivers} canEdit={isAdmin} flash={flash} fixedDriverId={id} full onChange={setSalaries} />

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
