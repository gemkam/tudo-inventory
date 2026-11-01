'use client';

/* Salary Credited button: grey "Not paid" → green "✓ Paid 01/11" (tap again to undo, asks first) */
export default function PaidButton({ credit, canEdit, onPay, onUndo }) {
  const paid = !!credit;
  const when = paid ? new Date(credit.paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : '';
  return (
    <button type="button" className={`paid-btn${paid ? ' on' : ''}`} disabled={!canEdit}
      title={paid ? `Paid ${new Date(credit.paid_at).toLocaleString('en-GB')}${credit.paid_by ? ` by ${credit.paid_by}` : ''}` : 'Press when the salary is paid'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (paid) { if (window.confirm('Mark this salary as NOT paid?')) onUndo(); } else onPay(); }}>
      {paid ? `✓ Paid ${when}` : '○ Not paid'}
    </button>
  );
}
