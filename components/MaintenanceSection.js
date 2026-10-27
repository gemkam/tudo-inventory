'use client';

import { useCallback, useEffect, useState } from 'react';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { todayISO, fmtAmt } from '@/lib/sheet';
import { WORK_TYPES, PAY_METHODS, daysLeft, fmtD, vehicleLabel, whenText } from '@/lib/reminders';

function Due({ date, done, warnDays = 7 }) {
  if (!date) return <span className="muted">–</span>;
  const left = daysLeft(date);
  if (done) return <span>{fmtD(date)}</span>;
  const cls = left <= 3 ? 'exp-bad' : left <= warnDays ? 'exp-soon' : '';
  return <span className={`exp ${cls}`}>{fmtD(date)}{left <= warnDays && <small>{whenText(left)}</small>}</span>;
}

/* Maintenance of units and trailers: work, charges, PDC / bank transfer, PDC date, next due */
export default function MaintenanceSection({ vehicles, canChange, flash }) {
  const [rows, setRows] = useState(null);
  const [del, setDel] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await sb().from('vehicle_maintenance').select('*').order('work_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) { flash(error.message, 'err'); setRows([]); return; }
    setRows(data || []);
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  const labelOf = (id) => vehicleLabel(vehicles.find((v) => v.id === id));
  const idOf = (label) => vehicles.find((v) => vehicleLabel(v) === label)?.id || null;

  async function save(row, key, value) {
    let patch;
    if (key === 'vehicle') patch = { vehicle_id: idOf(value) };
    else if (key === 'amount') patch = { amount: value ?? 0 };
    else patch = { [key]: value === '' ? null : value };
    if (key === 'payment_method' && value === 'Bank Transfer') patch.pdc_date = null;
    setRows((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('vehicle_maintenance').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }

  async function addRow() {
    const first = vehicles[0];
    const { data, error } = await sb().from('vehicle_maintenance')
      .insert({ vehicle_id: first?.id || null, work: WORK_TYPES[0], work_date: todayISO(), amount: 0, payment_method: 'Bank Transfer', status: 'Pending' })
      .select().single();
    if (error) { flash(error.message, 'err'); return; }
    setRows((list) => [data, ...list]);
    flash('New maintenance row added. Choose the vehicle and the work.');
  }

  async function confirmDelete() {
    const { error } = await sb().from('vehicle_maintenance').delete().eq('id', del.id);
    if (error) { flash(error.message, 'err'); return; }
    setRows((list) => list.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Deleted');
  }

  if (!rows) return <section className="panel" id="maintenance"><p className="empty">Loading maintenance...</p></section>;

  // Work list: the standard ones plus anything typed before (saved with the rows)
  const workList = [...new Set([...WORK_TYPES, ...rows.map((r) => (r.work || '').trim()).filter(Boolean)])];

  const columns = [
    { key: 'work_date', label: 'Date', type: 'date', width: 108, render: (r) => fmtD(r.work_date) || <span className="muted">–</span> },
    { key: 'vehicle', label: 'Vehicle (unit / trailer)', type: 'select', options: vehicles.map(vehicleLabel), width: 170, raw: (r) => labelOf(r.vehicle_id), render: (r) => <b>{labelOf(r.vehicle_id)}</b> },
    { key: 'work', label: 'Work', type: 'combo', options: workList, width: 150, placeholder: 'Pick or type work' },
    { key: 'amount', label: 'Charges', type: 'number', min: 0, width: 110, render: (r) => (Number(r.amount) ? <Omr v={r.amount} /> : <span className="muted">–</span>) },
    { key: 'payment_method', label: 'Paid by', type: 'select', options: PAY_METHODS, width: 130, render: (r) => (r.payment_method ? <span className={`tag ${r.payment_method === 'PDC' ? 'warn' : 'ok'}`}>{r.payment_method}</span> : '') },
    {
      key: 'pdc_date', label: 'PDC date', type: 'date', width: 130,
      editable: (r) => r.payment_method === 'PDC',
      render: (r) => (r.payment_method === 'PDC' ? <Due date={r.pdc_date} done={r.status === 'Paid'} /> : <span className="muted">–</span>)
    },
    { key: 'next_due', label: 'Next due', type: 'date', width: 130, render: (r) => <Due date={r.next_due} done={rows.some((o) => o.id !== r.id && o.vehicle_id === r.vehicle_id && o.work === r.work && o.work_date > r.work_date)} /> },
    { key: 'status', label: 'Payment', type: 'select', options: ['Pending', 'Paid'], width: 100, render: (r) => <span className={`tag ${r.status === 'Pending' ? 'due' : 'ok'}`}>{r.status || 'Pending'}</span> },
    { key: 'notes', label: 'Notes', type: 'text', width: 180 }
  ];

  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);
  const pdcOpen = rows.filter((r) => r.payment_method === 'PDC' && r.status !== 'Paid');

  return (
    <section className="panel" id="maintenance">
      <div className="section-head">
        <h2>🔧 Maintenance (units and trailers)</h2>
        <p className="note">
          Total charges <b>{fmtAmt(total)} OMR</b> · {pdcOpen.length} PDC cheque{pdcOpen.length === 1 ? '' : 's'} not paid yet
        </p>
      </div>
      <DataGrid
        columns={columns}
        rows={rows}
        canEdit={canChange}
        onSave={save}
        onAdd={addRow}
        addLabel="+ Add maintenance"
        onDelete={(r) => setDel(r)}
        rowClass={(r) => (r.status === 'Pending' && r.payment_method === 'PDC' && r.pdc_date && daysLeft(r.pdc_date) <= 3 ? 'due-row' : '')}
        emptyText="No maintenance recorded yet. Press Edit, then + Add maintenance."
        footer={{ amount: <Omr v={total} /> }}
        flash={flash}
      />
      <p className="note">
        PDC: set the cheque date. A reminder shows on the Home page 7 days before, and the alarm rings daily from 3 days before until you set Payment to Paid.
        Next due: the date of the next service (e.g. next greasing). The reminder stops when you add the next row for the same vehicle and work.
      </p>
      {del && (
        <Modal title="Delete maintenance?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.work}</b> for {labelOf(del.vehicle_id)} on {fmtD(del.work_date)}?</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
