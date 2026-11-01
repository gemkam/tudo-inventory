'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import SlipPaper from '@/components/SlipPaper';
import { slipPdf, monthName, m3 } from '@/lib/salarySlips';

/* 👁 Slip: the person's monthly slips (newest first) with month buttons, PDF. slips = that person's salary_slips rows */
export default function SlipViewer({ name, slips, onClose }) {
  const list = [...(slips || [])].sort((a, b) => b.month.localeCompare(a.month));
  const [m, setM] = useState(list[0]?.month || '');
  const s = list.find((x) => x.month === m) || list[0];
  return (
    <Modal title={`Salary slip · ${name}`} onClose={onClose}>
      {!list.length && <p className="muted" style={{ marginTop: 0 }}>No slip yet. Make it in All Companies › 💰 Salary (⚙ Generate drafts).</p>}
      {list.length > 1 && (
        <div className="ss-months">
          {list.map((x) => <button key={x.month} type="button" className={x.month === s?.month ? 'on' : ''} onClick={() => setM(x.month)}>{monthName(x.month)}{x.status === 'draft' ? ' · Draft' : ''}</button>)}
        </div>
      )}
      {s && s.status === 'draft' && <p className="ssp-rev" style={{ marginTop: 0 }}>Draft: the employee cannot see it yet (approve it or mark the salary paid).</p>}
      {s && <SlipPaper s={s} />}
      {s && (s.history || []).length > 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Earlier versions: {(s.history || []).map((h) => `v${h.version || 1} Net ${m3(h.net)}`).join(' · ')}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        {s && <button type="button" className="btn in" onClick={() => slipPdf(s)}>⬇ PDF</button>}
      </div>
    </Modal>
  );
}
