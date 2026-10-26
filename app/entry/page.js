'use client';

import { useEffect, useRef, useState } from 'react';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { evaluate, todayISO, fmtFullDate } from '@/lib/sheet';
import Modal from '@/components/Modal';

const BLANK = {
  kind: 'trip', driver_id: '', entry_date: '', from_place: '', to_place: '', rent: '', received: '',
  payment_status: 'Not Received', driver_allowance: '', allowance_status: 'Not paid', diesel: '', toll: '', maintenance: '',
  description: '', cargo: '', consignee: '', remarks: 'Completed', credit_in: ''
};
const NUMS = ['rent', 'received', 'driver_allowance', 'diesel', 'toll', 'maintenance'];

function EntryPage() {
  const me = useUser();
  const [drivers, setDrivers] = useState([]);
  const [f, setF] = useState({ ...BLANK, entry_date: todayISO() });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef(null);
  const [addDrv, setAddDrv] = useState(null);
  const [share, setShare] = useState(null); // { title, text, url }
  const [copied, setCopied] = useState(false);
  const myDriver = drivers.find((d) => d.user_id && d.user_id === me.id);

  async function loadDrivers(selectId) {
    const { data } = await sb().from('transport_drivers').select('id, name, vehicle_no, user_id, sort').order('sort').order('name');
    setDrivers(data || []);
    const mine = (data || []).find((d) => d.user_id && d.user_id === me.id);
    if (selectId) setF((x) => ({ ...x, driver_id: selectId }));
    else if (mine) setF((x) => (x.driver_id ? x : { ...x, driver_id: mine.id }));
  }

  useEffect(() => { loadDrivers(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveDriver(e) {
    e.preventDefault();
    if (!addDrv.name.trim()) return;
    const sort = drivers.reduce((m, d) => Math.max(m, d.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('transport_drivers').insert({ name: addDrv.name.trim(), vehicle_no: addDrv.vehicle.trim() || null, sort }).select('id').single();
    if (err) { setError(err.message); return; }
    setAddDrv(null);
    loadDrivers(data.id);
  }

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/entry` : '';

  async function openShare(payload) {
    setCopied(false);
    if (navigator.share) {
      try { await navigator.share(payload); return; } catch (e2) { if (e2?.name === 'AbortError') return; }
    }
    setShare(payload);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function numberOf(k) {
    const v = evaluate(f[k]);
    return v === null ? 0 : v;
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!f.driver_id) { setError('Choose the driver.'); return; }
    if (!f.entry_date) { setError('Choose the date.'); return; }
    for (const k of NUMS) {
      const v = evaluate(f[k]);
      if (Number.isNaN(v) || (v !== null && v < 0)) { setError(`Check the amount in "${k.replace('_', ' ')}". Use numbers only, e.g. 45 or 20+25.`); return; }
    }
    const isTrip = f.kind === 'trip';
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
      sort: Math.floor(Date.now() / 1000)
    };
    setBusy(true);
    // insert only: data entry users are not allowed to read rows back
    const { error: err } = await sb().from('transport_entries').insert(row);
    setBusy(false);
    if (err) { setError(err.code === '42501' ? 'You are not allowed to add entries. Ask the Administrator.' : err.message); return; }
    const driver = drivers.find((d) => d.id === f.driver_id)?.name || '';
    const money = (v) => `${Number(v).toFixed(3)} OMR`;
    const lines = [
      `${isTrip ? 'Trip' : 'Expense'} entry saved`,
      `Driver: ${driver}`,
      `Date: ${fmtFullDate(f.entry_date)}`,
      isTrip ? `Route: ${row.from_place} to ${row.to_place}` : `For: ${row.description}`,
      isTrip ? `Rent: ${money(row.rent)}` : null,
      isTrip ? `Received: ${money(row.received)}` : null,
      row.diesel ? `Diesel: ${money(row.diesel)}` : null,
      row.toll ? `Toll: ${money(row.toll)}` : null,
      row.maintenance ? `Maintenance: ${money(row.maintenance)}` : null,
      `Entered by: ${me.name}`
    ].filter(Boolean);
    setSaved({ driver, date: f.entry_date, what: isTrip ? `${row.from_place} → ${row.to_place}` : row.description, text: lines.join('\n') });
    setCount((c) => c + 1);
    setF({ ...BLANK, entry_date: todayISO(), kind: f.kind, driver_id: myDriver ? myDriver.id : '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => firstRef.current?.focus(), 300);
  }

  if (!me.isAdmin && !me.isEntry) return <div className="error">Data entry is only for Data entry users and Full access users.</div>;

  const isTrip = f.kind === 'trip';
  const balance = Math.max(0, numberOf('rent') - numberOf('received'));

  return (
    <>
      <div className="entry-head">
        <div>
          <h1>Transport data entry</h1>
          <p className="sub">Fill in one trip or expense and press Save. The form clears for the next one.</p>
        </div>
        <div className="entry-head-right">
          <button type="button" className="btn" onClick={() => openShare({ title: 'Tudo transport data entry', text: 'Transport data entry form. Log in with your username and password:', url: pageUrl })}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" stroke="currentColor" strokeWidth="1.8" /></svg>
            Share this form
          </button>
          <div className="entry-count"><strong>{count}</strong><span>saved this session</span></div>
        </div>
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
            <label key={k} className={`rp-chip ${f.kind === k ? 'active' : ''}`}>
              <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={set('kind')} className="sr-only" />{l}
            </label>
          ))}
        </div>

        <fieldset>
          <legend>Driver and date</legend>
          <div className="form-row">
            <div className="field">
              <label htmlFor="e-driver">Driver *</label>
              <select id="e-driver" ref={firstRef} value={f.driver_id} onChange={set('driver_id')} required>
                <option value="">Choose driver</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle_no ? ` (${d.vehicle_no})` : ''}</option>)}
              </select>
              {me.isAdmin && <button type="button" className="link-add" onClick={() => setAddDrv({ name: '', vehicle: '' })}>+ Add a new driver</button>}
              {drivers.length === 0 && <p className="note">No drivers yet. {me.isAdmin ? 'Add one with the link above.' : 'Ask the Administrator to add you to the driver list.'}</p>}
            </div>
            <div className="field narrow" style={{ flex: '0 1 180px' }}>
              <label htmlFor="e-date">Date *</label>
              <input id="e-date" type="date" value={f.entry_date} onChange={set('entry_date')} required />
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
              <div className="field"><label htmlFor="e-allow">Driver trip allowance (OMR)</label><input id="e-allow" inputMode="decimal" value={f.driver_allowance} onChange={set('driver_allowance')} placeholder="0" /></div>
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

        <fieldset>
          <legend>Details</legend>
          <div className="field">
            <label htmlFor="e-desc">{isTrip ? 'Description' : 'What was the expense for? *'}</label>
            <input id="e-desc" value={f.description} onChange={set('description')} placeholder={isTrip ? 'Optional' : 'e.g. Oil filter change'} />
          </div>
          {isTrip && (
            <div className="form-row">
              <div className="field"><label htmlFor="e-cargo">Cargo detail</label><input id="e-cargo" value={f.cargo} onChange={set('cargo')} /></div>
              <div className="field"><label htmlFor="e-cons">Consignee</label><input id="e-cons" value={f.consignee} onChange={set('consignee')} /></div>
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <label htmlFor="e-status">Status</label>
              <select id="e-status" value={f.remarks} onChange={set('remarks')}>
                <option>Completed</option><option>Loading</option><option>On the way</option><option>Done</option><option>Cancelled</option>
              </select>
            </div>
            <div className="field"><label htmlFor="e-credit">Payment credit in</label><input id="e-credit" value={f.credit_in} onChange={set('credit_in')} placeholder="e.g. Account" /></div>
          </div>
        </fieldset>

        <div className="entry-actions">
          <button type="button" className="btn ghost" onClick={() => { setF({ ...BLANK, entry_date: todayISO(), kind: f.kind }); setError(''); }}>Clear</button>
          <button type="submit" className="btn in entry-save" disabled={busy}>{busy ? 'Saving...' : 'Save entry'}</button>
        </div>
      </form>

      {addDrv && (
        <Modal title="Add a new driver" onClose={() => setAddDrv(null)}>
          <form onSubmit={saveDriver} style={{ display: 'grid', gap: 12 }}>
            <div className="field"><label htmlFor="nd-name">Driver name</label><input id="nd-name" autoFocus required value={addDrv.name} onChange={(e) => setAddDrv({ ...addDrv, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="nd-veh">Vehicle number</label><input id="nd-veh" value={addDrv.vehicle} onChange={(e) => setAddDrv({ ...addDrv, vehicle: e.target.value })} placeholder="e.g. 899 YR" /></div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setAddDrv(null)}>Cancel</button>
              <button type="submit" className="btn in">Add driver</button>
            </div>
          </form>
        </Modal>
      )}

      {share && (
        <Modal title="Share" onClose={() => setShare(null)}>
          <pre className="share-text">{share.url ? `${share.text}\n${share.url}` : share.text}</pre>
          <div className="share-btns">
            <a className="btn wa-btn" href={`https://wa.me/?text=${encodeURIComponent(share.url ? `${share.text}\n${share.url}` : share.text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <a className="btn" href={`mailto:?subject=${encodeURIComponent(share.title)}&body=${encodeURIComponent(share.url ? `${share.text}\n${share.url}` : share.text)}`}>Email</a>
            <button type="button" className="btn" onClick={() => copy(share.url ? `${share.text}\n${share.url}` : share.text)}>{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
        </Modal>
      )}

      {me.isEntry && <p className="note" style={{ textAlign: 'center' }}>For privacy, saved entries are not shown here. The Administrator can see them in Transport.</p>}
    </>
  );
}

export default function Page() {
  return <AuthGate entryPage><EntryPage /></AuthGate>;
}
