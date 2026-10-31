'use client';

import { useEffect, useState } from 'react';
import DateInput from '@/components/DateInput';
import TripFiles from '@/components/TripFiles';
import { sb } from '@/lib/supabase';
import { fmtAmt } from '@/lib/sheet';

/*
  One trip on the driver form (/entry).
  Part 1 "Trip (driver fills)": Date, From, To, Total rent, Driver allowance, and the costs, each with an amount and "⋯ More" papers:
     Diesel, Toll / others, Gate pass, Exit fee, Empty container fee at the border, Container wash, Vehicle wash, + Delivery order (papers only).
     Saved through database function driver_save_trip (drivers cannot touch the office fields).
  Part 2 "Office (Administrator only)": greyed out and locked for drivers; full control for Administrator / Full access
     (Received, Received on, Payment, Driver allowance status, VAT 5% added, Maintenance, Description, Trip status, Payment credit in).
  ✅ Trip complete (middle, bottom): driver or office. Uploading a Delivery order shows a reminder to press it.
  After complete the driver cannot change the trip; the office can (and can Open it again).
  Box names: label(key) from lib/entryLabels.js; the Administrator renames them with ✏️ Rename boxes (renaming = true).
*/

export const COSTS = ['diesel', 'toll', 'gate_pass', 'exit_fee', 'empty_border_fee', 'container_wash', 'vehicle_wash'];
const FILE_KIND = { empty_border_fee: 'empty_border' };
const kindOf = (k) => FILE_KIND[k] || k;
const DRIVER_KEYS = ['entry_date', 'from_place', 'to_place', 'rent', 'driver_allowance', ...COSTS];
const OFFICE_KEYS = ['received', 'received_date', 'payment_status', 'allowance_status', 'vat_included', 'maintenance', 'description', 'remarks', 'credit_in'];
const todayMuscat = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const numText = (v) => (Number(v) ? String(Number(v)) : '');

function fromTrip(t, driverId) {
  const f = { driver_id: driverId };
  DRIVER_KEYS.forEach((k) => { f[k] = k === 'entry_date' ? (t?.entry_date || todayMuscat()) : ['from_place', 'to_place'].includes(k) ? (t?.[k] || '') : numText(t?.[k]); });
  OFFICE_KEYS.forEach((k) => { f[k] = k === 'vat_included' ? !!t?.vat_included : ['received', 'maintenance'].includes(k) ? numText(t?.[k]) : (t?.[k] || ''); });
  return f;
}

