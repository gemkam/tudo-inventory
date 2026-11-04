// 📥 Import docs for Personnel (4 Nov 2026), used by components/PeopleImport.js and app/personnel/page.js.
// Pure helpers (no React, no network):
//   FIELDS          the boxes a person can have (one list for every tab; each tab saves the ones its table has)
//   mapTable(rows)  a sheet from Excel / CSV / Word table -> people, by reading the header row (Name, Passport, Mobile ...)
//   cleanPerson(p)  tidy one person (dates to YYYY-MM-DD, numbers, Yes/No)
//   dupKeys / findDup  DOUBLES: same passport, same resident card, same mobile (last 8 digits) or same name
//                      (words in any order) as someone already saved (Archives too) or earlier in the same import
//   toRow(p, tab)   the row saved in exp_staff (Office / Site), transport_drivers (Drivers) or personnel_subcontractors

export const FIELDS = [
  ['name', 'Name'],
  ['designation', 'Designation'],
  ['company', 'Company'],
  ['mobile', 'Mobile'],
  ['passport', 'Passport'],
  ['resident_card', 'Resident card No.'],
  ['resident_card_expiry', 'Resident card expiry'],
  ['visa_expiry', 'Visa expiry'],
  ['contract', 'Contract'],
  ['basic', 'Basic'],
  ['allowances', 'Allowance total'],
  ['house_rent', 'House rent'],
  ['utilities', 'Utilities'],
  ['transport_allow', 'Transport'],
  ['ticket', 'Ticket'],
  ['vehicle_no', 'Vehicle'],
  ['company_name', 'Company name'],
  ['notes', 'Notes']
];
export const DATE_FIELDS = ['resident_card_expiry', 'visa_expiry'];
export const NUM_FIELDS = ['basic', 'allowances', 'house_rent', 'utilities'];

/* which boxes each tab shows in the review list */
export const TAB_FIELDS = {
  office: ['name', 'designation', 'company', 'mobile', 'passport', 'resident_card', 'resident_card_expiry', 'visa_expiry', 'contract', 'basic', 'allowances', 'house_rent', 'utilities', 'transport_allow', 'ticket'],
  site: ['name', 'designation', 'company', 'mobile', 'passport', 'resident_card', 'resident_card_expiry', 'visa_expiry', 'contract', 'basic', 'allowances', 'house_rent', 'utilities', 'transport_allow', 'ticket'],
  drivers: ['name', 'company', 'mobile', 'vehicle_no', 'passport', 'resident_card', 'resident_card_expiry', 'visa_expiry', 'contract', 'basic', 'allowances', 'house_rent', 'utilities', 'ticket'],
  sub: ['name', 'company', 'company_name', 'mobile', 'contract']
};

