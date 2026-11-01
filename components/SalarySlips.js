'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import SlipPaper from '@/components/SlipPaper';
import PrintColumns from '@/components/PrintColumns';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { daysOfMonth, marksByStaff } from '@/lib/attendance';
import { exportExcel, exportStamp, todayISO } from '@/lib/sheet';
import PaidButton from '@/components/PaidButton';
import { requestEditPassword, lockEdit } from '@/lib/editLock';
import { notifySlips, loadCredits, markPaid, unmarkPaid, creditKey } from '@/lib/salaryCredit';
import { buildStaffSlip, buildDriverSlip, totals, sameMoney, slipPdf, slipsPdf, m3, r3, mKey, monthName, prevMonth } from '@/lib/salarySlips';

/*
  All Companies > 💰 Salary (app/expenses/salary, 1 Nov 2026; first built as a Personnel tab). One month at a time:
    Salary Credited column (green when paid) + "✅ All Employees Salary Paid": marking paid also approves the draft slip.
    ⚙ Generate drafts: makes / refreshes the draft slip of every active employee (Office, Site) and every driver
      with a Transport salary that month. Approved slips are not touched (use ↻ Regenerate on that person).
    Check: the table shows Net, unpaid days, deductions, change from last month, missing mobile (amber / red).
    ✅ Approve all: one check box screen, then every draft becomes approved, shows in the employee's shortcut
      (/s/<token>) and his phone gets a notification (if he turned them on).
    ✏️ Edit ▾ (menu): Edit slips (shows the change buttons on each row), ＋ Add slip, ↶ Undo (whole month back, up to 30
      steps, this visit), 🗑 Delete (Delete button per row), 📥 Import (Excel: Name, Deduction, Reason, Note → extra
      deduction lines on draft slips; template download), 📕 Export PDF (every slip of the month, one page each), 📗 Excel.
    Per person: 👁 View (PDF, Print) · ✏️ Deductions (own lines + note) · ↻ Regenerate (from Personnel + Attendance
      + Transport salary) · ✅ Approve · 📤 Link. Changing an approved slip asks a reason and makes a revision.
*/

const shiftM = (k, d) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };
const short = (k) => COMPANIES.find((c) => c.key === k)?.short || k || '';
const keyOf = (kind, id) => `${kind}:${id}`;

const notify = notifySlips;

