// Documents checklist: issue date and expiry of employee papers, cars, heavy vehicles, government licenses and company papers
import { daysLeft } from '@/lib/reminders';

export const SECTIONS = [
  { key: 'employee', icon: '🪪', label: 'Employee Docs', owner: 'Employee', docs: ['Passport', 'Resident Card', 'Visa', 'Labour Card', 'Driving Licence', 'Medical', 'Insurance', 'Employment Contract'] },
  { key: 'car', icon: '🚗', label: 'Cars Docs', owner: 'Car (plate and user)', docs: ['Mulkiya (Registration)', 'Insurance', 'Road Permit'] },
  { key: 'heavy', icon: '🚛', label: 'Heavy Vehicles', owner: 'Vehicle (plate and driver)', docs: ['Mulkiya (Registration)', 'VOC', 'Insurance', 'Road Permit', 'Fitness / Inspection'] },
  { key: 'govt', icon: '🏛️', label: 'Govt License', owner: 'Company', docs: ['Construction License', 'Investment License', 'Transport License', 'Business Brokerage License', 'Information Service Activities', 'Marketing and Promotion Services on Social Media', 'Real Estate License', 'Municipality License', 'Civil Defence'] },
  { key: 'company', icon: '🏢', label: 'Company Docs', owner: 'Company', docs: ['CR Paper', 'VAT Certificate', 'Tax Card', 'Chamber of Commerce', 'Office Agreement', 'Company Insurance'] }
];
export const SECTION = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

// Manual states that stop alerts (a vehicle sold, a license given up)
export const STATES = ['', 'Cancelled', 'Transferred', 'Not needed'];
export const ALERT_DAYS = 30;

/* Status worked out from the expiry date (never typed by hand, so it cannot be wrong) */
export function docStatus(r) {
  if (r.state) return { key: 'off', label: r.state, left: null };
  if (!r.expiry_date) return { key: 'none', label: 'No expiry date', left: null };
  const left = daysLeft(r.expiry_date);
  if (left < 0) return { key: 'bad', label: 'Expired', left };
  if (left <= ALERT_DAYS) return { key: 'soon', label: 'Renew soon', left };
  return { key: 'ok', label: 'Active', left };
}

/*
  Alerts for the Home column: expired or within 30 days.
  extraEmployee: [{ id, owner, doc_name, expiry_date }] from Drivers / Office staff (already alerted there, so skipped here)
*/
export function buildDocReminders(rows = []) {
  const out = [];
  for (const r of rows) {
    const st = docStatus(r);
    if (st.key !== 'bad' && st.key !== 'soon') continue;
    out.push({
      key: `doc-${r.id}-${r.expiry_date}`, kind: 'doc', date: r.expiry_date, left: st.left, urgent: st.left <= 3,
      title: `${r.doc_name || 'Document'} ${st.left < 0 ? 'expired' : 'renewal'}`,
      detail: `${r.owner || ''}${r.doc_no ? ` · No. ${r.doc_no}` : ''} · ${SECTION[r.section]?.label || ''}`,
      href: `/docs?tab=${r.section}`
    });
  }
  return out.sort((a, b) => a.left - b.left);
}
