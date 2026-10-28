'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import DateInput from '@/components/DateInput';
import Expiry from '@/components/Expiry';
import { sb } from '@/lib/supabase';
import DriverDesk from '@/components/DriverDesk';

/* One editable line on a driver card: shows the value, or an input box in Edit mode (saves when you leave the box) */
function Field({ label, value, type = 'text', canEdit, onSave, view, wide }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);

  let body;
  if (!canEdit) {
    body = view ?? (value ? <span>{value}</span> : <span className="muted">–</span>);
  } else if (type === 'date') {
    body = <DateInput value={value || ''} onChange={(iso) => { if (iso !== (value || '')) onSave(iso); }} className="drv-input" />;
  } else if (type === 'textarea') {
    body = <textarea className="drv-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== (value || '')) onSave(text); }} />;
  } else {
    body = <input className="drv-input" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== (value || '')) onSave(text); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
  }
  return (
    <div className={`drv-field${wide ? ' wide' : ''}`}>
      <span className="drv-label">{label}</span>
      <div className="drv-value">{body}</div>
    </div>
  );
}

function DriversPage() {
  const { isAdmin } = useUser();
  const [drivers, setDrivers] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [del, setDel] = useState(null);
  const [sortBy, setSortBy] = useState('name');
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

  const active = drivers.filter((d) => d.status !== 'Inactive').length;
  const exp = (d) => [d.resident_card_expiry, d.visa_expiry].filter(Boolean).sort()[0] || '9999';
  const sorted = [...drivers].sort((a, b) => {
    if (sortBy === 'status') return String(a.status || 'Active').localeCompare(String(b.status || 'Active')) || String(a.name).localeCompare(String(b.name));
    if (sortBy === 'expiry') return exp(a).localeCompare(exp(b));
    if (sortBy === 'added') return (a.sort || 0) - (b.sort || 0);
    return String(a.name).localeCompare(String(b.name));
  });

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <Link href="/transport/salary-sheet" className="btn in">📑 Salary sheet</Link>
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
          <select className="dd-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort drivers">
            <option value="name">Sort: Name A to Z</option>
            <option value="status">Sort: Active first</option>
            <option value="expiry">Sort: Resident Card / Visa expiry first</option>
            <option value="added">Sort: Order added</option>
          </select>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>

        {sorted.length === 0 && <p className="muted" style={{ margin: 0 }}>No drivers yet.</p>}

        <div className="drv-grid">
          {sorted.map((r) => {
            const inactive = r.status === 'Inactive';
            const unit = plates(r.id, 'Unit');
            const trailer = plates(r.id, 'Trailer');
            return (
              <article key={r.id} className={`drv-card${inactive ? ' inactive' : ''}`}>
                <div className="drv-top">
                  {canChange
                    ? <input className="drv-input drv-name-input" defaultValue={r.name || ''} aria-label="Driver name"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) save(r, 'name', v); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    : <h3 className="drv-name">{r.name}</h3>}
                  {canChange
                    ? <select className="drv-input drv-status" value={r.status || 'Active'} onChange={(e) => save(r, 'status', e.target.value)} aria-label="Status">
                        <option>Active</option><option>Inactive</option>
                      </select>
                    : <span className={`tag ${inactive ? 'warn' : 'ok'}`}>{r.status || 'Active'}</span>}
                </div>

                <div className="drv-links">
                  <Link href={`/transport/${r.id}`} className="btn small">🧾 Trip sheet</Link>
                  <Link href={`/transport/salary/${r.id}`} className="btn small in">💵 Salary slip</Link>
                </div>

                <div className="drv-fields">
                  <Field label="Mobile" value={r.phone} canEdit={canChange} onSave={(v) => save(r, 'phone', v)} />
                  <Field label="Resident Card No." value={r.resident_card} canEdit={canChange} onSave={(v) => save(r, 'resident_card', v)} />
                  <Field label="Resident Card expiry" type="date" value={r.resident_card_expiry} canEdit={canChange}
                    onSave={(v) => save(r, 'resident_card_expiry', v)} view={<Expiry date={r.resident_card_expiry} />} />
                  <Field label="Visa expiry" type="date" value={r.visa_expiry} canEdit={canChange}
                    onSave={(v) => save(r, 'visa_expiry', v)} view={<Expiry date={r.visa_expiry} />} />
                  <Field label="Vehicle # (shown on sheets)" value={r.vehicle_no} canEdit={canChange} onSave={(v) => save(r, 'vehicle_no', v)} />
                  <div className="drv-field">
                    <span className="drv-label">Unit (from Vehicles)</span>
                    <div className="drv-value">{unit || <span className="muted">–</span>}</div>
                  </div>
                  <div className="drv-field">
                    <span className="drv-label">Trailer (from Vehicles)</span>
                    <div className="drv-value">{trailer || <span className="muted">–</span>}</div>
                  </div>
                  <Field label="Notes" type="textarea" wide value={r.notes} canEdit={canChange} onSave={(v) => save(r, 'notes', v)} />
                </div>

                {canChange && (
                  <div className="drv-actions">
                    <button type="button" className="mini danger" onClick={() => setDel(r)}>Delete driver</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {canChange && <button type="button" className="add-row drv-add" onClick={addRow}>+ Add driver</button>}
      </section>

      <DriverDesk drivers={drivers} canEdit={isAdmin} flash={flash} />

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
