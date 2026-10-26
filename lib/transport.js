import { num } from '@/lib/sheet';

export const SALARY_FIELDS = [
  ['basic', 'Basic salary'],
  ['room_rent', 'Room rent'],
  ['utilities', 'Utilities'],
  ['mobile', 'Mobile allowance'],
  ['travel_food', 'Travel food'],
  ['trip_allowance', 'Trip allowance']
];

export function salaryTotal(s) {
  if (!s) return 0;
  return num(SALARY_FIELDS.reduce((t, [k]) => t + Number(s[k] || 0), 0));
}

export function salaryPayable(s) {
  if (!s) return 0;
  return num(salaryTotal(s) - Number(s.advance_deduction || 0) + Number(s.special_allowance || 0));
}