/* header words -> field (lower case, without dots and extra spaces) */
const HEAD = [
  ['name', /^(s\.?\s*no\.?\s*)?(full\s*)?(employee|staff|driver|worker|person|subcontractor)?\s*name$|^name of (the )?(employee|staff|driver)|^employee$|^staff$|^driver$|^الاسم|^اسم/],
  ['designation', /designation|position|job|title|profession|occupation|trade|role|المهنة|الوظيفة/],
  ['company', /^(company|employer|sponsor|visa (company|on)|works? for|working for|الشركة|الكفيل)$/],
  ['company_name', /company name|firm|supplier|contractor company/],
  ['mobile', /mobile|phone|contact|tel|whats\s*app|gsm|cell|الهاتف|رقم الجوال/],
  ['passport', /passport|جواز/],
  ['resident_card_expiry', /(resident|residence|civil|labour|labor|id)\s*(card)?\s*(expiry|exp|valid|end)|^r\s?c\s*(card)?\s*exp/],
  ['visa_expiry', /visa\s*(expiry|exp|valid|end)|^visa$/],
  ['resident_card', /(resident|residence|civil|labour|labor)\s*(card)?\s*(no|number|#)?$|^r\s?c(\s*(no|number))?$|^(id|civil id|id no|id number)$|البطاقة|المدنية/],
  ['contract', /contract|agreement|العقد/],
  ['basic', /basic|^salary$|monthly salary|^pay$|wage|الراتب/],
  ['house_rent', /house|room|rent|accommodation|housing|سكن/],
  ['utilities', /utilit|electric|water/],
  ['transport_allow', /transport/],
  ['allowances', /allowance|^total allow|other allow/],
  ['ticket', /ticket|air\s*fare|تذكرة/],
  ['vehicle_no', /vehicle|plate|truck|unit|المركبة/],
  ['notes', /note|remark|comment|ملاحظ/]
];

const low = (s) => String(s ?? '').replace(/[.:#_*]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function headerField(h) {
  const s = low(h);
  if (!s) return '';
  for (const [f, re] of HEAD) if (re.test(s)) return f;
  return '';
}

/* rows = [[cell, cell ...], ...] from one sheet. Finds the header row (first 15 rows) that has a Name column
   and at least one other known column, then reads every row under it. Returns null when no header is found. */
export function mapTable(rows) {
  const top = Math.min(rows.length, 15);
  for (let h = 0; h < top; h += 1) {
    const fields = (rows[h] || []).map(headerField);
    const nameCol = fields.indexOf('name');
    const known = fields.filter(Boolean).length;
    if (nameCol < 0 || known < 2) continue;
    // a column header used twice keeps the first one
    const seen = new Set();
    const cols = fields.map((f) => { if (!f || seen.has(f)) return ''; seen.add(f); return f; });
    const out = [];
    for (let r = h + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const p = {};
      cols.forEach((f, i) => { if (f && row[i] !== undefined && row[i] !== null && String(row[i]).trim() !== '') p[f] = row[i]; });
      const nm = String(p.name ?? '').trim();
      if (!nm || /^(total|grand total|sub ?total|المجموع)/i.test(nm) || /^\d+(\.\d+)?$/.test(nm)) continue;
      out.push(p);
    }
    return out;
  }
  return null;
}

/* ---------- tidy values ---------- */
const pad = (x) => String(x).padStart(2, '0');
export function isoDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates can arrive a few seconds before midnight or at UTC midnight: round to the nearest day
    const d = new Date(v.getTime() + 12 * 3600000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel day number
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/); // day/month/year (Oman)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; if (+m[2] <= 12) return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,})[- ,]*(\d{2,4})$/); // 12-Mar-2027
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase());
    if (mo >= 0) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${pad(mo + 1)}-${pad(m[1])}`; }
  }
  return '';
}
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
};
const yesNo = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/^(no|n|false|0|none|-|لا)$/.test(s)) return 'No';
  return 'Yes';
};
const txt = (v) => (v instanceof Date ? isoDate(v) : String(v ?? '').replace(/\s+/g, ' ').trim());

export function cleanPerson(p) {
  const o = {};
  for (const [f] of FIELDS) {
    const v = p[f];
    if (DATE_FIELDS.includes(f)) o[f] = isoDate(v);
    else if (NUM_FIELDS.includes(f)) { const x = num(v); o[f] = x === null ? '' : String(x); }
    else if (f === 'transport_allow') o[f] = yesNo(v);
    else if (f === 'mobile') o[f] = txt(v).replace(/\.0$/, '');
    else o[f] = txt(v);
  }
  return o;
}

/* ---------- doubles ---------- */
const normName = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1).sort().join(' ');
const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normPhone = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-8) : ''; };

/* the same shape for a saved person of any table */
export function personOf(row, table) {
  return {
    name: row.name,
    passport: row.passport,
    resident_card: row.resident_card,
    mobile: table === 'transport_drivers' ? row.phone : table === 'personnel_subcontractors' ? row.contact : row.mobile
  };
}

export function dupKeys(p) {
  const k = [];
  const pp = normId(p.passport); if (pp.length >= 5) k.push(['passport', pp, 'passport']);
  const rc = normId(p.resident_card); if (rc.length >= 5) k.push(['resident_card', rc, 'resident card No.']);
  const ph = normPhone(p.mobile); if (ph) k.push(['mobile', ph, 'mobile']);
  const nm = normName(p.name); if (nm) k.push(['name', nm, 'name']);
  return k;
}

/* index = Map(key -> { who, where }) built from saved people (and earlier rows of this import) */
export function makeIndex(list) {
  const idx = new Map();
  for (const { person, who, where } of list) for (const [f, v] of dupKeys(person)) { const key = `${f}:${v}`; if (!idx.has(key)) idx.set(key, { who, where }); }
  return idx;
}
export function findDup(p, idx) {
  // one line per person: "same passport, mobile and name as Ali Khan (Office)"
  const by = new Map();
  for (const [f, v, label] of dupKeys(p)) {
    const h = idx.get(`${f}:${v}`);
    if (!h) continue;
    const who = `${h.who}${h.where ? ` (${h.where})` : ''}`;
    if (!by.has(who)) by.set(who, []);
    by.get(who).push(label);
  }
  const join = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0]);
  return [...by.entries()].map(([who, l]) => `same ${join(l)} as ${who}`).join(' · ');
}

/* doubles inside one saved list (for the red rows in the Personnel tables): id -> reason */
export function doublesIn(rows, table) {
  const out = {};
  const seen = new Map();
  for (const r of rows) {
    for (const [f, v, label] of dupKeys(personOf(r, table))) {
      const key = `${f}:${v}`;
      const first = seen.get(key);
      if (first && first.id !== r.id) {
        out[r.id] = out[r.id] || `Double: same ${label} as ${first.name}`;
        out[first.id] = out[first.id] || `Double: same ${label} as ${r.name}`;
      } else if (!first) seen.set(key, r);
    }
  }
  return out;
}

/* row to insert for the tab; company = company key */
export function toRow(p, tab, company, sort) {
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const s = (v) => (v ? String(v) : null);
  if (tab === 'office' || tab === 'site') {
    const hr = n(p.house_rent) || 0;
    const ut = n(p.utilities) || 0;
    return {
      company, name: p.name, staff_type: tab === 'site' ? 'Site' : 'Office', working_days: 30, sort,
      designation: s(p.designation), mobile: s(p.mobile), passport: s(p.passport), resident_card: s(p.resident_card),
      resident_card_expiry: p.resident_card_expiry || null, visa_expiry: p.visa_expiry || null, contract: s(p.contract),
      basic: n(p.basic) || 0, house_rent: hr, utilities: ut, allowances: Math.max(n(p.allowances) || 0, hr + ut),
      transport_allow: p.transport_allow === 'Yes', ticket: s(p.ticket)
    };
  }
  if (tab === 'drivers') {
    const hr = n(p.house_rent) || 0;
    const ut = n(p.utilities) || 0;
    return {
      company, name: p.name, status: 'Active', sort, phone: s(p.mobile), vehicle_no: s(p.vehicle_no), passport: s(p.passport),
      resident_card: s(p.resident_card), resident_card_expiry: p.resident_card_expiry || null, visa_expiry: p.visa_expiry || null,
      contract: s(p.contract), salary: n(p.basic), house_rent: hr, utilities: ut, allowances: Math.max(n(p.allowances) || 0, hr + ut),
      ticket: s(p.ticket), notes: s(p.notes)
    };
  }
  return { company: company || null, name: p.name, sort, company_name: s(p.company_name), contract: s(p.contract), contact: s(p.mobile) };
}
