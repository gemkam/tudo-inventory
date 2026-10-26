'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AuthGate, { ROLES, useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

const ROLE_HELP = {
  admin: 'Everything, plus managing users',
  editor: 'See and edit everything',
  viewer: 'See everything, change nothing',
  entry: 'Only the Transport data entry form. Cannot see saved data.'
};
const ROLE_ORDER = ['admin', 'editor', 'viewer', 'entry'];
const EMPTY = { username: '', display: '', password: '', role: 'viewer' };

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
  const [form, setForm] = useState(EMPTY);
  const [showPw, setShowPw] = useState(false);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data, error: err } = await sb().rpc('admin_list_users');
    if (err) { setError(err.message); setUsers([]); return; }
    setUsers(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 3500); }

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await sb().rpc('admin_create_user', {
      p_username: form.username.trim(), p_password: form.password, p_display: form.display.trim(), p_role: form.role
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    flash(`User "${form.username.trim().toLowerCase()}" created with ${ROLES[form.role].label}. They can log in now.`);
    setForm(EMPTY);
    load();
  }

  async function saveEdit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await sb().rpc('admin_update_user', {
      p_id: edit.id, p_role: edit.role, p_display: edit.display_name, p_password: edit.password ? edit.password : null
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    flash(`${edit.display_name || edit.username} saved.${edit.id !== me.id ? ' They were signed out, and the new access applies at their next login.' : ''}`);
    setEdit(null);
    load();
  }

  async function confirmDelete() {
    setBusy(true); setError('');
    const { error: err } = await sb().rpc('admin_delete_user', { p_id: del.id });
    setBusy(false);
    if (err) { setError(err.message); return; }
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
          <div><button type="submit" className="btn in" disabled={busy}>{busy ? 'Creating...' : 'Create user'}</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>All users {users && <span className="note">({users.length})</span>}</h2>
        {!users ? <p className="empty">Loading users...</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Username</th><th>Access level</th><th>Last login</th><th className="num">Actions</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.display_name}</b>{u.id === me.id && <span className="pill neutral" style={{ marginLeft: 8 }}>You</span>}</td>
                    <td>{u.username}</td>
                    <td><span className={`role-badge r-${u.role}`}>{ROLES[u.role]?.label || u.role || 'No access'}</span></td>
                    <td>{fmtWhen(u.last_sign_in_at)}</td>
                    <td>
                      <div className="actions">
                        <button type="button" className="mini" onClick={() => setEdit({ ...u, password: '' })}>Edit</button>
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
