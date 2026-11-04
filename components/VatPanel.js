'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { fmtAmt } from '@/lib/sheet';
import { VAT_COLS, vatSources, vatNetText, buildVatData, computeVat } from '@/lib/vatReport';

/*
  🧾 VAT report box shown inside every report page (Kamran, 4 Nov 2026). Same numbers as the VAT return page.
  Props: from / to ('YYYY-MM-DD', '' = no limit), sources (keys picked at the start; chips let the user change them),
  driverId (only that driver's trips), onData(v) (the page uses it for its PDF / Excel).
  loadVatData() is also used by components/RangeReport.js.
*/

let cache = null; // { at, promise }

export function loadVatData() {
  if (cache && Date.now() - cache.at < 60000) return cache.promise;
  const s = sb();
  const promise = Promise.all([
    s.from('exp_entries').select('id, company, entry_date, bill_no, description, paid, unpaid, vat, vat_reg_no, source_kind'),
    s.from('transport_entries').select('id, driver_id, entry_date, from_place, to_place, rent, vat_included, diesel'),
    s.from('company_docs').select('id, company, kind, doc_no, doc_date, party, items, vat_pct').eq('kind', 'invoice'),
    s.from('transport_drivers').select('id, name')
  ]).then(([e, t, d, dr]) => {
    const all = vatSources(COMPANIES);
    const labelOf = (k) => all.find((x) => x.key === k)?.label || k;
    return buildVatData({ exp: e.data || [], te: t.data || [], docs: d.data || [], drivers: dr.data || [], labelOf });
  });
  cache = { at: Date.now(), promise };
  promise.catch(() => { cache = null; });
  return promise;
}

/* VAT for dates + sources, ready for RangeReport / exports */
export async function vatFor({ from = '', to = '', sources = null, driverId = null } = {}) {
  const data = await loadVatData();
  const all = vatSources(COMPANIES);
  return computeVat(data, { from, to, sources: sources || all.map((s) => s.key), allSources: all, driverId });
}

export default function VatPanel({ from = '', to = '', sources = null, driverId = null, onData, title = '🧾 VAT report' }) {
  const all = vatSources(COMPANIES);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState(sources || all.map((s) => s.key));
  const sourcesKey = (sources || []).join(',');
  useEffect(() => { if (sources) setPick(sources); }, [sourcesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    loadVatData().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setErr('Could not read the VAT data.'); });
    return () => { alive = false; };
  }, []);

  const v = useMemo(() => (data ? computeVat(data, { from, to, sources: pick, allSources: all, driverId }) : null), [data, from, to, pick.join(','), driverId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (onData) onData(v); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
  const when = from || to ? `${dmy(from) || 'the start'} to ${dmy(to) || 'today'}` : 'All dates';

  return (
    <section className="panel vat-panel" id="vat-report">
      <div className="section-head">
        <h2>{title}</h2>
        <Link href="/expenses/vat" className="btn ghost small no-print">Full VAT return →</Link>
      </div>
      <p className="muted" style={{ margin: '0 0 8px' }}>{when} · OMR · same figures as the VAT return page</p>
      {err && <p className="neg">{err}</p>}
      {!v && !err && <p className="muted">Loading VAT...</p>}
      {v && (
        <>
          {all.length > 1 && !driverId && (
            <div className="ats-chips no-print" role="group" aria-label="VAT companies">
              {all.map((s) => (
                <button key={s.key} type="button" className={`rp-chip ${pick.includes(s.key) ? 'active' : ''}`}
                  onClick={() => setPick((p) => (p.includes(s.key) ? (p.length > 1 ? p.filter((x) => x !== s.key) : p) : [...p, s.key]))}>
                  {pick.includes(s.key) ? '✓ ' : ''}{s.label}
                </button>
              ))}
            </div>
          )}
          <div className="kpi-row">
            <div className="kpi"><span>Output VAT (sales)</span><strong>{fmtAmt(v.T.outputVat)}</strong><small>OMR</small></div>
            <div className="kpi"><span>Input VAT (bills)</span><strong>{fmtAmt(v.T.inputVat)}</strong><small>OMR</small></div>
            <div className="kpi hero"><span>{v.T.net >= 0 ? 'VAT to pay' : 'VAT to claim back'}</span><strong>{fmtAmt(Math.abs(v.T.net))}</strong><small>OMR</small></div>
          </div>
          <div className="table-wrap">
            <table className="ats-table">
              <thead><tr><th>Company</th>{VAT_COLS.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
              <tbody>{v.rows.map(({ s, r }) => <tr key={s.key}><td><b>{s.label}</b></td>{VAT_COLS.map(([k]) => <td key={k} className={`num${k === 'net' ? (r.net >= 0 ? ' vat-pay' : ' vat-claim') : ''}`}>{k === 'net' ? vatNetText(r[k]) : fmtAmt(r[k])}</td>)}</tr>)}</tbody>
              {v.rows.length > 1 && <tfoot><tr><td>Total</td>{VAT_COLS.map(([k]) => <td key={k} className="num">{k === 'net' ? vatNetText(v.T[k]) : fmtAmt(v.T[k])}</td>)}</tr></tfoot>}
            </table>
          </div>
          <details className="vat-lines" style={{ marginTop: 10 }}>
            <summary>Sales and bills with VAT ({v.lines.length})</summary>
            {v.lines.length === 0 ? <p className="muted">No sales or bills with VAT in these dates. Trips count only when "VAT 5% added" is on.</p> : (
              <div className="table-wrap">
                <table className="ats-table">
                  <thead><tr><th>Date</th><th>Company</th><th>Type</th><th>From</th><th>Ref / Bill no.</th><th>Details</th><th className="num">Amount</th><th className="num">VAT</th></tr></thead>
                  <tbody>{v.lines.map((x, i) => <tr key={i}><td>{dmy(x.date)}</td><td>{x.srcLabel}</td><td>{x.type}</td><td>{x.from}</td><td>{x.ref}</td><td>{x.text}</td><td className="num">{fmtAmt(x.amount)}</td><td className="num">{fmtAmt(x.vat)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
