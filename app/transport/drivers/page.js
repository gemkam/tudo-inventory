'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import { sb } from '@/lib/supabase';

function DriversPage() {
  const { isAdmin } = useUser();
  const [drivers, setDrivers] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [del, setDel] = useState(null);
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, v] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_vehicles').select('id, part, plate_no, driver_id')
    ]);
    setDrivers(d.data || []);
    setVehicles(v.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(row, key, value) {
    const patch = { [key]: value === '' ? null : value };
    setDrivers((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('transport_drivers').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }

  async function addRow() {
    const sort = (drivers || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const { data, error } = await sb().from('transport_drivers').insert({ name: 'New driver', sort, status: 'Active' }).select().single();
    if (error) { flash(error.message, 'err'); return; }
    setDrivers((list) => [...list, data]);
    flash('New driver added. Type the name and details.');
  }

  async function confirmDelete() {
    const { error } = await sb().from('transport_drivers').delete().eq('id', del.id);
    if (error) { flash(/foreign key|violates/i.test(error.message) ? 'This driver has trips or salary saved. Set Status to Inactive instead.' : error.message, 'err'); setDel(null); return; }
    setDrivers((list) => list.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Driver deleted');
  }

  if (!drivers) return <div className="loading">Loading drivers...</div>;

  const plates = (id, part) => vehicles.filter((v) => v.driver_id === id && v.part === part).map((v) => v.plate_no).filter(Boolean).join(', ');
  const columns = [
    { key: 'name', label: 'Name', type: 'text', width: 170, render: (r) => <b>{r.name}</b> },
    { key: 'resident_card', label: 'Resident Card No.', type: 'text', width: 150 },
    { key: 'phone', label: 'Mobile', type: 'text', width: 130 },
    { key: 'vehicle_no', label: 'Vehicle # (shown on sheets)', type: 'text', width: 190 },
    { key: 'unit', label: 'Unit (from Vehicles)', type: 'calc', align: 'left', width: 140, render: (r) => plates(r.id, 'Unit') || <span className="muted">–</span> },
    { key: 'trailer', label: 'Trailer (from Vehicles)', type: 'calc', align: 'left', width: 150, render: (r) => plates(r.id, 'Trailer') || <span className="muted">–</span> },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100, render: (r) => <span className={`tag ${r.status === 'Inactive' ? 'warn' : 'ok'}`}>{r.status || 'Active'}</span> },
    { key: 'notes', label: 'Notes', type: 'text', width: 200 },
    {
      key: 'links', label: 'Open', type: 'calc', width: 190,
      render: (r) => (
        <span className="row-links">
          <Link href={`/transport/${r.id}`}>Trip sheet</Link>
          <Link href={`/transport/salary/${r.id}`}>Salary slip</Link>
        </span>
      )
    }
  ];

  const active = drivers.filter((d) => d.status !== 'Inactive').length;

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <Link href="/transport/vehicles" className="btn">🚚 Vehicles</Link>
        </div>
      </div>
      <div>
        <h1>Drivers</h1>
        <p className="sub">{drivers.length} drivers · {active} active. Press Edit to change details or add a driver.</p>
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>👤 All drivers</h2>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>
        <DataGrid
          columns={columns}
          rows={drivers}
          canEdit={canChange}
          onSave={save}
          onAdd={addRow}
          addLabel="+ Add driver"
          onDelete={(r) => setDel(r)}
          rowClass={(r) => (r.status === 'Inactive' ? 'muted-row' : '')}
          emptyText="No drivers yet."
          flash={flash}
        />
      </section>

      {del && (
        <Modal title="Delete driver?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.name}</b>? If the driver has trips or salary saved, set Status to Inactive instead.</p>
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
  return <AuthGate wide><DriversPage /></AuthGate>;
}
