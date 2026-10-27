'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, fmtDay, fmtFullDate, monthKey, monthLabel, monthStart, todayISO, exportStamp, exportExcel, exportPdf } from '@/lib/sheet';
import Omr from '@/components/Omr';

const NUM_KEYS = ['rent', 'received', 'driver_allowance', 'diesel', 'toll', 'maintenance'];

function DriverSheet() {
  const { id } = useParams();
  const { isAdmin } = useUser();
  const [driver, setDriver] = useState(null);
  const [entries, setEntries] = useState([]);
  const [month, setMonth] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [del, setDel] = useState(null);
  const [error, setError] = useState('');
  const toastTimer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, e] = await Promise.all([
      s.from('transport_drivers').select('*').eq('id', id).single(),
      s.from('transport_entries').select('*').eq('driver_id', id).order('entry_date').order('sort').order('created_at')
    ]);
    if (d.error) { setError('This driver was not found.'); return; }
    setDriver(d.data);
    setEntries(e.data || []);
    setMonth((m) => {
      if (m) return m;
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      return keys[keys.length - 1] || monthKey(todayISO());
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const set = new Set([...entries.map((x) => monthKey(x.entry_date)), monthKey(todayISO())]);
    return [...set].filter(Boolean).sort().reverse();
  }, [entries]);

  const rows = useMemo(
    () => entries
      .filter((e) => month === 'all' || monthKey(e.entry_date) === month)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : (a.sort || 0) - (b.sort || 0))),
    [entries, month]
  );

  const sum = (k) => num(rows.reduce((t, e) => t + Number(e[k] || 0), 0));
  const totals = {
    trips: rows.filter((e) => Number(e.rent) > 0).length,
    rent: sum('rent'), received: sum('received'), driver_allowance: sum('driver_allowance'),
    diesel: sum('diesel'), toll: sum('toll'), maintenance: sum('maintenance')
  };
  totals.balance = num(totals.rent - totals.received);
  totals.costs = num(totals.diesel + totals.toll + totals.maintenance);
  totals.net = num(totals.rent - totals.costs);

  /* ---------- Saving ---------- */

  async function save(row, key, value) {
    const patch = { [key]: NUM_KEYS.includes(key) ? (value ?? 0) : value };
    setEntries((list) => list.map((e) => (e.id === row.id ? { ...e, ...patch } : e)));
    const { data: fresh, error: err } = await sb().from('transport_entries').update(patch).eq('id', row.id).select().single();
    if (err) { flash(err.code === '42501' ? 'Only Administrator can edit' : err.message, 'err'); load(); return; }
    if (fresh) setEntries((list) => list.map((e) => (e.id === row.id ? fresh : e)));
    if (key === 'entry_date' && monthKey(value) !== month && month !== 'all') flash(`Moved to ${monthLabel(monthKey(value))}`);
    else flash('Saved');
  }

  async function addRow() {
    const date = month === 'all' || month === monthKey(todayISO()) ? todayISO() : monthStart(month);
    const sort = entries.reduce((m, e) => Math.max(m, e.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('transport_entries')
      .insert({ driver_id: id, entry_date: date, sort, payment_status: 'Not Received', allowance_status: 'Not paid', remarks: 'Loading' })
      .select().single();
    if (err) { flash(err.message, 'err'); return; }
    setEntries((list) => [...list, data]);
    flash('New row added. Fill in the trip details.');
  }

  async function confirmDelete() {
    const { error: err } = await sb().from('transport_entries').delete().eq('id', del.id);
    if (err) { flash(err.message, 'err'); return; }
    setEntries((list) => list.filter((e) => e.id !== del.id));
    setDel(null);
    flash('Row deleted');
  }

  /* ---------- Columns ---------- */

  const amt = (k) => (r) => (Number(r[k]) ? fmtAmt(r[k]) : <span className="muted">–</span>);
  const columns = [
    { key: 'entry_date', label: 'Date', type: 'date', width: 104, render: (r) => fmtDay(r.entry_date) },
    { key: 'from_place', label: 'From', type: 'text', width: 130 },
    { key: 'to_place', label: 'To', type: 'text', width: 170, render: (r) => r.to_place || (r.description ? <em className="muted">{r.description}</em> : '') },
    { key: 'rent', label: 'Total rent', type: 'number', min: 0, width: 104, render: amt('rent') },
    { key: 'received', label: 'Received', type: 'number', min: 0, width: 104, render: amt('received') },
    { key: 'received_date', label: 'Received on', type: 'date', width: 108, render: (r) => (r.received_date ? <span className={r.received_date !== r.entry_date ? 'late-pay' : ''}>{fmtDay(r.received_date)}</span> : <span className="muted">–</span>) },
    {
      key: 'balance', label: 'Balance', type: 'calc', width: 96,
      render: (r) => { const b = num(Number(r.rent || 0) - Number(r.received || 0)); return b ? <span className={b > 0 ? 'neg' : 'pos'}>{fmtAmt(b)}</span> : <span className="muted">0</span>; }
    },
    { key: 'payment_status', label: 'Payment', type: 'select', options: ['Received', 'Not Received', 'Partly received'], width: 132, render: (r) => r.payment_status ? <span className={`tag ${/not/i.test(r.payment_status) ? 'due' : /receiv/i.test(r.payment_status) ? 'ok' : 'info'}`}>{r.payment_status}</span> : '' },
    { key: 'driver_allowance', label: 'Driver allowance', type: 'number', min: 0, width: 118, render: amt('driver_allowance') },
    { key: 'allowance_status', label: 'Allowance', type: 'select', options: ['Paid', 'Not paid'], width: 104, render: (r) => r.allowance_status ? <span className={`tag ${/not/i.test(r.allowance_status) ? 'warn' : r.allowance_status === 'Paid' ? 'ok' : 'info'}`}>{r.allowance_status}</span> : '' },
    { key: 'diesel', label: 'Diesel', type: 'number', min: 0, width: 92, render: amt('diesel') },
    { key: 'toll', label: 'Toll / other', type: 'number', min: 0, width: 100, render: amt('toll') },
    { key: 'maintenance', label: 'Maintenance', type: 'number', min: 0, width: 112, render: amt('maintenance') },
    { key: 'description', label: 'Description', type: 'text', width: 200 },
    { key: 'cargo', label: 'Cargo detail', type: 'text', width: 130 },
    { key: 'consignee', label: 'Consignee', type: 'text', width: 120 },
    { key: 'remarks', label: 'Status', type: 'select', options: ['Completed', 'Loading', 'On the way', 'Done', 'Cancelled'], width: 116 },
    { key: 'credit_in', label: 'Payment credit in', type: 'text', width: 140 },
    { key: 'entered_by', label: 'Entered by', type: 'text', width: 120 }
  ];

  /* ---------- Export ---------- */

  function tableData() {
    const head = ['Date', 'From', 'To', 'Description', 'Cargo', 'Consignee', 'Rent', 'Received', 'Received on', 'Balance', 'Payment', 'Driver allow.', 'Allowance', 'Diesel', 'Toll/other', 'Maint.', 'Status', 'Credit in', 'Entered by'];
    const data = rows.map((r) => [
      fmtFullDate(r.entry_date), r.from_place || '', r.to_place || '', r.description || '', r.cargo || '', r.consignee || '',
      num(r.rent), num(r.received), r.received_date ? fmtFullDate(r.received_date) : '', num(Number(r.rent || 0) - Number(r.received || 0)), r.payment_status || '',
      num(r.driver_allowance), r.allowance_status || '', num(r.diesel), num(r.toll), num(r.maintenance), r.remarks || '', r.credit_in || '', r.entered_by || ''
    ]);
    const totalsRow = ['Total', `${totals.trips} trips`, '', '', '', '', totals.rent, totals.received, '', totals.balance, '', totals.driver_allowance, '', totals.diesel, totals.toll, totals.maintenance, '', '', ''];
    return { head, data, totalsRow, numCols: [6, 7, 9, 11, 13, 14, 15] };
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const t = tableData();
      await exportExcel(`${driver.name} ${monthLabel(month)}.xlsx`, [{
        name: driver.name, title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''} · ${monthLabel(month)}`,
        subtitle: `${COMPANY_NAME} · Transport Division · Exported ${exportStamp()} · OMR`,
        head: t.head, rows: t.data, numCols: t.numCols, totalsRow: t.totalsRow,
        widths: [13, 14, 18, 26, 14, 14, 10, 10, 10, 14, 11, 11, 9, 10, 10, 12, 14]
      }]);
      flash('Excel file downloaded');
    } catch {
      flash('Could not create the Excel file. Please try again.', 'err');
    }
  }

  async function doPdf() {
    try {
      flash('Preparing PDF...');
      const t = tableData();
      const keep = [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16];
      const pick = (r) => keep.map((i) => (t.numCols.includes(i) && typeof r[i] === 'number' ? fmtAmt(r[i]) : r[i]));
      await exportPdf(`${driver.name} ${monthLabel(month)}.pdf`, {
        title: `${driver.name} · Vehicle # ${driver.vehicle_no || ''}`,
        subtitle: `${COMPANY_NAME} · Transport Division  |  ${monthLabel(month)}  |  Exported ${exportStamp()}  |  OMR`,
        sections: [{
          head: keep.map((i) => t.head[i]), rows: t.data.map(pick), totalsRow: pick(t.totalsRow),
          numCols: keep.map((i, j) => (t.numCols.includes(i) ? j : -1)).filter((j) => j >= 0)
        }, {
          heading: 'Totals',
          head: ['Trips', 'Work amount', 'Received', 'Balance', 'Diesel', 'Toll / other', 'Maintenance', 'Net (before salary)'],
          rows: [[totals.trips, fmtAmt(totals.rent), fmtAmt(totals.received), fmtAmt(totals.balance), fmtAmt(totals.diesel), fmtAmt(totals.toll), fmtAmt(totals.maintenance), fmtAmt(totals.net)]],
          numCols: [0, 1, 2, 3, 4, 5, 6, 7], fontSize: 10
        }]
      });
      flash('PDF downloaded');
    } catch {
      flash('Could not create the PDF. Please try again.', 'err');
    }
  }

  /* ---------- Render ---------- */

  if (error) return <div className="error">{error} <Link href="/transport">Back to Transport</Link></div>;
  if (!driver || !month) return <div className="loading">Loading trip sheet...</div>;

  return (
    <>
      <div className="page-tools">
        <Link href="/transport" className="crumb">← Transport</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="month">Month</label>
            <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          {isAdmin && (
            <button type="button" className={`btn ${editMode ? 'in' : ''}`} onClick={() => setEditMode((v) => !v)} aria-pressed={editMode}>
              {editMode ? '✓ Done editing' : 'Edit'}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
          <button type="button" className="btn ghost" onClick={doPdf}>Export PDF</button>
        </div>
      </div>

      <CompanyHeader title={`${driver.name} · Trip sheet`} detail={`Driver: ${driver.name}  |  Vehicle # ${driver.vehicle_no || '–'}  |  ${monthLabel(month)}`} />

      <div className="kpi-row">
        <div className="kpi"><span>Trips</span><strong>{totals.trips}</strong><small>{monthLabel(month)}</small></div>
        <div className="kpi"><span>Work amount</span><strong><Omr v={totals.rent} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Balance to collect</span><strong className={totals.balance > 0 ? 'neg' : ''}><Omr v={totals.balance} /></strong><small>Rent − received</small></div>
        <div className="kpi"><span>Trip costs</span><strong><Omr v={totals.costs} /></strong><small>Diesel, toll, maintenance</small></div>
        <div className="kpi hero"><span>Net before salary</span><strong><Omr v={totals.net} /></strong><small>OMR</small></div>
      </div>

      <section className={`sheet ${editMode ? 'is-editing' : ''}`}>
        {editMode && (
          <div className="edit-banner">
            Edit mode is on. Click any cell to change it, then press Enter. Amounts accept maths like 25+4. Click <strong>Done editing</strong> when finished.
          </div>
        )}
        <DataGrid
          columns={columns}
          rows={rows}
          canEdit={canChange}
          onSave={save}
          onAdd={addRow}
          addLabel="+ Add trip or expense"
          onDelete={(r) => setDel(r)}
          rowClass={(r) => (Number(r.rent) === 0 && Number(r.maintenance) > 0 ? 'expense-row' : Number(r.rent) > Number(r.received) ? 'due-row' : '')}
          emptyText="No trips in this month."
          footer={{
            entry_date: `${totals.trips} trips`,
            rent: fmtAmt(totals.rent), received: fmtAmt(totals.received),
            balance: <span className={totals.balance > 0 ? 'neg' : ''}>{fmtAmt(totals.balance)}</span>,
            driver_allowance: fmtAmt(totals.driver_allowance), diesel: fmtAmt(totals.diesel),
            toll: fmtAmt(totals.toll), maintenance: fmtAmt(totals.maintenance)
          }}
          flash={flash}
        />
        <p className="sheet-hint">
          Red mark: money still to collect. Amber mark: maintenance or other expense without a trip. All amounts in OMR.
          {!isAdmin && ' View only.'}
        </p>
      </section>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}

      {del && (
        <Modal title="Delete row?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>
            Delete the {fmtFullDate(del.entry_date)} row
            {del.to_place ? ` (${del.from_place || ''} → ${del.to_place})` : del.description ? ` (${del.description})` : ''}?
          </p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DriverSheet /></AuthGate>;
}
