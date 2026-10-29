'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal';
import DateInput from '@/components/DateInput';
import { fmtAmt, todayISO, exportExcel } from '@/lib/sheet';

/*
  "📊 Report" button used on every page that needs a report.
  Opens a box: quick periods (Today, This month, Last month, This year, All) or any From date and To date,
  shows how many lines will print, then 🖨 Print (A4, portrait or landscape) or ⬇ Excel.
  The page gives build(from, to) -> {
    summary: [[label, value]],                       // boxes at the top (numbers get 3 decimals)
    sections: [{ heading, head: [..], rows: [[..]], totals: [..], num: [column indexes with money], note }],
    count: number of records (optional)
  }
  Dates are 'YYYY-MM-DD', both days included. Helper inDates(date, from, to) is exported.
  CSS rr-* at the end of app/globals.css.
*/

export const inDates = (d, from, to) => {
  const x = String(d || '').slice(0, 10);
  return !!x && (!from || x >= from) && (!to || x <= to);
};
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

function presets() {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  return [
    ['Today', iso(t), iso(t)],
    ['Last 7 days', iso(new Date(y, m, t.getDate() - 6)), iso(t)],
    ['This month', iso(new Date(y, m, 1)), iso(t)],
    ['Last month', iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    ['Last 3 months', iso(new Date(y, m - 2, 1)), iso(t)],
    ['This year', `${y}-01-01`, iso(t)],
    ['All', '', '']
  ];
}

const cell = (v, isNum) => (typeof v === 'number' && isNum ? fmtAmt(v) : v ?? '');

function Sheet({ title, company, from, to, data }) {
  const now = new Date();
  return (
    <div className="rr-sheet">
      <header className="rr-head">
        <div>
          <b>{company || 'Tudo Num Office Systems'}</b>
          <h1>{title}</h1>
          <span>{from || to ? `From ${dmy(from) || 'the start'} to ${dmy(to) || 'today'}` : 'All dates'}</span>
        </div>
        <small>Printed {now.toLocaleDateString('en-GB')} {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
      </header>
      {data.summary?.length > 0 && (
        <div className="rr-sum">
          {data.summary.map(([k, v]) => <div key={k}><span>{k}</span><b>{typeof v === 'number' ? fmtAmt(v) : v}</b></div>)}
        </div>
      )}
      {data.sections.map((s, i) => (
        <section key={i} className="rr-sec">
          {s.heading && <h2>{s.heading}</h2>}
          {s.note && <p className="rr-note">{s.note}</p>}
          {s.rows.length === 0 ? <p className="rr-note">Nothing in this period.</p> : (
            <table className="rr-t">
              <thead><tr>{s.head.map((h, j) => <th key={j} className={s.num?.includes(j) ? 'n' : ''}>{h}</th>)}</tr></thead>
              <tbody>{s.rows.map((r, k) => <tr key={k}>{r.map((v, j) => <td key={j} className={s.num?.includes(j) ? 'n' : ''}>{cell(v, s.num?.includes(j))}</td>)}</tr>)}</tbody>
              {s.totals && <tfoot><tr>{s.totals.map((v, j) => <td key={j} className={s.num?.includes(j) ? 'n' : ''}>{cell(v, s.num?.includes(j))}</td>)}</tr></tfoot>}
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

export default function RangeReport({ title = 'Report', company, build, label = '📊 Report', className = 'btn', landscape = false, defaultPreset = 'This month' }) {
  const P = useMemo(presets, []);
  const start = P.find((p) => p[0] === defaultPreset) || P[2];
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start[1]);
  const [to, setTo] = useState(start[2]);
  const [land, setLand] = useState(landscape);
  const [printing, setPrinting] = useState(false);
  const bad = from && to && from > to;

  const [data, setData] = useState(null);
  useEffect(() => {
    if (!open || bad) { setData(null); return undefined; }
    let alive = true;
    setData(null);
    Promise.resolve().then(() => build(from, to))
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setData({ error: e?.message || 'Could not build the report', sections: [] }); });
    return () => { alive = false; };
  }, [open, from, to, bad]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = data ? (data.count ?? data.sections.reduce((t, s) => t + s.rows.length, 0)) : 0;

  useEffect(() => {
    if (!printing) return undefined;
    const style = document.createElement('style');
    style.textContent = `@page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 10mm; }`;
    document.head.appendChild(style);
    document.body.classList.add('rr-printing');
    const done = () => { document.body.classList.remove('rr-printing'); style.remove(); setPrinting(false); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => { window.print(); setTimeout(done, 1500); }, 150);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); document.body.classList.remove('rr-printing'); style.remove(); };
  }, [printing, land]);

  async function excel() {
    if (!data) return;
    const range = from || to ? `${dmy(from) || 'start'} to ${dmy(to) || 'today'}` : 'All dates';
    const sheets = [];
    if (data.summary?.length) sheets.push({ name: 'Summary', title, subtitle: `${company || 'Tudo Num Office Systems'} · ${range}`, head: ['Measure', 'Value'], rows: data.summary.map(([k, v]) => [k, v]), numCols: [1], widths: [34, 18] });
    data.sections.forEach((s, i) => sheets.push({
      name: (s.heading || `Part ${i + 1}`).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31), title: `${title} · ${s.heading || ''}`, subtitle: range,
      head: s.head, rows: s.rows, totalsRow: s.totals, numCols: s.num || [], widths: s.head.map((h) => Math.max(10, Math.min(34, String(h).length + 6)))
    }));
    await exportExcel(`${title} ${from || 'start'} to ${to || todayISO()}.xlsx`, sheets);
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Report for any dates: print or Excel">{label}</button>
      {open && !printing && (
        <Modal title={`${label.replace(/^\S+\s/, '')}: ${title}`} onClose={() => setOpen(false)}>
          <div className="rr-box">
            <div className="rr-chips">
              {P.map(([k, f, t]) => (
                <button key={k} type="button" className={`rp-chip ${from === f && to === t ? 'active' : ''}`} onClick={() => { setFrom(f); setTo(t); }}>{k}</button>
              ))}
            </div>
            <div className="rr-dates">
              <label htmlFor="rr-from"><span>From</span><DateInput id="rr-from" value={from} onChange={(v) => setFrom(v || '')} /></label>
              <label htmlFor="rr-to"><span>To</span><DateInput id="rr-to" value={to} onChange={(v) => setTo(v || '')} /></label>
            </div>
            {bad && <p className="rr-err">From date is after To date.</p>}
            {data?.error && <p className="rr-err">{data.error}</p>}
            {open && !bad && !data && <div className="rr-preview">Getting the data...</div>}
            {data && !data.error && (
              <div className="rr-preview">
                <b>{count} line{count === 1 ? '' : 's'}</b> will print{from || to ? ` from ${dmy(from) || 'the start'} to ${dmy(to) || 'today'}` : ' (all dates)'}.
                {data.summary?.slice(0, 3).map(([k, v]) => <span key={k}> {k}: <b>{typeof v === 'number' ? fmtAmt(v) : v}</b>.</span>)}
              </div>
            )}
            <label className="rr-land"><input type="checkbox" checked={land} onChange={(e) => setLand(e.target.checked)} /> Landscape (wide tables)</label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
            <button type="button" className="btn ghost" onClick={excel} disabled={!data || !!data.error}>⬇ Excel</button>
            <button type="button" className="btn in" onClick={() => setPrinting(true)} disabled={!data || !!data.error}>🖨 Print</button>
          </div>
        </Modal>
      )}
      {printing && data && typeof document !== 'undefined' && createPortal(<Sheet title={title} company={company} from={from} to={to} data={data} />, document.body)}
    </>
  );
}
