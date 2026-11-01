'use client';

import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

/*
  📤 Send To Employee (Personnel and All Companies > Salary). The link /s/<slip_token> is made ONCE and never changes:
  the employee installs it once ("<Name> Salary" icon) and every month the newest approved slip shows there by itself.
  WhatsApp is only to hand over the link the first time. Turn off / on hides or shows his slips.
  table: 'exp_staff' | 'transport_drivers'. onChanged(row) after the on / off switch.
*/
export default function SendSlipLink({ table, row, onClose, onChanged, flash }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/s/${row.slip_token}` : '';
  const digits = String(row.mobile || row.phone || '').replace(/\D/g, '');
  const wa = digits ? (digits.length === 8 ? `968${digits}` : digits) : '';
  const text = `Salam ${row.name}\n\nThis is your salary slip link\n${url}\n\nOpen it in Chrome\nTap Add to my phone\nTap Notify me\n\nEvery month your salary slip shows there by itself with PDF download`;
  async function toggle() {
    const on = !row.slip_link_on;
    const { error } = await sb().from(table).update({ slip_link_on: on }).eq('id', row.id);
    if (error) { flash(error.message, 'err'); return; }
    onChanged?.({ ...row, slip_link_on: on });
    flash(on ? 'Link turned on' : 'Link turned off');
  }
  return (
    <Modal title={`Send To Employee · ${row.name}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        His own link, made once and never changes. He adds it to his phone once; every month his new salary slip shows there by itself. No login needed.
      </p>
      <div className="pn-link">
        <code>{url}</code>
        <span className={`pn-state ${row.slip_link_on ? 'ok' : 'bad'}`}>{row.slip_link_on ? 'Link is on' : 'Link is off'}</span>
      </div>
      <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
        <a className="btn in" href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">📤 WhatsApp{wa ? ` ${row.mobile || row.phone}` : ''}</a>
        <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(url); flash('Link copied'); }}>📋 Copy link</button>
        <a className="btn ghost" href={url} target="_blank" rel="noreferrer">👁 Open</a>
        <button type="button" className="btn ghost" onClick={toggle}>{row.slip_link_on ? '⛔ Turn link off' : '✅ Turn link on'}</button>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
