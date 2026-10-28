/*
  WHOLE APP WATCH for Rauf (Group Summary AI assistant). Server side only.
  Reads every part of the app (as the logged-in user, so database rules still apply) and writes a short text of
  everything that needs attention: money to pay, money to receive, renewals and cheques, low stock, bills, budgets.
  Kept compact on purpose so the AI free limits are not used up.
*/

const n3 = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0; };
const f = (v) => n3(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const mk = (d) => String(d || '').slice(0, 7);
const mName = (k) => { const [y, m] = String(k).split('-').map(Number); return y ? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''; };
const CO = { 'modern-city': 'Modern City', 'abu-wasif': 'Abu Wasif', sumptuosity: 'Sumptuosity' };
const SAL = ['basic', 'room_rent', 'utilities', 'mobile', 'travel_food', 'trip_allowance'];
const payable = (s) => n3(SAL.reduce((t, k) => t + Number(s[k] || 0), 0) - Number(s.advance_deduction || 0) + Number(s.special_allowance || 0));

function muscatToday() {
  const p = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' }); // YYYY-MM-DD
  return p.slice(0, 10);
}
function daysFrom(today, d) {
  if (!d) return null;
  return Math.round((new Date(`${String(d).slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
}
const when = (left) => (left < 0 ? `${-left} day(s) OVERDUE` : left === 0 ? 'TODAY' : left === 1 ? 'tomorrow' : `in ${left} days`);

export async function appWatchData(supa) {
  const q = (p) => p.then((r) => r.data || []).catch(() => []);
  const [exp, te, ts, drv, veh, maint, docs, budgets, cats, bills, accounts, staff, checklist] = await Promise.all([
    q(supa.from('exp_entries').select('company, department, entry_date, bill_no, description, head, paid, unpaid, source_kind')),
    q(supa.from('transport_entries').select('driver_id, entry_date, from_place, to_place, description, rent, received, driver_allowance, allowance_status')),
    q(supa.from('transport_salaries').select('*')),
    q(supa.from('transport_drivers').select('id, name, vehicle_no, status, resident_card, resident_card_expiry, visa_expiry')),
    q(supa.from('transport_vehicles').select('*')),
    q(supa.from('vehicle_maintenance').select('*')),
    q(supa.from('company_docs').select('company, kind, doc_no, doc_date, party, items, vat_pct, department')),
    q(supa.from('exp_budgets').select('*')),
    q(supa.from('categories').select('name, items(name, unit, quantity, min_qty)')),
    q(supa.from('bill_payments').select('account_id, amount, paid_on, period')),
    q(supa.from('bill_accounts').select('id, name, payment_type')),
    q(supa.from('exp_staff').select('company, name, department, basic, allowances, working_days, deductions, active, resident_card, resident_card_expiry, visa_expiry')),
    q(supa.from('doc_checklist').select('section, owner, doc_name, doc_no, issue_date, expiry_date, state'))
  ]);
  return { exp, te, ts, drv, veh, maint, docs, budgets, cats, bills, accounts, staff, checklist };
}

export function appWatchContext(D) {
  const today = muscatToday();
  const thisM = mk(today);
  const name = (id) => D.drv.find((d) => d.id === id)?.name || 'driver';
  const vLabel = (id) => { const v = D.veh.find((x) => x.id === id); return v ? `${v.name || ''} ${v.plate_no || ''} (${v.part || 'vehicle'})`.trim() : 'vehicle'; };
  const L = [];
  let urgent = 0;

  L.push('=== WHOLE APP WATCH (all modules: Office Expense of the 3 companies, Transport, Vehicles, Inventory, Bills, Invoices and Receipts). Use this for any question about alerts, what to pay, what is due, what to collect, renewals, low stock. ===');
  L.push(`Today: ${dmy(today)}.`);

  // 1. Renewals, cheques and services (vehicles)
  const rem = [];
  for (const v of D.veh) {
    for (const [what, d] of [['VOC', v.voc_expiry], ['Mulkiya', v.mulkiya_expiry]]) {
      const left = daysFrom(today, d);
      if (d && left <= 60) rem.push({ left, text: `${what} renewal for ${vLabel(v.id)}: expires ${dmy(d)}, ${when(left)}` });
    }
  }
  for (const m of D.maint) {
    if (m.payment_method === 'PDC' && m.pdc_date && m.status !== 'Paid') {
      const left = daysFrom(today, m.pdc_date);
      rem.push({ left, text: `PDC cheque to pay ${f(m.amount)} OMR to ${m.paid_to || 'supplier'} for ${m.work || 'maintenance'} on ${vLabel(m.vehicle_id)}: cheque date ${dmy(m.pdc_date)}, ${when(left)}` });
    }
    if (m.next_due) {
      const redone = D.maint.some((o) => o.id !== m.id && o.vehicle_id === m.vehicle_id && o.work === m.work && o.work_date && o.work_date > m.work_date);
      const left = daysFrom(today, m.next_due);
      if (!redone && left <= 30) rem.push({ left, text: `${m.work || 'Service'} due for ${vLabel(m.vehicle_id)}: ${dmy(m.next_due)}, ${when(left)}` });
    }
  }
  const people = [...D.drv.filter((d) => d.status !== 'Inactive').map((d) => ({ ...d, who: `${d.name} (driver)` })),
    ...D.staff.filter((x) => x.active !== false).map((x) => ({ ...x, who: `${x.name} (${CO[x.company] || x.company} staff)` }))];
  for (const p of people) {
    for (const [what, d] of [['Resident Card', p.resident_card_expiry], ['Visa', p.visa_expiry]]) {
      const left = daysFrom(today, d);
      if (d && left <= 60) rem.push({ left, text: `${what} renewal for ${p.who}: expires ${dmy(d)}, ${when(left)}` });
    }
  }
  const SEC = { employee: 'Employee doc', car: 'Car doc', heavy: 'Heavy vehicle doc', govt: 'Govt license', company: 'Company doc' };
  for (const c of D.checklist || []) {
    if (c.state || !c.expiry_date) continue;
    const left = daysFrom(today, c.expiry_date);
    if (left <= 60) rem.push({ left, text: `${SEC[c.section] || 'Document'} ${c.doc_name || ''} for ${c.owner || '-'}: expires ${dmy(c.expiry_date)}, ${when(left)} (Documents Checklist)` });
  }
  const noPeopleDates = people.filter((p) => !p.resident_card_expiry || !p.visa_expiry).map((p) => p.who);
  rem.sort((a, b) => a.left - b.left);
  urgent += rem.filter((r) => r.left <= 7).length;
  L.push('');
  L.push(`RENEWALS (VOC, Mulkiya, Resident Card, Visa, Documents Checklist: company papers, govt licenses, car and heavy vehicle docs, employee docs), CHEQUES AND SERVICES (next 60 days or overdue): ${rem.length || 'none'}`);
  rem.forEach((r) => L.push(`- ${r.text}`));
  const noDates = D.veh.filter((v) => !v.voc_expiry || !v.mulkiya_expiry);
  if (noPeopleDates.length) L.push(`- Note: Resident Card or Visa expiry not entered for ${noPeopleDates.join(', ')} (add on Drivers page or Office Expense salary sheet).`);
  if (noDates.length) L.push(`- Note: VOC or Mulkiya expiry date not entered for ${noDates.map((v) => vLabel(v.id)).join(', ')}, so no reminder can be given for them (add dates on the Vehicles page).`);

  // 2. Money to pay
  L.push('');
  L.push('MONEY TO PAY:');
  const unpaid = D.exp.filter((r) => n3(r.unpaid) > 0 && r.source_kind !== 'maint'); // vehicle maintenance is listed in b)
  const byCo = {};
  unpaid.forEach((r) => { byCo[r.company] = n3((byCo[r.company] || 0) + n3(r.unpaid)); });
  const unpaidTotal = n3(unpaid.reduce((t, r) => t + n3(r.unpaid), 0));
  L.push(`a) Unpaid office bills (all 3 companies, all months, not counting vehicle maintenance): ${unpaid.length} bill(s), ${f(unpaidTotal)} OMR. ${Object.entries(byCo).map(([c, v]) => `${CO[c] || c} ${f(v)}`).join(', ')}`);
  unpaid.map((r) => ({ ...r, age: -daysFrom(today, r.entry_date) })).sort((a, b) => b.age - a.age).slice(0, 25)
    .forEach((r) => L.push(`  - ${dmy(r.entry_date)} | ${CO[r.company] || r.company}${r.department ? ` / ${r.department}` : ''} | ${r.head || ''} | ${f(r.unpaid)} OMR | ${r.age} days old | ${[r.bill_no, r.description].filter(Boolean).join(' ')}`));
  const mPend = D.maint.filter((m) => m.status !== 'Paid' && n3(m.amount) > 0);
  L.push(`b) Vehicle maintenance not paid yet: ${mPend.length}, ${f(mPend.reduce((t, m) => t + n3(m.amount), 0))} OMR`);
  mPend.forEach((m) => L.push(`  - ${dmy(m.work_date)} | ${m.work || 'Maintenance'} | ${vLabel(m.vehicle_id)} | ${f(m.amount)} OMR | by ${m.payment_method || '-'}${m.pdc_date ? ` (cheque date ${dmy(m.pdc_date)})` : ''} | to ${m.paid_to || '-'}`));
  const allowDue = {};
  D.te.filter((e) => n3(e.driver_allowance) > 0 && !/^paid$/i.test(e.allowance_status || '')).forEach((e) => {
    const k = name(e.driver_id);
    allowDue[k] = allowDue[k] || { amt: 0, n: 0, oldest: e.entry_date };
    allowDue[k].amt = n3(allowDue[k].amt + n3(e.driver_allowance)); allowDue[k].n += 1;
    if (e.entry_date < allowDue[k].oldest) allowDue[k].oldest = e.entry_date;
  });
  const allowList = Object.entries(allowDue);
  L.push(`c) Driver trip allowance NOT PAID: ${allowList.length ? allowList.map(([k, v]) => `${k} ${f(v.amt)} OMR (${v.n} trips, oldest ${dmy(v.oldest)})`).join('; ') : 'none'}`);
  const salMonths = [...new Set(D.ts.map((s) => mk(s.month)))].sort();
  const lastSal = salMonths[salMonths.length - 1];
  if (lastSal) {
    L.push(`d) Driver salaries, latest month in the system ${mName(lastSal)}: ${D.ts.filter((s) => mk(s.month) === lastSal).map((s) => `${name(s.driver_id)} ${f(payable(s))} OMR`).join(', ')} (the app does not record whether salary was handed over).`);
    if (lastSal < thisM) L.push(`   Note: no driver salary entered yet for ${mName(thisM)}.`);
  }
  const staffAct = D.staff.filter((s) => s.active !== false);
  if (staffAct.length) {
    const net = (s) => n3(((n3(s.basic) + n3(s.allowances)) / 30) * n3(s.working_days) - n3(s.deductions));
    const bc = {};
    staffAct.forEach((s) => { bc[s.company] = n3((bc[s.company] || 0) + net(s)); });
    L.push(`e) Office staff net salary per month (salary sheet): ${Object.entries(bc).map(([c, v]) => `${CO[c] || c} ${f(v)} OMR`).join(', ')}`);
  }
  // utility bills: last payment per account
  const acc = D.accounts.map((a) => {
    const ps = D.bills.filter((b) => b.account_id === a.id).sort((x, y) => String(y.paid_on).localeCompare(String(x.paid_on)));
    return { a, last: ps[0] };
  });
  if (acc.length) {
    L.push(`f) Office utility bills (Inventory > Bills), last payment: ${acc.map(({ a, last }) => `${a.name}${a.payment_type ? ` (${a.payment_type})` : ''}: ${last ? `${f(last.amount)} OMR on ${dmy(last.paid_on)}${mk(last.paid_on) === thisM ? '' : ' (NOT paid this month yet)'}` : 'no payment recorded'}`).join('; ')}`);
  }

  // 3. Money to receive
  L.push('');
  L.push('MONEY TO RECEIVE:');
  const due = D.te.filter((e) => n3(e.rent) - n3(e.received) > 0.0005);
  const dueBy = {};
  due.forEach((e) => { const k = name(e.driver_id); dueBy[k] = n3((dueBy[k] || 0) + n3(e.rent) - n3(e.received)); });
  L.push(`a) Transport trips not fully paid by customers: ${due.length} trip(s), ${f(due.reduce((t, e) => t + n3(e.rent) - n3(e.received), 0))} OMR. ${Object.entries(dueBy).map(([k, v]) => `${k} ${f(v)}`).join(', ')}`);
  due.sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date))).slice(0, 25)
    .forEach((e) => L.push(`  - ${dmy(e.entry_date)} | ${name(e.driver_id)} | ${[e.from_place, e.to_place].filter(Boolean).join(' to ') || e.description || 'trip'} | rent ${f(e.rent)} | received ${f(e.received)} | balance ${f(n3(e.rent) - n3(e.received))} OMR | ${-daysFrom(today, e.entry_date)} days ago`));
  const inv = D.docs.filter((d) => d.kind === 'invoice');
  const docTotal = (d) => n3((d.items || []).reduce((t, i) => t + n3(i.amount), 0) * (1 + n3(d.vat_pct) / 100));
  L.push(`b) Company invoices issued (Invoice / Receipt page; the app does not track if they were paid): ${inv.length ? '' : 'none'}`);
  inv.sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date))).slice(0, 15)
    .forEach((d) => L.push(`  - ${d.doc_no} | ${dmy(d.doc_date)} | ${CO[d.company] || d.company} | to ${d.party} | ${f(docTotal(d))} OMR`));
  const rec = D.docs.filter((d) => d.kind === 'receipt');
  if (rec.length) {
    L.push(`c) Payment receipts made (money already paid out, also in Office Expense): ${rec.length}. Latest:`);
    rec.sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date))).slice(0, 8)
      .forEach((d) => L.push(`  - ${d.doc_no} | ${dmy(d.doc_date)} | ${CO[d.company] || d.company} | paid to ${d.party} | ${f(docTotal(d))} OMR`));
  }

  // 4. Budgets this month (all sources)
  const bud = D.budgets.filter((b) => n3(b.monthly) > 0);
  if (bud.length) {
    L.push('');
    L.push(`BUDGETS THIS MONTH (${mName(thisM)}, office companies). Company | Head | Budget | Spent | Used %`);
    bud.forEach((b) => {
      if (b.source === 'transport') return;
      const spent = n3(D.exp.filter((r) => r.company === b.source && r.head === b.head && mk(r.entry_date) === thisM).reduce((t, r) => t + n3(r.paid), 0));
      const pc = Math.round((spent / n3(b.monthly)) * 100);
      if (pc >= 100) urgent += 1;
      L.push(`- ${CO[b.source] || b.source} | ${b.head} | ${f(b.monthly)} | ${f(spent)} | ${pc}%${pc >= 100 ? ' OVER BUDGET' : pc >= 85 ? ' nearly used' : ''}`);
    });
  }

  // 5. Inventory low stock
  const items = D.cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, section: c.name })));
  const low = items.filter((i) => n3(i.quantity) <= 0 || (n3(i.min_qty) > 0 && n3(i.quantity) <= n3(i.min_qty)));
  L.push('');
  L.push(`INVENTORY LOW OR OUT OF STOCK (to buy): ${low.length ? low.map((i) => `${i.name} (${i.section}: ${f(i.quantity).replace(/\.000$/, '')} ${i.unit || ''} left${n3(i.min_qty) ? `, minimum ${n3(i.min_qty)}` : ''})`).join('; ') : 'none'}. Total items in inventory: ${items.length}.`);

  // 6. People and vehicles (for names)
  L.push('');
  L.push(`DRIVERS: ${D.drv.map((d) => `${d.name} (${d.vehicle_no || '-'}${d.status ? `, ${d.status}` : ''})`).join('; ') || 'none'}`);
  L.push(`VEHICLES: ${D.veh.map((v) => `${vLabel(v.id)} VOC ${dmy(v.voc_expiry) || '-'} Mulkiya ${dmy(v.mulkiya_expiry) || '-'}`).join('; ') || 'none'}`);
  L.push(`URGENT COUNT (due within 7 days, overdue, or over budget): ${urgent}`);
  L.push('=== END OF WHOLE APP WATCH ===');
  return L.join('\n').slice(0, 14000);
}
