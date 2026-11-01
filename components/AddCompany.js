'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { COMPANIES, addCompanies } from '@/lib/expenses';

/*
  ＋ Add company: last button on the All Companies tabs (and Salary page). Saves to personnel_companies
  (key, short, name, cr, address), joins COMPANIES at once (lib/expenses addCompanies) so the new company gets its
  own bills, salary sheet, attendance, invoices, salary and Personnel employees. onAdded(key) opens it.
*/
export default function AddCompany({ onAdded, flash }) {
  const [box, setBox] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const short = (box.short || '').trim();
    if (!short) { flash?.('Type the company name', 'err'); return; }
    if (COMPANIES.some((c) => c.short.toLowerCase() === short.toLowerCase())) { flash?.('This company is already there', 'err'); return; }
    setBusy(true);
    const key = `${short.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'}-${Date.now().toString(36).slice(-4)}`;
    const row = { key, short, name: (box.name || '').trim() || short.toUpperCase(), cr: (box.cr || '').trim() || null, address: (box.address || '').trim() || null, sort: COMPANIES.length + 1 };
    const { data, error } = await sb().from('personnel_companies').insert(row).select().single();
    setBusy(false);
    if (error) { flash?.(error.message, 'err'); return; }
    addCompanies([data]);
    setBox(null);
    flash?.(`${short} added`);
    onAdded?.(data.key);
  }
  const f = (k, label, ph, auto) => (
    <label className="dfl-label" style={{ marginTop: 10 }}>{label}
      <input className="drv-input" autoFocus={auto} value={box[k]} placeholder={ph} onChange={(e) => setBox({ ...box, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
    </label>
  );
  return (
    <>
      <button type="button" className="co-tab co-add" onClick={() => setBox({ short: '', name: '', cr: '', address: '' })}>＋ Add company</button>
      {box && (
        <Modal title="＋ Add company" onClose={() => setBox(null)}>
          {f('short', 'Short name (on the button)', 'e.g. Tudo Tech', true)}
          {f('name', 'Full company name', 'e.g. TUDO TECH L.L.C')}
          {f('cr', 'CR number (optional)', 'e.g. 1234567')}
          {f('address', 'Address (optional)', 'e.g. P.O. Box 149, PC 133, Al Khuwair, Sultanate of Oman')}
          <p className="muted" style={{ margin: '10px 0 0' }}>It gets its own bills, salary sheet, attendance, invoices and salary, like the other companies.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setBox(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={save} disabled={busy}>{busy ? 'Adding...' : 'Add company'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
