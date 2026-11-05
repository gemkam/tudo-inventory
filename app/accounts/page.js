'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import DateInput from '@/components/DateInput';
import EditToggle from '@/components/EditToggle';
import AccImport from '@/components/AccImport';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { fmtAmt, monthLabel, exportStamp, exportExcel, exportPdf, todayISO } from '@/lib/sheet';
import { dmy } from '@/lib/groupTools';
import {
  n, r3, ACC_KINDS, TXN_CATS, ITEM_SIDES, sideLabel,
  accountBalance, ledger, tripReceivables, payables, balanceSheet, ageDays, ageBand
} from '@/lib/accounts';

/*
  🏦 Accounts (/accounts, top bar button before Admin, 4 Nov 2026). Tabs (?tab=):
  all      = 📚 All accounts (default): every money page of the app in one place (sales, invoices, bills, payroll,
             tax, reports), with live totals; tiles open the page (Reports & Summary parts open with ?open=)
  bank     = Bank & Cash: accounts with balance, ledger per account (money in / out, running balance,
             ✓ cleared for bank reconciliation), ＋ Money in / out, ⇄ Transfer, month filter, Excel / PDF
  balance  = Balance sheet as on a date: assets, loans and amounts owed, capital, profit kept (balancing figure)
  receive  = Money to receive: trips not fully paid, by age (0-30, 31-60, 61-90, 90+)
  pay      = Money to pay: unpaid bills, driver salaries not paid, office staff balances
  items    = Assets, loans & capital typed by hand (vehicles, deposits, bank loans, owner capital)
  Profit and Loss stays in Reports & Summary, VAT return in All Companies (buttons link there).
  Edit asks the edit password (EditToggle). Data entry can add and change, not delete.
*/

const TABS = [
  ['all', '📚 All accounts'],
  ['bank', '🏦 Bank & Cash'],
  ['balance', '⚖ Balance sheet'],
  ['receive', '📥 Money to receive'],
  ['pay', '📤 Money to pay'],
  ['items', '🏗 Assets, loans & capital']
];
const coLabel = (k) => COMPANIES.find((c) => c.key === k)?.short || k || '';
const money = (v) => fmtAmt(r3(v));

