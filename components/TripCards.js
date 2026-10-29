'use client';

import { useEffect, useState } from 'react';
import DateInput from '@/components/DateInput';
import { TextInput, PayRow, money } from '@/components/PayCard';
import { fmtDay } from '@/lib/sheet';

/*
  Trip sheet VERTICAL (app/transport/[id]): one card per trip, easy to read on phone and PC.
  View: date, status, route From → To, description, Money (rent, received, balance), Driver (allowance), Costs.
  Edit (✏️ Edit on): every field becomes a box (amounts accept maths like 25+4), Delete per card, + Add trip.
  Uses the page's column list for labels and dropdown options. CSS: tc-* (and pc-row) in app/globals.css.
*/

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;

function calc(text) {
  const t = String(text).replace(/\s+/g, '');
  if (t === '') return null;
  if (!/^[\d.+\-*/()]+$/.test(t)) return NaN;
  try { const v = Function(`"use strict";return (${t})`)(); return Number.isFinite(v) ? r3(v) : NaN; } catch { return NaN; }
}

function MathInput({ value, onSave, flash }) {
  const [t, setT] = useState(n(value) ? String(value) : '');
  useEffect(() => { setT(n(value) ? String(value) : ''); }, [value]);
  const commit = () => {
    const v = calc(t);
    if (Number.isNaN(v)) { flash?.('Only numbers and + − × ÷', 'err'); setT(n(value) ? String(value) : ''); return; }
    const next = v ?? 0;
    if (next !== r3(value)) onSave(next);
    setT(next ? String(next) : '');
  };
  return (
    <input className="pc-in" type="text" inputMode="decimal" value={t} placeholder="0.000" style={{ width: 110 }}
      onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

const tagCls = (v, bad, good) => (bad.test(v || '') ? 'due' : good.test(v || '') ? 'ok' : 'info');

export default function TripCards({ rows, columns, canEdit, onSave, onAdd, onDelete, flash, allowLabel, totals, prevOpenTotal = 0, addLabel = '+ Add trip or expense' }) {
  const col = (k) => columns.find((c) => c.key === k) || { key: k, label: k };
  const opts = (k) => col(k).options || [];
  const lab = (k) => col(k).label;

  const field = (r, k) => {
    const c = col(k);
    if (c.type === 'date') return <DateInput value={r[k] || ''} onChange={(v) => onSave(r, k, v || null)} />;
    if (c.type === 'select') {
      return (
        <select className="pc-in" value={r[k] || ''} onChange={(e) => onSave(r, k, e.target.value || null)}>
          <option value="">–</option>
          {opts(k).map((o) => <option key={o} value={o}>{o}</option>)}
          {r[k] && !opts(k).includes(r[k]) && <option value={r[k]}>{r[k]}</option>}
        </select>
      );
    }
    if (c.type === 'number') return <MathInput value={r[k]} onSave={(v) => onSave(r, k, v)} flash={flash} />;
    return <TextInput value={r[k]} onSave={(v) => onSave(r, k, v || null)} width={180} />;
  };

  return (
    <>
      {rows.length === 0 ? <p className="muted">No trips in this month.</p> : (
        <div className="tc-grid">
          {rows.map((r, i) => {
            const bal = r3(n(r.rent) - n(r.received));
            const expense = !n(r.rent) && (n(r.maintenance) > 0 || n(r.toll) > 0 || n(r.diesel) > 0);
            const costs = r3(n(r.diesel) + n(r.toll) + n(r.maintenance));
            return (
              <section key={r.id} className={`pc-card tc-card ${expense ? 'tc-exp' : bal > 0 ? 'tc-due' : ''} ${canEdit ? 'editing' : ''}`}>
                <header className="tc-top">
                  <span className="tc-no">{i + 1}</span>
                  <div className="tc-date">
                    {canEdit ? field(r, 'entry_date') : <b>{fmtDay(r.entry_date)}</b>}
                    {expense && <span className="tc-kind">Expense</span>}
                  </div>
                  {!canEdit && r.remarks && <span className={`tc-tag ${tagCls(r.remarks, /cancel/i, /complet|done/i)}`}>{r.remarks}</span>}
                </header>

                <div className="tc-route">
                  {canEdit ? (
                    <div className="tc-route-edit">
                      <label><span>{lab('from_place')}</span>{field(r, 'from_place')}</label>
                      <label><span>{lab('to_place')}</span>{field(r, 'to_place')}</label>
                    </div>
                  ) : (r.from_place || r.to_place) ? (
                    <div className="tc-way"><b>{r.from_place || '–'}</b><span>→</span><b>{r.to_place || '–'}</b></div>
                  ) : null}
                  {canEdit ? (
                    <label className="tc-desc-edit"><span>{lab('description')}</span>{field(r, 'description')}</label>
                  ) : r.description ? <p className="tc-desc">{r.description}</p> : null}
                </div>

                <div className="pc-body">
                  {canEdit && <PayRow label={lab('remarks')}>{field(r, 'remarks')}</PayRow>}
                  {(canEdit || n(r.rent) || n(r.received)) ? (
                    <div className="pc-sec">
                      <h4>Money</h4>
                      <PayRow label={lab('rent')} value={r.rent}>{canEdit ? field(r, 'rent') : undefined}</PayRow>
                      <PayRow label={lab('received')} value={r.received}>{canEdit ? field(r, 'received') : undefined}</PayRow>
                      {(canEdit || r.received_date) && (
                        <PayRow label={lab('received_date')}>
                          {canEdit ? field(r, 'received_date') : <span className={r.received_date !== r.entry_date ? 'late-pay' : ''}>{fmtDay(r.received_date)}</span>}
                        </PayRow>
                      )}
                      <PayRow label="Balance" kind={bal > 0 ? 'due' : 'total'}>{bal ? money(bal) : 'Nil ✓'}</PayRow>
                      <PayRow label={lab('payment_status')}>
                        {canEdit ? field(r, 'payment_status') : r.payment_status ? <span className={`tc-tag ${tagCls(r.payment_status, /not/i, /receiv/i)}`}>{r.payment_status}</span> : '–'}
                      </PayRow>
                    </div>
                  ) : null}

                  {(canEdit || n(r.driver_allowance)) ? (
                    <div className="pc-sec">
                      <h4>Driver</h4>
                      <PayRow label={lab('driver_allowance')} value={r.driver_allowance}>{canEdit ? field(r, 'driver_allowance') : undefined}</PayRow>
                      <PayRow label={lab('allowance_status')}>
                        {canEdit ? field(r, 'allowance_status') : r.allowance_status ? <span className={`tc-tag ${r.allowance_status === 'Paid' ? 'ok' : 'warn'}`}>{allowLabel ? allowLabel(r) : r.allowance_status}</span> : '–'}
                      </PayRow>
                    </div>
                  ) : null}

                  {(canEdit || costs) ? (
                    <div className="pc-sec">
                      <h4>Costs</h4>
                      {['diesel', 'toll', 'maintenance'].map((k) => (canEdit || n(r[k])) ? (
                        <PayRow key={k} label={lab(k)} value={r[k]}>{canEdit ? field(r, k) : undefined}</PayRow>
                      ) : null)}
                      {!canEdit && costs > 0 && <PayRow label="Total costs" value={costs} kind="total" />}
                    </div>
                  ) : null}

                  {(canEdit || r.credit_in || r.entered_by) && (
                    <div className="tc-foot">
                      {canEdit ? (
                        <>
                          <PayRow label={lab('credit_in')}>{field(r, 'credit_in')}</PayRow>
                          <PayRow label={lab('entered_by')}>{field(r, 'entered_by')}</PayRow>
                        </>
                      ) : (
                        <>
                          {r.credit_in && <span>💳 {lab('credit_in')}: <b>{r.credit_in}</b></span>}
                          {r.entered_by && <span>👤 {lab('entered_by')}: <b>{r.entered_by}</b></span>}
                        </>
                      )}
                    </div>
                  )}
                  {canEdit && (
                    <div className="pc-del">
                      <button type="button" className="btn small danger" onClick={() => onDelete(r)}>🗑 Delete</button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {canEdit && <button type="button" className="btn in" style={{ marginTop: 12 }} onClick={onAdd}>{addLabel}</button>}

      {rows.length > 0 && totals && (
        <section className="pc-card tc-total">
          <header className="pc-top"><div className="pc-name"><b>Totals · {totals.trips} trips</b></div></header>
          <div className="pc-body tc-total-body">
            <div className="pc-sec">
              <h4>Money</h4>
              <PayRow label="Total rent" value={totals.rent} />
              <PayRow label="Received" value={totals.received} />
              <PayRow label="Balance to collect" kind={totals.balance > 0 ? 'due' : 'total'}>{totals.balance ? money(totals.balance) : 'Nil ✓'}</PayRow>
            </div>
            <div className="pc-sec">
              <h4>Driver and costs</h4>
              <PayRow label="Driver allowance" value={totals.driver_allowance} note={prevOpenTotal > 0 ? `+ previous ${money(prevOpenTotal)} not paid` : undefined} />
              <PayRow label="Diesel" value={totals.diesel} />
              <PayRow label="Toll / other" value={totals.toll} />
              <PayRow label="Maintenance" value={totals.maintenance} />
            </div>
            <PayRow label="Net before salary" value={totals.net} kind="net" />
          </div>
        </section>
      )}
    </>
  );
}
