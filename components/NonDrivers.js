'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';

/*
  Data entry > 👤 Staff (1 Nov 2026). Empty for now (the forms for non-drivers come later).
  Shows the non-driver employees from Personnel (exp_staff, Office / Site) and lets the office add one
  (＋ Add staff → added to Personnel and the salary sheet).
*/
export default function NonDrivers({ flash, canAdd }) {
  const [staff, setStaff] = useState(null);
  const [addP, setAddP] = useState(null);
  const load = useCallback(async () => {
    const { data } = await sb().from('exp_staff').select('id, name, company, staff_type, designation, department, user_id, active').is('archived_at', null).order('company').order('sort').order('name');
    setStaff((data || []).filter((x) => x.active !== false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const short = (k) => COMPANIES.find((c) => c.key === k)?.short || k || '';

  async function add(e) {
    e.preventDefault();
    if (!addP.name.trim()) return;
    const sort = (staff || []).filter((x) => x.company === addP.company).length + 1;
    const { error } = await sb().from('exp_staff').insert({ name: addP.name.trim(), company: addP.company, staff_type: addP.type, designation: addP.designation.trim() || null, working_days: 30, basic: 0, sort });
    if (error) { flash(error.message, 'err'); return; }
    flash(`${addP.name.trim()} added to Employees`);
    setAddP(null);
    load();
  }

  return (
    <section className="panel">
      <div className="section-head">
        <h2>👤 Staff</h2>
        {canAdd && <button type="button" className="ent-new" onClick={() => setAddP({ name: '', company: 'sumptuosity', type: 'Office', designation: '' })}><span aria-hidden="true">＋</span> Add staff</button>}
      </div>
      <div className="ent-drivers" role="list">
        {(staff || []).map((p) => (
          <div key={p.id} className="ent-driver" role="listitem">
            <span className="ent-av" aria-hidden="true">{String(p.name || '?').replace(/^(mr|mrs|miss|ms)\.?\s+/i, '').trim()[0]}</span>
            <span><b>{p.name}</b><small>{[short(p.company), p.staff_type || 'Office', p.designation || p.department].filter(Boolean).join(' · ')}</small></span>
          </div>
        ))}
        {staff && !staff.length && <p className="muted">No staff yet.</p>}
        {!staff && <p className="muted">Loading...</p>}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>The forms for staff will come here. The list comes from <Link href="/personnel?tab=office">Employees</Link>.</p>

      {addP && (
        <Modal title="＋ Add staff" onClose={() => setAddP(null)}>
          <form onSubmit={add} style={{ display: 'grid', gap: 12 }}>
            <div className="field"><label htmlFor="nd2-name">Name</label><input id="nd2-name" autoFocus required value={addP.name} onChange={(e) => setAddP({ ...addP, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="nd2-co">Company</label>
              <select id="nd2-co" value={addP.company} onChange={(e) => setAddP({ ...addP, company: e.target.value })}>{COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="nd2-type">Office or Site</label>
              <select id="nd2-type" value={addP.type} onChange={(e) => setAddP({ ...addP, type: e.target.value })}><option>Office</option><option>Site</option></select>
            </div>
            <div className="field"><label htmlFor="nd2-des">Designation</label><input id="nd2-des" value={addP.designation} onChange={(e) => setAddP({ ...addP, designation: e.target.value })} placeholder="e.g. Accountant" /></div>
            <p className="muted" style={{ margin: 0 }}>He is added to Employees and the salary sheet. Fill his salary and papers there.</p>
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