function AccountsPage() {
  const user = useUser();
  const router = useRouter();
  const q = useSearchParams();
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'all';
  const [co, setCo] = useState(q.get('co') || 'all');
  const [D, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [lastImport, setLastImport] = useState(null); // { accounts, txns, items } ids made by the last 📥 Import documents (this visit)
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const flash = useCallback((text, kind = 'ok') => { setToast({ text, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), 2600); }, []);

  const load = useCallback(async () => {
    const s = sb();
    const res = await Promise.all([
      s.from('acc_accounts').select('*').order('sort').order('created_at'),
      s.from('acc_txns').select('*').order('txn_date').order('created_at'),
      s.from('acc_items').select('*').order('sort').order('created_at'),
      s.from('exp_entries').select('id, company, entry_date, bill_no, description, head, paid, unpaid, vat, source_kind'),
      s.from('transport_entries').select('id, driver_id, entry_date, description, from_place, to_place, customer, rent, received, vat_included, diesel'),
      s.from('transport_drivers').select('id, name'),
      s.from('transport_salaries').select('*'),
      s.from('exp_staff').select('*').is('archived_at', null),
      s.from('company_docs').select('id, company, doc_no, doc_date, party, items, vat_pct').eq('kind', 'invoice')
    ]);
    const bad = res.find((x) => x.error);
    if (bad) { setErr(bad.error.message.includes('acc_') ? 'Accounts tables are missing in the database.' : bad.error.message); }
    const [a, t, i, b, tr, dr, sal, st, inv] = res.map((x) => x.data || []);
    setD({ accounts: a, txns: t, items: i, bills: b, trips: tr, drivers: dr, salaries: sal, staff: st, invoices: inv });
  }, []);
  useEffect(() => { load(); }, [load]);

  function goTab(k) {
    const p = new URLSearchParams(q.toString()); p.set('tab', k); if (co !== 'all') p.set('co', co); else p.delete('co');
    router.replace(`/accounts?${p.toString()}`, { scroll: false });
  }
  function pickCo(k) {
    setCo(k);
    const p = new URLSearchParams(q.toString()); if (k !== 'all') p.set('co', k); else p.delete('co');
    router.replace(`/accounts?${p.toString()}`, { scroll: false });
  }

  async function undoImport() {
    if (!lastImport || !confirm('Take back everything added by the last import?')) return;
    const s = sb();
    const steps = [
      lastImport.txns.length && s.from('acc_txns').delete().in('id', lastImport.txns),
      lastImport.items.length && s.from('acc_items').delete().in('id', lastImport.items)
    ].filter(Boolean);
    for (const st of steps) { const r = await st; if (r.error) { flash(r.error.message, 'err'); return; } }
    if (lastImport.accounts.length) { const r = await s.from('acc_accounts').delete().in('id', lastImport.accounts); if (r.error) { flash(r.error.message, 'err'); return; } }
    setLastImport(null); await load(); flash('Import taken back');
  }

  if (!D) return <div className="loading">Loading accounts...</div>;
  const coName = co === 'all' ? 'All companies' : coLabel(co);
  const P = { D, co, coName, edit, user, flash, reload: load };

  return (
    <>
      <div className="company-head ch-top">
        <span className="company-name">Tudo Num Group</span>
        <h1>🏦 Accounts</h1>
        <p className="sub">{coName} · Bank & Cash, Balance sheet, money to receive and to pay</p>
      </div>

      <div className="page-tools">
        <div className="tools">
          <EditToggle on={edit} onClick={() => setEdit((v) => !v)} show={user.isAdmin} />
          {user.isAdmin && (
            <AccImport D={D} co={co} companies={COMPANIES} user={user} flash={flash} disabled={!edit}
              onSaved={async (made, c) => {
                setLastImport(made);
                await load();
                if (c) flash(`Added ${c.txns} money line${c.txns === 1 ? '' : 's'}${c.items ? `, ${c.items} asset / loan / capital` : ''}${c.accounts ? `, ${c.accounts} new account${c.accounts === 1 ? '' : 's'}` : ''}${c.doubles ? ` (${c.doubles} double${c.doubles === 1 ? '' : 's'})` : ''}`);
              }} />
          )}
          {lastImport && edit && user.canDelete !== false && (
            <button type="button" className="btn ghost" onClick={undoImport} title="Take the last import back">↶ Undo import</button>
          )}
          <Link href="/expenses/summary#pl-statement" className="btn">📑 Profit and Loss</Link>
          <Link href="/expenses/vat" className="btn">🧾 VAT return</Link>
        </div>
      </div>

      <div className="ac-tabs no-print" role="tablist" aria-label="Accounts">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>{l}</button>
        ))}
      </div>

      <div className="ats-chips no-print" role="group" aria-label="Companies">
        {[['all', 'All companies'], ...COMPANIES.map((c) => [c.key, c.short])].map(([k, l]) => (
          <button key={k} type="button" className={`rp-chip ${co === k ? 'active' : ''}`} onClick={() => pickCo(k)}>{co === k ? '✓ ' : ''}{l}</button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}

      {tab === 'all' && <HubTab {...P} goTab={goTab} />}
      {tab === 'bank' && <BankTab {...P} />}
      {tab === 'balance' && <BalanceTab {...P} goTab={goTab} />}
      {tab === 'receive' && <ReceiveTab {...P} />}
      {tab === 'pay' && <PayTab {...P} />}
      {tab === 'items' && <ItemsTab {...P} />}

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

/* ---------------- 📚 All accounts: every money page of the app ---------------- */
function HubTab({ D, co, coName, goTab }) {
  const c1 = co === 'all' ? '' : co;
  const cq = c1 ? `co=${c1}` : '';
  const withCo = (base) => (cq ? `${base}${base.includes('?') ? '&' : '?'}${cq}` : base);
  const docCo = c1 || COMPANIES[0].key;
  const today = todayISO();
  const B = balanceSheet(D, co, today);
  const accs = D.accounts.filter((a) => co === 'all' || a.company === co);
  const bankTotal = r3(accs.reduce((s, a) => s + accountBalance(a, D.txns).balance, 0));
  const recTotal = r3(B.rec.reduce((s, x) => s + x.balance, 0));
  const match = (k) => co === 'all' || (k || 'modern-city') === co;
  const thisMonth = today.slice(0, 7);
  const invMonth = D.invoices.filter((x) => match(x.company) && String(x.doc_date).slice(0, 7) === thisMonth).length;
  const billsMonth = r3(D.bills.filter((b) => match(b.company) && String(b.entry_date).slice(0, 7) === thisMonth).reduce((s, b) => s + n(b.paid) + n(b.unpaid), 0));
  const mcOnly = co === 'all' || co === 'modern-city';

  const GROUPS = [
    ['🏦 Bank, cash and position', [
      { t: 'Bank & Cash', d: 'Bank and cash accounts, ledger, transfers, bank reconciliation', v: money(bankTotal), s: `${accs.length} account(s)`, tab: 'bank' },
      { t: 'Balance sheet', d: 'What the company has, what it owes, capital, net worth', v: money(B.netWorth), s: 'net worth today', tab: 'balance' },
      { t: 'Assets, loans & capital', d: 'Vehicles, equipment, deposits, loans, owner capital', v: String(D.items.filter((x) => match(x.company)).length), s: 'item(s) typed', tab: 'items' },
      { t: 'Cash forecast', d: 'Money in and out for the next 30 days, week by week', href: '/expenses/summary?open=cash' }
    ]],
    ['💰 Sales and money to receive', [
      { t: 'Money to receive', d: 'Trips not fully paid, by age', v: money(recTotal), s: `${B.rec.length} trip(s)`, tab: 'receive', hide: !mcOnly },
      { t: 'Sales', d: 'Everything earned: trips and company invoices, by month', href: '/expenses/summary?open=sales' },
      { t: 'Company invoices', d: 'Invoices to customers on the company letterhead', v: String(invMonth), s: 'this month', href: `/expenses/docs?co=${docCo}&kind=invoice` },
      { t: 'Transport invoices', d: 'Transportation Invoice, Tax Invoice, Interim Payment Application', href: '/transport/invoice', hide: !mcOnly },
      { t: 'Trip sheets', d: 'Rent, received, balance and received date of every trip', href: '/transport/trip-sheets', hide: !mcOnly }
    ]],
    ['📤 Expenses and money to pay', [
      { t: 'Money to pay', d: 'Unpaid bills, salaries not paid, staff balances', v: money(B.pay.total), s: 'to pay', tab: 'pay' },
      { t: 'Bills (All Companies)', d: 'Every bill: paid, unpaid, VAT, department, head', v: money(billsMonth), s: 'this month', href: withCo('/expenses') },
      { t: 'Payment receipts', d: 'Supplier bills and purchase receipts, 📥 Import documents', href: `/expenses/docs?co=${docCo}&kind=receipt` },
      { t: 'Unpaid bills by age', d: '0-30, 31-60, 61-90, 90+ days, oldest first', href: '/expenses/summary?open=unpaid' },
      { t: 'Vehicle maintenance & PDC', d: 'Work, charges, PDC cheque dates, Pending / Paid', href: '/transport/vehicles', hide: !mcOnly },
      { t: 'Utility bills', d: 'Electricity, water, dispenser, internet payments', href: '/bills' },
      { t: 'Budgets', d: 'Monthly budget vs actual by head of account', href: '/expenses/summary?open=budget' }
    ]],
    ['👥 Salaries and payroll', [
      { t: 'Salary slips', d: 'Monthly slips, approve, 💵 Salary paid, send to employee', href: withCo('/expenses/salary') },
      { t: 'All Drivers Salary Sheet', d: 'Driver salaries, driver allowance, paid / unpaid', href: '/transport/salary-sheet', hide: !mcOnly },
      { t: 'Office staff salary sheet', d: 'Basic, allowances, working days, deductions', href: withCo('/expenses') },
      { t: 'Attendance', d: 'Absent and half days that lower the salary', href: withCo('/personnel?tab=attendance') }
    ]],
    ['🧾 Tax', [
      { t: 'VAT return', d: 'Output VAT, input VAT, net to pay or claim, by quarter', v: money(Math.abs(B.vat.net)), s: B.vat.net >= 0 ? 'VAT to pay (all time)' : 'VAT to claim (all time)', href: '/expenses/vat' },
      { t: 'Profit and Loss', d: 'Sales, direct costs, gross profit, salaries, expenses, net profit, 15% tax estimate', href: '/expenses/summary?open=pl' }
    ]],
    ['📊 Reports and checks', [
      { t: 'Cash flow', d: 'Money in vs money spent, by month', href: '/expenses/summary?open=cashflow' },
      { t: 'Double work', d: 'Double bills, same amount twice, diesel too high, trips unpaid 60+ days (Home Alerts)', href: '/?dw=1' },
      { t: 'Analytics', d: 'Spending pace, biggest changes, by department, biggest bills', href: '/expenses/summary?open=analytics' },
      { t: 'Reports & Summary', d: 'Whole group: by company, by head, by month, PDF', href: '/expenses/summary' },
      { t: 'Transport reports', d: 'Trips, costs and profit by month and driver', href: '/transport/reports', hide: !mcOnly },
      { t: 'Report by dates', d: 'Any From / To dates, Print or Excel', href: '/transport?do=range', hide: !mcOnly }
    ]]
  ];

  return (
    <>
      <div className="kpi-row">
        <div className="kpi hero"><span>Bank and cash</span><strong>{money(bankTotal)}</strong><small>OMR · {coName}</small></div>
        <div className="kpi"><span>To receive</span><strong>{money(mcOnly ? recTotal : 0)}</strong><small>trips not fully paid</small></div>
        <div className="kpi"><span>To pay</span><strong>{money(B.pay.total)}</strong><small>bills and salaries</small></div>
        <div className="kpi"><span>{B.vat.net >= 0 ? 'VAT to pay' : 'VAT to claim'}</span><strong>{money(Math.abs(B.vat.net))}</strong><small>all time, less VAT paid</small></div>
      </div>
      {GROUPS.map(([title, list]) => (
        <section key={title} className="panel">
          <h2 className="ac-hub-h">{title}</h2>
          <div className="ac-hub">
            {list.filter((x) => !x.hide).map((x) => {
              const inner = (
                <>
                  <b>{x.t}</b>
                  <small>{x.d}</small>
                  {x.v !== undefined && <span className="ac-hub-v"><strong>{x.v}</strong> {x.s}</span>}
                  <span className="ac-hub-go">{x.tab ? 'Open here ›' : 'Open ›'}</span>
                </>
              );
              return x.tab
                ? <button key={x.t} type="button" className="ac-hub-tile here" onClick={() => goTab(x.tab)}>{inner}</button>
                : <Link key={x.t} href={x.href} className="ac-hub-tile">{inner}</Link>;
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/* ---------------- 🏦 Bank & Cash ---------------- */
function BankTab({ D, co, coName, edit, user, flash, reload }) {
  const accs = D.accounts.filter((a) => co === 'all' || a.company === co);
  const [sel, setSel] = useState(null);
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [accForm, setAccForm] = useState(null);
  const [txForm, setTxForm] = useState(null);
  const [trForm, setTrForm] = useState(null);
  const acc = accs.find((a) => a.id === sel) || accs[0] || null;

  const months = useMemo(() => [...new Set(D.txns.filter((t) => acc && t.account_id === acc.id).map((t) => String(t.txn_date).slice(0, 7)))].sort().reverse(), [D.txns, acc]);
  const from = month === 'all' ? '' : `${month}-01`;
  const to = month === 'all' ? '' : `${month}-31`;
  const L = acc ? ledger(acc, D.txns, from, to) : null;
  const ql = search.trim().toLowerCase();
  const shown = L ? L.lines.filter((t) => (!onlyOpen || !t.cleared) && (!ql || [t.description, t.party, t.ref, t.category, t.notes].join(' ').toLowerCase().includes(ql))) : [];
  const total = r3(accs.reduce((s, a) => s + accountBalance(a, D.txns).balance, 0));

  async function saveAcc(f) {
    const row = { company: f.company, name: f.name.trim(), kind: f.kind, bank_name: f.bank_name || null, account_no: f.account_no || null, opening_balance: r3(f.opening_balance), opening_date: f.opening_date || null, active: f.active !== false, notes: f.notes || null };
    if (!row.name) return flash('Type the account name', 'err');
    const r = f.id ? await sb().from('acc_accounts').update(row).eq('id', f.id).select().single() : await sb().from('acc_accounts').insert(row).select().single();
    if (r.error) return flash(r.error.message, 'err');
    setAccForm(null); setSel(r.data.id); await reload(); flash('Account saved');
  }
  async function delAcc(f) {
    if (!confirm(`Delete the account "${f.name}" and all its money in / out lines? This cannot be undone.`)) return;
    const r = await sb().from('acc_accounts').delete().eq('id', f.id);
    if (r.error) return flash(r.error.message, 'err');
    setAccForm(null); setSel(null); await reload(); flash('Account deleted');
  }
  async function saveTx(f) {
    const amt = r3(f.amount);
    if (!amt) return flash('Type the amount', 'err');
    const row = { account_id: f.account_id, txn_date: f.txn_date || todayISO(), description: f.description || null, party: f.party || null, ref: f.ref || null, category: f.category || null, money_in: f.dir === 'in' ? amt : 0, money_out: f.dir === 'out' ? amt : 0, cleared: !!f.cleared, notes: f.notes || null };
    if (!f.id) row.entered_by = user.name;
    const r = f.id ? await sb().from('acc_txns').update(row).eq('id', f.id) : await sb().from('acc_txns').insert(row);
    if (r.error) return flash(r.error.message, 'err');
    setTxForm(null); await reload(); flash(f.id ? 'Line changed' : 'Line added');
  }
  async function delTx(f) {
    if (!confirm('Delete this line?')) return;
    const r = f.transfer_id ? await sb().from('acc_txns').delete().eq('transfer_id', f.transfer_id) : await sb().from('acc_txns').delete().eq('id', f.id);
    if (r.error) return flash(r.error.message, 'err');
    setTxForm(null); await reload(); flash(f.transfer_id ? 'Transfer deleted (both sides)' : 'Line deleted');
  }
  async function toggleCleared(t) {
    const r = await sb().from('acc_txns').update({ cleared: !t.cleared }).eq('id', t.id);
    if (r.error) return flash(r.error.message, 'err');
    await reload();
  }
  async function saveTransfer(f) {
    const amt = r3(f.amount);
    if (!amt || !f.from || !f.to || f.from === f.to) return flash('Choose two different accounts and type the amount', 'err');
    const tid = crypto.randomUUID();
    const nameOf = (id) => D.accounts.find((a) => a.id === id)?.name || '';
    const base = { txn_date: f.txn_date || todayISO(), ref: f.ref || null, category: 'Transfer', transfer_id: tid, entered_by: user.name, notes: f.notes || null };
    const r = await sb().from('acc_txns').insert([
      { ...base, account_id: f.from, description: `Transfer to ${nameOf(f.to)}`, money_out: amt },
      { ...base, account_id: f.to, description: `Transfer from ${nameOf(f.from)}`, money_in: amt }
    ]);
    if (r.error) return flash(r.error.message, 'err');
    setTrForm(null); await reload(); flash('Transfer saved');
  }

  const fileName = `Ledger ${acc?.name || ''} ${month === 'all' ? 'all' : month} ${exportStamp()}`;
  const head = ['Date', 'Description', 'Paid to / from', 'Ref / Cheque', 'Category', 'Money in', 'Money out', 'Balance', 'Cleared'];
  const rowsOut = () => [['', 'Balance brought forward', '', '', '', '', '', money(L.brought), ''], ...shown.map((t) => [dmy(t.txn_date), t.description || '', t.party || '', t.ref || '', t.category || '', n(t.money_in) ? money(t.money_in) : '', n(t.money_out) ? money(t.money_out) : '', money(t.balance), t.cleared ? '✓' : ''])];
  const sub = () => `${coLabel(acc.company)} · ${acc.kind}${acc.bank_name ? ` · ${acc.bank_name}` : ''}${acc.account_no ? ` · A/c ${acc.account_no}` : ''} · ${month === 'all' ? 'All months' : monthLabel(month)}`;

  return (
    <>
      <div className="kpi-row">
        <div className="kpi hero"><span>Total bank and cash</span><strong>{money(total)}</strong><small>OMR · {coName}</small></div>
        <div className="kpi"><span>Accounts</span><strong>{accs.length}</strong><small>{accs.filter((a) => a.kind === 'Bank').length} bank · {accs.filter((a) => a.kind !== 'Bank').length} cash / other</small></div>
        {acc && (() => { const b = accountBalance(acc, D.txns); return (
          <div className="kpi"><span>Cleared by bank ({acc.name})</span><strong>{money(b.cleared)}</strong><small>{b.notCleared} line(s) not cleared yet</small></div>
        ); })()}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Accounts</h2>
          {edit && <div className="ac-row-btns">
            <button type="button" className="btn small" onClick={() => setAccForm({ company: co === 'all' ? COMPANIES[0].key : co, name: '', kind: 'Bank', opening_balance: 0, opening_date: todayISO(), active: true })}>＋ Add account</button>
            {accs.length > 1 && <button type="button" className="btn small" onClick={() => setTrForm({ from: acc?.id, to: accs.find((a) => a.id !== acc?.id)?.id, amount: '', txn_date: todayISO() })}>⇄ Transfer</button>}
          </div>}
        </div>
        {accs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No bank or cash account yet for {coName}. {user.isAdmin ? 'Press ✏️ Edit, then ＋ Add account (for example "Bank Muscat current account" or "Office cash") with the balance on the day you start.' : 'Ask a Full access user to add one.'}</p>
        ) : (
          <div className="ac-cards">
            {accs.map((a) => { const b = accountBalance(a, D.txns); return (
              <button key={a.id} type="button" className={`ac-card${acc?.id === a.id ? ' on' : ''}${a.active ? '' : ' off'}`} onClick={() => setSel(a.id)}>
                <span className="ac-kind">{a.kind === 'Bank' ? '🏦' : a.kind === 'Card' ? '💳' : '💵'} {a.kind} · {coLabel(a.company)}</span>
                <b>{a.name}</b>
                <small>{[a.bank_name, a.account_no && `A/c ${a.account_no}`].filter(Boolean).join(' · ') || ' '}</small>
                <strong className={b.balance < 0 ? 'neg' : ''}>{money(b.balance)}</strong>
                {edit && <span className="ac-edit" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setAccForm({ ...a }); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setAccForm({ ...a }); } }}>✏️ Change</span>}
              </button>
            ); })}
          </div>
        )}
      </section>

      {acc && L && (
        <section className="panel">
          <div className="section-head">
            <h2>Ledger · {acc.name}</h2>
            <div className="ac-row-btns">
              <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                <option value="all">All months</option>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <input type="search" placeholder="🔍 Search" value={search} onChange={(e) => setSearch(e.target.value)} className="ac-search" />
              <label className="ac-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Not cleared only</label>
              {edit && <>
                <button type="button" className="btn small" onClick={() => setTxForm({ account_id: acc.id, dir: 'in', txn_date: todayISO(), amount: '', category: 'Customer payment' })}>＋ Money in</button>
                <button type="button" className="btn small" onClick={() => setTxForm({ account_id: acc.id, dir: 'out', txn_date: todayISO(), amount: '', category: 'Bill payment' })}>＋ Money out</button>
              </>}
              <button type="button" className="btn small" onClick={() => exportExcel(fileName, [{ name: 'Ledger', title: `Bank ledger · ${acc.name}`, subtitle: sub(), head, rows: rowsOut(), numCols: [5, 6, 7], totalsRow: ['', 'Total', '', '', '', money(L.in), money(L.out), money(L.closing), ''] }])}>📗 Excel</button>
              <button type="button" className="btn small" onClick={() => exportPdf(fileName, { title: `Bank ledger · ${acc.name}`, subtitle: sub(), sections: [{ heading: '', head, rows: rowsOut(), numCols: [5, 6, 7], totalsRow: ['', 'Total', '', '', '', money(L.in), money(L.out), money(L.closing), ''] }] })}>📕 PDF</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="ats-table ac-ledger">
              <thead><tr>{head.map((h, i) => <th key={h} className={i >= 5 && i <= 7 ? 'num' : ''}>{h}</th>)}</tr></thead>
              <tbody>
                <tr className="ac-bf"><td /><td colSpan={6}>Balance brought forward{month === 'all' && acc.opening_date ? ` (opening balance on ${dmy(acc.opening_date)})` : ''}</td><td className="num">{money(L.brought)}</td><td /></tr>
                {shown.length === 0 && <tr><td colSpan={9} className="muted">No money in or out {month === 'all' ? 'yet' : `in ${monthLabel(month)}`}.{edit ? ' Use ＋ Money in / ＋ Money out.' : ''}</td></tr>}
                {shown.map((t) => (
                  <tr key={t.id} className={edit ? 'ac-click' : ''} onClick={edit ? () => setTxForm({ ...t, dir: n(t.money_in) ? 'in' : 'out', amount: n(t.money_in) || n(t.money_out) }) : undefined}>
                    <td>{dmy(t.txn_date)}</td>
                    <td>{t.description}{t.transfer_id && <span className="ac-tag">⇄</span>}</td>
                    <td>{t.party}</td>
                    <td>{t.ref}</td>
                    <td>{t.category}</td>
                    <td className="num ac-in">{n(t.money_in) ? money(t.money_in) : ''}</td>
                    <td className="num ac-out">{n(t.money_out) ? money(t.money_out) : ''}</td>
                    <td className={`num${t.balance < 0 ? ' neg' : ''}`}>{money(t.balance)}</td>
                    <td className="ac-clr">
                      {edit ? <input type="checkbox" checked={!!t.cleared} onClick={(e) => e.stopPropagation()} onChange={() => toggleCleared(t)} aria-label="Cleared by bank" /> : t.cleared ? '✓' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td /><td colSpan={4}>Total {month === 'all' ? '' : monthLabel(month)}</td><td className="num">{money(L.in)}</td><td className="num">{money(L.out)}</td><td className="num">{money(L.closing)}</td><td /></tr></tfoot>
            </table>
          </div>
          <p className="note">Tick ✓ Cleared when the line shows on the bank statement. "Cleared by bank" above should then equal the bank statement balance (bank reconciliation).</p>
        </section>
      )}

      {accForm && (
        <Modal title={accForm.id ? 'Change account' : 'Add bank or cash account'} onClose={() => setAccForm(null)}>
          <div className="field"><label>Company</label>
            <select value={accForm.company} onChange={(e) => setAccForm({ ...accForm, company: e.target.value })}>{COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}</select></div>
          <div className="field"><label>Account name</label><input value={accForm.name || ''} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} placeholder="Bank Muscat current account" /></div>
          <div className="ac-two">
            <div className="field"><label>Type</label><select value={accForm.kind} onChange={(e) => setAccForm({ ...accForm, kind: e.target.value })}>{ACC_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
            <div className="field"><label>Bank</label><input value={accForm.bank_name || ''} onChange={(e) => setAccForm({ ...accForm, bank_name: e.target.value })} placeholder="Bank Muscat" /></div>
          </div>
          <div className="field"><label>Account no. (last 4 digits are enough)</label><input value={accForm.account_no || ''} onChange={(e) => setAccForm({ ...accForm, account_no: e.target.value })} /></div>
          <div className="ac-two">
            <div className="field"><label>Opening balance (OMR)</label><input type="number" step="0.001" value={accForm.opening_balance ?? ''} onChange={(e) => setAccForm({ ...accForm, opening_balance: e.target.value })} /></div>
            <div className="field"><label>On date</label><DateInput value={accForm.opening_date || ''} onChange={(v) => setAccForm({ ...accForm, opening_date: v })} /></div>
          </div>
          <label className="ac-check"><input type="checkbox" checked={accForm.active !== false} onChange={(e) => setAccForm({ ...accForm, active: e.target.checked })} /> Account in use</label>
          <div className="modal-actions">
            {accForm.id && user.canDelete && <button type="button" className="btn ghost danger" onClick={() => delAcc(accForm)}>🗑 Delete</button>}
            <button type="button" className="btn ghost" onClick={() => setAccForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={() => saveAcc(accForm)}>✓ Save</button>
          </div>
        </Modal>
      )}

      {txForm && (
        <Modal title={txForm.id ? 'Change line' : txForm.dir === 'in' ? '＋ Money in' : '＋ Money out'} onClose={() => setTxForm(null)}>
          <div className="ac-dir" role="radiogroup">
            {[['in', '⬇ Money in'], ['out', '⬆ Money out']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={txForm.dir === k} className={txForm.dir === k ? 'on' : ''} disabled={!!txForm.transfer_id} onClick={() => setTxForm({ ...txForm, dir: k })}>{l}</button>)}
          </div>
          <div className="ac-two">
            <div className="field"><label>Date</label><DateInput value={txForm.txn_date || ''} onChange={(v) => setTxForm({ ...txForm, txn_date: v })} /></div>
            <div className="field"><label>Amount (OMR)</label><input type="number" step="0.001" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} autoFocus /></div>
          </div>
          <div className="field"><label>Description</label><input value={txForm.description || ''} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder="Payment for Jabal Ali trip" /></div>
          <div className="ac-two">
            <div className="field"><label>{txForm.dir === 'in' ? 'Received from' : 'Paid to'}</label><input list="ac-parties" value={txForm.party || ''} onChange={(e) => setTxForm({ ...txForm, party: e.target.value })} /></div>
            <div className="field"><label>Ref / Cheque no.</label><input value={txForm.ref || ''} onChange={(e) => setTxForm({ ...txForm, ref: e.target.value })} /></div>
          </div>
          <datalist id="ac-parties">{[...new Set(D.txns.map((t) => t.party).filter(Boolean))].map((p) => <option key={p} value={p} />)}</datalist>
          <div className="field"><label>Category</label><select value={txForm.category || ''} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })}><option value="">—</option>{TXN_CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label>Notes</label><input value={txForm.notes || ''} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} /></div>
          <label className="ac-check"><input type="checkbox" checked={!!txForm.cleared} onChange={(e) => setTxForm({ ...txForm, cleared: e.target.checked })} /> Cleared (shows on the bank statement)</label>
          {txForm.transfer_id && <p className="muted" style={{ margin: 0 }}>Part of a transfer: Delete removes both sides.</p>}
          <div className="modal-actions">
            {txForm.id && user.canDelete && <button type="button" className="btn ghost danger" onClick={() => delTx(txForm)}>🗑 Delete</button>}
            <button type="button" className="btn ghost" onClick={() => setTxForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={() => saveTx(txForm)}>✓ Save</button>
          </div>
        </Modal>
      )}

      {trForm && (
        <Modal title="⇄ Transfer between accounts" onClose={() => setTrForm(null)}>
          <div className="field"><label>From</label><select value={trForm.from || ''} onChange={(e) => setTrForm({ ...trForm, from: e.target.value })}>{accs.map((a) => <option key={a.id} value={a.id}>{a.name} ({coLabel(a.company)})</option>)}</select></div>
          <div className="field"><label>To</label><select value={trForm.to || ''} onChange={(e) => setTrForm({ ...trForm, to: e.target.value })}>{accs.map((a) => <option key={a.id} value={a.id}>{a.name} ({coLabel(a.company)})</option>)}</select></div>
          <div className="ac-two">
            <div className="field"><label>Date</label><DateInput value={trForm.txn_date || ''} onChange={(v) => setTrForm({ ...trForm, txn_date: v })} /></div>
            <div className="field"><label>Amount (OMR)</label><input type="number" step="0.001" value={trForm.amount} onChange={(e) => setTrForm({ ...trForm, amount: e.target.value })} /></div>
          </div>
          <div className="field"><label>Ref / Cheque no.</label><input value={trForm.ref || ''} onChange={(e) => setTrForm({ ...trForm, ref: e.target.value })} /></div>
          <p className="muted" style={{ margin: 0 }}>Example: cash deposited into the bank, or money taken out of the bank for petty cash.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setTrForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={() => saveTransfer(trForm)}>✓ Save transfer</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------- ⚖ Balance sheet ---------------- */
function BalanceTab({ D, co, coName, goTab }) {
  const [asOf, setAsOf] = useState(todayISO());
  const B = balanceSheet(D, co, asOf);
  const side = (title, list, total, totalLabel) => {
    const groups = [...new Set(list.map((x) => x.group))];
    return (
      <section className="panel ac-bs">
        <h2>{title}</h2>
        <table className="ats-table">
          <tbody>
            {groups.map((g) => (
              <BsGroup key={g} g={g} list={list.filter((x) => x.group === g)} goTab={goTab} />
            ))}
          </tbody>
          <tfoot><tr><td>{totalLabel}</td><td className="num">{money(total)}</td></tr></tfoot>
        </table>
      </section>
    );
  };
  const rowsOut = () => [
    ...B.assets.map((x) => ['Assets', x.group, x.name, money(x.amount)]), ['', '', 'Total assets', money(B.tA)],
    ...B.liabilities.map((x) => ['Liabilities', x.group, x.name, money(x.amount)]), ['', '', 'Total liabilities', money(B.tL)],
    ...B.equity.map((x) => ['Capital', x.group, x.name, money(x.amount)]), ['', '', 'Total capital', money(B.tE)],
    ['', '', 'Liabilities + capital', money(B.tL + B.tE)]
  ];
  const fileName = `Balance sheet ${coName} ${asOf} ${exportStamp()}`;
  const head = ['Part', 'Group', 'Item', 'Amount (OMR)'];
  return (
    <>
      <div className="ac-row-btns ac-asof no-print">
        <div className="field narrow"><label>As on date</label><DateInput value={asOf} onChange={(v) => setAsOf(v || todayISO())} /></div>
        <button type="button" className="btn small" onClick={() => exportExcel(fileName, [{ name: 'Balance sheet', title: `Balance sheet · ${coName}`, subtitle: `As on ${dmy(asOf)}`, head, rows: rowsOut(), numCols: [3] }])}>📗 Excel</button>
        <button type="button" className="btn small" onClick={() => exportPdf(fileName, { title: `Balance sheet · ${coName}`, subtitle: `As on ${dmy(asOf)}`, landscape: false, sections: [{ heading: '', head, rows: rowsOut(), numCols: [3] }] })}>📕 PDF</button>
      </div>
      <div className="kpi-row">
        <div className="kpi"><span>Total assets</span><strong>{money(B.tA)}</strong><small>what the company has and is owed</small></div>
        <div className="kpi"><span>Total liabilities</span><strong>{money(B.tL)}</strong><small>what the company owes</small></div>
        <div className="kpi hero"><span>Net worth</span><strong>{money(B.netWorth)}</strong><small>assets minus liabilities · {dmy(asOf)}</small></div>
      </div>
      <div className="ac-bs-grid">
        {side('Assets', B.assets, B.tA, 'Total assets')}
        <div>
          {side('Liabilities', B.liabilities, B.tL, 'Total liabilities')}
          {side('Capital', B.equity, B.tE, 'Total capital')}
          <div className="ac-bs-check">Liabilities + capital = <b>{money(B.tL + B.tE)}</b> = Total assets ✓</div>
        </div>
      </div>
      <p className="note">
        Built from the app: bank and cash balances (🏦 Bank & Cash), trips not fully paid, unpaid bills, salaries not paid, VAT
        (output {money(B.vat.output)} − input {money(B.vat.input)} − paid {money(B.vat.paid)}), plus assets, loans and capital typed in 🏗.
        "Profit kept in the business" is what is left after liabilities and capital, so the two sides always match.
        Company invoices are not counted as money to receive (they have no paid / not paid yet). For the official yearly
        balance sheet, give these figures to your accountant to check.
      </p>
    </>
  );
}
function BsGroup({ g, list, goTab }) {
  const go = (l) => { if (!l) return; if (l === 'vat') window.location.href = '/expenses/vat'; else goTab(l.startsWith('bank') ? 'bank' : l); };
  return (
    <>
      <tr className="ac-bs-g"><td colSpan={2}>{g}</td></tr>
      {list.map((x, i) => (
        <tr key={i} className={x.link ? 'ac-click' : ''} onClick={() => go(x.link)}>
          <td className={x.balancing ? 'ac-bal' : ''}>{x.name}</td>
          <td className={`num${x.amount < 0 ? ' neg' : ''}`}>{money(x.amount)}</td>
        </tr>
      ))}
    </>
  );
}

/* ---------------- 📥 Money to receive ---------------- */
function ReceiveTab({ D, co, coName }) {
  const today = todayISO();
  const list = co === 'all' || co === 'modern-city' ? tripReceivables(D.trips, D.drivers) : [];
  const withAge = list.map((x) => ({ ...x, age: ageDays(x.date, today) }));
  const bands = ['0-30', '31-60', '61-90', '90+'].map((b) => ({ b, total: r3(withAge.filter((x) => ageBand(x.age) === b).reduce((s, x) => s + x.balance, 0)) }));
  const total = r3(withAge.reduce((s, x) => s + x.balance, 0));
  const head = ['Trip date', 'Driver', 'Route', 'Customer', 'Rent', 'Received', 'Balance', 'Days'];
  const rowsOut = () => withAge.map((x) => [dmy(x.date), x.driver, x.route, x.customer, money(x.rent), money(x.received), money(x.balance), x.age]);
  const fileName = `Money to receive ${coName} ${exportStamp()}`;
  return (
    <>
      <div className="kpi-row">
        <div className="kpi hero"><span>Money to receive</span><strong>{money(total)}</strong><small>{withAge.length} trip(s)</small></div>
        {bands.map(({ b, total: t }) => <div key={b} className={`kpi${b === '90+' && t > 0 ? ' kpi-bad' : ''}`}><span>{b} days</span><strong>{money(t)}</strong><small>OMR</small></div>)}
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>Trips not fully paid</h2>
          <div className="ac-row-btns">
            <button type="button" className="btn small" onClick={() => exportExcel(fileName, [{ name: 'To receive', title: `Money to receive · ${coName}`, subtitle: `As on ${dmy(today)}`, head, rows: rowsOut(), numCols: [4, 5, 6], totalsRow: ['', '', '', 'Total', '', '', money(total), ''] }])}>📗 Excel</button>
            <button type="button" className="btn small" onClick={() => exportPdf(fileName, { title: `Money to receive · ${coName}`, subtitle: `As on ${dmy(today)}`, sections: [{ heading: '', head, rows: rowsOut(), numCols: [4, 5, 6], totalsRow: ['', '', '', 'Total', '', '', money(total), ''] }] })}>📕 PDF</button>
          </div>
        </div>
        {co !== 'all' && co !== 'modern-city' ? <p className="muted" style={{ margin: 0 }}>Only Transport (Modern City) trips have money to receive in the app now. {coLabel(co)} invoices have no paid / not paid yet.</p> : withAge.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing to receive. All trips are paid.</p> : (
          <div className="table-wrap">
            <table className="ats-table">
              <thead><tr>{head.map((h, i) => <th key={h} className={i >= 4 ? 'num' : ''}>{h}</th>)}</tr></thead>
              <tbody>{withAge.map((x) => (
                <tr key={x.id}><td>{dmy(x.date)}</td><td><Link href={`/transport/${x.driver_id}`}>{x.driver}</Link></td><td>{x.route}</td><td>{x.customer}</td>
                  <td className="num">{money(x.rent)}</td><td className="num">{money(x.received)}</td><td className="num"><b>{money(x.balance)}</b></td>
                  <td className={`num${x.age > 60 ? ' neg' : ''}`}>{x.age}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={6}>Total</td><td className="num">{money(total)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ---------------- 📤 Money to pay ---------------- */
function PayTab({ D, co, coName }) {
  const today = todayISO();
  const P = payables(D, co);
  const all = [...P.bills, ...P.salaries, ...P.staff].map((x) => ({ ...x, age: ageDays(x.date, today) }));
  const sum = (l) => r3(l.reduce((s, x) => s + x.amount, 0));
  const head = ['Type', 'Company', 'Date', 'Bill no.', 'Details', 'Amount', 'Days'];
  const rowsOut = () => all.map((x) => [x.kind, coLabel(x.company), x.date ? dmy(x.date) : '', x.ref, x.text, money(x.amount), x.age ?? '']);
  const fileName = `Money to pay ${coName} ${exportStamp()}`;
  return (
    <>
      <div className="kpi-row">
        <div className="kpi hero"><span>Money to pay</span><strong>{money(P.total)}</strong><small>{coName}</small></div>
        <div className="kpi"><span>Unpaid bills</span><strong>{money(sum(P.bills))}</strong><small>{P.bills.length} bill(s)</small></div>
        <div className="kpi"><span>Driver salaries</span><strong>{money(sum(P.salaries))}</strong><small>not paid</small></div>
        <div className="kpi"><span>Office staff</span><strong>{money(sum(P.staff))}</strong><small>salary balance</small></div>
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>Everything to pay</h2>
          <div className="ac-row-btns">
            <button type="button" className="btn small" onClick={() => exportExcel(fileName, [{ name: 'To pay', title: `Money to pay · ${coName}`, subtitle: `As on ${dmy(today)}`, head, rows: rowsOut(), numCols: [5], totalsRow: ['', '', '', '', 'Total', money(P.total), ''] }])}>📗 Excel</button>
            <button type="button" className="btn small" onClick={() => exportPdf(fileName, { title: `Money to pay · ${coName}`, subtitle: `As on ${dmy(today)}`, sections: [{ heading: '', head, rows: rowsOut(), numCols: [5], totalsRow: ['', '', '', '', 'Total', money(P.total), ''] }] })}>📕 PDF</button>
          </div>
        </div>
        {all.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing to pay for {coName}.</p> : (
          <div className="table-wrap">
            <table className="ats-table">
              <thead><tr>{head.map((h, i) => <th key={h} className={i >= 5 ? 'num' : ''}>{h}</th>)}</tr></thead>
              <tbody>{all.map((x, i) => (
                <tr key={i}><td>{x.kind}{x.auto && <span className="ac-tag">🔗 Auto</span>}</td><td>{coLabel(x.company)}</td><td>{x.date ? dmy(x.date) : ''}</td><td>{x.ref}</td><td>{x.text}</td>
                  <td className="num"><b>{money(x.amount)}</b></td><td className={`num${x.age > 30 ? ' neg' : ''}`}>{x.age ?? ''}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={5}>Total</td><td className="num">{money(P.total)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        <p className="note">Bills come from All Companies (Unpaid column, including vehicle maintenance not paid). Salaries from the salary sheets (Paid boxes).</p>
      </section>
    </>
  );
}

/* ---------------- 🏗 Assets, loans & capital ---------------- */
function ItemsTab({ D, co, coName, edit, user, flash, reload }) {
  const list = D.items.filter((x) => co === 'all' || x.company === co);
  const [form, setForm] = useState(null);
  async function save(f) {
    const row = { company: f.company, side: f.side, name: (f.name || '').trim(), amount: r3(f.amount), as_of: f.as_of || null, notes: f.notes || null };
    if (!row.name) return flash('Type the name', 'err');
    const r = f.id ? await sb().from('acc_items').update(row).eq('id', f.id) : await sb().from('acc_items').insert(row);
    if (r.error) return flash(r.error.message, 'err');
    setForm(null); await reload(); flash('Saved');
  }
  async function del(f) {
    if (!confirm(`Delete "${f.name}"?`)) return;
    const r = await sb().from('acc_items').delete().eq('id', f.id);
    if (r.error) return flash(r.error.message, 'err');
    setForm(null); await reload(); flash('Deleted');
  }
  const opts = ITEM_SIDES.find((s) => s[0] === form?.side)?.[2] || [];
  return (
    <>
      {ITEM_SIDES.map(([side, title, examples]) => {
        const rows = list.filter((x) => x.side === side);
        const total = r3(rows.reduce((s, x) => s + n(x.amount), 0));
        return (
          <section key={side} className="panel">
            <div className="section-head">
              <h2>{title}</h2>
              {edit && <button type="button" className="btn small" onClick={() => setForm({ side, company: co === 'all' ? COMPANIES[0].key : co, name: '', amount: '', as_of: todayISO() })}>＋ Add</button>}
            </div>
            {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing yet. Examples: {examples.slice(0, 4).join(', ')}.</p> : (
              <div className="table-wrap">
                <table className="ats-table">
                  <thead><tr><th>Name</th><th>Company</th><th>As on</th><th>Notes</th><th className="num">Amount</th></tr></thead>
                  <tbody>{rows.map((x) => (
                    <tr key={x.id} className={edit ? 'ac-click' : ''} onClick={edit ? () => setForm({ ...x }) : undefined}>
                      <td><b>{x.name}</b></td><td>{coLabel(x.company)}</td><td>{x.as_of ? dmy(x.as_of) : ''}</td><td>{x.notes}</td><td className="num">{money(x.amount)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><td colSpan={4}>Total</td><td className="num">{money(total)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </section>
        );
      })}
      <p className="note">These go straight into the ⚖ Balance sheet. Type the value today (for a vehicle: price minus wear so far; for a loan: what is still to repay).</p>
      {form && (
        <Modal title={`${form.id ? 'Change' : 'Add'} · ${sideLabel(form.side)}`} onClose={() => setForm(null)}>
          <div className="ac-two">
            <div className="field"><label>Type</label><select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>{ITEM_SIDES.map(([k]) => <option key={k} value={k}>{sideLabel(k)}</option>)}</select></div>
            <div className="field"><label>Company</label><select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>{COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.short}</option>)}</select></div>
          </div>
          <div className="field"><label>Name</label><input list="ac-item-names" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={opts[0] || ''} /></div>
          <datalist id="ac-item-names">{opts.map((o) => <option key={o} value={o} />)}</datalist>
          <div className="ac-two">
            <div className="field"><label>Amount (OMR)</label><input type="number" step="0.001" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label>As on</label><DateInput value={form.as_of || ''} onChange={(v) => setForm({ ...form, as_of: v })} /></div>
          </div>
          <div className="field"><label>Notes</label><input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="modal-actions">
            {form.id && user.canDelete && <button type="button" className="btn ghost danger" onClick={() => del(form)}>🗑 Delete</button>}
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={() => save(form)}>✓ Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><Suspense fallback={<div className="loading">Loading accounts...</div>}><AccountsPage /></Suspense></AuthGate>;
}
