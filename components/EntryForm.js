'use client';

import { useEffect, useRef, useState } from 'react';
import { evaluate, todayISO, fmtFullDate } from '@/lib/sheet';
import { useShare } from '@/components/ShareModal';
import DateInput from '@/components/DateInput';

const BLANK = {
  kind: 'trip', driver_id: '', entry_date: '', from_place: '', to_place: '', rent: '', received: '',
  payment_status: 'Not Received', driver_allowance: '', allowance_status: 'Not paid', diesel: '', toll: '', maintenance: '',
  description: '', cargo: '', consignee: '', remarks: 'Completed', credit_in: ''
};
const NUMS = ['rent', 'received', 'driver_allowance', 'diesel', 'toll', 'maintenance'];

/*
  Transport entry form. Used by the logged-in Data entry page and by the public share link.
  props:
    drivers: [{ id, name, vehicle_no }]
    lockedDriverId: driver fixed by the link (dropdown hidden)
    defaultDriverId: driver picked at start
    askName: show "Your name" (public link)
    enteredBy: name used in the share message when askName is false
    onSubmit(row) -> Promise<string|null>  (error message or null)
    driverExtra: node shown under the driver dropdown (e.g. "+ Add a new driver")
*/
export default function EntryForm({ drivers, lockedDriverId = null, defaultDriverId = '', askName: askNameProp = false, enteredBy = '', onSubmit, driverExtra = null, intro, driverMode = false }) {
  /* driverMode (share links /f/<token>, 31 Oct 2026): "Expense only" and the Details boxes are office only, so greyed out
     (Status stays usable); a link made for one driver needs no "Your name": the driver's name is used. */
  const linkDriver = lockedDriverId ? drivers.find((d) => d.id === lockedDriverId) : null;
  const askName = askNameProp && !(driverMode && linkDriver);
  const [f, setF] = useState({ ...BLANK, entry_date: todayISO(), driver_id: lockedDriverId || defaultDriverId || '' });
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const topRef = useRef(null);
  const { open: openShare, modal: shareModal } = useShare();

  useEffect(() => {
    if (lockedDriverId) setF((x) => ({ ...x, driver_id: lockedDriverId }));
    else if (defaultDriverId) setF((x) => (x.driver_id ? x : { ...x, driver_id: defaultDriverId }));
  }, [lockedDriverId, defaultDriverId]);

  useEffect(() => {
    if (!askName) return;
    try { setName(localStorage.getItem('entry-name') || ''); } catch { /* ignore */ }
  }, [askName]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const numberOf = (k) => { const v = evaluate(f[k]); return v === null || Number.isNaN(v) ? 0 : v; };
  const isTrip = f.kind === 'trip';
  const balance = Math.max(0, numberOf('rent') - numberOf('received'));
  const lockedDriver = lockedDriverId ? drivers.find((d) => d.id === lockedDriverId) : null;

  async function save(e) {
    e.preventDefault();
    setError('');
    if (askName && name.trim().length < 2) { setError('Write your name.'); return; }
    if (!f.driver_id) { setError('Choose the driver.'); return; }
    if (!f.entry_date) { setError('Choose the date.'); return; }
    for (const k of NUMS) {
      const v = evaluate(f[k]);
      if (Number.isNaN(v) || (v !== null && v < 0)) { setError(`Check the amount in "${k.replace('_', ' ')}". Use numbers only, e.g. 45 or 20+25.`); return; }
    }
    if (isTrip && (!f.from_place.trim() || !f.to_place.trim())) { setError('Enter where the trip is from and to.'); return; }
    if (isTrip && numberOf('rent') <= 0) { setError('Enter the total rent for the trip.'); return; }
    if (!isTrip && numberOf('maintenance') + numberOf('diesel') + numberOf('toll') <= 0) { setError('Enter the expense amount.'); return; }
    if (!isTrip && !f.description.trim()) { setError('Write what the expense was for, e.g. Oil filter change.'); return; }

    const row = {
      driver_id: f.driver_id,
      entry_date: f.entry_date,
      from_place: isTrip ? f.from_place.trim() : null,
      to_place: isTrip ? f.to_place.trim() : null,
      rent: isTrip ? numberOf('rent') : 0,
      received: isTrip ? numberOf('received') : 0,
      payment_status: isTrip ? f.payment_status : null,
      driver_allowance: isTrip ? numberOf('driver_allowance') : 0,
      allowance_status: isTrip ? f.allowance_status : null,
      diesel: numberOf('diesel'),
      toll: numberOf('toll'),
      maintenance: numberOf('maintenance'),
      description: f.description.trim() || null,
      cargo: f.cargo.trim() || null,
      consignee: f.consignee.trim() || null,
      remarks: f.remarks || null,
      credit_in: f.credit_in.trim() || null,
      entered_by: askName ? name.trim() : (driverMode && linkDriver ? linkDriver.name : (enteredBy || null))
    };
    setBusy(true);
    const err = await onSubmit(row);
    setBusy(false);
    if (err) { setError(err); return; }
    if (askName) { try { localStorage.setItem('entry-name', name.trim()); } catch { /* ignore */ } }

    const driver = drivers.find((d) => d.id === f.driver_id)?.name || '';
    const money = (v) => `${Number(v).toFixed(3)} OMR`;
    const text = [
      `${isTrip ? 'Trip' : 'Expense'} entry saved`,
      `Driver: ${driver}`,
      `Date: ${fmtFullDate(f.entry_date)}`,
      isTrip ? `Route: ${row.from_place} to ${row.to_place}` : `For: ${row.description}`,
      isTrip ? `Rent: ${money(row.rent)}` : null,
      isTrip ? `Received: ${money(row.received)}` : null,
      row.diesel ? `Diesel: ${money(row.diesel)}` : null,
      row.toll ? `Toll: ${money(row.toll)}` : null,
      row.maintenance ? `Maintenance: ${money(row.maintenance)}` : null,
      row.entered_by ? `Entered by: ${row.entered_by}` : null
    ].filter(Boolean).join('\n');
    setSaved({ driver, date: f.entry_date, what: isTrip ? `${row.from_place} → ${row.to_place}` : row.description, text });
    setCount((c) => c + 1);
    setF({ ...BLANK, entry_date: todayISO(), kind: f.kind, driver_id: lockedDriverId || defaultDriverId || '' });
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <div className="entry-head" ref={topRef}>
        <div>
          <h1>Transport data entry</h1>
          <p className="sub">{intro || 'Fill in one trip or expense and press Save. The form clears for the next one.'}</p>
        </div>
        <div className="entry-count"><strong>{count}</strong><span>saved now</span></div>
      </div>

      {saved && (
        <div className="entry-saved" role="status">
          <span className="entry-tick" aria-hidden="true">✓</span>
          <div>
            <b>Saved.</b> {saved.driver} · {fmtFullDate(saved.date)} · {saved.what}
            <div className="note">The form is ready for the next entry.</div>
          </div>
          <button type="button" className="btn small wa-btn" onClick={() => openShare({ title: 'Transport entry', text: saved.text })}>Share entry</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}

      <form className="entry-card" onSubmit={save} noValidate>
        <div className="entry-kind" role="radiogroup" aria-label="Entry type">
          {[['trip', '🚚 Trip'], ['expense', '🔧 Expense only']].map(([k, l]) => (
            <label key={k} className={`rp-chip ${f.kind === k ? 'active' : ''}${driverMode && k === 'expense' ? ' ef-off' : ''}`} title={driverMode && k === 'expense' ? 'Office only' : undefined}>
              <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={set('kind')} className="sr-only" disabled={driverMode && k === 'expense'} />{l}{driverMode && k === 'expense' ? ' 🔒' : ''}
            </label>
          ))}
        </div>

        <fieldset>
          <legend>{askName ? 'Who and when' : 'Driver and date'}</legend>
          {askName && (
            <div className="field">
              <label htmlFor="e-name">Your name *</label>
              <input id="e-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Saif" autoComplete="name" />
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <label htmlFor="e-driver">Driver *</label>
              {lockedDriver ? (
                <div className="locked-driver">{lockedDriver.name}{lockedDriver.vehicle_no ? ` (${lockedDriver.vehicle_no})` : ''}</div>
              ) : (
                <select id="e-driver" value={f.driver_id} onChange={set('driver_id')} required>
                  <option value="">Choose driver</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle_no ? ` (${d.vehicle_no})` : ''}</option>)}
                </select>
              )}
              {driverExtra}
            </div>
            <div className="field narrow" style={{ flex: '0 1 180px' }}>
              <label htmlFor="e-date">Date *</label>
              <DateInput id="e-date" value={f.entry_date} onChange={(v) => setF((x) => ({ ...x, entry_date: v }))} required />
            </div>
          </div>
        </fieldset>

        {isTrip && (
          <fieldset>
            <legend>Trip</legend>
            <div className="form-row">
              <div className="field"><label htmlFor="e-from">From *</label><input id="e-from" value={f.from_place} onChange={set('from_place')} placeholder="e.g. Sohar" /></div>
              <div className="field"><label htmlFor="e-to">To *</label><input id="e-to" value={f.to_place} onChange={set('to_place')} placeholder="e.g. Jabal Ali" /></div>
            </div>
            <div className="form-row">
              <div className="field"><label htmlFor="e-rent">Total rent (OMR) *</label><input id="e-rent" inputMode="decimal" value={f.rent} onChange={set('rent')} placeholder="0" /></div>
              <div className="field"><label htmlFor="e-rec">Received (OMR)</label><input id="e-rec" inputMode="decimal" value={f.received} onChange={set('received')} placeholder="0" /></div>
              <div className="field">
                <label htmlFor="e-pay">Payment</label>
                <select id="e-pay" value={f.payment_status} onChange={set('payment_status')}>
                  <option>Not Received</option><option>Partly received</option><option>Received</option>
                </select>
              </div>
            </div>
            {numberOf('rent') > 0 && <p className="note">Balance to collect: <b>{balance.toFixed(3)} OMR</b></p>}
            <div className="form-row">
              <div className="field"><label htmlFor="e-allow">Driver allowance (OMR)</label><input id="e-allow" inputMode="decimal" value={f.driver_allowance} onChange={set('driver_allowance')} placeholder="0" /></div>
              <div className="field">
                <label htmlFor="e-allows">Allowance paid?</label>
                <select id="e-allows" value={f.allowance_status} onChange={set('allowance_status')}><option>Not paid</option><option>Paid</option></select>
              </div>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>{isTrip ? 'Trip expenses' : 'Expense'}</legend>
          <div className="form-row">
            <div className="field"><label htmlFor="e-diesel">Diesel (OMR)</label><input id="e-diesel" inputMode="decimal" value={f.diesel} onChange={set('diesel')} placeholder="0" /></div>
            <div className="field"><label htmlFor="e-toll">Toll / other (OMR)</label><input id="e-toll" inputMode="decimal" value={f.toll} onChange={set('toll')} placeholder="0" /></div>
            <div className="field"><label htmlFor="e-maint">Maintenance (OMR)</label><input id="e-maint" inputMode="decimal" value={f.maintenance} onChange={set('maintenance')} placeholder="0" /></div>
          </div>
          <p className="note">You can type maths, e.g. 25+46+53.</p>
        </fieldset>

        <fieldset className={driverMode ? 'ef-details-locked' : ''}>
          <legend>Details{driverMode ? ' (office fills, except Status)' : ''}</legend>
          <div className="field">
            <label htmlFor="e-desc">{isTrip ? 'Description' : 'What was the expense for? *'}</label>
            <input id="e-desc" disabled={driverMode} value={f.description} onChange={set('description')} placeholder={isTrip ? 'Optional' : 'e.g. Oil filter change'} />
          </div>
          {isTrip && (
            <div className="form-row">
              <div className="field"><label htmlFor="e-cargo">Cargo detail</label><input id="e-cargo" disabled={driverMode} value={f.cargo} onChange={set('cargo')} /></div>
              <div className="field"><label htmlFor="e-cons">Consignee</label><input id="e-cons" disabled={driverMode} value={f.consignee} onChange={set('consignee')} /></div>
            </div>
          )}
          <div className="form-row">
            <div className="field ef-keep">
              <label htmlFor="e-status">Status</label>
              <select id="e-status" value={f.remarks} onChange={set('remarks')}>
                <option>Completed</option><option>Loading</option><option>On the way</option><option>Done</option><option>Cancelled</option>
              </select>
            </div>
            <div className="field"><label htmlFor="e-credit">Payment credit in</label><input id="e-credit" disabled={driverMode} value={f.credit_in} onChange={set('credit_in')} placeholder="e.g. Account" /></div>
          </div>
        </fieldset>

        <div className="entry-actions">
          <button type="button" className="btn ghost" onClick={() => { setF({ ...BLANK, entry_date: todayISO(), kind: f.kind, driver_id: lockedDriverId || defaultDriverId || '' }); setError(''); }}>Clear</button>
          <button type="submit" className="btn in entry-save" disabled={busy}>{busy ? 'Saving...' : 'Save entry'}</button>
        </div>
      </form>
      {shareModal}
    </>
  );
}
