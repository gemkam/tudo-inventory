'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import { ROLES } from '@/components/AuthGate';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { logAction } from '@/lib/activity';

/*
  Data entry > 🔑 Create users (Administrator only, 1 Nov 2026).
  1. Driver or Non-driver.
  2. Pick the person from Personnel (drivers = transport_drivers, non-drivers = exp_staff Office / Site). A person added
     in Personnel shows here by himself. ＋ Add staff / ＋ Add driver adds him to Personnel first.
  3. Username, password, access level (Driver = only his trip form; Data entry, View only, Full access, Administrator).
  Creates the login (RPC admin_create_user) and links it: transport_drivers.user_id or exp_staff.user_id.
*/
const ROLE_HELP = {
  driver: 'Only his own trip form, papers and Trip complete',
  entry: 'Sees everything, adds and edits, cannot delete',
  viewer: 'Sees everything, changes nothing',
  editor: 'Sees and changes everything, no Admin',
  admin: 'Everything, plus Admin (users, settings)'
};
const ROLES_FOR = { driver: ['driver', 'entry', 'viewer'], other: ['entry', 'viewer', 'editor', 'admin'] };
const nice = (s) => String(s || '').toLowerCase().replace(/^(mr|mrs|miss|ms)\.?\s+/i, '').trim().split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, '') || '';

