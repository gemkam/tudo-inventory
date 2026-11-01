/*
  Monthly salary slips made by the app (1 Nov 2026). Table salary_slips (one per person per month).
  Office / Site staff (exp_staff): earnings = Basic + House rent + Utilities + Other allowance (full month);
    deductions = Unpaid days from Attendance (absent + half of half days, on a 30 day month) + the salary sheet
    Deductions + any typed by the office. Net = monthly - deductions.
  Drivers (transport_drivers): from the Transport salary sheet of that month (transport_salaries):
    earnings = the salary fields + special allowance, deduction = advance. Net = salaryPayable.
  Deduction lines: { label, amount, auto } . auto lines are rebuilt on Regenerate, the office's own lines are kept.
  Employees see only approved slips (link /s/<token>). Changing an approved slip = a revision (version + 1,
  reason, old copy kept in history).
*/
import { personMonth, PAY_BASIS } from '@/lib/attendance';
import { SALARY_FIELDS, salaryPayable } from '@/lib/transport';
import { COMPANIES } from '@/lib/expenses';
import { omrInWords } from '@/lib/words';

const n = (v) => Number(v || 0);
export const r3 = (v) => Math.round(n(v) * 1000) / 1000;
export const m3 = (v) => n(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
export const mKey = (d) => String(d || '').slice(0, 7);
export const monthName = (k) => { if (!k) return ''; const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
export const prevMonth = (k) => { const [y, m] = k.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
export const companyInfo = (key) => COMPANIES.find((c) => c.key === key) || null;

const DRIVER_LABEL = { basic: 'Basic salary', room_rent: 'House rent', utilities: 'Utilities', mobile: 'Mobile allowance', travel_food: 'Travel food', trip_allowance: 'Driver allowance', allowance_carried: 'Driver allowance of earlier months' };

export function totals(s) {
  const earn = (s.earnings || []).reduce((t, x) => t + n(x.amount), 0);
  const ded = (s.deductions || []).reduce((t, x) => t + n(x.amount), 0);
  return { gross: r3(earn), deduction_total: r3(ded), net: r3(earn - ded) };
}

/* keep the office's own deduction lines, rebuild the automatic ones */
function mergeDeductions(auto, old) {
  const own = (old?.deductions || []).filter((x) => !x.auto);
  return [...auto.filter((x) => n(x.amount)), ...own];
}

export function buildStaffSlip(p, marks, month, old = null) {
  const type = p.staff_type || 'Office';
  const st = personMonth(month, marks || {}, '', type);
  const basic = n(p.basic);
  const allow = n(p.allowances);
  const hr = n(p.house_rent);
  const ut = n(p.utilities);
  const other = r3(Math.max(0, allow - hr - ut));
  const monthly = r3(basic + allow);
  const earnings = [
    { label: 'Basic salary', amount: basic },
    { label: 'House rent', amount: hr },
    { label: 'Utilities', amount: ut },
    { label: 'Other allowance', amount: other }
  ].filter((x) => x.amount);
  const unpaid = r3(monthly - (monthly / PAY_BASIS) * st.payDays);
  const bits = [st.absent ? `${st.absent} absent` : '', st.half ? `${st.half} half day${st.half === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  const auto = [
    { label: `Unpaid days (${bits || 'none'})`, amount: unpaid, auto: true },
    { label: 'Deductions (salary sheet)', amount: n(p.deductions), auto: true }
  ];
  const slip = {
    person_kind: 'staff', person_id: p.id, month, company: p.company, name: p.name,
    designation: p.designation || p.department || '', staff_type: type,
    basic, house_rent: hr, utilities: ut, other_allow: other, transport_allow: !!p.transport_allow,
    earnings, monthly, pay_days: st.payDays, absent: st.absent, half: st.half, leave: st.leave,
    deductions: mergeDeductions(auto, old)
  };
  return { ...slip, ...totals(slip) };
}

export function buildDriverSlip(d, sal, month, old = null) {
  if (!sal) return null;
  const earnings = SALARY_FIELDS.map(([k]) => ({ label: k === 'allowance_carried' && sal.allowance_carried_note ? `${DRIVER_LABEL[k]} (${sal.allowance_carried_note})` : DRIVER_LABEL[k], amount: n(sal[k]) })).filter((x) => x.amount);
  if (n(sal.special_allowance)) earnings.push({ label: 'Special allowance', amount: n(sal.special_allowance) });
  const auto = [{ label: 'Advance deduction', amount: n(sal.advance_deduction), auto: true }];
  const slip = {
    person_kind: 'driver', person_id: d.id, month, company: d.company || 'modern-city', name: d.name,
    designation: 'Driver', staff_type: 'Driver',
    basic: n(sal.basic), house_rent: n(sal.room_rent), utilities: n(sal.utilities), other_allow: 0, transport_allow: false,
    earnings, monthly: r3(earnings.reduce((t, x) => t + x.amount, 0)), pay_days: null, absent: 0, half: 0, leave: 0,
    deductions: mergeDeductions(auto, old)
  };
  const t = totals(slip);
  // same Net as the Transport salary sheet
  if (!(old?.deductions || []).some((x) => !x.auto)) t.net = r3(salaryPayable(sal));
  return { ...slip, ...t };
}

/* what is different from the saved slip (to show "changed" before Regenerate) */
export function sameMoney(a, b) {
  return a && b && r3(a.net) === r3(b.net) && r3(a.gross) === r3(b.gross) && r3(a.deduction_total) === r3(b.deduction_total);
}

/* A4 PDF of one slip (text, small file) */
export async function slipPdf(s) {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const co = companyInfo(s.company);
  const W = doc.internal.pageSize.getWidth();
  const green = [19, 131, 107];
  doc.setFillColor(...green); doc.rect(0, 0, W, 6, 'F');
  if (co?.logo) {
    try {
      const img = await fetch(co.logo).then((r) => r.blob()).then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }));
      doc.addImage(img, 'PNG', 40, 24, 54, 54);
    } catch { /* no logo */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30, 30, 30);
  doc.text(co?.name || String(s.company || ''), 104, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  if (co) { doc.text(co.cr, 104, 58); doc.text(co.address, 104, 70); }
  doc.setDrawColor(...green); doc.setLineWidth(1.2); doc.line(40, 90, W - 40, 90);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...green);
  doc.text('SALARY SLIP', W / 2, 118, { align: 'center' });
  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  doc.text(monthName(s.month) + (s.version > 1 ? `  (Revised ${s.revised_at ? new Date(s.revised_at).toLocaleDateString('en-GB') : ''})` : ''), W / 2, 134, { align: 'center' });

  autoTable(doc, {
    startY: 150, theme: 'plain', styles: { fontSize: 10, cellPadding: 3 },
    body: [
      ['Employee', s.name || '', 'Month', monthName(s.month)],
      ['Designation', s.designation || '', 'Type', s.staff_type || ''],
      ...(s.pay_days != null ? [['Pay days', `${s.pay_days} of 30`, 'Absent / Half / Leave', `${n(s.absent)} / ${n(s.half)} / ${n(s.leave)}`]] : [])
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 2: { fontStyle: 'bold', cellWidth: 120 } }
  });
  const rows = Math.max((s.earnings || []).length, (s.deductions || []).filter((x) => n(x.amount)).length);
  const ded = (s.deductions || []).filter((x) => n(x.amount));
  const body = [];
  for (let i = 0; i < rows; i++) {
    const e = s.earnings[i]; const d = ded[i];
    body.push([e?.label || '', e ? m3(e.amount) : '', d?.label || '', d ? m3(d.amount) : '']);
  }
  body.push([{ content: 'Total earnings', styles: { fontStyle: 'bold' } }, { content: m3(s.gross), styles: { fontStyle: 'bold' } }, { content: 'Total deductions', styles: { fontStyle: 'bold' } }, { content: m3(s.deduction_total), styles: { fontStyle: 'bold' } }]);
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 12, head: [['Earnings', 'OMR', 'Deductions', 'OMR']], body,
    theme: 'grid', styles: { fontSize: 10 }, headStyles: { fillColor: green },
    columnStyles: { 1: { halign: 'right', cellWidth: 80 }, 3: { halign: 'right', cellWidth: 80 } }
  });
  let y = doc.lastAutoTable.finalY + 26;
  doc.setFillColor(232, 245, 240); doc.rect(40, y - 16, W - 80, 30, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...green);
  doc.text('NET PAY', 52, y + 3); doc.text(`OMR ${m3(s.net)}`, W - 52, y + 3, { align: 'right' });
  y += 30;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(70, 70, 70);
  doc.text(doc.splitTextToSize(omrInWords(s.net), W - 80), 40, y);
  if (s.note) { y += 22; doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(`Note: ${s.note}`, W - 80), 40, y); }
  if (s.version > 1 && s.revise_reason) { y += 18; doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(`Revised: ${s.revise_reason}`, W - 80), 40, y); }
  doc.setFontSize(8); doc.setTextColor(140, 140, 140);
  doc.text('This salary slip is made by Tudo Num Office Systems.', W / 2, doc.internal.pageSize.getHeight() - 30, { align: 'center' });
  doc.save(`Salary slip ${s.name} ${monthName(s.month)}.pdf`);
}
