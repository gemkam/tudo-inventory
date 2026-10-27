// Office expense (Sumptuosity Tropical LLC) helpers
export const EXP_COMPANY = 'SUMPTUOSITY TROPICAL L.L.C';

export const HEADS = [
  'Entertainment',
  'Govt Fees, Registration and Renewals',
  'IT, Mobile and Computer',
  'Marketing',
  'Mobile Telephone and Internet',
  'Office Expenses',
  'Salary',
  'Utility',
  'Vehicle Running and Maintenance'
];

export const CATEGORIES = ['Food', 'Water', 'Documentation', 'Electronics', 'Marketing', 'Sponsorship', 'Cards', 'Mobile', 'Mobile Service', 'Internet',
  'Stationary', 'Office', 'Office Expense', 'Building Material', 'Furniture', 'Utensils', 'Service', 'Contract', 'Misc', 'Salary', 'Utility', 'Petrol', 'Car', 'Car service'];

export const n = (v) => Number(v || 0);
export const r3 = (v) => Math.round(n(v) * 1000) / 1000;

/* Salary sheet (from the Excel): gross = (basic + allowances) / 30 x working days, net = gross - deductions */
export function staffGross(s) { return r3(((n(s.basic) + n(s.allowances)) / 30) * n(s.working_days)); }
export function staffNet(s) { return r3(staffGross(s) - n(s.deductions)); }
