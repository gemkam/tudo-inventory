'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import Modal from '@/components/Modal';
import DriverTripForm from '@/components/DriverTripForm';
import { useEntryLabels } from '@/lib/entryLabels';
import InstallApp from '@/components/InstallApp';
import { useShare } from '@/components/ShareModal';

function fmtWhen(d) {
  if (!d) return 'Never';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* Open links: anyone with the link can fill the form without a login */
function ShareLinks({ drivers }) {
  const [links, setLinks] = useState(null);
  const [form, setForm] = useState(null);
  const [del, setDel] = useState(null);
  const [error, setError] = useState('');
  const { open: openShare, modal } = useShare();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const urlOf = (l) => `${origin}/f/${l.token}`;

  const load = useCallback(async () => {
    const { data, error: err } = await sb().from('entry_links').select('*').order('created_at', { ascending: false });
    if (err) { setError(err.message); setLinks([]); return; }
    setLinks(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function shareLink(l) {
    const d = drivers.find((x) => x.id === l.driver_id);
    openShare({
      title: 'Transport data entry',
      text: `Transport data entry form${d ? ` for ${d.name}` : ''}. Open the link, fill in the trip or expense and press Save. No login needed.`,
      url: urlOf(l)
    });
  }

  async function create(e) {
    e.preventDefault();
    setError('');
    const label = form.label.trim() || (drivers.find((d) => d.id === form.driver_id)?.name ? `${drivers.find((d) => d.id === form.driver_id).name}'s link` : 'Entry link');
    const { data, error: err } = await sb().from('entry_links').insert({ label, driver_id: form.driver_id || null }).select().single();
    if (err) { setError(err.message); return; }
    setForm(null);
    await load();
    shareLink(data);
  }

  async function toggle(l) {
    const { error: err } = await sb().from('entry_links').update({ active: !l.active }).eq('id', l.id);
    if (err) setError(err.message); else load();
  }

  async function remove() {
    const { error: err } = await sb().from('entry_links').delete().eq('id', del.id);
    if (err) { setError(err.message); return; }
    setDel(null); load();
  }

  return (
    <section className="panel links-panel">
      <div className="links-head">
        <div>
          <h2>Share links (no login)</h2>
          <p className="note">Send a link on WhatsApp. Whoever opens it can add entries straight away, without a username or password. They cannot see saved data.</p>
        </div>
        <button type="button" className="btn in" onClick={() => setForm({ label: '', driver_id: '' })}>+ New share link</button>
      </div>
      {error && <div className="error">{error}</div>}
      {!links ? <p className="empty">Loading links...</p> : links.length === 0 ? (
        <p className="empty">No links yet. Press “+ New share link” to make one.</p>
      ) : (
        <div className="links-list">
          {links.map((l) => {
            const d = drivers.find((x) => x.id === l.driver_id);
            return (
              <div key={l.id} className={`link-card ${l.active ? '' : 'off'}`}>
                <div className="link-info">
                  <b>{l.label || 'Entry link'}</b>
                  <span className={`tag ${l.active ? 'ok' : 'warn'}`}>{l.active ? 'On' : 'Off'}</span>
                  <div className="note">
                    {d ? `Driver fixed: ${d.name}` : 'Any driver'} · {l.uses || 0} entries · last used {fmtWhen(l.last_used_at)}
                  </div>
                  <code className="link-url">{urlOf(l)}</code>
                </div>
                <div className="actions">
                  <button type="button" className="mini wa-mini" onClick={() => shareLink(l)} disabled={!l.active}>Share</button>
                  <button type="button" className="mini" onClick={() => toggle(l)}>{l.active ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" className="mini danger" onClick={() => setDel(l)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="note">If a link reaches the wrong person, press “Turn off”. It stops working at once; entries already saved stay.</p>

      {form && (
        <Modal title="New share link" onClose={() => setForm(null)}>
          <form onSubmit={create} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="sl-driver">Driver</label>
              <select id="sl-driver" value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
                <option value="">Any driver (person chooses)</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>Only {d.name}{d.vehicle_no ? ` (${d.vehicle_no})` : ''}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sl-label">Name of the link (for you)</label>
              <input id="sl-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Saif's phone" />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn in">Create and share</button>
            </div>
          </form>
        </Modal>
      )}
      {del && (
        <Modal title="Delete link?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.label}</b>? The link stops working. Entries already saved stay.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={remove}>Delete</button>
          </div>
        </Modal>
      )}
      {modal}
    </section>
  );
}

/*
  Driver trip form (31 Oct 2026). Big name buttons for every active driver (Saif Altaf, Aman Ullah, new drivers appear by themselves).
  Tap a name: his open trips + "＋ New trip". Tap a trip: components/DriverTripForm.js (driver part, greyed office part,
  papers with ⋯ More, ✅ Trip complete). Drivers (Data entry users) see only their OPEN trips and the NUMBER of completed trips (no details);
  the office also has a "✅ Completed trips" list with every detail.
  A Data entry user linked to a driver (transport_drivers.user_id) opens on his own name.
  Administrator: ✏️ Rename boxes, sees deleted papers, and the share links section below.
*/
function EntryPage() {
  const me = useUser();
  const isOffice = !!me.isAdmin;
  const { label, rename } = useEntryLabels();
  const [drivers, setDrivers] = useState([]);
  const [driverId, setDriverId] = useState('');
  const [trips, setTrips] = useState(null); // open trips
  const [doneTrips, setDoneTrips] = useState(null); // completed trips (office only)
  const [counts, setCounts] = useState(null); // { completed, this_month, open }
  const [listTab, setListTab] = useState('open'); // 'open' | 'done' (done = office only)
  const [tripId, setTripId] = useState(null); // null = list, 'new' = new trip, id = that trip
  const [current, setCurrent] = useState(null); // the trip open in the form (kept even if it leaves the list)
  const [renaming, setRenaming] = useState(false);
  const [addDrv, setAddDrv] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  async function loadDrivers(newId) {
    const { data } = await sb().from('transport_drivers').select('id, name, vehicle_no, user_id, status, sort').order('sort').order('name');
    let list = (data || []).filter((d) => d.status !== 'Inactive');
    const mine = list.find((d) => d.user_id && d.user_id === me.id);
    if (!isOffice && mine) list = [mine]; // a driver's login shows only his own name
    setDrivers(list);
    if (newId) setDriverId(newId); else if (mine) setDriverId((v) => v || mine.id);
  }
  useEffect(() => { loadDrivers(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // each driver's own link /d/<username> (usernames can be read by the Administrator only)
  const [driverLinks, setDriverLinks] = useState([]);
  useEffect(() => {
    if (!me.isOwner || !drivers.length) return;
    sb().rpc('admin_list_users').then(({ data }) => {
      const byId = Object.fromEntries((data || []).map((x) => [x.id, x]));
      setDriverLinks(drivers.map((d) => ({ id: d.id, name: d.name, user: d.user_id && byId[d.user_id] ? String(byId[d.user_id].username || byId[d.user_id].email || '').replace('@tudo.local', '') : '' })));
    });
  }, [me.isOwner, drivers]);

  const loadTrips = useCallback(async () => {
    if (!driverId) { setTrips(null); setDoneTrips(null); setCounts(null); return; }
    const s = sb();
    const [o, c] = await Promise.all([
      s.from('transport_entries').select('*').eq('driver_id', driverId).eq('trip_completed', false)
        .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      s.rpc('driver_trip_counts', { p_driver: driverId })
    ]);
    if (o.error) { setError(o.error.message); setTrips([]); } else setTrips(o.data || []);
    setCounts(c.data || null);
    if (isOffice) {
      const { data } = await s.from('transport_entries').select('*').eq('driver_id', driverId).eq('trip_completed', true)
        .order('completed_at', { ascending: false }).order('entry_date', { ascending: false }).limit(300);
      setDoneTrips(data || []);
    }
  }, [driverId, isOffice]);
  useEffect(() => { setTripId(null); setCurrent(null); setListTab('open'); loadTrips(); }, [loadTrips]);
  const openTrip = (t) => { setCurrent(t); setTripId(t ? t.id : 'new'); };

  async function saveDriver(e) {
    e.preventDefault();
    if (!addDrv.name.trim()) return;
    const sort = drivers.reduce((m, d) => Math.max(m, d.sort || 0), 0) + 1;
    const { data, error: err } = await sb().from('transport_drivers').insert({ name: addDrv.name.trim(), vehicle_no: addDrv.vehicle.trim() || null, sort }).select('id').single();
    if (err) { setError(err.message); return; }
    setAddDrv(null);
    loadDrivers(data.id);
  }

  const driver = drivers.find((d) => d.id === driverId);
  const papers = (t) => Object.values(t.attachments || {}).flat().filter((x) => !x.deleted_at).length;
  const deleted = (t) => Object.values(t.attachments || {}).flat().filter((x) => x.deleted_at).length;
  const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

  return (
    <div className={`ent-page${isOffice ? ' office' : ' driver'}`}>
      <div className="page-tools ent-head">
        <h1 style={{ margin: 0 }}>🚚 Driver trip form</h1>
        <div className="tools">
          <InstallApp isOffice={isOffice} driverLinks={driverLinks} />
          {isOffice && <button type="button" className={`btn${renaming ? ' in' : ''}`} aria-pressed={renaming} onClick={() => setRenaming((v) => !v)}>{renaming ? '✓ Done renaming' : '✏️ Rename boxes'}</button>}
          {isOffice && <button type="button" className="btn" onClick={() => setAddDrv({ name: '', vehicle: '' })}>➕ Add driver</button>}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="ent-drivers" role="group" aria-label="Choose driver">
        {drivers.map((d) => (
          <button key={d.id} type="button" className={`ent-driver${driverId === d.id ? ' on' : ''}`} onClick={() => setDriverId(d.id)}>
            <span className="ent-av" aria-hidden="true">{String(d.name || '?').trim()[0]}</span>
            <span><b>{d.name}</b>{d.vehicle_no ? <small>{d.vehicle_no}</small> : null}</span>
          </button>
        ))}
        {!drivers.length && <p className="muted">No drivers yet.</p>}
      </div>

      {driver && tripId === null && (
        <section className="panel">
          <div className="section-head">
            <h2>{driver.name}: trips</h2>
            <button type="button" className="ent-new" onClick={() => openTrip(null)}><span aria-hidden="true">＋</span> New trip</button>
          </div>
          <div className="ent-count">
            <div><span>Open trips</span><b>{trips ? trips.length : '…'}</b></div>
            <div className="ok"><span>✅ Trips completed</span><b>{counts ? counts.completed : '…'}</b></div>
            <div><span>Completed this month</span><b>{counts ? counts.this_month : '…'}</b></div>
          </div>
          {isOffice && (
            <div className="ent-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={listTab === 'open'} className={`rp-chip ${listTab === 'open' ? 'active' : ''}`} onClick={() => setListTab('open')}>🟡 Open trips ({trips ? trips.length : 0})</button>
              <button type="button" role="tab" aria-selected={listTab === 'done'} className={`rp-chip ${listTab === 'done' ? 'active' : ''}`} onClick={() => setListTab('done')}>✅ Completed trips ({doneTrips ? doneTrips.length : 0})</button>
            </div>
          )}
          {(() => {
            const list = listTab === 'done' && isOffice ? doneTrips : trips;
            if (list === null) return <p className="muted">Loading...</p>;
            if (!list.length) return <p className="muted" style={{ margin: '8px 0 0' }}>{listTab === 'done' ? 'No completed trips yet.' : 'No open trips. Press ＋ New trip.'}</p>;
            return (
              <div className="ent-trips">
                {list.map((t) => (
                  <button key={t.id} type="button" className={`ent-trip${t.trip_completed ? ' done' : ''}`} onClick={() => openTrip(t)}>
                    <span className="ent-trip-date">{dmy(t.entry_date)}</span>
                    <b>{[t.from_place, t.to_place].filter(Boolean).join(' → ') || t.description || 'No route yet'}</b>
                    <small>{papers(t)} paper{papers(t) === 1 ? '' : 's'}{isOffice && deleted(t) ? ` · 🗑 ${deleted(t)} deleted` : ''}{t.trip_completed && t.completed_by ? ` · by ${t.completed_by}` : ''}</small>
                    <span className={`tag ${t.trip_completed ? 'ok' : 'warn'}`}>{t.trip_completed ? `✅ ${dmy(t.completed_at)}` : 'Open'}</span>
                  </button>
                ))}
              </div>
            );
          })()}
        </section>
      )}

      {driver && tripId !== null && (
        <section className="panel">
          <DriverTripForm key={tripId} driver={driver} trip={current} isOffice={isOffice} label={label} rename={rename} renaming={renaming}
            flash={flash} onSaved={loadTrips} onClose={() => { setTripId(null); setCurrent(null); loadTrips(); }} />
        </section>
      )}

      {isOffice && <ShareLinks drivers={drivers} />}

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
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}

export default function Page() {
  return <AuthGate entryPage wide><EntryPage /></AuthGate>;
}
