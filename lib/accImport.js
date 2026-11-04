/*
  📥 Import documents in 🏦 Accounts (4 Nov 2026). Pure helpers used by components/AccImport.js.
  A line found in a file is one of:
    in / out  -> acc_txns (Bank & Cash ledger: money in / money out of one account)
    asset / liability / equity -> acc_items (Assets, loans & capital)
  Tables with headers (Excel, CSV, Word) are read here; anything else goes to the AI (app/api/acc-import).
*/
import { isoDate } from '@/lib/peopleImport';
import { TXN_CATS, ITEM_SIDES } from '@/lib/accounts';

const n = (v) => Number(v || 0);
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const LINE_TYPES = [
  ['in', 'Money in'],
  ['out', 'Money out'],
  ['asset', 'Asset'],
  ['liability', 'Loan / owed'],
  ['equity', 'Capital']
];
export const isTxn = (t) => t === 'in' || t === 'out';

/* money text like "1,234.500", "(25.000)", "OMR 12.5", "12.500 CR" -> number (negative for brackets / DR minus) */
export function money(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  const x = Number(s);
  if (!Number.isFinite(x)) return 0;
  return neg ? -x : x;
}

const HEAD = [
  ['date', ['date', 'txn date', 'transaction date', 'value date', 'posting date', 'trans date', 'as of', 'as on', 'tarikh']],
  ['description', ['description', 'details', 'narration', 'particulars', 'remarks', 'transaction details', 'memo', 'item', 'name of asset', 'asset', 'purpose']],
  ['party', ['party', 'payee', 'paid to', 'received from', 'beneficiary', 'customer', 'supplier', 'vendor', 'from to', 'name']],
  ['ref', ['ref', 'reference', 'ref no', 'cheque', 'cheque no', 'chq no', 'chq', 'voucher', 'voucher no', 'receipt no', 'doc no', 'transaction id']],
  ['category', ['category', 'type of payment', 'head', 'account head', 'head of account']],
  ['out', ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'payment', 'payments', 'dr', 'debit amount', 'out']],
  ['in', ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'receipt', 'receipts', 'cr', 'credit amount', 'in']],
  ['amount', ['amount', 'value', 'amount omr', 'amount ro', 'total', 'sum']],
  ['kind', ['type', 'dr cr', 'side', 'kind']],
  ['balance', ['balance', 'running balance', 'closing balance', 'available balance']],
  ['notes', ['notes', 'note', 'comment', 'comments']]
];
export function headerField(h) {
  const s = norm(h);
  if (!s) return null;
  for (const [k, words] of HEAD) if (words.includes(s)) return k;
  for (const [k, words] of HEAD) if (words.some((w) => w.length > 3 && s.includes(w))) return k;
  return null;
}

/* one table (array of rows) -> lines, or null when no header row with a date + money column is found */
export function mapTable(rows) {
  const top = Math.min(rows.length, 15);
  for (let i = 0; i < top; i += 1) {
    const cols = (rows[i] || []).map(headerField);
    const has = (k) => cols.includes(k);
    if (!(has('in') || has('out') || has('amount'))) continue;
    if (!(has('date') || has('description'))) continue;
    const at = (row, k) => { const j = cols.indexOf(k); return j < 0 ? '' : row[j]; };
    const out = [];
    for (const row of rows.slice(i + 1)) {
      if (!row || !row.some((c) => String(c ?? '').trim())) continue;
      const desc = String(at(row, 'description') ?? '').trim();
      if (/^(total|grand total|sub ?total|closing balance|opening balance|balance b ?f|balance c ?f)/i.test(desc)) continue;
      let inn = money(at(row, 'in'));
      let outt = money(at(row, 'out'));
      if (!inn && !outt && has('amount')) {
        const a = money(at(row, 'amount'));
        const k = norm(at(row, 'kind'));
        if (/^(dr|debit|out|payment|withdrawal)/.test(k) || a < 0) outt = Math.abs(a); else inn = Math.abs(a);
      }
      if (!inn && !outt) continue;
      out.push({
        type: outt && !inn ? 'out' : 'in',
        date: isoDate(at(row, 'date')),
        description: desc,
        party: String(at(row, 'party') ?? '').trim(),
        ref: String(at(row, 'ref') ?? '').trim(),
        category: String(at(row, 'category') ?? '').trim(),
        amount: r3(Math.abs(outt && !inn ? outt : inn)),
        notes: String(at(row, 'notes') ?? '').trim()
      });
    }
    return out;
  }
  return null;
}

/* AI / table line -> clean line for the review list */
export function cleanLine(x) {
  const t = String(x.type || '').toLowerCase();
  const type = LINE_TYPES.some(([k]) => k === t) ? t : /out|debit|pay|withdraw/.test(t) ? 'out' : /loan|liab|owe/.test(t) ? 'liability' : /capital|equity/.test(t) ? 'equity' : /asset/.test(t) ? 'asset' : 'in';
  const cat = String(x.category || '').trim();
  const catOk = isTxn(type) ? (TXN_CATS.find((c) => norm(c) === norm(cat)) || '') : '';
  return {
    type,
    date: isoDate(x.date),
    description: String(x.description || x.name || '').trim(),
    party: String(x.party || '').trim(),
    ref: String(x.ref || '').trim(),
    category: catOk || (isTxn(type) ? '' : cat),
    amount: r3(Math.abs(money(x.amount))),
    notes: [String(x.notes || '').trim(), cat && !catOk && isTxn(type) ? `Category in file: ${cat}` : ''].filter(Boolean).join(' · ')
  };
}

/* doubles: same account + date + amount + direction (+ same ref when both have one) as a saved line or an earlier one in this import */
export const txnKey = (accId, date, type, amount) => `${accId}|${String(date || '').slice(0, 10)}|${type}|${r3(amount).toFixed(3)}`;
export function savedTxnIndex(txns = []) {
  const m = new Map();
  for (const t of txns) {
    const type = n(t.money_out) && !n(t.money_in) ? 'out' : 'in';
    const k = txnKey(t.account_id, t.txn_date, type, type === 'out' ? t.money_out : t.money_in);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}
export const itemKey = (company, side, name, amount) => `${company}|${side}|${norm(name)}|${r3(amount).toFixed(3)}`;

/* account picked from what the file says (account number last 4 digits, bank name) */
export function matchAccount(hint, accounts = [], company) {
  const no = String(hint?.account_no || '').replace(/\D/g, '');
  const bank = norm(hint?.bank_name);
  const list = accounts.filter((a) => !company || company === 'all' || a.company === company);
  if (no.length >= 4) {
    const hit = list.find((a) => String(a.account_no || '').replace(/\D/g, '').endsWith(no.slice(-4)));
    if (hit) return hit.id;
  }
  if (bank) {
    const hit = list.find((a) => norm(a.bank_name) && (norm(a.bank_name).includes(bank) || bank.includes(norm(a.bank_name))));
    if (hit) return hit.id;
  }
  return '';
}

export const itemCats = (side) => ITEM_SIDES.find((s) => s[0] === side)?.[2] || [];
