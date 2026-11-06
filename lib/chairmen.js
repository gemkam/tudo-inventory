/*
  👑 Chairman (6 Nov 2026, Kamran): top bar button before Admin. Inside: one button per chairman.
  - Asif Altaf: full access, the whole app, all companies (login "asif").
  - Sibtain: no access yet. Kamran will add another company later and give him access to that company only.
  username = the login name (Users page). Empty = no login yet.
  companies: 'all' = every company, [] = none yet, later e.g. ['new-company-key'].
*/
export const CHAIRMEN = [
  { key: 'asif', name: 'Asif Altaf', username: 'asif', companies: 'all' },
  { key: 'sibtain', name: 'Sibtain', username: '', companies: [] }
];

export const chairmanOf = (key) => CHAIRMEN.find((c) => c.key === key) || null;
export const chairmanForUser = (user) => CHAIRMEN.find((c) => c.username && c.username === user?.username) || null;
/* Administrator sees every chairman; a chairman sees only his own button */
export const canSeeChairman = (user) => !!(user?.isOwner || chairmanForUser(user));
export const canOpenChairman = (user, key) => !!(user?.isOwner || chairmanForUser(user)?.key === key);
export const hasAccess = (c) => c.companies === 'all' || (Array.isArray(c.companies) && c.companies.length > 0);
