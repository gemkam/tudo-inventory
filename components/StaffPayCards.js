'use client';

import DateInput from '@/components/DateInput';
import Expiry from '@/components/Expiry';
import { PayCard, PaySection, PayRow, AmountInput, TextInput, BalanceBox, PaySummary } from '@/components/PayCard';
import { staffGross, staffNet } from '@/lib/expenses';
import { hasPaidCols, staffBalance } from '@/lib/payBalance';
import { monthLabel, todayISO } from '@/lib/sheet';
import { fmtD } from '@/lib/reminders';

/*
  Office staff salary sheet of one company (Office Expense page), VERTICAL: one card per staff member.
  View: details, salary rows top to bottom, net pay, paid, UNPAID BALANCE (previous balance + net − paid).
  Edit (✏️ Edit on): every field becomes a box, + Add staff, Delete.
  Paid can be typed by Administrator / Full access any time (needs supabase/salary-paid.sql).
*/

const n = (v) => Number(v || 0);

export default function StaffPayCards({ staff, canEdit, canPay, onSave, onAdd, onDelete }) {
  const tracked = staff.some(hasPaidCols);
  const hasType = staff.some((x) => Object.prototype.hasOwnProperty.call(x, 'staff_type'));

  const savePaid = (s, v) => {
    onSave(s, 'paid_amount', v);
    onSave(s, 'paid_on', v ? (s.paid_on || todayISO()) : null);
  };

  return (
    <>
      {!tracked && staff.length > 0 && (
        <div className="ss-msg warn">Payments are not recorded yet. Run <b>supabase/salary-paid.sql</b> once in Supabase to type what was paid and see the unpaid balance.</div>
      )}
      {staff.length === 0 ? (
        <p className="muted">No staff yet.{canEdit ? '' : ' Press ✏️ Edit, then + Add staff.'}</p>
      ) : (
        <div className="pc-grid">
          {staff.map((s, i) => {
            const net = staffNet(s);
            const bal = staffBalance(s, net);
            return (
              <PayCard key={s.id} no={i + 1} className={canEdit ? 'editing' : ''}
                title={canEdit ? <TextInput value={s.name} onSave={(v) => onSave(s, 'name', v || 'New staff')} placeholder="Name" /> : s.name}
                badge={bal == null ? null : bal > 0.0005 ? <span className="pc-tag due">Not paid</span> : <span className="pc-tag ok">Paid ✓</span>}
                meta={canEdit ? [] : [
                  ['Department', s.department],
                  hasType ? ['Type', s.staff_type || 'Office'] : null,
                  ['Resident Card', s.resident_card],
                  ['Resident Card expiry', s.resident_card_expiry ? <Expiry date={s.resident_card_expiry} /> : null],
                  ['Visa expiry', s.visa_expiry ? <Expiry date={s.visa_expiry} /> : null]
                ]}>
                {canEdit && (
                  <PaySection title="Details">
                    <PayRow label="Department"><TextInput value={s.department} onSave={(v) => onSave(s, 'department', v)} width={170} /></PayRow>
                    {hasType && (
                      <PayRow label="Type">
                        <select className="pc-in" value={s.staff_type || 'Office'} onChange={(e) => onSave(s, 'staff_type', e.target.value)}>
                          <option>Office</option><option>Site</option>
                        </select>
                      </PayRow>
                    )}
                    <PayRow label="Resident Card No."><TextInput value={s.resident_card} onSave={(v) => onSave(s, 'resident_card', v)} width={170} /></PayRow>
                    <PayRow label="Resident Card expiry"><DateInput value={s.resident_card_expiry || ''} onChange={(v) => onSave(s, 'resident_card_expiry', v || null)} /></PayRow>
                    <PayRow label="Visa expiry"><DateInput value={s.visa_expiry || ''} onChange={(v) => onSave(s, 'visa_expiry', v || null)} /></PayRow>
                  </PaySection>
                )}
                <PaySection title="Salary">
                  <PayRow label="Basic pay" value={s.basic}>{canEdit ? <AmountInput value={s.basic} onSave={(v) => onSave(s, 'basic', v ?? 0)} /> : undefined}</PayRow>
                  <PayRow label="Allowances" value={s.allowances}>{canEdit ? <AmountInput value={s.allowances} onSave={(v) => onSave(s, 'allowances', v ?? 0)} /> : undefined}</PayRow>
                  <PayRow label="Working days" note={s.attendance_month ? `from 🗓 attendance ${monthLabel(s.attendance_month)}` : 'out of 30'}>
                    {canEdit ? <AmountInput value={s.working_days} width={80} onSave={(v) => onSave(s, 'working_days', v ?? 0)} /> : String(n(s.working_days))}
                  </PayRow>
                  <PayRow label="Total gross" value={staffGross(s)} kind="total" note="(Basic + Allowances) ÷ 30 × days" />
                </PaySection>
                <PaySection title="Deductions">
                  <PayRow label="Deductions / advances" value={s.deductions} kind="minus">{canEdit ? <AmountInput value={s.deductions} onSave={(v) => onSave(s, 'deductions', v ?? 0)} /> : undefined}</PayRow>
                </PaySection>
                <PayRow label="Net pay" value={net} kind="net" />
                {hasPaidCols(s) && (
                  <>
                    {(canEdit || n(s.prev_balance) > 0) && (
                      <PayRow label="Previous unpaid balance" value={s.prev_balance} kind="plus" note="from earlier months">
                        {canEdit ? <AmountInput value={s.prev_balance} onSave={(v) => onSave(s, 'prev_balance', v ?? 0)} /> : undefined}
                      </PayRow>
                    )}
                    <PayRow label="Paid" kind="paid" value={s.paid_amount} note={s.paid_on ? `on ${fmtD(s.paid_on)}` : undefined}>
                      {canPay ? (
                        <span className="pc-pay">
                          <AmountInput value={s.paid_amount} onSave={(v) => savePaid(s, v)} />
                          {bal > 0.0005 && <button type="button" className="btn small in no-print" onClick={() => savePaid(s, Math.round((n(s.paid_amount) + bal) * 1000) / 1000)}>✓ Full</button>}
                        </span>
                      ) : (s.paid_amount == null ? '–' : undefined)}
                    </PayRow>
                    <BalanceBox total={bal} lines={[['Previous months not paid', Math.max(0, n(s.prev_balance) - n(s.paid_amount))], ['This month not paid', Math.max(0, net - Math.max(0, n(s.paid_amount) - n(s.prev_balance)))]]} />
                  </>
                )}
                {canEdit && (
                  <div className="pc-del no-print">
                    <button type="button" className="btn small danger" onClick={() => { if (window.confirm(`Delete ${s.name}?`)) onDelete(s); }}>🗑 Delete</button>
                  </div>
                )}
              </PayCard>
            );
          })}
        </div>
      )}
      {canEdit && <button type="button" className="btn in no-print" style={{ marginTop: 12 }} onClick={onAdd}>+ Add staff</button>}
      {staff.length > 0 && (
        <>
          <h3 className="pc-h3">Totals</h3>
          <PaySummary tracked={tracked} netLabel="Net pay" rows={staff.map((s) => {
            const net = staffNet(s);
            return { key: s.id, name: s.name, net, paid: hasPaidCols(s) ? n(s.paid_amount) : null, balance: hasPaidCols(s) ? Math.max(0, staffBalance(s, net)) : 0 };
          })} />
        </>
      )}
    </>
  );
}
