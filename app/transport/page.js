'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';
import { num, fmtAmt, monthKey, monthLabel, monthStart, exportStamp, exportExcel, exportPdf, evaluate } from '@/lib/sheet';
import { SALARY_FIELDS, salaryTotal, salaryPayable, allowancePlan } from '@/lib/transport';
import { useSalaryLabels, SALARY_EXTRA_LABELS } from '@/lib/labels';
import CompanyHeader, { COMPANY_NAME } from '@/components/CompanyHeader';
import Omr from '@/components/Omr';
import EditToggle from '@/components/EditToggle';

const COMPANY = `${COMPANY_NAME} · Transport Division`;


function TransportPage() {
  const { isAdmin } = useUser();
  const [drivers, setDrivers] = useState(null);
  const [entries, setEntries] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [extras, setExtras] = useState([]);
  const [month, setMonth] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [delExtra, setDelExtra] = useState(null);
  const toastTimer = useRef(null);
  const canChange = isAdmin && editMode;
  const salLabels = useSalaryLabels();

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [d, e, sa, ex] = await Promise.all([
      s.from('transport_drivers').select('*').order('sort').order('name'),
      s.from('transport_entries').select('id, driver_id, entry_date, rent, received, diesel, toll, maintenance, driver_allowance, allowance_status, allowance_salary_id'),
      s.from('transport_salaries').select('*'),
      s.from('transport_extras').select('*').order('created_at')
    ]);
    setDrivers(d.data || []);
    setEntries(e.data || []);
    setSalaries(sa.data || []);
    setExtras(ex.data || []);
    setMonth((m) => {
      if (m) return m;
      const keys = (e.data || []).map((x) => monthKey(x.entry_date)).sort();
      return keys[keys.length - 1] || monthKey(new Date().toISOString());
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const set = new Set([
      ...entries.map((x) => monthKey(x.entry_date)),
      ...salaries.map((x) => monthKey(x.month)),
      ...extras.map((x) => monthKey(x.month)),
      monthKey(new Date().toISOString())
    ]);
    return [...set].filter(Boolean).sort().reverse();
  }, [entries, salaries, extras]);

  const inMonth = (d) => month === 'all' || monthKey(d) === month;

  const summary = useMemo(() => {
    if (!drivers) return [];
    return drivers.map((d) => {
      const es = entries.filter((e) => e.driver_id === d.id && inMonth(e.entry_date));
      const sum = (k) => num(es.reduce((t, e) => t + Number(e[k] || 0), 0));
      const sal = salaries.filter((s) => s.driver_id === d.id && inMonth(s.month));
      const ex = extras.filter((x) => x.driver_id === d.id && inMonth(x.month));
      const r = {
        driver: d,
        trips: es.filter((e) => Number(e.rent) > 0).length,
        work: sum('rent'),
        received: sum('received'),
        diesel: sum('diesel'),
        toll: sum('toll'),
        maintenance: sum('maintenance'),
        tripAllowance: sum('driver_allowance'),
        salary: num(sal.reduce((t, s) => t + salaryPayable(s), 0)),
        other: num(ex.reduce((t, x) => t + Number(x.amount || 0), 0))
      };
      r.receivable = num(r.work - r.received);
      r.expenses = num(r.diesel + r.toll + r.maintenance + r.salary + r.other);
      r.profit = num(r.work - r.expenses);
      return r;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, entries, salaries, extras, month]);

  const total = (k) => num(summary.reduce((t, r) => t + r[k], 0));

  const SUMMARY_ROWS = [
    ['trips', 'Total trips'],
    ['work', 'Total work amount'],
    ['received', 'Total received amount'],
    ['receivable', 'Receivable amount'],
    ['gap'],
    ['diesel', 'Diesel expense'],
    ['toll', 'Toll + visa exit fee'],
    ['maintenance', 'Maintenance charges'],
    ['salary', 'Total salary'],
    ['other', 'Other (trailer rent etc.)'],
    ['expenses', 'Total expenses', 'sum'],
    ['profit', 'Profit', 'profit']
  ];

  /* ---------- Salary ---------- */

  const salaryOf = (driverId) => salaries.find((s) => s.driver_id === driverId && monthKey(s.month) === month);

  async function saveSalary(driver, field, raw) {
    const cur = salaryOf(driver.id);
    const v = evaluate(raw, cur?.[field] ?? 0);
    if (v === null && !cur) return;
    const value = v === null ? 0 : v;
    if (Number.isNaN(value) || value < 0) { flash('Type a number, e.g. 200', 'err'); return; }
    if (cur && num(cur[field]) === value) return;
    if (cur) {
      setSalaries((list) => list.map((s) => (s.id === cur.id ? { ...s, [field]: value } : s)));
      const { error } = await sb().from('transport_salaries').update({ [field]: value }).eq('id', cur.id);
      if (error) { flash(error.message, 'err'); load(); return; }
    } else {
      // New month: copy the fixed amounts from the latest earlier month
      const prev = salaries.filter((s) => s.driver_id === driver.id && monthKey(s.month) < month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
      // Trip allowance: only what is marked Paid, each trip on one receipt; earlier months must be Paid first
      const plan = allowancePlan(entries, driver.id, month);
      if (plan.unpaidEarlier.length) {
        flash(`${driver.name}: mark earlier driver allowance Paid first (${plan.unpaidEarlier.length} trips). Use Drivers page > Salary receipts.`, 'err');
        return;
      }
      const base = { basic: 0, room_rent: 0, utilities: 0, mobile: 0, travel_food: 0, trip_allowance: 0, allowance_carried: 0, advance_deduction: 0, special_allowance: 0 };
      if (prev) ['basic', 'room_rent', 'utilities', 'mobile', 'travel_food'].forEach((k) => { base[k] = num(prev[k]); });
      base.trip_allowance = plan.current;
      base.allowance_carried = plan.carried;
      const row = { ...base, [field]: value, allowance_carried_note: plan.note || null, driver_id: driver.id, month: monthStart(month) };
      const { data, error } = await sb().from('transport_salaries').insert(row).select().single();
      if (error) { flash(error.message, 'err'); return; }
      if (plan.linkIds.length) {
        await sb().from('transport_entries').update({ allowance_salary_id: data.id }).in('id', plan.linkIds);
        setEntries((list) => list.map((x) => (plan.linkIds.includes(x.id) ? { ...x, allowance_salary_id: data.id } : x)));
      }
      setSalaries((list) => [...list, data]);
    }
    flash('Salary saved');
  }

  async function createSalaries() {
    const missing = drivers.filter((d) => !salaryOf(d.id));
    for (const d of missing) await saveSalary(d, 'basic', String(
      num(salaries.filter((s) => s.driver_id === d.id).sort((a, b) => (a.month < b.month ? 1 : -1))[0]?.basic ?? 0)
    ));
  }

  /* ---------- Other expenses ---------- */

  const monthExtras = extras.filter((x) => month !== 'all' && monthKey(x.month) === month);

  async function addExtra() {
    if (!drivers?.length) return;
    const { data, error } = await sb().from('transport_extras')
      .insert({ driver_id: drivers[0].id, month: monthStart(month), description: 'Other expense', amount: 0 }).select().single();
    if (error) { flash(error.message, 'err'); return; }
    setExtras((list) => [...list, data]);
  }

  async function saveExtra(row, key, value) {
    let patch;
    if (key === 'driver') {
      const d = drivers.find((x) => x.name === value);
      if (!d) return;
      patch = { driver_id: d.id };
    } else patch = { [key]: key === 'description' ? (value || 'Other expense') : value };
    setExtras((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('transport_extras').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }

  async function confirmDeleteExtra() {
    const { error } = await sb().from('transport_extras').delete().eq('id', delExtra.id);
    if (error) { flash(error.message, 'err'); return; }
    setExtras((list) => list.filter((x) => x.id !== delExtra.id));
    setDelExtra(null);
    flash('Deleted');
  }

  /* ---------- Export ---------- */

  function summaryTable() {
    const head = ['Description', ...summary.map((r) => `${r.driver.name} ${r.driver.vehicle_no ? r.driver.vehicle_no.split(' ')[0] : ''}`.trim()), 'Total'];
    const rows = SUMMARY_ROWS.filter(([k]) => k !== 'gap').map(([k, label]) => [label, ...summary.map((r) => r[k]), total(k)]);
    return { head, rows };
  }

  function salaryTable() {
    const head = ['Description', ...drivers.map((d) => d.name)];
    const rows = [
      ...SALARY_FIELDS.map(([k]) => [salLabels.label(k), ...drivers.map((d) => num(salaryOf(d.id)?.[k] || 0))]),
      ['Total', ...drivers.map((d) => salaryTotal(salaryOf(d.id)))],
      ['Advance deduction', ...drivers.map((d) => num(salaryOf(d.id)?.advance_deduction || 0))],
      ['Special allowance', ...drivers.map((d) => num(salaryOf(d.id)?.special_allowance || 0))],
      ['Balance payable', ...drivers.map((d) => salaryPayable(salaryOf(d.id)))]
    ];
    return { head, rows };
  }

  async function doExcel() {
    try {
      flash('Preparing Excel file...');
      const s = summaryTable();
      const sheets = [{ name: 'Summary', title: `Transport summary · ${monthLabel(month)}`, subtitle: `${COMPANY} · Exported ${exportStamp()} · OMR`, head: s.head, rows: s.rows, numCols: s.head.map((_, i) => i).slice(1), widths: [30, 18, 18, 14], boldRows: [s.rows.length - 2, s.rows.length - 1] }];
      if (month !== 'all') {
        const sal = salaryTable();
        sheets.push({ name: 'Salary', title: `Salary detail · ${monthLabel(month)}`, subtitle: COMPANY, head: sal.head, rows: sal.rows, numCols: sal.head.map((_, i) => i).slice(1), widths: [26, 16, 16], boldRows: [6, 9] });
        if (monthExtras.length) {
          sheets.push({ name: 'Other expenses', title: `Other expenses · ${monthLabel(month)}`, subtitle: COMPANY, head: ['Driver', 'Description', 'Amount (OMR)'], rows: monthExtras.map((x) => [drivers.find((d) => d.id === x.driver_id)?.name || '', x.description, num(x.amount)]), numCols: [2], widths: [18, 30, 14] });
        }
      }
      await exportExcel(`Transport ${monthLabel(month)}.xlsx`, sheets);
      flash('Excel file downloaded');
    } catch {
      flash('Could not create the Excel file. Please try again.', 'err');
    }
  }

  async function doPdf() {
    try {
      flash('Preparing PDF...');
      const s = summaryTable();
      const fmt = (rows) => rows.map((r) => r.map((v, i) => (i === 0 ? v : fmtAmt(v))));
      const sections = [{ heading: 'Summary (OMR)', head: s.head, rows: fmt(s.rows), numCols: s.head.map((_, i) => i).slice(1), boldRows: [s.rows.length - 2, s.rows.length - 1], fontSize: 10 }];
      if (month !== 'all') {
        const sal = salaryTable();
        sections.push({ heading: 'Salary detail (OMR)', head: sal.head, rows: fmt(sal.rows), numCols: sal.head.map((_, i) => i).slice(1), boldRows: [6, 9], fontSize: 10 });
      }
      await exportPdf(`Transport ${monthLabel(month)}.pdf`, { title: `Transport Expense · ${monthLabel(month)}`, subtitle: `${COMPANY}  |  Exported ${exportStamp()}`, sections, landscape: false });
      flash('PDF downloaded');
    } catch {
      flash('Could not create the PDF. Please try again.', 'err');
    }
  }

  /* ---------- Email the full PDF report ---------- */

  const [mailing, setMailing] = useState(false);
  async function emailReport() {
    setMailing(true);
    flash('Sending the full report by email...');
    try {
      const { data } = await sb().auth.getSession();
      const res = await fetch('/api/transport-report', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) flash(out.error || 'Sending failed.', 'err');
      else flash(`Report emailed to ${(out.to || []).join(', ')}`);
    } catch {
      flash('Sending failed. Check the internet and try again.', 'err');
    }
    setMailing(false);
  }

  /* ---------- Render ---------- */

  if (!drivers || !month) return <div className="loading">Loading transport...</div>;

  const t = {
    work: total('work'), received: total('received'), receivable: total('receivable'),
    expenses: total('expenses'), profit: total('profit'), trips: total('trips')
  };

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <div className="month-select">
            <label htmlFor="month">Month</label>
            <select id="month" value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
          </div>
          {isAdmin && (
            <button type="button" className={`btn ${editMode ? 'in' : ''}`} onClick={() => setEditMode((v) => !v)} aria-pressed={editMode}>
              {editMode ? '✓ Done editing' : 'Edit'}
            </button>
          )}
          <Link href="/transport/drivers" className="btn">👤 Drivers</Link>
          <Link href="/transport/vehicles" className="btn">🚚 Vehicles</Link>
          <Link href="/transport/invoice" className="btn">🧾 Invoice</Link>
          <Link href="/transport/reports" className="btn report">📊 Reports</Link>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
          <button type="button" className="btn ghost" onClick={doPdf}>Export PDF</button>
          {isAdmin && <button type="button" className="btn ghost" onClick={emailReport} disabled={mailing}>{mailing ? 'Sending...' : '✉ Email report'}</button>}
        </div>
      </div>

      <CompanyHeader title="Transport Expense" detail={`Period: ${monthLabel(month)}  |  ${drivers.length} trucks  |  Currency: OMR`} />

      <div className="kpi-row">
        <div className="kpi"><span>Work amount</span><strong><Omr v={t.work} /></strong><small>{t.trips} trips · OMR</small></div>
        <div className="kpi"><span>Received</span><strong className="pos"><Omr v={t.received} /></strong><small>OMR</small></div>
        <div className="kpi"><span>Receivable</span><strong className={t.receivable > 0 ? 'neg' : ''}><Omr v={t.receivable} /></strong><small>Still to collect</small></div>
        <div className="kpi"><span>Total expenses</span><strong><Omr v={t.expenses} /></strong><small>Diesel, toll, maintenance, salary</small></div>
        <div className="kpi hero"><span>Profit</span><strong><Omr v={t.profit} /></strong><small>OMR · {monthLabel(month)}</small></div>
      </div>

      <div className="driver-cards">
        {summary.map((r) => (
          <div key={r.driver.id} className="driver-card">
            <div>
              <h3>{r.driver.name}</h3>
              <div className="veh">Vehicle # {r.driver.vehicle_no || '–'}</div>
            </div>
            <dl>
              <div><dt>Trips</dt><dd>{r.trips}</dd></div>
              <div><dt>Work</dt><dd><Omr v={r.work} /></dd></div>
              <div><dt>Profit</dt><dd className={r.profit < 0 ? 'neg' : 'pos'}><Omr v={r.profit} /></dd></div>
            </dl>
            <div className="card-links">
              <Link href={`/transport/${r.driver.id}`} className="open stretch">Open trip sheet →</Link>
              <Link href={`/transport/salary/${r.driver.id}?m=${month === 'all' ? '' : month}`} className="slip-link">🧾 Salary slip</Link>
            </div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Summary · {monthLabel(month)}</h2>
          <p className="note">All amounts in OMR</p>
        </div>
        <div className="table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Description</th>
                {summary.map((r) => <th key={r.driver.id} className="num">{r.driver.name}<br /><small className="muted">{r.driver.vehicle_no}</small></th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {SUMMARY_ROWS.map(([k, label, cls]) => (k === 'gap' ? (
                <tr key="gap" className="gap"><td colSpan={summary.length + 2} /></tr>
              ) : (
                <tr key={k} className={cls || ''}>
                  <td>{label}</td>
                  {summary.map((r) => (
                    <td key={r.driver.id} className={`num ${k === 'profit' ? (r[k] < 0 ? 'neg' : 'pos') : ''} ${k === 'receivable' && r[k] > 0 ? 'neg' : ''}`}>
                      {k === 'trips' ? r[k] : fmtAmt(r[k])}
                    </td>
                  ))}
                  <td className={`num ${k === 'profit' ? (total(k) < 0 ? 'neg' : 'pos') : ''}`}>{k === 'trips' ? total(k) : fmtAmt(total(k))}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      {month !== 'all' && (
        <section className="panel">
          <div className="section-head">
            <h2>Salary detail · {monthLabel(month)}</h2>
            <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
            {canChange && drivers.some((d) => !salaryOf(d.id)) && (
              <button type="button" className="btn ghost" onClick={createSalaries}>Create salary for this month</button>
            )}
          </div>
          <div className="table-wrap">
            <table className="summary-table salary-table">
              <thead>
                <tr>
                  <th>Description</th>
                  {drivers.map((d) => <th key={d.id} className="num">{d.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...SALARY_FIELDS, ...SALARY_EXTRA_LABELS].map(([k]) => [k, salLabels.label(k)]).map(([k, label]) => (
                  <tr key={k} className={k === '_total' ? 'sum' : k === '_payable' ? 'profit' : ''}>
                    <td>
                      {canChange ? (
                        <input
                          key={`lbl-${k}-${label}`}
                          className="label-input"
                          aria-label={`Row name for ${label}`}
                          title="Rename this row (leave empty for the standard name)"
                          defaultValue={label}
                          onBlur={async (e) => {
                            if (e.target.value.trim() === label) return;
                            const r = await salLabels.rename(k, e.target.value);
                            flash(r.error ? r.error : 'Row name saved', r.error ? 'err' : 'ok');
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        />
                      ) : label}
                      {k === 'trip_allowance' && !canChange && <small className="muted"> (paid, this month's trips)</small>}
                      {k === 'allowance_carried' && !canChange && <small className="muted"> (paid now)</small>}
                    </td>
                    {drivers.map((d) => {
                      const s = salaryOf(d.id);
                      const tripSum = summary.find((r) => r.driver.id === d.id)?.tripAllowance || 0;
                      if (k === '_total') return <td key={d.id} className="num">{s ? fmtAmt(salaryTotal(s)) : '–'}</td>;
                      if (k === '_payable') return <td key={d.id} className="num">{s ? fmtAmt(salaryPayable(s)) : '–'}</td>;
                      const val = s ? num(s[k]) : null;
                      return (
                        <td key={d.id} className="num">
                          {canChange ? (
                            <input
                              key={`${d.id}-${k}-${val}`}
                              className="salary-input"
                              id={`sal-${d.id}-${k}`}
                              aria-label={`${label} for ${d.name}`}
                              inputMode="decimal"
                              defaultValue={val ?? ''}
                              placeholder="0"
                              onBlur={(e) => { if (e.target.value !== String(val ?? '')) saveSalary(d, k, e.target.value); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            />
                          ) : (
                            <>
                              {val === null ? '–' : (k === 'advance_deduction' && val > 0 ? `−${fmtAmt(val)}` : fmtAmt(val))}
                            </>
                          )}
                          {k === 'trip_allowance' && <div className="hint-num">all trips: {fmtAmt(tripSum)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Balance payable = Total − Advance deduction + Special allowance. In Edit mode, type in any box and press Enter. You can also rename any row (empty = standard name).</p>
        </section>
      )}

      {month !== 'all' && (
        <section className="sheet">
          <div className="sheet-title">
            <h2>Other expenses · {monthLabel(month)}</h2>
            <span className="note">Trailer rent and anything not tied to a trip</span>
            <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
          </div>
          <DataGrid
            columns={[
              { key: 'driver', label: 'Driver', type: 'select', options: drivers.map((d) => d.name), width: 170, raw: (r) => drivers.find((d) => d.id === r.driver_id)?.name || '', render: (r) => drivers.find((d) => d.id === r.driver_id)?.name || '' },
              { key: 'description', label: 'Description', type: 'text', width: 280 },
              { key: 'amount', label: 'Amount (OMR)', type: 'number', min: 0, width: 140, render: (r) => fmtAmt(r.amount) }
            ]}
            rows={monthExtras}
            canEdit={canChange}
            onSave={saveExtra}
            onAdd={addExtra}
            addLabel="+ Add expense"
            onDelete={(r) => setDelExtra(r)}
            emptyText="No other expenses this month."
            footer={{ driver: `${monthExtras.length} ${monthExtras.length === 1 ? "entry" : "entries"}`, amount: fmtAmt(monthExtras.reduce((t2, x) => t2 + Number(x.amount || 0), 0)) }}
            flash={flash}
          />
        </section>
      )}

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}

      {delExtra && (
        <Modal title="Delete expense?" onClose={() => setDelExtra(null)}>
          <p style={{ margin: 0 }}>Delete <strong>{delExtra.description}</strong> ({fmtAmt(delExtra.amount)} OMR)?</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDelExtra(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDeleteExtra}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><TransportPage /></AuthGate>;
}
