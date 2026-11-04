'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import Omr from '@/components/Omr';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, fmtDay, monthKey, monthLabel, monthStart, todayISO, exportStamp, exportExcel } from '@/lib/sheet';
import { vatOf, rentNet, dieselNet, dieselVat } from '@/lib/transport';

/*
  All Drivers Combined Sheet (/transport/combined), 4 Nov 2026.
  ONE editable sheet with the trips of every driver (Driver column first). Same table transport_entries as each
  driver's trip sheet, so a change here shows there too (DB triggers still do Received on, allowance links, Modern City).
  - ▾ on every column = Excel filter (sort, search, tick values). Totals, KPIs and Excel use only the rows shown.
  - ✏️ Edit (edit password): change any cell, Driver drop-down moves a trip to another driver, ＋ Add new trip asks the driver.
  - Column widths: drag a header edge (components/ColumnResize.js).
  New drivers appear by themselves (drivers table).
*/

const NUM_KEYS = ['rent', 'received', 'driver_allowance', 'diesel', 'toll', 'maintenance', 'gate_pass', 'exit_fee', 'empty_border_fee', 'container_wash', 'vehicle_wash'];
const dmy = (d) => { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const uniq = (list) => [...new Set(list.map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function Combined() {
  const { isAdmin, canDelete, name: userName } = useUser() || {};
  const [drivers, setDrivers] = useState(null);
  const [entries, setEntries] = useState([]);
  const [month, setMonth] = useState(null);
  const [pick, setPick] = useState('all'); // driver buttons: 'all' or driver id
  const [editMode, setEditMode] = useState(false);
  const [viewIds, setViewIds] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [del, setDel] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, e] = await Promise.all([
      s.from('transport_drivers').select('id, name, status, vehicle_no, sort').is('archived_at', null).order('sort').order('name'),
      s.from('transport_entries').select('*').order('entry_date').order('sort').order('created_at')
    ]);
    const list = (d.data || []).sort((a, b) => (a.status === 'Inactive') - (b.status === 'Inactive') || String(a.name).localeCompare(String(b.name)));
    setDrivers(list);
    setEntries(e.data || []);
    setMonth((m) => {
      if (m) return m;
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      return keys[keys.length - 1] || monthKey(todayISO());
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => Object.fromEntries((drivers || []).map((d) => [d.id, d.name])), [drivers]);
  const idOf = useMemo(() => Object.fromEntries((drivers || []).map((d) => [d.name, d.id])), [drivers]);
  const months = useMemo(() => [...new Set([...entries.map((x) => monthKey(x.entry_date)), monthKey(todayISO())])].sort().reverse(), [entries]);

  // rows of the month, sorted by date then driver (the ▾ filters can sort again)
  const rows = useMemo(() => entries
    .filter((e) => (month === 'all' || monthKey(e.entry_date) === month) && (pick === 'all' || e.driver_id === pick))
    .map((e) => ({ ...e, driver_name: nameOf[e.driver_id] || '' }))
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)) || a.driver_name.localeCompare(b.driver_name) || (a.sort || 0) - (b.sort || 0)),
  [entries, month, nameOf, pick]);

  const onView = useCallback((ids) => setViewIds(ids), []);
  const shown = useMemo(() => {
    if (!viewIds) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return viewIds.map((i) => byId.get(i)).filter(Boolean);
  }, [rows, viewIds]);

  const T = useMemo(() => {
    const tot = (k) => num(shown.reduce((t, e) => t + Number(e[k] || 0), 0));
    const o = {};
    NUM_KEYS.forEach((k) => { o[k] = tot(k); });
    o.trips = shown.filter((e) => Number(e.rent) > 0).length;
    o.balance = num(o.rent - o.received);
    o.vat = num(shown.reduce((t, e) => t + vatOf(e), 0));
    o.rent_net = num(shown.reduce((t, e) => t + rentNet(e), 0));
    o.diesel_vat = num(shown.reduce((t, e) => t + dieselVat(e), 0));
    o.diesel_net = num(shown.reduce((t, e) => t + dieselNet(e), 0));
    return o;
  }, [shown]);

  if (!drivers || !month) return <div className="loading">Loading the combined sheet...</div>;

  const period = month === 'all' ? 'All months' : monthLabel(month);
  const amt = (k) => (r) => (Number(r[k]) ? fmtAmt(r[k]) : <span className="muted">–</span>);
  const places = uniq(entries.flatMap((e) => [e.from_place, e.to_place]));

  const columns = [
    { key: 'driver_name', label: 'Driver', type: 'select', width: 150, options: drivers.map((d) => d.name), raw: (r) => r.driver_name, text: (r) => r.driver_name },
    { key: 'entry_date', label: 'Date', type: 'date', width: 118, render: (r) => fmtDay(r.entry_date), text: (r) => dmy(r.entry_date) },
    { key: 'from_place', label: 'From', type: 'combo', width: 140, options: places },
    { key: 'to_place', label: 'To', type: 'combo', width: 140, options: places },
    { key: 'description', label: 'Description', type: 'text', width: 200 },
    { key: 'rent', label: 'Total rent with VAT', type: 'number', min: 0, width: 120, render: amt('rent') },
    { key: 'rent_net', label: 'Total rent without VAT', type: 'calc', width: 130, render: (r) => (Number(r.rent) ? fmtAmt(rentNet(r)) : <span className="muted">–</span>), text: (r) => (Number(r.rent) ? fmtAmt(rentNet(r)) : ''), sortValue: (r) => rentNet(r) },
    { key: 'vat', label: 'VAT 5%', type: 'calc', width: 96, render: (r) => (vatOf(r) ? <b className="col-vat-amt">{fmtAmt(vatOf(r))}</b> : <span className="muted">–</span>), text: (r) => (vatOf(r) ? fmtAmt(vatOf(r)) : ''), sortValue: (r) => vatOf(r) },
    { key: 'received', label: 'Received', type: 'number', min: 0, width: 104, render: amt('received') },
    { key: 'received_date', label: 'Received on', type: 'date', width: 124, render: (r) => (r.received_date ? <span className={r.received_date !== r.entry_date ? 'late-pay' : ''}>{fmtDay(r.received_date)}</span> : <span className="muted">–</span>), text: (r) => dmy(r.received_date) },
    {
      key: 'balance', label: 'Balance', type: 'calc', width: 96,
      render: (r) => { const b = num(Number(r.rent || 0) - Number(r.received || 0)); return b ? <span className={b > 0 ? 'neg' : 'pos'}>{fmtAmt(b)}</span> : <span className="muted">0</span>; },
      text: (r) => fmtAmt(num(Number(r.rent || 0) - Number(r.received || 0))), sortValue: (r) => Number(r.rent || 0) - Number(r.received || 0)
    },
    { key: 'payment_status', label: 'Payment', type: 'select', options: ['Received', 'Not Received', 'Partly received'], width: 132, render: (r) => (r.payment_status ? <span className={`tag ${/not/i.test(r.payment_status) ? 'due' : /receiv/i.test(r.payment_status) ? 'ok' : 'info'}`}>{r.payment_status}</span> : '') },
    { key: 'driver_allowance', label: 'Driver allowance', type: 'number', min: 0, width: 118, render: amt('driver_allowance') },
    { key: 'allowance_status', label: 'Allowance', type: 'select', options: ['Paid', 'Not paid'], width: 104, render: (r) => (r.allowance_status ? <span className={`tag ${/not/i.test(r.allowance_status) ? 'warn' : r.allowance_status === 'Paid' ? 'ok' : 'info'}`}>{r.allowance_status}</span> : '') },
    { key: 'diesel', label: 'Diesel with VAT', type: 'number', min: 0, width: 110, render: amt('diesel') },
    { key: 'diesel_vat', label: 'Diesel VAT 5%', type: 'calc', width: 110, render: (r) => (Number(r.diesel) ? <b className="col-vat-amt">{fmtAmt(dieselVat(r))}</b> : <span className="muted">–</span>), text: (r) => (Number(r.diesel) ? fmtAmt(dieselVat(r)) : ''), sortValue: (r) => dieselVat(r) },
    { key: 'diesel_net', label: 'Diesel without VAT', type: 'calc', width: 120, render: (r) => (Number(r.diesel) ? fmtAmt(dieselNet(r)) : <span className="muted">–</span>), text: (r) => (Number(r.diesel) ? fmtAmt(dieselNet(r)) : ''), sortValue: (r) => dieselNet(r) },
    { key: 'toll', label: 'Toll / other', type: 'number', min: 0, width: 100, render: amt('toll') },
    { key: 'maintenance', label: 'Maintenance', type: 'number', min: 0, width: 112, render: amt('maintenance') },
    { key: 'gate_pass', label: 'Gate pass', type: 'number', min: 0, width: 96, render: amt('gate_pass') },
    { key: 'exit_fee', label: 'Exit fee', type: 'number', min: 0, width: 92, render: amt('exit_fee') },
    { key: 'empty_border_fee', label: 'Empty container fee', type: 'number', min: 0, width: 140, render: amt('empty_border_fee') },
    { key: 'container_wash', label: 'Container wash', type: 'number', min: 0, width: 120, render: amt('container_wash') },
    { key: 'vehicle_wash', label: 'Vehicle wash', type: 'number', min: 0, width: 108, render: amt('vehicle_wash') },
    { key: 'remarks', label: 'Status', type: 'select', options: ['Completed', 'Loading', 'On the way', 'Done', 'Cancelled'], width: 116 },
    { key: 'credit_in', label: 'Payment credit in', type: 'select', options: ['Company Account', 'Mobile Payment'], width: 150 },
    { key: 'entered_by', label: 'Entered by', type: 'text', width: 120 }
  ];

  const footer = {
    driver_name: 'Total', entry_date: `${T.trips} trips`,
    rent: fmtAmt(T.rent), rent_net: fmtAmt(T.rent_net), vat: fmtAmt(T.vat), received: fmtAmt(T.received), balance: fmtAmt(T.balance),
    driver_allowance: fmtAmt(T.driver_allowance), diesel: fmtAmt(T.diesel), diesel_vat: fmtAmt(T.diesel_vat), diesel_net: fmtAmt(T.diesel_net),
    toll: fmtAmt(T.toll), maintenance: fmtAmt(T.maintenance), gate_pass: fmtAmt(T.gate_pass), exit_fee: fmtAmt(T.exit_fee),
    empty_border_fee: fmtAmt(T.empty_border_fee), container_wash: fmtAmt(T.container_wash), vehicle_wash: fmtAmt(T.vehicle_wash)
  };

  async function save(row, key, value) {
    let patch;
    if (key === 'driver_name') {
      const did = idOf[value];
      if (!did) { flash('Pick a driver', 'err'); return; }
      patch = { driver_id: did };
    } else patch = { [key]: NUM_KEYS.includes(key) ? (value ?? 0) : value };
    setEntries((list) => list.map((e) => (e.id === row.id ? { ...e, ...patch } : e)));
    const { data: fresh, error: err } = await sb().from('transport_entries').update(patch).eq('id', row.id).select().single();
    if (err) { flash(err.code === '42501' ? 'You cannot change this' : err.message, 'err'); load(); return; }
    if (fresh) setEntries((list) => list.map((e) => (e.id === row.id ? fresh : e)));
    if (key === 'driver_name') flash(`Trip moved to ${value}`);
    else if (key === 'entry_date' && month !== 'all' && monthKey(value) !== month) flash(`Moved to ${monthLabel(monthKey(value))}`);
    else flash('Saved');
  }

  async function addTrip(driver) {
    const date = month === 'all' || month === monthKey(todayISO()) ? todayISO() : monthStart(month);
    const sort = entries.filter((e) => e.driver_id === driver.id).reduce((m, e) => Math.max(m, e.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('transport_entries')
      .insert({ driver_id: driver.id, entry_date: date, sort, payment_status: 'Not Received', allowance_status: 'Not paid', remarks: 'Loading', entered_by: userName || null })
      .select().single();
    if (err) { flash(err.message, 'err'); return; }
    setAddOpen(false);
    setEntries((list) => [...list, data]);
    flash(`New trip added for ${driver.name}. Fill in the details.`);
  }

  async function confirmDelete() {
    const { error: err } = await sb().from('transport_entries').delete().eq('id', del.id);
    if (err) { flash(err.message, 'err'); return; }
    setEntries((list) => list.filter((e) => e.id !== del.id));
    setDel(null);
    flash('Trip deleted');
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const xcols = columns.map((c) => c.key);
      const val = (r, c) => {
        if (NUM_KEYS.includes(c.key)) return Number(r[c.key]) ? Number(r[c.key]) : '';
        if (c.key === 'rent_net') return Number(r.rent) ? rentNet(r) : '';
        if (c.key === 'vat') return vatOf(r) || '';
        if (c.key === 'balance') return num(Number(r.rent || 0) - Number(r.received || 0));
        if (c.key === 'diesel_vat') return Number(r.diesel) ? dieselVat(r) : '';
        if (c.key === 'diesel_net') return Number(r.diesel) ? dieselNet(r) : '';
        if (c.key === 'entry_date' || c.key === 'received_date') return dmy(r[c.key]);
        return r[c.key] ?? '';
      };
      const numCols = columns.map((c, i) => (c.type === 'number' || c.type === 'calc' ? i : -1)).filter((i) => i >= 0);
      const totalsRow = xcols.map((k, i) => (i === 0 ? 'Total' : i === 1 ? `${T.trips} trips` : (T[k] !== undefined && k !== 'trips' ? T[k] : '')));
      await exportExcel(`${pick === 'all' ? 'All drivers' : nameOf[pick]} combined sheet ${period}.xlsx`, [{
        name: 'Combined sheet', title: `${pick === 'all' ? 'All Drivers' : nameOf[pick]} Combined Sheet · ${period}`,
        subtitle: `${COMPANY_NAME} · Transport Division · ${shown.length} of ${rows.length} rows · Exported ${exportStamp()} · OMR`,
        head: columns.map((c) => c.label), rows: shown.map((r) => columns.map((c) => val(r, c))), totalsRow, numCols,
        widths: columns.map((c) => Math.max(10, Math.min(30, Math.round((c.width || 110) / 7))))
      }]);
      flash('Excel file downloaded');
    } catch { flash('Could not create the Excel file. Please try again.', 'err'); }
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/transport/trip-sheets" className="crumb">← All Drivers Trip Sheets</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="cmb-month">Month</label>
            <select id="cmb-month" value={month} onChange={(e) => { setMonth(e.target.value); setViewIds(null); }}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
          <button type="button" className="btn" onClick={doExcel}>📗 Excel</button>
          <Link href="/transport/trip-sheets" className="btn">📄 Trip sheets by driver</Link>
        </div>
      </div>

      <CompanyHeader title={pick === 'all' ? 'All Drivers Combined Sheet' : `${nameOf[pick]} · Combined Sheet`} detail={`Period: ${period}  |  ${pick === 'all' ? `${drivers.length} drivers` : `Driver: ${nameOf[pick]}`}  |  ${shown.length} of ${rows.length} rows shown  |  Currency: OMR`} />

      <div className="ats-chips no-print" role="group" aria-label="Choose driver">
        <button type="button" className={`rp-chip ${pick === 'all' ? 'active' : ''}`} onClick={() => { setPick('all'); setViewIds(null); }}>All drivers</button>
        {drivers.map((d) => (
          <button key={d.id} type="button" className={`rp-chip ${pick === d.id ? 'active' : ''}`} onClick={() => { setPick(d.id); setViewIds(null); }}>
            {d.name}{d.status === 'Inactive' ? ' (inactive)' : ''}
          </button>
        ))}
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Trips</span><strong>{T.trips}</strong><small>Rows shown</small></div>
        <div className="kpi"><span>Work amount</span><strong><Omr v={T.rent} /></strong><small>With VAT</small></div>
        <div className="kpi"><span>Received</span><strong><Omr v={T.received} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Balance to collect</span><strong className="neg"><Omr v={T.balance} /></strong><small>Rent − received</small></div>
        <div className="kpi"><span>Diesel</span><strong><Omr v={T.diesel} /></strong><small>With VAT</small></div>
        <div className="kpi"><span>Driver allowance</span><strong><Omr v={T.driver_allowance} /></strong><small>OMR</small></div>
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>🚚 {pick === 'all' ? 'Trips of all drivers' : `Trips of ${nameOf[pick]}`} <small className="muted">· ▾ on a column to filter or sort · drag a column edge to change its width</small></h2>
        </div>
        <DataGrid
          columns={columns}
          rows={rows}
          filters
          onView={onView}
          canEdit={canChange}
          onSave={save}
          onAdd={() => setAddOpen(true)}
          addLabel="+ Add new trip"
          onDelete={canDelete ? (r) => setDel(r) : undefined}
          footer={footer}
          flash={flash}
          emptyText={`No trips in ${period}.`}
        />
      </section>

      {addOpen && (
        <Modal title="New trip: which driver?" onClose={() => setAddOpen(false)}>
          <div className="ats-presets">
            {drivers.map((d) => (
              <button key={d.id} type="button" className="rp-chip" onClick={() => addTrip(d)}>
                {d.name}{d.vehicle_no ? ` · ${d.vehicle_no}` : ''}{d.status === 'Inactive' ? ' (inactive)' : ''}
              </button>
            ))}
          </div>
          <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setAddOpen(false)}>Cancel</button></div>
        </Modal>
      )}
      {del && (
        <Modal title="Delete this trip?" onClose={() => setDel(null)}>
          <p>{nameOf[del.driver_id]} · {dmy(del.entry_date)} · {del.from_place || ''}{del.to_place ? ` → ${del.to_place}` : ''}{Number(del.rent) ? ` · ${fmtAmt(del.rent)}` : ''}</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={confirmDelete}>🗑 Delete</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><Combined /></AuthGate>;
}