export default function CreateUsers({ flash, onChanged }) {
  const [kind, setKind] = useState('driver');
  const [drivers, setDrivers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ person: '', username: '', password: '', role: 'driver' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addP, setAddP] = useState(null); // { name, company, type, vehicle }

  const load = useCallback(async () => {
    const s = sb();
    const [d, st, u] = await Promise.all([
      s.from('transport_drivers').select('id, name, vehicle_no, user_id, company, status, sort').is('archived_at', null).order('sort').order('name'),
      s.from('exp_staff').select('id, name, company, staff_type, designation, department, user_id, active, sort').is('archived_at', null).order('company').order('sort').order('name'),
      s.rpc('admin_list_users')
    ]);
    setDrivers((d.data || []).filter((x) => x.status !== 'Inactive'));
    setStaff((st.data || []).filter((x) => x.active !== false));
    setUsers(u.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const userById = useMemo(() => Object.fromEntries(users.map((x) => [x.id, x])), [users]);
  const people = kind === 'driver' ? drivers : staff;
  const free = people.filter((p) => !p.user_id || !userById[p.user_id]);
  const linked = people.filter((p) => p.user_id && userById[p.user_id]);
  const short = (k) => COMPANIES.find((c) => c.key === k)?.short || k || '';

  function pickKind(k) {
    setKind(k); setError('');
    setForm({ person: '', username: '', password: '', role: k === 'driver' ? 'driver' : 'entry' });
  }
  function pickPerson(id) {
    const p = people.find((x) => x.id === id);
    setForm((f) => ({ ...f, person: id, username: f.username || nice(p?.name) }));
  }

  async function create(e) {
    e.preventDefault();
    setError('');
    const p = people.find((x) => x.id === form.person);
    if (!p) { setError(`Choose the ${kind === 'driver' ? 'driver' : 'employee'} first`); return; }
    if (!form.username.trim() || form.password.length < 6) { setError('Type a username and a password of at least 6 letters or numbers'); return; }
    setBusy(true);
    const { data: newId, error: err } = await sb().rpc('admin_create_user', { p_username: form.username.trim(), p_password: form.password, p_display: p.name, p_role: form.role });
    if (err) { setBusy(false); setError(err.message); return; }
    const { error: lErr } = await sb().from(kind === 'driver' ? 'transport_drivers' : 'exp_staff').update({ user_id: newId }).eq('id', p.id);
    setBusy(false);
    logAction(`Created user "${form.username.trim().toLowerCase()}" (${kind === 'driver' ? 'Driver' : 'Staff'} ${p.name}) with ${ROLES[form.role]?.label}`);
    flash(`Login "${form.username.trim().toLowerCase()}" made for ${p.name} (${ROLES[form.role]?.label}).${lErr ? ` Could not link: ${lErr.message}` : ''}`);
    setForm({ person: '', username: '', password: '', role: kind === 'driver' ? 'driver' : 'entry' });
    load(); onChanged?.();
  }

  async function addPerson(e) {
    e.preventDefault();
    if (!addP.name.trim()) return;
    let res;
    if (kind === 'driver') {
      const sort = drivers.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
      res = await sb().from('transport_drivers').insert({ name: addP.name.trim(), vehicle_no: addP.vehicle.trim() || null, company: addP.company, status: 'Active', sort }).select('id').single();
    } else {
      const sort = staff.filter((x) => x.company === addP.company).length + 1;
      res = await sb().from('exp_staff').insert({ name: addP.name.trim(), company: addP.company, staff_type: addP.type, designation: addP.designation.trim() || null, working_days: 30, basic: 0, sort }).select('id').single();
    }
    if (res.error) { flash(res.error.message, 'err'); return; }
    flash(`${addP.name.trim()} added to Employees. Fill his salary and papers there later.`);
    setAddP(null);
    await load(); onChanged?.();
    setForm((f) => ({ ...f, person: res.data.id, username: f.username || nice(addP.name) }));
  }

  return (
    <section className="panel cu">
      <div className="section-head"><h2>🔑 Create users</h2></div>
      <div className="co-switch cu-kind" role="tablist" aria-label="Driver or staff">
        <button type="button" role="tab" aria-selected={kind === 'driver'} className={kind === 'driver' ? 'on' : ''} onClick={() => pickKind('driver')}>🚚 Driver</button>
        <button type="button" role="tab" aria-selected={kind === 'other'} className={kind === 'other' ? 'on' : ''} onClick={() => pickKind('other')}>👤 Staff</button>
      </div>

      <form onSubmit={create} className="cu-form">
        <div className="field">
          <label htmlFor="cu-person">{kind === 'driver' ? 'Which driver?' : 'Which employee?'}</label>
          <div className="cu-row">
            <select id="cu-person" value={form.person} onChange={(e) => pickPerson(e.target.value)}>
              <option value="">{free.length ? '– choose –' : 'Everyone already has a login'}</option>
              {free.map((p) => <option key={p.id} value={p.id}>{p.name}{p.company ? ` · ${short(p.company)}` : ''}{kind === 'driver' ? (p.vehicle_no ? ` · ${p.vehicle_no}` : '') : ` · ${p.staff_type || 'Office'}`}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => setAddP({ name: '', company: kind === 'driver' ? 'modern-city' : 'sumptuosity', type: 'Office', designation: '', vehicle: '' })}>＋ Add {kind === 'driver' ? 'driver' : 'staff'}</button>
          </div>
          <small className="muted">The list comes from <Link href={`/personnel?tab=${kind === 'driver' ? 'drivers' : 'office'}`}>Employees</Link>. Someone added there shows here by himself.</small>
        </div>
        <div className="cu-two">
          <div className="field"><label htmlFor="cu-user">Username</label><input id="cu-user" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. saif" /></div>
          <div className="field"><label htmlFor="cu-pass">Password</label><input id="cu-pass" type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="at least 6" /></div>
        </div>
        <div className="field">
          <label>Access (what he can do)</label>
          <div className="cu-roles" role="radiogroup">
            {ROLES_FOR[kind].map((r) => (
              <label key={r} className={`cu-role${form.role === r ? ' on' : ''}`}>
                <input type="radio" name="cu-role" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                <b>{ROLES[r]?.label || r}</b><small>{ROLE_HELP[r]}</small>
              </label>
            ))}
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="submit" className="btn in" disabled={busy}>{busy ? 'Creating...' : '🔑 Create login'}</button>
        </div>
      </form>

      <h3 className="ent-sub">{kind === 'driver' ? '🚚 Drivers with a login' : '👤 Staff with a login'} ({linked.length})</h3>
      {!linked.length && <p className="muted" style={{ margin: 0 }}>None yet.</p>}
      <div className="cu-list">
        {linked.map((p) => {
          const u = userById[p.user_id];
          return (
            <div key={p.id} className="cu-item">
              <b>{p.name}</b>
              <small>{String(u.username || u.email || '').replace('@tudo.local', '')} · {ROLES[u.role]?.label || u.role}{p.company ? ` · ${short(p.company)}` : ''}</small>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>Change a password or access later in <Link href="/users">Admin › Users</Link>.</p>

      {addP && (
        <Modal title={kind === 'driver' ? '＋ Add driver' : '＋ Add staff'} onClose={() => setAddP(null)}>
          <form onSubmit={addPerson} style={{ display: 'grid', gap: 12 }}>
            <div className="field"><label htmlFor="ap-name">Name</label><input id="ap-name" autoFocus required value={addP.name} onChange={(e) => setAddP({ ...addP, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ap-co">Company</label>
              <select id="ap-co" value={addP.company} onChange={(e) => setAddP({ ...addP, company: e.target.value })}>{COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}</select>
            </div>
            {kind === 'driver' ? (
              <div className="field"><label htmlFor="ap-veh">Vehicle number</label><input id="ap-veh" value={addP.vehicle} onChange={(e) => setAddP({ ...addP, vehicle: e.target.value })} placeholder="e.g. 899 YR" /></div>
            ) : (
              <>
                <div className="field"><label htmlFor="ap-type">Office or Site</label>
                  <select id="ap-type" value={addP.type} onChange={(e) => setAddP({ ...addP, type: e.target.value })}><option>Office</option><option>Site</option></select>
                </div>
                <div className="field"><label htmlFor="ap-des">Designation</label><input id="ap-des" value={addP.designation} onChange={(e) => setAddP({ ...addP, designation: e.target.value })} placeholder="e.g. Accountant" /></div>
              </>
            )}
            <p className="muted" style={{ margin: 0 }}>He is added to Employees ({kind === 'driver' ? 'Drivers' : `${addP.type} Employees`}) and to the salary sheet.</p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setAddP(null)}>Cancel</button>
              <button type="submit" className="btn in">Add</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
