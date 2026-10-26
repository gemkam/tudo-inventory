'use client';

import { useCallback, useEffect, useState } from 'react';
import AuthGate, { useUser } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import Modal from '@/components/Modal';
import EntryForm from '@/components/EntryForm';
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

function EntryPage() {
  const me = useUser();
  const [drivers, setDrivers] = useState([]);
  const [selectId, setSelectId] = useState('');
  const [addDrv, setAddDrv] = useState(null);
  const [error, setError] = useState('');
  const myDriver = drivers.find((d) => d.user_id && d.user_id === me.id);

  async function loadDrivers(newId) {
    const { data } = await sb().from('transport_drivers').select('id, name, vehicle_no, user_id, sort').order('sort').order('name');
    setDrivers(data || []);
    if (newId) setSelectId(newId);
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

  async function submit(row) {
    const { error: err } = await sb().from('transport_entries').insert(row);
    return err ? err.message : null;
  }

  return (
    <>
      {me.isAdmin && <ShareLinks drivers={drivers} />}
      {error && <div className="error">{error}</div>}
      <EntryForm
        key={selectId || 'form'}
        drivers={drivers}
        defaultDriverId={selectId || myDriver?.id || ''}
        enteredBy={me.name}
        onSubmit={submit}
        driverExtra={me.isAdmin ? <button type="button" className="link-add" onClick={() => setAddDrv({ name: '', vehicle: '' })}>+ Add a new driver</button> : null}
      />

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

      {me.isEntry && <p className="note" style={{ textAlign: 'center' }}>For privacy, saved entries are not shown here. The Administrator can see them in Transport.</p>}
    </>
  );
}

export default function Page() {
  return <AuthGate entryPage><EntryPage /></AuthGate>;
}
