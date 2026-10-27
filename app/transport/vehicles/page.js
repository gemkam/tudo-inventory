'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import MaintenanceSection from '@/components/MaintenanceSection';

const TRAILER_TYPES = ['Flatbed 40 Feet', 'Flatbed 45 Feet'];
const fmtD = (d) => (d ? d.split('-').reverse().join('.') : '');

function daysLeft(d) {
  if (!d) return null;
  const a = new Date(`${d}T00:00:00`);
  const b = new Date(`${todayISO()}T00:00:00`);
  return Math.round((a - b) / 86400000);
}

function Expiry({ date }) {
  if (!date) return <span className="muted">–</span>;
  const left = daysLeft(date);
  const cls = left < 0 ? 'exp-bad' : left <= 30 ? 'exp-soon' : 'exp-ok';
  const note = left < 0 ? `expired ${-left}d ago` : left === 0 ? 'expires today' : left <= 30 ? `${left}d left` : '';
  return <span className={`exp ${cls}`}>{fmtD(date)}{note && <small>{note}</small>}</span>;
}

function VehiclesPage() {
  const { isAdmin } = useUser();
  const [vehicles, setVehicles] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [del, setDel] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [v, d] = await Promise.all([
      s.from('transport_vehicles').select('*').order('sort').order('created_at'),
      s.from('transport_drivers').select('id, name').order('sort')
    ]);
    if (v.error) { setError(v.error.message); setVehicles([]); return; }
    setVehicles(v.data || []);
    setDrivers(d.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const driverName = (id) => drivers.find((d) => d.id === id)?.name || '';
  const driverId = (name) => drivers.find((d) => d.name === name)?.id || null;

  async function save(row, key, value) {
    let patch;
    if (key === 'driver') patch = { driver_id: value ? driverId(value) : null };
    else patch = { [key]: value === '' ? null : value };
    setVehicles((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error: err } = await sb().from('transport_vehicles').update(patch).eq('id', row.id);
    if (err) { flash(err.message, 'err'); load(); return; }
    flash('Saved');
  }

  async function addRow(part) {
    const sort = (vehicles || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const row = { part, sort, ownership: 'Own', name: part === 'Unit' ? 'New unit' : 'New trailer', trailer_type: part === 'Trailer' ? TRAILER_TYPES[0] : null };
    const { data, error: err } = await sb().from('transport_vehicles').insert(row).select().single();
    if (err) { flash(err.message, 'err'); return; }
    setVehicles((list) => [...list, data]);
    flash(`New ${part.toLowerCase()} added. Fill in the details.`);
  }

  async function confirmDelete() {
    const { error: err } = await sb().from('transport_vehicles').delete().eq('id', del.id);
    if (err) { flash(err.message, 'err'); return; }
    setVehicles((list) => list.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Deleted');
  }

  if (error) return <div className="error">Could not load vehicles: {error}</div>;
  if (!vehicles) return <div className="loading">Loading vehicles...</div>;

  const dateCol = (key, label, expiry) => ({
    key, label, type: 'date', width: expiry ? 140 : 112,
    render: (r) => (expiry ? <Expiry date={r[key]} /> : (r[key] ? fmtD(r[key]) : <span className="muted">–</span>))
  });

  const cols = (part) => [
    { key: 'name', label: 'Name', type: 'text', width: 150, render: (r) => <b>{r.name}</b> },
    { key: 'plate_no', label: 'Number plate', type: 'text', width: 120 },
    part === 'Unit'
      ? { key: 'model', label: 'Model', type: 'text', width: 150, placeholder: 'e.g. Mercedes Actros 2020' }
      : { key: 'trailer_type', label: 'Trailer type', type: 'select', options: TRAILER_TYPES, width: 140 },
    ...(part === 'Trailer' ? [{ key: 'model', label: 'Model', type: 'text', width: 130 }] : []),
    { key: 'ownership', label: 'Own / Rent', type: 'select', options: ['Own', 'Rent'], width: 100, render: (r) => <span className={`tag ${r.ownership === 'Rent' ? 'info' : 'ok'}`}>{r.ownership || 'Own'}</span> },
    { key: 'driver', label: 'Driver', type: 'select', options: ['', ...drivers.map((d) => d.name)], width: 130, raw: (r) => driverName(r.driver_id), render: (r) => driverName(r.driver_id) || <span className="muted">–</span> },
    dateCol('insurance_issue', 'Insurance issue', false),
    dateCol('insurance_expiry', 'Insurance expiry', true),
    dateCol('mulkiya_issue', 'Mulkiya issue', false),
    dateCol('mulkiya_expiry', 'Mulkiya expiry', true),
    { key: 'notes', label: 'Notes', type: 'text', width: 180 }
  ];

  const units = vehicles.filter((v) => v.part === 'Unit');
  const trailers = vehicles.filter((v) => v.part === 'Trailer');
  const alerts = vehicles.flatMap((v) => [['Insurance', v.insurance_expiry], ['Mulkiya', v.mulkiya_expiry]]
    .filter(([, d]) => d && daysLeft(d) <= 30)
    .map(([what, d]) => ({ v, what, d, left: daysLeft(d) })))
    .sort((a, b) => a.left - b.left);

  async function doExcel() {
    const row = (v) => [v.part, v.name || '', v.plate_no || '', v.model || '', v.trailer_type || '', v.ownership || '', driverName(v.driver_id),
      fmtD(v.insurance_issue), fmtD(v.insurance_expiry), fmtD(v.mulkiya_issue), fmtD(v.mulkiya_expiry), v.notes || ''];
    await exportExcel(`Vehicles ${exportStamp()}.xlsx`, [{
      name: 'Vehicles', title: 'Vehicles (Units and Trailers)', subtitle: 'Modern City for Express Services LLC · Transport Division',
      head: ['Part', 'Name', 'Number plate', 'Model', 'Trailer type', 'Own / Rent', 'Driver', 'Insurance issue', 'Insurance expiry', 'Mulkiya issue', 'Mulkiya expiry', 'Notes'],
      rows: [...units, ...trailers].map(row), numCols: [], widths: [9, 18, 14, 18, 16, 10, 16, 14, 14, 14, 14, 24]
    }]);
    flash('Excel file downloaded');
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          {isAdmin && (
            <button type="button" className={`btn ${editMode ? 'in' : ''}`} onClick={() => setEditMode((v) => !v)} aria-pressed={editMode}>
              {editMode ? '✓ Done editing' : 'Edit'}
            </button>
          )}
          <a href="#maintenance" className="btn">🔧 Maintenance</a>
          <Link href="/transport/drivers" className="btn">👤 Drivers</Link>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
        </div>
      </div>
      <div>
        <h1>Vehicles</h1>
        <p className="sub">Each truck has two parts: the Unit (head) and the Trailer. Each part has its own Insurance and Mulkiya.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Units</span><strong>{units.length}</strong><small>{units.filter((u) => u.ownership === 'Rent').length} on rent</small></div>
        <div className="kpi"><span>Trailers</span><strong>{trailers.length}</strong><small>{TRAILER_TYPES.map((t) => `${trailers.filter((x) => x.trailer_type === t).length} × ${t.replace('Flatbed ', '')}`).join(' · ')}</small></div>
        <div className={`kpi ${alerts.some((a) => a.left < 0) ? 'kpi-bad' : ''}`}><span>Expired</span><strong>{alerts.filter((a) => a.left < 0).length}</strong><small>Insurance or Mulkiya</small></div>
        <div className="kpi"><span>Expiring in 30 days</span><strong>{alerts.filter((a) => a.left >= 0).length}</strong><small>Renew soon</small></div>
      </div>

      {alerts.length > 0 && (
        <div className="exp-alerts" role="status">
          {alerts.map((a) => (
            <span key={`${a.v.id}-${a.what}`} className={a.left < 0 ? 'bad' : 'soon'}>
              <b>{a.v.plate_no || a.v.name}</b> ({a.v.part}) {a.what} {a.left < 0 ? `expired ${fmtD(a.d)}` : `expires ${fmtD(a.d)}`}
            </span>
          ))}
        </div>
      )}

      <section className="panel">
        <h2>🚛 Units (heads)</h2>
        <DataGrid columns={cols('Unit')} rows={units} canEdit={canChange} onSave={save} onAdd={() => addRow('Unit')} addLabel="+ Add unit" onDelete={(r) => setDel(r)} emptyText="No units yet." flash={flash} />
      </section>
      <section className="panel">
        <h2>🛻 Trailers (flatbed 40 / 45 feet)</h2>
        <DataGrid columns={cols('Trailer')} rows={trailers} canEdit={canChange} onSave={save} onAdd={() => addRow('Trailer')} addLabel="+ Add trailer" onDelete={(r) => setDel(r)} emptyText="No trailers yet." flash={flash} />
      </section>

      <MaintenanceSection vehicles={[...units, ...trailers]} canChange={canChange} flash={flash} />

      {del && (
        <Modal title="Delete vehicle?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.plate_no || del.name}</b> ({del.part})?</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><VehiclesPage /></AuthGate>;
}