function Label({ k, label, renaming, rename, flash }) {
  const [t, setT] = useState(label(k));
  useEffect(() => { setT(label(k)); }, [label, k]);
  if (!renaming) return <>{label(k)}</>;
  return (
    <input className="dtf-rename" value={t} onChange={(e) => setT(e.target.value)} aria-label={`Rename ${label(k)}`}
      onBlur={async () => { const err = await rename(k, t); if (err) flash(err, 'err'); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export default function DriverTripForm({ driver, trip, isOffice, label, rename, renaming, flash, onSaved, onClose }) {
  const [f, setF] = useState(() => fromTrip(trip, driver.id));
  const [id, setId] = useState(trip?.id || null);
  const [att, setAtt] = useState(trip?.attachments || {});
  const [done, setDone] = useState({ on: !!trip?.trip_completed, at: trip?.completed_at, by: trip?.completed_by });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const locked = done.on && !isOffice;
  const L = (k) => <Label k={k} label={label} renaming={renaming} rename={rename} flash={flash} />;
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setDirty(true); };
  const costs = COSTS.reduce((t, k) => t + (Number(f[k]) || 0), 0);
  const hasDO = (att.delivery_order || []).some((x) => !x.deleted_at);

  async function saveDriverPart() {
    const data = {};
    DRIVER_KEYS.forEach((k) => { data[k] = f[k]; });
    data.driver_id = driver.id;
    const { data: newId, error } = await sb().rpc('driver_save_trip', { p_id: id, p_data: data });
    if (error) { flash(error.message, 'err'); return null; }
    if (!id) setId(newId);
    return newId;
  }
  async function saveOfficePart(tid) {
    const patch = {};
    OFFICE_KEYS.forEach((k) => {
      const v = f[k];
      patch[k] = k === 'vat_included' ? !!v : ['received', 'maintenance'].includes(k) ? (Number(v) || 0) : (v === '' ? null : v);
    });
    const { error } = await sb().from('transport_entries').update(patch).eq('id', tid);
    if (error) { flash(error.message, 'err'); return false; }
    return true;
  }
  async function save(quiet) {
    setBusy(true);
    const tid = await saveDriverPart();
    let ok = !!tid;
    if (tid && isOffice) ok = await saveOfficePart(tid);
    setBusy(false);
    if (ok) { setDirty(false); if (!quiet) flash('Trip saved'); onSaved?.(); }
    return ok ? tid : null;
  }
  // a paper needs a saved trip: save first (keeps what is typed)
  const ensureTrip = async () => { if (id && !dirty) return id; return save(true); };

  async function complete(on) {
    if (on && !(f.from_place || f.to_place)) { flash('Write From and To first', 'err'); return; }
    const tid = locked ? id : await save(true);
    if (!tid) return;
    const { error } = await sb().rpc('trip_complete', { p_id: tid, p_done: on });
    if (error) { flash(error.message, 'err'); return; }
    setDone(on ? { on: true, at: new Date().toISOString(), by: 'you' } : { on: false });
    flash(on ? '✅ Trip completed' : 'Trip opened again');
    onSaved?.();
  }

  const money = (k, extra) => (
    <div className={`dtf-field${extra ? ' cost' : ''}`} key={k}>
      <label>{L(k)}</label>
      <div className="dtf-row">
        <input inputMode="decimal" value={f[k]} disabled={locked} placeholder="0.000" onChange={(e) => set(k, e.target.value.replace(/[^\d.]/g, ''))} />
        {extra && <TripFiles kind={kindOf(k)} label={label(k)} tripId={id} files={att[kindOf(k)] || []} locked={done.on} isOffice={isOffice}
          ensureTrip={ensureTrip} onChange={(tid, a) => { if (!id) setId(tid); setAtt(a || {}); }} flash={flash} />}
      </div>
    </div>
  );

  return (
    <div className="dtf">
      <div className="dtf-top">
        <h2>🚚 {driver.name}{driver.vehicle_no ? <small> · {driver.vehicle_no}</small> : null}</h2>
        <span className={`tag ${done.on ? 'ok' : 'warn'}`}>{done.on ? '✅ Completed' : id ? 'Open trip' : 'New trip'}</span>
        {onClose && <button type="button" className="btn small ghost" onClick={onClose}>← Trips</button>}
      </div>

      <fieldset className={`dtf-part${locked ? ' locked' : ''}`}>
        <legend>{L('_driver_part')}</legend>
        <div className="dtf-grid">
          <div className="dtf-field"><label>{L('entry_date')}</label><span className={locked ? 'dtf-off' : ''}><DateInput value={f.entry_date} onChange={(iso) => set('entry_date', iso)} /></span></div>
          <div className="dtf-field"><label>{L('from_place')}</label><input value={f.from_place} disabled={locked} onChange={(e) => set('from_place', e.target.value)} placeholder="e.g. Sohar" /></div>
          <div className="dtf-field"><label>{L('to_place')}</label><input value={f.to_place} disabled={locked} onChange={(e) => set('to_place', e.target.value)} placeholder="e.g. Jabal Ali" /></div>
          {money('rent')}
          {money('driver_allowance')}
        </div>
        <div className="dtf-grid costs">
          {COSTS.map((k) => money(k, true))}
          <div className="dtf-field cost do">
            <label>{L('delivery_order')}</label>
            <div className="dtf-row">
              <span className="dtf-do-note">{hasDO ? '📄 Uploaded' : 'Upload the delivery order receipt'}</span>
              <TripFiles kind="delivery_order" label={label('delivery_order')} tripId={id} files={att.delivery_order || []} locked={done.on} isOffice={isOffice}
                ensureTrip={ensureTrip} onChange={(tid, a) => { if (!id) setId(tid); setAtt(a || {}); }} flash={flash} />
            </div>
          </div>
        </div>
        <p className="dtf-sum">Costs total: <b>{fmtAmt(costs)}</b> OMR</p>
      </fieldset>

      <fieldset className={`dtf-part office${isOffice ? '' : ' grey'}`} disabled={!isOffice}>
        <legend>🔒 {L('_office_part')}</legend>
        {!isOffice && <p className="dtf-lock">Only the office fills this part.</p>}
        <div className="dtf-grid">
          <div className="dtf-field"><label>{L('received')}</label><input inputMode="decimal" value={f.received} onChange={(e) => set('received', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.000" /></div>
          <div className="dtf-field"><label>{L('received_date')}</label><DateInput value={f.received_date} onChange={(iso) => set('received_date', iso)} /></div>
          <div className="dtf-field"><label>{L('payment_status')}</label>
            <select value={f.payment_status} onChange={(e) => set('payment_status', e.target.value)}><option value="">–</option><option>Received</option><option>Not Received</option><option>Partly received</option></select></div>
          <div className="dtf-field"><label>{L('allowance_status')}</label>
            <select value={f.allowance_status} onChange={(e) => set('allowance_status', e.target.value)}><option value="">–</option><option>Paid</option><option>Not paid</option></select></div>
          <div className="dtf-field"><label>{L('maintenance')}</label><input inputMode="decimal" value={f.maintenance} onChange={(e) => set('maintenance', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.000" /></div>
          <div className="dtf-field"><label>{L('remarks')}</label>
            <select value={f.remarks} onChange={(e) => set('remarks', e.target.value)}><option value="">–</option><option>Loading</option><option>On the way</option><option>Completed</option><option>Done</option><option>Cancelled</option></select></div>
          <div className="dtf-field"><label>{L('credit_in')}</label><input value={f.credit_in} onChange={(e) => set('credit_in', e.target.value)} /></div>
          <div className="dtf-field check"><label><input type="checkbox" checked={!!f.vat_included} onChange={(e) => set('vat_included', e.target.checked)} /> {L('vat_included')}</label></div>
          <div className="dtf-field wide"><label>{L('description')}</label><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
        </div>
      </fieldset>

      <div className="dtf-actions">
        {!locked && <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving...' : '💾 Save'}</button>}
      </div>

      {hasDO && !done.on && <div className="dtf-hint">📄 Delivery order is uploaded. If the trip is finished, press <b>Trip complete</b>.</div>}
      <div className="dtf-complete">
        {done.on ? (
          <>
            <div className="dtf-done">✅ Trip completed{done.by ? ` by ${done.by}` : ''}{done.at ? ` · ${new Date(done.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
            {isOffice && <button type="button" className="btn ghost" onClick={() => complete(false)}>↺ Open this trip again</button>}
          </>
        ) : (
          <button type="button" className="dtf-big" onClick={() => complete(true)} disabled={busy}>✅ Trip complete</button>
        )}
      </div>
    </div>
  );
}
