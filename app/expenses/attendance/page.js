'use client';

import RangeReport from '@/components/RangeReport';
import { attendanceReport } from '@/lib/rangeReports';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import EditToggle from '@/components/EditToggle';
import { sb } from '@/lib/supabase';
import { monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { COMPANIES, companyOf } from '@/lib/expenses';
import { MARKS, MARK, WD_SHORT, LEAVE_REASONS, STAFF_TYPES, daysOfMonth, personMonth, marksByStaff, notesByStaff, offDaysFor, weekendText } from '@/lib/attendance';

/*
  Attendance (/expenses/attendance?co=&m=): office staff of each company (Office Expense salary sheet).
  Table exp_attendance (one row per staff per day). Weekend: Office staff Fri + Sat off, Site staff Fri off
  (exp_staff.staff_type, tap the Office / Site tag in Edit). All leave is paid; reason (Sick, Marketing,
  Outside meeting, Personal) saved in note. No leave on a weekend day.
  Edit: choose a mark (Present, Absent, Leave, Half day, Clear), then tap a day. Tap a day number
  in the header to give the whole column that mark. Every working day is Present by default (not stored);
  only changes (Absent, Leave, Half day) are saved. "Back to Present" removes a change.
  Every change also writes the person's Working days on the salary sheet (exp_staff.working_days,
  attendance_month): 30 - absent - half of the half days.
*/

const shiftM = (key, by) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const missingTable = (e) => /exp_attendance|does not exist|schema cache/i.test(e?.message || '');

function AttendancePage() {
  const { isAdmin, name: me } = useUser();
  const today = todayISO();
  const [co, setCo] = useState(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [staff, setStaff] = useState(null);
  const [att, setAtt] = useState([]);
  const [noTable, setNoTable] = useState(false);
  const [edit, setEdit] = useState(false);
  const [brush, setBrush] = useState('P');
  const [reason, setReason] = useState('Sick');
  const [undo, setUndo] = useState([]); // stack of earlier states of the changed days
  const [askDel, setAskDel] = useState(null); // { who: staff or null (= everyone), list }
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const canChange = isAdmin && edit && !noTable;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    let k = '';
    let m = '';
    try {
      const q = new URLSearchParams(window.location.search);
      k = q.get('co') || localStorage.getItem('tudo-exp-co') || '';
      m = q.get('m') || '';
    } catch { /* ignore */ }
    setCo(COMPANIES.some((c) => c.key === k) ? k : 'sumptuosity');
    if (/^\d{4}-\d{2}$/.test(m)) setMonth(m);
  }, []);

  useEffect(() => {
    if (!co) return;
    try { localStorage.setItem('tudo-exp-co', co); window.history.replaceState(null, '', `/expenses/attendance?co=${co}&m=${month}`); } catch { /* ignore */ }
  }, [co, month]);

  const load = useCallback(async () => {
    if (!co) return;
    const s = sb();
    const days = daysOfMonth(month);
    const [st, a] = await Promise.all([
      s.from('exp_staff').select('*').eq('company', co).order('sort').order('name'),
      s.from('exp_attendance').select('id, staff_id, day, mark, note').eq('company', co).gte('day', days[0].iso).lte('day', days[days.length - 1].iso)
    ]);
    setStaff((st.data || []).filter((x) => x.active !== false));
    if (a.error) { setNoTable(missingTable(a.error)); setAtt([]); if (!missingTable(a.error)) flash(a.error.message, 'err'); return; }
    setNoTable(false);
    setAtt(a.data || []);
  }, [co, month, flash]);
  useEffect(() => { setStaff(null); load(); }, [load]);

  // Printing this page (Print button or Ctrl+P): A4 landscape, the whole month from day 1 to the last day on one page width
  useEffect(() => {
    const st = document.createElement('style');
    st.textContent = '@media print { @page { size: A4 landscape; margin: 7mm; } }';
    document.head.appendChild(st);
    document.body.classList.add('at-print-page');
    return () => { st.remove(); document.body.classList.remove('at-print-page'); };
  }, []);

  const marks = useMemo(() => marksByStaff(att), [att]);
  const notes = useMemo(() => notesByStaff(att), [att]);
  const hasType = useMemo(() => (staff || []).some((x) => Object.prototype.hasOwnProperty.call(x, 'staff_type')), [staff]);
  const typeOf = (p) => p.staff_type || 'Office';
  const days = useMemo(() => daysOfMonth(month), [month]);
  const stats = useMemo(() => Object.fromEntries((staff || []).map((p) => [p.id, personMonth(month, marks[p.id], today, typeOf(p))])), [staff, marks, month, today]);

  /* Salary sheet working days follow attendance */
  async function syncWorkingDays(ids, nextAtt) {
    const mk = marksByStaff(nextAtt);
    const s = sb();
    await Promise.all(ids.map((id) => {
      const p = (staff || []).find((x) => x.id === id);
      const wd = personMonth(month, mk[id], today, p ? typeOf(p) : 'Office').payDays;
      return s.from('exp_staff').update({ working_days: wd, attendance_month: month }).eq('id', id)
        .then((r) => (r.error ? s.from('exp_staff').update({ working_days: wd }).eq('id', id) : r));
    }));
  }

  /* changes: [{ staff_id, day, mark|null }] */
  async function apply(changes, record = true) {
    if (!changes.length) return;
    if (record) {
      const before = changes.map((c) => ({ staff_id: c.staff_id, day: c.day, mark: marks[c.staff_id]?.[c.day] || null, note: notes[c.staff_id]?.[c.day] || null }));
      setUndo((u) => [...u.slice(-29), before]);
    }
    const s = sb();
    const put = changes.filter((c) => c.mark).map((c) => ({ company: co, staff_id: c.staff_id, day: c.day, mark: c.mark, note: c.mark === 'L' || c.mark === 'A' ? c.note || null : null, entered_by: me || null, updated_at: new Date().toISOString() }));
    const clear = changes.filter((c) => !c.mark);
    const key = (r) => `${r.staff_id}|${String(r.day).slice(0, 10)}`;
    const changed = new Set(changes.map(key));
    const next = [...att.filter((r) => !changed.has(key(r))), ...put];
    setAtt(next);
    if (put.length) {
      const { error } = await s.from('exp_attendance').upsert(put, { onConflict: 'staff_id,day' });
      if (error) { flash(error.message, 'err'); load(); return; }
    }
    for (const c of clear) {
      const { error } = await s.from('exp_attendance').delete().eq('staff_id', c.staff_id).eq('day', c.day);
      if (error) { flash(error.message, 'err'); load(); return; }
    }
    await syncWorkingDays([...new Set(changes.map((c) => c.staff_id))], next);
    flash(changes.length === 1 ? 'Saved. Salary sheet working days updated.' : `${changes.length} days saved. Salary sheet working days updated.`);
  }

  async function undoLast() {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    await apply(last, false);
    flash('Undone');
  }
  /* Delete every mark of this month: one person, or everyone */
  function askDelete(p) {
    const list = [];
    for (const x of p ? [p] : staff) for (const d of days) if (marks[x.id]?.[d.iso]) list.push({ staff_id: x.id, day: d.iso, mark: null });
    if (!list.length) { flash(`Nothing marked in ${monthLabel(month)}${p ? ` for ${p.name}` : ''}.`); return; }
    setAskDel({ who: p, list });
  }
  async function confirmDelete() {
    const d = askDel;
    setAskDel(null);
    await apply(d.list);
    flash(`${d.list.length} day${d.list.length === 1 ? '' : 's'} deleted. Press ↶ Undo to bring them back.`);
  }

  const isOff = (p, day) => offDaysFor(typeOf(p)).includes(day.wd);
  function change(p, day) {
    const cur = marks[p.id]?.[day.iso] || null;
    const curNote = notes[p.id]?.[day.iso] || null;
    if (brush === 'X') return cur ? { staff_id: p.id, day: day.iso, mark: null } : null;
    if (brush === 'L' && isOff(p, day)) return 'weekend';
    if (brush === 'P' && !cur && !isOff(p, day)) return null; // already Present by default
    if (cur === brush && (brush !== 'L' || curNote === reason)) return { staff_id: p.id, day: day.iso, mark: null };
    return { staff_id: p.id, day: day.iso, mark: brush, note: brush === 'L' ? reason : null };
  }
  function tapCell(p, day) {
    if (!canChange) return;
    const c = change(p, day);
    if (c === 'weekend') { flash(`No leave on the weekend (${weekendText(typeOf(p))}).`, 'err'); return; }
    if (c) apply([c]);
  }
  function tapColumn(day) {
    if (!canChange || !staff?.length) return;
    const list = staff.map((p) => {
      const cur = marks[p.id]?.[day.iso] || null;
      if (brush === 'X') return cur ? { staff_id: p.id, day: day.iso, mark: null } : null;
      if (brush === 'L' && isOff(p, day)) return null;
      if (brush === 'P' && !cur && !isOff(p, day)) return null; // already Present by default
      if (cur === brush && (brush !== 'L' || notes[p.id]?.[day.iso] === reason)) return null;
      return { staff_id: p.id, day: day.iso, mark: brush, note: brush === 'L' ? reason : null };
    }).filter(Boolean);
    if (!list.length) { flash(brush === 'L' ? 'No leave on the weekend.' : 'Nothing to change on this day.'); return; }
    apply(list);
  }
  async function toggleType(p) {
    if (!canChange || !hasType) return;
    const next = typeOf(p) === 'Site' ? 'Office' : 'Site';
    setStaff((list) => list.map((x) => (x.id === p.id ? { ...x, staff_type: next } : x)));
    const { error } = await sb().from('exp_staff').update({ staff_type: next }).eq('id', p.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    const wd = personMonth(month, marks[p.id], today, next).payDays;
    await sb().from('exp_staff').update({ working_days: wd, attendance_month: month }).eq('id', p.id);
    flash(`${p.name} is now ${next} staff (${weekendText(next)}).`);
  }

  async function doExcel() {
    const head = ['Staff', ...days.map((d) => `${d.d} ${WD_SHORT[d.wd]}`), 'Present', 'Absent', 'Leave', 'Half day', 'Off', 'Working days (salary)'];
    const rows = staff.map((p) => {
      const st = stats[p.id];
      return [`${p.name} (${typeOf(p)})`, ...days.map((d) => { const m = marks[p.id]?.[d.iso]; const nt = notes[p.id]?.[d.iso]; return m ? (m === 'H' ? '½' : m === 'L' && nt ? `L ${nt}` : m) : isOff(p, d) ? 'Off' : 'P'; }), st.present, st.absent, st.leave, st.half, st.off, st.payDays];
    });
    const n = days.length;
    await exportExcel(`Attendance ${companyOf(co).short} ${monthLabel(month)}.xlsx`, [{
      name: 'Attendance', title: `Attendance · ${companyOf(co).name} · ${monthLabel(month)}`,
      subtitle: `P Present · A Absent · L Leave (paid) · ½ Half day · Office staff Fri and Sat off, Site staff Fri off · Exported ${exportStamp()}`,
      head, rows, numCols: [n + 1, n + 2, n + 3, n + 4, n + 5, n + 6], widths: [26, ...days.map(() => 6), 9, 9, 9, 9, 7, 12]
    }]);
    flash('Excel file downloaded');
  }

  const switcher = (
    <div className="co-switch no-print" role="tablist" aria-label="Company">
      {COMPANIES.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={co === c.key} className={co === c.key ? 'on' : ''} onClick={() => { setCo(c.key); setEdit(false); }}>{c.short}</button>
      ))}
      <Link href="/transport" className="co-tab co-tr">🚚 Transport</Link>
      <Link href="/expenses/summary" className="co-tab co-sum">📊 Group Summary</Link>
    </div>
  );
  if (!co || !staff) return <>{co && switcher}<div className="loading">Loading attendance...</div></>;

  const C = companyOf(co);
  const tot = (staff || []).reduce((t, p) => { const s = stats[p.id]; ['present', 'absent', 'leave', 'half', 'unmarked'].forEach((k) => { t[k] += s[k]; }); return t; }, { present: 0, absent: 0, leave: 0, half: 0, unmarked: 0 });
  const todayIn = days.some((d) => d.iso === today);
  const why = {};
  att.forEach((r) => { if (r.mark === 'L') why[r.note || 'Not given'] = (why[r.note || 'Not given'] || 0) + 1; });
  const leaveText = Object.entries(why).map(([k, v]) => `${k} ${v}`).join(' · ');
  const todayD = days.find((x) => x.iso === today);
  const todayMarked = todayIn ? staff.filter((p) => { const m = marks[p.id]?.[today] || (isOff(p, todayD) ? '' : 'P'); return m === 'P' || m === 'H'; }).length : 0;
  const todayAbsent = todayIn ? staff.filter((p) => marks[p.id]?.[today] === 'A').length : 0;

  return (
    <>
      <div className="page-tools no-print">
        <Link href={`/expenses?co=${co}`} className="crumb">← Office Expense</Link>
        <div className="tools">
          <div className="month-select at-month">
            <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, -1))} aria-label="Previous month">‹</button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
            <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftM(month, 1))} aria-label="Next month">›</button>
          </div>
          <RangeReport title={`Attendance report · ${COMPANIES.find((c) => c.key === co)?.short || ''}`} company={COMPANIES.find((c) => c.key === co)?.name}
            build={async (from, to) => {
              let q = sb().from('exp_attendance').select('staff_id, day, mark, note').eq('company', co);
              if (from) q = q.gte('day', from);
              if (to) q = q.lte('day', to);
              const { data, error } = await q;
              if (error) throw new Error(error.message);
              return attendanceReport({ staff: staff || [], att: data || [], from, to });
            }} label="🖨 Report by dates" />
          <button type="button" className="btn ghost" onClick={doExcel} disabled={!staff.length}>📗 Excel</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {switcher}

      {C.logo && (
        <div className="print-letterhead print-only">
          <img src={C.logo} alt={C.short} />
          <div><b>{C.name}</b><span>{C.cr}</span><span>{C.address}</span></div>
        </div>
      )}

      <div className="company-head">
        <span className="company-name">{C.name}</span>
        <h1>🗓 Attendance</h1>
        <p className="sub">{monthLabel(month)} · Office staff Friday and Saturday off · Site staff Friday off · Working days go to the salary sheet</p>
      </div>

      {noTable && (
        <div className="panel at-warn">
          <b>Attendance is not switched on in the database yet.</b> Run the file <code>supabase/attendance.sql</code> once in the Supabase SQL Editor, then reload this page.
        </div>
      )}

      <div className="kpi-row">
        <div className="kpi hero"><span>Staff</span><strong>{staff.length}</strong><small>{C.short}</small></div>
        <div className="kpi"><span>Today</span><strong>{todayIn ? `${todayMarked}/${staff.length}` : '–'}</strong><small>{todayIn ? (todayAbsent ? `present · ${todayAbsent} absent` : 'present') : 'not this month'}</small></div>
        <div className={`kpi ${tot.absent ? 'kpi-bad' : ''}`}><span>Absent days</span><strong>{tot.absent}</strong><small>{tot.half ? `+ ${tot.half} half days` : 'this month'}</small></div>
        <div className="kpi"><span>Leave days (paid)</span><strong>{tot.leave}</strong><small>{leaveText || 'everyone else Present'}</small></div>
      </div>

      <section className={`sheet ${canChange ? 'is-editing' : ''}`}>
        <div className="sheet-title sheet-edit-bar">
          <h2>{monthLabel(month)}</h2>
          <EditToggle show={isAdmin && !noTable} on={edit} onClick={() => setEdit((v) => !v)} />
        </div>

        {canChange && (
          <div className="at-bar no-print">
            <span className="muted">Everyone is Present by default. Choose a change, then tap a day:</span>
            {MARKS.map((m) => (
              <button key={m.key} type="button" className={`at-brush at-${m.key} ${brush === m.key ? 'on' : ''}`} onClick={() => setBrush(m.key)}>{m.short} {m.label}</button>
            ))}
            {brush === 'L' && (
              <select className="at-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Leave reason">
                {LEAVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <button type="button" className={`at-brush at-X ${brush === 'X' ? 'on' : ''}`} onClick={() => setBrush('X')}>↺ Back to Present</button>
            <span className="at-sep" />
            <button type="button" className="btn ghost sm" onClick={undoLast} disabled={!undo.length} title="Go back one step">↶ Undo{undo.length > 1 ? ` (${undo.length})` : ''}</button>
            <button type="button" className="btn danger sm" onClick={() => askDelete(null)}>🗑 Delete {monthLabel(month)}</button>
          </div>
        )}
        {askDel && (
          <div className="at-confirm no-print" role="alertdialog">
            <span>Delete <b>{askDel.list.length}</b> marked day{askDel.list.length === 1 ? '' : 's'} of <b>{askDel.who ? askDel.who.name : 'everyone'}</b> in {monthLabel(month)}? You can Undo it.</span>
            <button type="button" className="btn ghost sm" onClick={() => setAskDel(null)}>Cancel</button>
            <button type="button" className="btn danger sm" onClick={confirmDelete}>Yes, delete</button>
          </div>
        )}
        {!canChange && isAdmin && !noTable && <p className="note no-print" style={{ margin: 0 }}>Press ✏️ Edit to mark, change, undo or delete attendance.</p>}

        {!staff.length ? (
          <p className="empty">No staff for {C.short}. Add them on the <Link href={`/expenses?co=${co}`}>Office Expense salary sheet</Link>.</p>
        ) : (
          <div className="table-wrap at-wrap">
            <table className="at-table">
              <thead>
                <tr>
                  <th className="at-name">Staff</th>
                  {days.map((d) => (
                    <th key={d.iso} className={`at-day ${d.wd === 5 ? 'off' : d.wd === 6 ? 'off-office' : ''} ${d.iso === today ? 'today' : ''} ${canChange ? 'tap' : ''}`}
                      onClick={() => tapColumn(d)} title={canChange ? `Give everyone this mark on ${d.d}` : undefined}>
                      <b>{d.d}</b><small>{WD_SHORT[d.wd]}</small>
                    </th>
                  ))}
                  <th className="at-sum">P</th><th className="at-sum">A</th><th className="at-sum">L</th><th className="at-sum">½</th><th className="at-sum at-pay">Working days</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((p) => {
                  const st = stats[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="at-name">
                        <b>{p.name}</b>
                        {canChange && <button type="button" className="at-del" onClick={() => askDelete(p)} title={`Delete all marks of ${p.name} in ${monthLabel(month)}`}>🗑</button>}
                        <small>
                          {hasType ? (
                            <button type="button" className={`at-type ${typeOf(p) === 'Site' ? 'site' : ''}`} onClick={() => toggleType(p)} disabled={!canChange}
                              title={canChange ? 'Tap to change Office / Site' : weekendText(typeOf(p))}>{typeOf(p)}</button>
                          ) : null}
                          {p.department ? ` ${p.department}` : ''}
                        </small>
                      </td>
                      {days.map((d) => {
                        const saved = marks[p.id]?.[d.iso];
                        const nt = notes[p.id]?.[d.iso];
                        const off = isOff(p, d);
                        const m = saved || (off ? '' : 'P'); // working day without a mark = Present
                        return (
                          <td key={d.iso} className={`at-cell ${off ? 'off' : ''} ${d.iso === today ? 'today' : ''} ${m ? `at-${m}` : ''} ${!saved && m ? 'at-def' : ''} ${canChange ? 'tap' : ''}`}
                            onClick={() => tapCell(p, d)} title={`${p.name} · ${d.d} ${WD_SHORT[d.wd]}${m ? ` · ${MARK[m].label}${nt ? ` (${nt})` : ''}` : off ? ' · Off' : ''}`}>
                            {m ? <>{MARK[m].short}{m === 'L' && nt ? <sup className="at-why">{nt[0]}</sup> : null}</> : off ? <span className="at-off">Off</span> : ''}
                          </td>
                        );
                      })}
                      <td className="at-sum">{st.present}</td>
                      <td className={`at-sum ${st.absent ? 'neg' : ''}`}>{st.absent}</td>
                      <td className="at-sum">{st.leave}</td>
                      <td className="at-sum">{st.half}</td>
                      <td className="at-sum at-pay"><b>{st.payDays}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="note" style={{ margin: '10px 0 0' }}>
          P Present · A Absent · L Leave, always paid (S Sick, M Marketing, O Outside meeting, P Personal) · ½ Half day.
          Weekend: Office staff Friday and Saturday, Site staff Friday only. No leave on a weekend day.
          {hasType && canChange ? ' Tap the Office / Site tag under a name to change it.' : ''}
          Every working day is Present unless you change it.
          Working days for the salary = 30 − absent days − half of the half days. They are written to the salary sheet when you change attendance.
        </p>
      </section>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><AttendancePage /></AuthGate>;
}
