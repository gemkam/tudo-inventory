'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import EditToggle from '@/components/EditToggle';
import { sb } from '@/lib/supabase';
import { monthLabel, todayISO, exportExcel, exportStamp } from '@/lib/sheet';
import { COMPANIES, companyOf } from '@/lib/expenses';
import { MARKS, MARK, WD_SHORT, daysOfMonth, personMonth, marksByStaff } from '@/lib/attendance';

/*
  Attendance (/expenses/attendance?co=&m=): office staff of each company (Office Expense salary sheet).
  Table exp_attendance (one row per staff per day). Friday and Saturday are Off unless marked.
  Edit: choose a mark (Present, Absent, Leave, Half day, Clear), then tap a day. Tap a day number
  in the header to give the whole column that mark. "All present today" / "Fill unmarked days".
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

  const marks = useMemo(() => marksByStaff(att), [att]);
  const days = useMemo(() => daysOfMonth(month), [month]);
  const stats = useMemo(() => Object.fromEntries((staff || []).map((p) => [p.id, personMonth(month, marks[p.id], today)])), [staff, marks, month, today]);

  /* Salary sheet working days follow attendance */
  async function syncWorkingDays(ids, nextAtt) {
    const mk = marksByStaff(nextAtt);
    const s = sb();
    await Promise.all(ids.map((id) => {
      const wd = personMonth(month, mk[id], today).payDays;
      return s.from('exp_staff').update({ working_days: wd, attendance_month: month }).eq('id', id)
        .then((r) => (r.error ? s.from('exp_staff').update({ working_days: wd }).eq('id', id) : r));
    }));
  }

  /* changes: [{ staff_id, day, mark|null }] */
  async function apply(changes) {
    if (!changes.length) return;
    const s = sb();
    const put = changes.filter((c) => c.mark).map((c) => ({ company: co, staff_id: c.staff_id, day: c.day, mark: c.mark, entered_by: me || null, updated_at: new Date().toISOString() }));
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

  function tapCell(p, day) {
    if (!canChange) return;
    const cur = marks[p.id]?.[day.iso] || null;
    const want = brush === 'X' ? null : brush;
    apply([{ staff_id: p.id, day: day.iso, mark: cur === want ? null : want }]);
  }
  function tapColumn(day) {
    if (!canChange || !staff?.length) return;
    const want = brush === 'X' ? null : brush;
    apply(staff.filter((p) => (marks[p.id]?.[day.iso] || null) !== want).map((p) => ({ staff_id: p.id, day: day.iso, mark: want })));
  }
  function allPresentToday() {
    const d = days.find((x) => x.iso === today);
    if (!d) { flash('Today is not in this month.', 'err'); return; }
    apply(staff.filter((p) => !marks[p.id]?.[today]).map((p) => ({ staff_id: p.id, day: today, mark: 'P' })));
  }
  function fillUnmarked() {
    const ch = [];
    for (const p of staff) for (const d of days) if (!d.off && d.iso <= today && !marks[p.id]?.[d.iso]) ch.push({ staff_id: p.id, day: d.iso, mark: 'P' });
    if (!ch.length) { flash('Nothing to fill: every working day is marked.'); return; }
    apply(ch);
  }

  async function doExcel() {
    const head = ['Staff', ...days.map((d) => `${d.d} ${WD_SHORT[d.wd]}`), 'Present', 'Absent', 'Leave', 'Half day', 'Off', 'Working days (salary)'];
    const rows = staff.map((p) => {
      const st = stats[p.id];
      return [p.name, ...days.map((d) => { const m = marks[p.id]?.[d.iso]; return m ? (m === 'H' ? '½' : m) : d.off ? 'Off' : ''; }), st.present, st.absent, st.leave, st.half, st.off, st.payDays];
    });
    const n = days.length;
    await exportExcel(`Attendance ${companyOf(co).short} ${monthLabel(month)}.xlsx`, [{
      name: 'Attendance', title: `Attendance · ${companyOf(co).name} · ${monthLabel(month)}`,
      subtitle: `P Present · A Absent · L Leave · ½ Half day · Fri and Sat off · Exported ${exportStamp()}`,
      head, rows, numCols: [n + 1, n + 2, n + 3, n + 4, n + 5, n + 6], widths: [26, ...days.map(() => 6), 9, 9, 9, 9, 7, 12]
    }]);
    flash('Excel file downloaded');
  }

  const switcher = (
    <div className="co-switch no-print" role="tablist" aria-label="Company">
      {COMPANIES.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={co === c.key} className={co === c.key ? 'on' : ''} onClick={() => { setCo(c.key); setEdit(false); }}>{c.short}</button>
      ))}
      <Link href="/expenses/summary" className="co-tab co-sum">📊 Group Summary</Link>
    </div>
  );
  if (!co || !staff) return <>{co && switcher}<div className="loading">Loading attendance...</div></>;

  const C = companyOf(co);
  const tot = (staff || []).reduce((t, p) => { const s = stats[p.id]; ['present', 'absent', 'leave', 'half', 'unmarked'].forEach((k) => { t[k] += s[k]; }); return t; }, { present: 0, absent: 0, leave: 0, half: 0, unmarked: 0 });
  const todayIn = days.some((d) => d.iso === today);
  const todayMarked = todayIn ? staff.filter((p) => marks[p.id]?.[today]).length : 0;
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
          <button type="button" className="btn ghost" onClick={doExcel} disabled={!staff.length}>Export Excel</button>
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
        <p className="sub">{monthLabel(month)} · Office staff · Friday and Saturday off · Working days go to the salary sheet</p>
      </div>

      {noTable && (
        <div className="panel at-warn">
          <b>Attendance is not switched on in the database yet.</b> Run the file <code>supabase/attendance.sql</code> once in the Supabase SQL Editor, then reload this page.
        </div>
      )}

      <div className="kpi-row">
        <div className="kpi hero"><span>Staff</span><strong>{staff.length}</strong><small>{C.short}</small></div>
        <div className="kpi"><span>Today</span><strong>{todayIn ? `${todayMarked}/${staff.length}` : '–'}</strong><small>{todayIn ? (todayAbsent ? `${todayAbsent} absent` : 'marked') : 'not this month'}</small></div>
        <div className={`kpi ${tot.absent ? 'kpi-bad' : ''}`}><span>Absent days</span><strong>{tot.absent}</strong><small>{tot.half ? `+ ${tot.half} half days` : 'this month'}</small></div>
        <div className="kpi"><span>Leave days</span><strong>{tot.leave}</strong><small>{tot.unmarked ? `${tot.unmarked} days not marked` : 'all marked'}</small></div>
      </div>

      <section className={`sheet ${canChange ? 'is-editing' : ''}`}>
        <div className="sheet-title sheet-edit-bar">
          <h2>{monthLabel(month)}</h2>
          <EditToggle show={isAdmin && !noTable} on={edit} onClick={() => setEdit((v) => !v)} />
        </div>

        {canChange && (
          <div className="at-bar no-print">
            <span className="muted">Choose, then tap a day:</span>
            {MARKS.map((m) => (
              <button key={m.key} type="button" className={`at-brush at-${m.key} ${brush === m.key ? 'on' : ''}`} onClick={() => setBrush(m.key)}>{m.short} {m.label}</button>
            ))}
            <button type="button" className={`at-brush at-X ${brush === 'X' ? 'on' : ''}`} onClick={() => setBrush('X')}>✕ Clear</button>
            <span className="at-sep" />
            {todayIn && <button type="button" className="btn in sm" onClick={allPresentToday}>✓ All present today</button>}
            <button type="button" className="btn ghost sm" onClick={fillUnmarked}>Fill unmarked days as Present</button>
          </div>
        )}

        {!staff.length ? (
          <p className="empty">No staff for {C.short}. Add them on the <Link href={`/expenses?co=${co}`}>Office Expense salary sheet</Link>.</p>
        ) : (
          <div className="table-wrap at-wrap">
            <table className="at-table">
              <thead>
                <tr>
                  <th className="at-name">Staff</th>
                  {days.map((d) => (
                    <th key={d.iso} className={`at-day ${d.off ? 'off' : ''} ${d.iso === today ? 'today' : ''} ${canChange ? 'tap' : ''}`}
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
                      <td className="at-name"><b>{p.name}</b>{p.department ? <small>{p.department}</small> : null}</td>
                      {days.map((d) => {
                        const m = marks[p.id]?.[d.iso];
                        const future = d.iso > today;
                        return (
                          <td key={d.iso} className={`at-cell ${d.off ? 'off' : ''} ${d.iso === today ? 'today' : ''} ${m ? `at-${m}` : ''} ${!m && !d.off && !future ? 'gap' : ''} ${canChange ? 'tap' : ''}`}
                            onClick={() => tapCell(p, d)} title={`${p.name} · ${d.d} ${WD_SHORT[d.wd]}${m ? ` · ${MARK[m].label}` : d.off ? ' · Off' : ''}`}>
                            {m ? MARK[m].short : d.off ? <span className="at-off">Off</span> : ''}
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
          P Present · A Absent · L Leave (paid) · ½ Half day · Off = Friday and Saturday.
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