export default function SalarySlips({ staff, drivers, me, isAdmin, flash, onSend, co = '', tabs = null }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [credits, setCredits] = useState({});
  const [payAll, setPayAll] = useState(false);
  const [slips, setSlips] = useState(null);
  const [prev, setPrev] = useState([]);
  const [att, setAtt] = useState([]);
  const [sal, setSal] = useState([]);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState(null);
  const [dedEdit, setDedEdit] = useState(null); // { slip, lines, note }
  const [revise, setRevise] = useState(null); // { slip, next, reason, then }
  const [approveAll, setApproveAll] = useState(false);
  const [editOn, setEditOn] = useState(false);
  const [delOn, setDelOn] = useState(false);
  const [undo, setUndo] = useState([]); // [{ label, month, slips, credits }]
  const [addOpen, setAddOpen] = useState(false);
  const [delAsk, setDelAsk] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRes, setImportRes] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const s = sb();
    const days = daysOfMonth(month);
    const [a, b, c, d] = await Promise.all([
      s.from('salary_slips').select('*').eq('month', month),
      s.from('salary_slips').select('person_kind, person_id, net').eq('month', prevMonth(month)),
      s.from('exp_attendance').select('staff_id, day, mark, note').gte('day', days[0].iso).lte('day', days[days.length - 1].iso),
      s.from('transport_salaries').select('*')
    ]);
    if (a.error) { flash(a.error.message, 'err'); setSlips([]); return; }
    setSlips(a.data || []);
    setPrev(b.data || []);
    setCredits(await loadCredits(month));
    setAtt(c.data || []);
    setSal((d.data || []).filter((x) => mKey(x.month) === month));
  }, [month, flash]);
  useEffect(() => { setSlips(null); load(); }, [load]);

  /* ↶ Undo: keep the whole month (slips + Salary Credited) as it was before each change */
  function snap(label) {
    setUndo((u) => [...u.slice(-29), { label, month, slips: (slips || []).map((x) => ({ ...x })), credits: Object.values(credits).map((x) => ({ ...x })) }]);
  }
  async function doUndo() {
    const st = undo[undo.length - 1];
    if (!st) { flash('Nothing to undo'); return; }
    const s = sb();
    const { data: now } = await s.from('salary_slips').select('id').eq('month', st.month);
    const keep = new Set(st.slips.map((x) => x.id));
    const extra = (now || []).filter((x) => !keep.has(x.id)).map((x) => x.id);
    if (extra.length) await s.from('salary_slips').delete().in('id', extra);
    if (st.slips.length) {
      const { error } = await s.from('salary_slips').upsert(st.slips);
      if (error) { flash(`Could not undo: ${error.message}`, 'err'); return; }
    }
    await s.from('salary_credits').delete().eq('month', st.month);
    if (st.credits.length) await s.from('salary_credits').insert(st.credits);
    setUndo((u) => u.slice(0, -1));
    if (st.month !== month) setMonth(st.month); else load();
    flash(`Undone: ${st.label}`);
  }

  const marks = useMemo(() => marksByStaff(att), [att]);
  const people = useMemo(() => [
    ...(staff || []).filter((p) => p.active !== false).map((p) => ({ kind: 'staff', table: 'exp_staff', p })),
    ...(drivers || []).map((p) => ({ kind: 'driver', table: 'transport_drivers', p }))
  ], [staff, drivers]);
  const byKey = useMemo(() => Object.fromEntries((slips || []).map((s) => [keyOf(s.person_kind, s.person_id), s])), [slips]);
  const prevByKey = useMemo(() => Object.fromEntries(prev.map((s) => [keyOf(s.person_kind, s.person_id), s])), [prev]);

  function build(x, old) {
    if (x.kind === 'staff') return buildStaffSlip(x.p, marks[x.p.id], month, old);
    return buildDriverSlip(x.p, sal.find((r) => r.driver_id === x.p.id), month, old);
  }

  async function generate() {
    snap('Generate drafts');
    setBusy('gen');
    const ups = [];
    let skipped = 0;
    for (const x of people) {
      const old = byKey[keyOf(x.kind, x.p.id)];
      if (old?.status === 'approved') { skipped += 1; continue; }
      const next = build(x, old);
      if (!next) continue;
      ups.push({ ...next, note: old?.note || null, status: 'draft', generated_at: new Date().toISOString(), generated_by: me || null });
    }
    const { error } = ups.length ? await sb().from('salary_slips').upsert(ups, { onConflict: 'person_kind,person_id,month' }) : { error: null };
    setBusy('');
    if (error) { flash(error.message, 'err'); return; }
    flash(`${ups.length} draft slip${ups.length === 1 ? '' : 's'} ready for ${monthName(month)}${skipped ? ` · ${skipped} already approved (use ↻ Regenerate on them)` : ''}`);
    load();
  }

  /* save changes to one slip; an approved slip becomes a revision (reason asked first) */
  async function saveSlip(slip, changes, reason = '') {
    snap(`change of ${slip.name}`);
    const next = { ...slip, ...changes };
    Object.assign(next, totals(next));
    if (changes.net !== undefined) next.net = changes.net;
    const patch = { ...changes, gross: next.gross, deduction_total: next.deduction_total, net: changes.net !== undefined ? changes.net : next.net, generated_at: new Date().toISOString(), generated_by: me || null };
    if (slip.status === 'approved') {
      const { history, ...old } = slip;
      Object.assign(patch, { version: (slip.version || 1) + 1, revised_at: new Date().toISOString(), revise_reason: reason || null, history: [...(slip.history || []), old] });
    }
    const { error } = await sb().from('salary_slips').update(patch).eq('id', slip.id);
    if (error) { flash(error.message, 'err'); return false; }
    if (slip.status === 'approved') {
      const sent = await notify([slip.id]);
      flash(`Revised slip saved${sent ? ' · his phone was told' : ''}`);
    } else flash('Saved');
    load();
    return true;
  }

  function regenerate(x) {
    const old = byKey[keyOf(x.kind, x.p.id)];
    const next = build(x, old);
    if (!next) { flash(`No Transport salary for ${x.p.name} in ${monthName(month)}`, 'err'); return; }
    if (!old) { snap(`add slip ${x.p.name}`); sb().from('salary_slips').insert({ ...next, status: 'draft', generated_by: me || null }).then(({ error }) => { if (error) flash(error.message, 'err'); else { flash('Draft made'); load(); } }); return; }
    const { person_kind, person_id, month: mm, ...changes } = next;
    if (old.status === 'approved') {
      if (sameMoney(next, old)) { flash('Nothing changed: the approved slip is already up to date'); return; }
      setRevise({ slip: old, changes, reason: '', title: `↻ Regenerate ${old.name}`, info: `Net was OMR ${m3(old.net)}, new Net OMR ${m3(next.net)}.` });
      return;
    }
    saveSlip(old, changes);
  }

  async function approve(list) {
    if (!list.length) return;
    snap(`approve ${list.length === 1 ? list[0].name : `${list.length} slips`}`);
    setBusy('approve');
    const ids = list.map((s) => s.id);
    const { error } = await sb().from('salary_slips').update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: me || null }).in('id', ids);
    if (error) { setBusy(''); flash(error.message, 'err'); return; }
    const sent = await notify(ids);
    setBusy('');
    setApproveAll(false);
    flash(`${ids.length} slip${ids.length === 1 ? '' : 's'} approved and now in the employee's shortcut${sent ? ` · ${sent} phone${sent === 1 ? '' : 's'} told` : ''}`);
    load();
  }

  async function unapprove(slip) {
    snap(`back to draft ${slip.name}`);
    const { error } = await sb().from('salary_slips').update({ status: 'draft' }).eq('id', slip.id);
    if (error) flash(error.message, 'err'); else { flash(`${slip.name}: back to draft (hidden from his shortcut)`); load(); }
  }

  async function pay(list) {
    snap(`salary paid (${list.length})`);
    setBusy('pay');
    const r = await markPaid(list.map(({ x, s }) => ({ kind: x.kind, id: x.p.id, amount: s ? Number(s.net) : null })), month, me);
    setBusy(''); setPayAll(false);
    if (r.error) { flash(r.error, 'err'); return; }
    flash(`Salary paid: ${list.length}${r.approved ? ` · ${r.approved} slip${r.approved === 1 ? '' : 's'} approved` : ''}${r.sent ? ` · ${r.sent} phone${r.sent === 1 ? '' : 's'} told` : ''}`);
    load();
  }
  async function unpay(x) {
    snap(`not paid ${x.p.name}`);
    const err = await unmarkPaid(x.kind, x.p.id, month);
    if (err) flash(err, 'err'); else { flash(`${x.p.name}: marked not paid`); load(); }
  }

  /* rows */
  const rows = people
    .filter((x) => !co || x.p.company === co)
    .map((x) => {
      const s = byKey[keyOf(x.kind, x.p.id)] || null;
      const last = prevByKey[keyOf(x.kind, x.p.id)];
      const fresh = s ? build(x, s) : null;
      const diff = s && last ? r3(s.net - last.net) : null;
      const big = diff !== null && last.net ? Math.abs(diff) / Math.abs(last.net) > 0.1 : false;
      const mobile = x.p.mobile || x.p.phone || '';
      return { x, s, last, diff, big, mobile, stale: s && fresh && !sameMoney(s, fresh), noSal: x.kind === 'driver' && !sal.some((r) => r.driver_id === x.p.id) };
    })
    .filter((r) => r.s || !r.noSal);
  const drafts = rows.filter((r) => r.s && r.s.status === 'draft');
  const approved = rows.filter((r) => r.s && r.s.status === 'approved');
  const missing = rows.filter((r) => !r.s);
  const unpaid = rows.filter((r) => !credits[creditKey(r.x.kind, r.x.p.id)]);
  const totalNet = rows.reduce((t, r) => t + (r.s ? Number(r.s.net) : 0), 0);

  async function deleteSlip(slip) {
    snap(`delete slip ${slip.name}`);
    setDelAsk(null);
    const { error } = await sb().from('salary_slips').delete().eq('id', slip.id);
    if (error) flash(error.message, 'err'); else { flash(`${slip.name}: slip deleted${slip.status === 'approved' ? ' (gone from his app too)' : ''}`); load(); }
  }

  function doPdf() {
    const list = rows.filter((r) => r.s).map((r) => r.s);
    if (!list.length) { flash('No slips this month', 'err'); return; }
    flash(`Making PDF of ${list.length} slip${list.length === 1 ? '' : 's'}...`);
    slipsPdf(list, `Salary slips ${monthName(month)}${co ? ` ${short(co)}` : ''}.pdf`);
  }

  function importTemplate() {
    exportExcel(`Salary deductions ${monthName(month)}.xlsx`, [{
      name: 'Deductions', title: `Extra deductions · ${monthName(month)}`, subtitle: 'Fill Deduction (OMR), Reason and Note, then 📥 Import. Leave a row empty to skip it.',
      head: ['Name', 'Company', 'Deduction', 'Reason', 'Note'],
      rows: rows.map(({ x }) => [x.p.name, short(x.p.company), '', '', '']), numCols: [2]
    }]);
  }

  async function doImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const txt = (v) => String(v?.result ?? v?.text ?? (v?.richText ? v.richText.map((t) => t.text).join('') : v) ?? '').trim();
      let head = null; const col = {};
      ws.eachRow((row, i) => {
        if (head) return;
        const cells = row.values.map(txt);
        if (cells.some((c) => /^name$/i.test(c))) { head = i; cells.forEach((c, k) => { if (/^name$/i.test(c)) col.name = k; if (/deduction|amount/i.test(c)) col.amt = k; if (/reason/i.test(c)) col.why = k; if (/note/i.test(c)) col.note = k; }); }
      });
      if (!head || !col.name) { flash('No "Name" column found in the file', 'err'); return; }
      const byName = Object.fromEntries((slips || []).map((x) => [String(x.name).trim().toLowerCase(), x]));
      const done = []; const skipped = [];
      snap('import');
      for (let i = head + 1; i <= ws.rowCount; i++) {
        const r = ws.getRow(i);
        const name = txt(r.getCell(col.name).value);
        if (!name) continue;
        const amt = col.amt ? Number(txt(r.getCell(col.amt).value).replace(/[^\d.-]/g, '')) || 0 : 0;
        const why = col.why ? txt(r.getCell(col.why).value) : '';
        const note = col.note ? txt(r.getCell(col.note).value) : '';
        if (!amt && !note) continue;
        const slip = byName[name.toLowerCase()];
        if (!slip) { skipped.push(`${name} (no slip this month)`); continue; }
        if (slip.status === 'approved') { skipped.push(`${name} (approved: use ✏️ Deductions)`); continue; }
        const deductions = [...(slip.deductions || []), ...(amt ? [{ label: why || 'Deduction', amount: r3(amt), auto: false }] : [])];
        const t = totals({ ...slip, deductions });
        const { error } = await sb().from('salary_slips').update({ deductions, note: note || slip.note || null, gross: t.gross, deduction_total: t.deduction_total, net: t.net }).eq('id', slip.id);
        if (error) skipped.push(`${name} (${error.message})`); else done.push(name);
      }
      setImportRes({ done, skipped });
      load();
    } catch (err) { flash(`Could not read the file: ${err.message}`, 'err'); }
  }

  function doExcel() {
    exportExcel(`Salary slips ${monthName(month)}.xlsx`, [{
      name: 'Salary slips', title: `Salary slips · ${monthName(month)}`, subtitle: exportStamp(),
      head: ['Name', 'Company', 'Type', 'Monthly', 'Pay days', 'Absent', 'Half', 'Earnings', 'Deductions', 'Net', 'Last month Net', 'Status', 'Version'],
      rows: rows.filter((r) => r.s).map(({ s, last }) => [s.name, short(s.company), s.staff_type, Number(s.monthly), s.pay_days ?? '', Number(s.absent), Number(s.half), Number(s.gross), Number(s.deduction_total), Number(s.net), last ? Number(last.net) : '', s.status === 'approved' ? 'Approved' : 'Draft', s.version]),
      numCols: [3, 7, 8, 9, 10]
    }]);
  }

  return (
    <>
      <div className="pn-bar no-print">
        <div className="month-select at-month">
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, -1))} aria-label="Previous month">‹</button>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, 1))} aria-label="Next month">›</button>
        </div>
        {isAdmin && <button type="button" className="btn" onClick={generate} disabled={!!busy}>{busy === 'gen' ? 'Making...' : '⚙ Generate drafts'}</button>}
        {isAdmin && <button type="button" className="btn in" onClick={() => setApproveAll(true)} disabled={!drafts.length || !!busy}>✅ Approve all ({drafts.length})</button>}
        {isAdmin && <button type="button" className="btn" onClick={() => setPayAll(true)} disabled={!unpaid.length || !!busy}>💵 All Employees Salary Paid ({unpaid.length})</button>}
        <SlipEditMenu
          isAdmin={isAdmin} editOn={editOn} delOn={delOn} undoCount={undo.length} undoLabel={undo[undo.length - 1]?.label || ''}
          onEdit={() => setEditOn((v) => !v)} onAdd={() => setAddOpen(true)} onUndo={doUndo} onDelete={() => setDelOn((v) => !v)}
          onImport={() => setImportOpen(true)} onPdf={doPdf} onExcel={doExcel} onDone={() => { setEditOn(false); setDelOn(false); lockEdit(); }} />
        <PrintColumns className="btn ghost" />
      </div>

      {tabs}

      <div className="kpi-row">
        <div className="kpi hero"><span>Net pay · {monthName(month)}</span><strong>{m3(totalNet)}</strong><small>OMR · {rows.filter((r) => r.s).length} slips</small></div>
        <div className="kpi"><span>Draft (to check)</span><strong>{drafts.length}</strong><small>not seen by employees</small></div>
        <div className="kpi"><span>Approved</span><strong>{approved.length}</strong><small>in their shortcut</small></div>
        <div className="kpi"><span>Salary paid</span><strong>{rows.length - unpaid.length}/{rows.length}</strong><small>{unpaid.length ? `${unpaid.length} not paid yet` : 'everyone paid'}</small></div>
        <div className={`kpi ${missing.length ? 'kpi-bad' : ''}`}><span>No slip yet</span><strong>{missing.length}</strong><small>{missing.length ? 'press ⚙ Generate drafts' : 'everyone has one'}</small></div>
      </div>

      {slips === null ? <div className="loading">Loading slips...</div> : (
        <div className="grid-wrap">
          <table className="summary-table ssl-table">
            <thead>
              <tr><th>Name</th><th>Company</th><th>Type</th><th className="num">Monthly</th><th className="num">Pay days</th><th className="num">Deductions</th><th className="num">Net pay</th><th className="num">vs last month</th><th>Mobile</th><th>Salary Credited</th><th>Slip</th><th className="no-print">{editOn ? 'Change' : 'View'}</th>{delOn && <th className="no-print" />}</tr>
            </thead>
            <tbody>
              {rows.map(({ x, s, diff, big, mobile, stale }) => (
                <tr key={keyOf(x.kind, x.p.id)} className={s ? '' : 'ssl-none'}>
                  <td><b>{x.p.name}</b>{s?.designation ? <small className="muted"> {s.designation}</small> : null}</td>
                  <td>{short(x.p.company)}</td>
                  <td>{x.kind === 'driver' ? 'Driver' : x.p.staff_type || 'Office'}</td>
                  <td className="num">{s ? m3(s.monthly) : '–'}</td>
                  <td className="num">{s && s.pay_days != null ? <>{s.pay_days}{(Number(s.absent) || Number(s.half)) ? <small className="bad"> A{Number(s.absent)}{Number(s.half) ? ` ½${Number(s.half)}` : ''}</small> : null}</> : '–'}</td>
                  <td className="num">{s ? (Number(s.deduction_total) ? <span className="bad">{m3(s.deduction_total)}</span> : '0.000') : '–'}</td>
                  <td className="num"><b>{s ? m3(s.net) : '–'}</b></td>
                  <td className={`num ${big ? 'ssl-big' : ''}`}>{diff === null ? <span className="muted">new</span> : diff === 0 ? 'same' : `${diff > 0 ? '+' : ''}${m3(diff)}`}</td>
                  <td>{mobile || <span className="bad">missing</span>}</td>
                  <td><PaidButton credit={credits[creditKey(x.kind, x.p.id)]} canEdit={isAdmin} onPay={() => pay([{ x, s }])} onUndo={() => unpay(x)} /></td>
                  <td>
                    {!s ? <span className="muted">No slip</span> : s.status === 'approved'
                      ? <span className="ssl-st ok">✅ Approved{s.version > 1 ? ` · v${s.version}` : ''}</span>
                      : <span className="ssl-st draft">Draft</span>}
                    {stale && <small className="ssl-stale" title="Personnel, Attendance or Transport salary changed after this slip was made">changed · ↻</small>}
                  </td>
                  <td className="no-print ssl-acts">
                    {s && <button type="button" className="dfl-btn" onClick={() => setView(s)}>👁 View</button>}
                    {editOn && isAdmin && s && <button type="button" className="dfl-btn" onClick={() => setDedEdit({ slip: s, lines: (s.deductions || []).map((d) => ({ ...d })), note: s.note || '' })}>✏️ Deductions</button>}
                    {editOn && isAdmin && <button type="button" className="dfl-btn" onClick={() => regenerate(x)}>↻ Regenerate</button>}
                    {editOn && isAdmin && s?.status === 'draft' && <button type="button" className="dfl-btn" onClick={() => approve([s])}>✅ Approve</button>}
                    {editOn && isAdmin && s?.status === 'approved' && <button type="button" className="dfl-btn" onClick={() => unapprove(s)} title="Hide it from his shortcut again">↩ Back to draft</button>}
                    {isAdmin && <button type="button" className="dfl-btn" onClick={() => onSend({ table: x.table, row: x.p })}>📤 Link</button>}
                  </td>
                  {delOn && <td className="no-print">{s && <button type="button" className="mini danger" onClick={() => setDelAsk(s)}>Delete</button>}</td>}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={13} className="muted">No employees for this company.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted pn-note no-print">Office and Site: monthly salary from Personnel, unpaid days from Attendance (absent and half days on a 30 day month), Deductions from the salary sheet. Drivers: from the Transport salary sheet of that month. Employees only see approved slips, in their own shortcut.</p>

      {view && (
        <Modal title={`${view.name} · ${monthName(view.month)}`} onClose={() => setView(null)}>
          <SlipPaper s={view} />
          {(view.history || []).length > 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Earlier versions: {(view.history || []).map((h) => `v${h.version || 1} Net ${m3(h.net)}`).join(' · ')}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setView(null)}>Close</button>
            <button type="button" className="btn in" onClick={() => slipPdf(view)}>⬇ PDF</button>
          </div>
        </Modal>
      )}

      {dedEdit && (
        <Modal title={`✏️ Deductions · ${dedEdit.slip.name}`} onClose={() => setDedEdit(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Lines marked auto come from Attendance or the salary sheet and are made again on ↻ Regenerate. Your own lines stay.</p>
          <div className="ssl-ded">
            {dedEdit.lines.map((l, i) => (
              <div key={i} className="ssl-ded-row">
                <input className="drv-input" value={l.label} placeholder="Reason (e.g. Fine, Advance, Unpaid leave)" onChange={(e) => setDedEdit({ ...dedEdit, lines: dedEdit.lines.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} disabled={l.auto} />
                <input className="drv-input num" type="number" step="0.001" value={l.amount} onChange={(e) => setDedEdit({ ...dedEdit, lines: dedEdit.lines.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)) })} />
                {l.auto ? <small className="muted">auto</small> : <button type="button" className="dfl-btn danger" onClick={() => setDedEdit({ ...dedEdit, lines: dedEdit.lines.filter((_, k) => k !== i) })}>✕</button>}
              </div>
            ))}
            <button type="button" className="dfl-more" onClick={() => setDedEdit({ ...dedEdit, lines: [...dedEdit.lines, { label: '', amount: '', auto: false }] })}>＋ Add deduction</button>
          </div>
          <label className="dfl-label" style={{ marginTop: 12 }}>Note on the slip (optional)
            <input className="drv-input" value={dedEdit.note} onChange={(e) => setDedEdit({ ...dedEdit, note: e.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDedEdit(null)}>Cancel</button>
            <button type="button" className="btn in" onClick={async () => {
              const deductions = dedEdit.lines.filter((l) => String(l.label).trim() || Number(l.amount)).map((l) => ({ label: String(l.label).trim() || 'Deduction', amount: r3(l.amount), auto: !!l.auto }));
              const changes = { deductions, note: dedEdit.note.trim() || null };
              if (dedEdit.slip.person_kind === 'driver') changes.net = r3(totals({ ...dedEdit.slip, deductions }).net);
              if (dedEdit.slip.status === 'approved') { setRevise({ slip: dedEdit.slip, changes, reason: '', title: `Change approved slip · ${dedEdit.slip.name}`, info: 'This slip is already in his shortcut. It will show as revised.' }); setDedEdit(null); return; }
              if (await saveSlip(dedEdit.slip, changes)) setDedEdit(null);
            }}>Save</button>
          </div>
        </Modal>
      )}

      {revise && (
        <Modal title={revise.title} onClose={() => setRevise(null)}>
          <p style={{ marginTop: 0 }}>{revise.info} He will see the new slip marked <b>Revised</b>. The old one is kept for the office.</p>
          <label className="dfl-label">Reason (shown on the slip)
            <input className="drv-input" autoFocus value={revise.reason} placeholder="e.g. Absent 3 Nov not told, corrected" onChange={(e) => setRevise({ ...revise, reason: e.target.value })} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setRevise(null)}>Cancel</button>
            <button type="button" className="btn in" disabled={!revise.reason.trim()} onClick={async () => { if (await saveSlip(revise.slip, revise.changes, revise.reason.trim())) setRevise(null); }}>Save revision</button>
          </div>
        </Modal>
      )}

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={doImport} />
      {addOpen && (
        <Modal title={`＋ Add slip · ${monthName(month)}`} onClose={() => setAddOpen(false)}>
          {missing.length ? (
            <div className="ssl-add">
              {missing.map(({ x }) => (
                <button key={keyOf(x.kind, x.p.id)} type="button" className="dfl-btn" onClick={() => { setAddOpen(false); regenerate(x); }}>
                  ＋ {x.p.name} <small className="muted">{short(x.p.company)} · {x.kind === 'driver' ? 'Driver' : x.p.staff_type || 'Office'}</small>
                </button>
              ))}
            </div>
          ) : <p className="muted" style={{ marginTop: 0 }}>Everyone already has a slip for {monthName(month)}. New employee? Add him in Personnel first.</p>}
          <div className="modal-actions"><button type="button" className="btn ghost" onClick={() => setAddOpen(false)}>Close</button></div>
        </Modal>
      )}
      {delAsk && (
        <Modal title="Delete slip?" onClose={() => setDelAsk(null)}>
          <p style={{ marginTop: 0 }}>Delete the {monthName(delAsk.month)} slip of <b>{delAsk.name}</b>?{delAsk.status === 'approved' ? ' It is approved: it also disappears from his app.' : ''} ↶ Undo can bring it back.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setDelAsk(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={() => deleteSlip(delAsk)}>Delete</button>
          </div>
        </Modal>
      )}
      {importOpen && (
        <Modal title={`📥 Import deductions · ${monthName(month)}`} onClose={() => { setImportOpen(false); setImportRes(null); }}>
          {!importRes ? (
            <>
              <p style={{ marginTop: 0 }}>Excel file with columns <b>Name</b>, <b>Deduction</b> (OMR), <b>Reason</b>, <b>Note</b>. Each row adds a deduction line to that person's <b>draft</b> slip. Approved slips are skipped.</p>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={importTemplate}>⬇ Download template (all names)</button>
                <button type="button" className="btn in" onClick={() => fileRef.current?.click()}>📥 Choose Excel file</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>✓ Added to <b>{importRes.done.length}</b> slip{importRes.done.length === 1 ? '' : 's'}{importRes.done.length ? `: ${importRes.done.join(', ')}` : ''}.</p>
              {importRes.skipped.length > 0 && <ul className="ssl-warn">{importRes.skipped.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
              <div className="modal-actions"><button type="button" className="btn in" onClick={() => { setImportOpen(false); setImportRes(null); }}>OK</button></div>
            </>
          )}
        </Modal>
      )}

      {payAll && (
        <Modal title="⚠ Are you sure?" onClose={() => setPayAll(false)}>
          <p style={{ marginTop: 0 }}>Mark <b>{unpaid.length}</b> employee{unpaid.length === 1 ? '' : 's'}{co ? ` of ${short(co)}` : ''} as <b>salary paid</b> for <b>{monthName(month)}</b> (total Net <b>OMR {m3(unpaid.reduce((t, r) => t + (r.s ? Number(r.s.net) : 0), 0))}</b>)?</p>
          <div className="sure-warn">📱 Every one of them gets a notification on his mobile: <b>“Salary slip ready”</b>, and his slip shows in his app. This cannot be taken back from their phones.</div>
          <p className="muted sure-names">{unpaid.map((r) => r.x.p.name).join(' · ')}</p>
          {unpaid.some((r) => !r.s) && <p className="bad">⚠ No slip yet for: {unpaid.filter((r) => !r.s).map((r) => r.x.p.name).join(', ')} (press ⚙ Generate drafts first).</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" autoFocus onClick={() => setPayAll(false)}>No, cancel</button>
            <button type="button" className="btn in" onClick={() => pay(unpaid)} disabled={busy === 'pay'}>{busy === 'pay' ? 'Saving...' : 'Yes, I am sure'}</button>
          </div>
        </Modal>
      )}

      {approveAll && (
        <Modal title={`✅ Approve ${drafts.length} slip${drafts.length === 1 ? '' : 's'} · ${monthName(month)}`} onClose={() => setApproveAll(false)}>
          <p style={{ marginTop: 0 }}>Total Net pay <b>OMR {m3(drafts.reduce((t, r) => t + Number(r.s.net), 0))}</b>.</p>
          <div className="sure-warn">📱 Every one of them gets a notification on his mobile: <b>“Salary slip ready”</b>, and his slip shows in his app.</div>
          {(() => {
            const warn = [
              ...drafts.filter((r) => r.big).map((r) => `${r.s.name}: Net ${r.diff > 0 ? 'up' : 'down'} ${m3(Math.abs(r.diff))} from last month`),
              ...drafts.filter((r) => Number(r.s.absent) || Number(r.s.half)).map((r) => `${r.s.name}: ${Number(r.s.absent)} absent, ${Number(r.s.half)} half days`),
              ...drafts.filter((r) => r.stale).map((r) => `${r.s.name}: data changed after the draft was made (press ↻ Regenerate first)`),
              ...drafts.filter((r) => !r.mobile).map((r) => `${r.s.name}: no mobile number`)
            ];
            return warn.length ? <ul className="ssl-warn">{warn.map((w) => <li key={w}>⚠ {w}</li>)}</ul> : <p className="ok">✓ Nothing unusual found.</p>;
          })()}
          <div className="modal-actions">
            <button type="button" className="btn ghost" autoFocus onClick={() => setApproveAll(false)}>No, cancel</button>
            <button type="button" className="btn in" onClick={() => approve(drafts.map((r) => r.s))} disabled={busy === 'approve'}>{busy === 'approve' ? 'Approving...' : 'Everything is OK · Approve'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ✏️ Edit ▾ on the Salary page: Edit slips, Add, Undo, Delete, Import, Export PDF, Excel */
function SlipEditMenu({ isAdmin, editOn, delOn, undoCount, undoLabel, onEdit, onAdd, onUndo, onDelete, onImport, onPdf, onExcel, onDone }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const act = (fn) => () => { setOpen(false); fn(); };
  const on = editOn || delOn;
  return (
    <div className="pn-edit" ref={box}>
      <button type="button" className={`btn${on ? ' in' : ''}`} aria-pressed={on} aria-haspopup="menu" aria-expanded={open} onClick={async () => { if (open) { setOpen(false); return; } if (await requestEditPassword()) setOpen(true); }}>✏️ Edit <span aria-hidden="true">▾</span></button>
      {open && (
        <div className="pn-menu" role="menu">
          {isAdmin && <button type="button" role="menuitem" className={editOn ? 'on' : ''} onClick={act(onEdit)}>✏️ {editOn ? 'Stop editing' : 'Edit slips'}<small>Deductions, Regenerate, Approve on each row</small></button>}
          {isAdmin && <button type="button" role="menuitem" onClick={act(onAdd)}>＋ Add slip<small>for someone with no slip this month</small></button>}
          {isAdmin && <button type="button" role="menuitem" onClick={act(onUndo)} disabled={!undoCount}>↶ Undo{undoCount ? ` (${undoCount})` : ''}<small>{undoLabel ? `last: ${undoLabel}` : 'last change on this page'}</small></button>}
          {isAdmin && <button type="button" role="menuitem" className={delOn ? 'on' : ''} onClick={act(onDelete)}>🗑 {delOn ? 'Hide Delete buttons' : 'Delete'}<small>Delete button on each slip</small></button>}
          {isAdmin && <button type="button" role="menuitem" onClick={act(onImport)}>📥 Import<small>extra deductions from Excel</small></button>}
          <button type="button" role="menuitem" onClick={act(onPdf)}>📕 Export PDF<small>every slip of the month, one page each</small></button>
          <button type="button" role="menuitem" onClick={act(onExcel)}>📗 Excel<small>salary table of the month</small></button>
          {on && <button type="button" role="menuitem" className="done" onClick={act(onDone)}>✓ Done</button>}
        </div>
      )}
    </div>
  );
}
