'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate, { ROLES, useUser } from '@/components/AuthGate';
import RaufPicturePanel from '@/components/RaufPicturePanel';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { logAction } from '@/lib/activity';

const ROLE_HELP = {
  admin: 'Everything, plus managing users',
  editor: 'See and edit everything',
  viewer: 'See everything, change nothing',
  entry: 'Only the Transport data entry form. Cannot see saved data.'
};
const ROLE_ORDER = ['admin', 'editor', 'viewer', 'entry'];
const EMPTY = { username: '', display: '', password: '', role: 'viewer', asDriver: true, vehicle: '' };

function fmtWhen(d) {
  if (!d) return 'Never';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function RolePicker({ value, onChange, name }) {
  return (
    <div className="role-pick" role="radiogroup" aria-label="Access level">
      {ROLE_ORDER.map((r) => (
        <label key={r} className={`role-opt ${value === r ? 'on' : ''}`}>
          <input type="radio" name={name} value={r} checked={value === r} onChange={() => onChange(r)} />
          <span className="role-opt-title">{ROLES[r].label}</span>
          <span className="role-opt-help">{ROLE_HELP[r]}</span>
        </label>
      ))}
    </div>
  );
}

function UsersPage() {
  const me = useUser();
  const [users, setUsers] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showPw, setShowPw] = useState(false);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [seen, setSeen] = useState({});

  const load = useCallback(async () => {
    const [{ data, error: err }, d] = await Promise.all([
      sb().rpc('admin_list_users'),
      sb().from('transport_drivers').select('id, name, vehicle_no, user_id, sort').order('sort')
    ]);
    if (err) { setError(err.message); setUsers([]); return; }
    setUsers(data || []);
    setDrivers(d.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Online now / last seen per user (from the activity log)
  const loadSeen = useCallback(async () => {
    const { data } = await sb().from('user_sessions').select('user_id, last_seen, ended_at').order('last_seen', { ascending: false }).limit(500);
    const m = {};
    (data || []).forEach((s) => {
      const online = !s.ended_at && Date.now() - new Date(s.last_seen).getTime() < 150000;
      if (!m[s.user_id]) m[s.user_id] = { last: s.last_seen, online };
      else if (online) m[s.user_id].online = true;
    });
    setSeen(m);
  }, []);

  useEffect(() => {
    loadSeen();
    const t = setInterval(loadSeen, 30000);
    return () => clearInterval(t);
  }, [loadSeen]);

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 3500); }

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { data: newId, error: err } = await sb().rpc('admin_create_user', {
      p_username: form.username.trim(), p_password: form.password, p_display: form.display.trim(), p_role: form.role
    });
    if (err) { setBusy(false); setError(err.message); return; }
    let extra = '';
    if (form.role === 'entry' && form.asDriver) {
      const sort = drivers.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
      const { error: dErr } = await sb().from('transport_drivers').insert({ name: form.display.trim() || form.username.trim(), vehicle_no: form.vehicle.trim() || null, user_id: newId, sort });
      extra = dErr ? ` (Could not add to the driver list: ${dErr.message})` : ' Added to the driver list.';
    }
    setBusy(false);
    logAction(`Created user "${form.username.trim().toLowerCase()}" with ${ROLES[form.role].label}`);
    flash(`User "${form.username.trim().toLowerCase()}" created with ${ROLES[form.role].label}. They can log in now.${extra}`);
    setForm(EMPTY);
    load();
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await sb().rpc('admin_update_user', {
      p_id: edit.id, p_role: edit.role, p_display: edit.display_name, p_password: edit.password ? edit.password : null
    });
    if (err) { setBusy(false); setError(err.message); return; }
    const current = drivers.find((d) => d.user_id === edit.id)?.id || '';
    if (edit.driverId !== current) {
      if (current) await sb().from('transport_drivers').update({ user_id: null }).eq('id', current);
      if (edit.driverId === 'new') {
        const sort = drivers.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
        await sb().from('transport_drivers').insert({ name: edit.display_name || edit.username, user_id: edit.id, sort });
      } else if (edit.driverId) {
        await sb().from('transport_drivers').update({ user_id: edit.id }).eq('id', edit.driverId);
      }
    }
    setBusy(false);
    const before = (users || []).find((x) => x.id === edit.id);
    const bits = [];
    if (before && before.role !== edit.role) bits.push(`access ${ROLES[before.role]?.label || before.role} → ${ROLES[edit.role]?.label || edit.role}`);
    if (before && (before.display_name || '') !== (edit.display_name || '')) bits.push(`name "${before.display_name || ''}" → "${edit.display_name || ''}"`);
    if (edit.password) bits.push('password changed');
    logAction(`Edited user "${edit.username}"${bits.length ? ': ' + bits.join(', ') : ''}`);
    flash(`${edit.display_name || edit.username} saved.${edit.id !== me.id ? ' They were signed out, and the new access applies at their next login.' : ''}`);
    setEdit(null);
    load();
  }

  async function confirmDelete() {
    setBusy(true); setError('');
    const { error: err } = await sb().rpc('admin_delete_user', { p_id: del.id });
    setBusy(false);
    if (err) { setError(err.message); return; }
    logAction(`Deleted user "${del.username}"`);
    flash(`${del.display_name || del.username} deleted.`);
    setDel(null);
    load();
  }

  const counts = ROLE_ORDER.map((r) => [r, (users || []).filter((u) => u.role === r).length]);

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
      </div>
      <div>
        <h1>Users and access</h1>
        <p className="sub">Create logins and choose what each person can do.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="kpi-row">
        {counts.map(([r, c]) => (
          <div className="kpi" key={r}><span>{ROLES[r].label}</span><strong>{c}</strong><small>{ROLE_HELP[r]}</small></div>
        ))}
      </div>

      <RaufPicturePanel />

      <section className="panel">
        <h2>Create a new user</h2>
        <form onSubmit={create} style={{ display: 'grid', gap: 14 }}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="nu-user">Username</label>
              <input id="nu-user" required autoComplete="off" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, '') })} placeholder="e.g. rashid" />
            </div>
            <div className="field">
              <label htmlFor="nu-name">Display name</label>
              <input id="nu-name" value={form.display} onChange={(e) => setForm({ ...form, display: e.target.value })} placeholder="e.g. Rashid Khan" />
            </div>
            <div className="field">
              <label htmlFor="nu-pass">Password</label>
              <div className="pw-wrap">
                <input id="nu-pass" required type={showPw ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 4 characters" />
                <button type="button" className="pw-eye" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
            </div>
          </div>
          <div className="field">
            <label>Access level</label>
            <RolePicker value={form.role} onChange={(r) => setForm({ ...form, role: r })} name="new-role" />
          </div>
          {form.role === 'entry' && (
            <div className="driver-link">
              <label className="check">
                <input type="checkbox" checked={form.asDriver} onChange={(e) => setForm({ ...form, asDriver: e.target.checked })} />
                This person is a driver. Add them to the driver list (they will be picked automatically on the entry form).
              </label>
              {form.asDriver && (
                <div className="field narrow" style={{ maxWidth: 260 }}>
                  <label htmlFor="nu-veh">Vehicle number</label>
                  <input id="nu-veh" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="e.g. 899 YR" />
                </div>
              )}
            </div>
          )}
          <div><button type="submit" className="btn in" disabled={busy}>{busy ? 'Creating...' : 'Create user'}</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>All users {users && <span className="note">({users.length})</span>} <Link href="/activity" className="btn small ghost" style={{ marginLeft: 10 }}>👁 All users activity</Link></h2>
        {!users ? <p className="empty">Loading users...</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Username</th><th>Access level</th><th>Driver</th><th>Status</th><th>Last login</th><th className="num">Actions</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.display_name}</b>{u.id === me.id && <span className="pill neutral" style={{ marginLeft: 8 }}>You</span>}</td>
                    <td>{u.username}</td>
                    <td><span className={`role-badge r-${u.role}`}>{ROLES[u.role]?.label || u.role || 'No access'}</span></td>
                    <td>{drivers.find((d) => d.user_id === u.id)?.name || <span className="muted">–</span>}</td>
                    <td>{seen[u.id]?.online ? <span className="pill in">🟢 Online now</span> : seen[u.id] ? <span className="muted">Last seen {fmtWhen(seen[u.id].last)}</span> : <span className="muted">–</span>}</td>
                    <td>{fmtWhen(u.last_sign_in_at)}</td>
                    <td>
                      <div className="actions">
                        <Link href={`/activity?u=${u.id}`} className="mini">📜 Activity</Link>
                        <button type="button" className="mini" onClick={() => setEdit({ ...u, password: '', driverId: drivers.find((d) => d.user_id === u.id)?.id || '' })}>Edit</button>
                        {u.id !== me.id && <button type="button" className="mini danger" onClick={() => setDel(u)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Usernames work in capitals or small letters. When you change someone&apos;s access, they are signed out and the new access applies when they log in again.</p>
      </section>

      {edit && (
        <Modal title={`Edit ${edit.display_name || edit.username}`} onClose={() => setEdit(null)}>
          <form onSubmit={saveEdit} style={{ display: 'grid', gap: 12 }}>
            <div className="field">
              <label htmlFor="eu-name">Display name</label>
              <input id="eu-name" value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="eu-pass">New password (leave empty to keep the current one)</label>
              <input id="eu-pass" type="text" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="Keep current password" />
            </div>
            <div className="field">
              <label>Access level</label>
              <RolePicker value={edit.role} onChange={(r) => setEdit({ ...edit, role: r })} name="edit-role" />
            </div>
            <div className="field">
              <label htmlFor="eu-driver">Driver in the list (for Data entry)</label>
              <select id="eu-driver" value={edit.driverId} onChange={(e) => setEdit({ ...edit, driverId: e.target.value })}>
                <option value="">Not a driver</option>
                {drivers.filter((d) => !d.user_id || d.user_id === edit.id).map((d) => <option key={d.id} value={d.id}>{d.name}{d.vehicle_no ? ` (${d.vehicle_no})` : ''}</option>)}
                <option value="new">+ Add as a new driver</option>
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button type="submit" className="btn in" disabled={busy}>Save</button>
            </div>
          </form>
        </Modal>
      )}

      {del && (
        <Modal title="Delete user?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <strong>{del.display_name}</strong> ({del.username})? They will not be able to log in any more. Data they entered stays.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete} disabled={busy}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate ownerOnly><UsersPage /></AuthGate>;
}
