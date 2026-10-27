'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { Donut, Bars, PairBars, HBars, SERIES } from '@/components/Charts';
import { sb, isLow } from '@/lib/supabase';
import { num, fmtAmt, fmtMoney, fmtFullDate, exportExcel, exportReportPdf } from '@/lib/sheet';
import { RANGES, rangeBounds, inRange, rangeNote, lastNDays } from '@/lib/ranges';

const RANGE_KEYS = ['today', 'yesterday', 'week', 'month', 'lastmonth', 'all'];
const UNIT = { packets: 'Packets', pcs: 'Pieces', roll: 'Rolls', box: 'Box', carton: 'Carton', ream: 'Ream', bottle: 'Bottle', set: 'Set', kg: 'Kg', litre: 'Litre' };
const unit = (u) => UNIT[u] || u || '';
const money = (v) => fmtMoney(v) || '0 Bz';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function InventoryReports() {
  const [cats, setCats] = useState(null);
  const [moves, setMoves] = useState([]);
  const [bills, setBills] = useState([]);
  const [range, setRange] = useState('month');
  const [busy, setBusy] = useState('');
  const areaRef = useRef(null);

  useEffect(() => {
    (async () => {
      const s = sb();
      const [c, m, b] = await Promise.all([
        s.from('categories').select('id, name, sort, items(id, name, unit, quantity, min_qty, price, per_pack)').order('sort').order('name'),
        s.from('stock_moves').select('id, item_id, move_type, qty, note, created_at').order('created_at', { ascending: false }).limit(5000),
        s.from('bill_payments').select('id, amount, paid_on, period, note, bill_accounts(name)').order('paid_on', { ascending: false })
      ]);
      setCats(c.data || []);
      setMoves(m.data || []);
      setBills(b.data || []);
    })();
  }, []);

  const r = useMemo(() => {
    if (!cats) return null;
    const bounds = rangeBounds(range);
    const items = cats.flatMap((c) => (c.items || []).map((i) => ({ ...i, category: c.name })));
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const value = (i) => num(Number(i.quantity) * Number(i.price || 0));
    const pm = moves.filter((m) => byId[m.item_id] && inRange(m.created_at, bounds));
    const ins = pm.filter((m) => m.move_type === 'in');
    const outs = pm.filter((m) => m.move_type === 'out');
    const sumQ = (list) => num(list.reduce((t, m) => t + Number(m.qty), 0));
    const sumV = (list) => num(list.reduce((t, m) => t + Number(m.qty) * Number(byId[m.item_id]?.price || 0), 0));

    const usedBy = {};
    outs.forEach((m) => { usedBy[m.item_id] = num((usedBy[m.item_id] || 0) + Number(m.qty)); });
    const topUsed = Object.entries(usedBy).map(([id, q]) => ({ item: byId[id], q })).sort((a, b) => b.q - a.q);

    const catValue = cats.map((c, i) => ({ label: c.name, color: SERIES[i % SERIES.length], value: num((c.items || []).reduce((t, it) => t + value(it), 0)) }));
    const health = {
      ok: items.filter((i) => Number(i.min_qty) > 0 && !isLow(i)).length,
      low: items.filter((i) => isLow(i) && Number(i.quantity) > 0).length,
      out: items.filter((i) => Number(i.quantity) <= 0).length,
      nomin: items.filter((i) => Number(i.min_qty) <= 0 && Number(i.quantity) > 0).length
    };
    const days = lastNDays(7).map((d) => ({ ...d, v: sumQ(moves.filter((m) => m.move_type === 'out' && byId[m.item_id] && new Date(m.created_at) >= d.start && new Date(m.created_at) < d.end)) }));
    const perDay = {};
    pm.forEach((m) => { const k = new Date(m.created_at).toDateString(); perDay[k] = (perDay[k] || 0) + 1; });
    const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0] || null;
    const catIn = cats.map((c) => sumQ(ins.filter((m) => byId[m.item_id]?.category === c.name)));
    const catOut = cats.map((c) => sumQ(outs.filter((m) => byId[m.item_id]?.category === c.name)));
    const pb = bills.filter((b) => inRange(b.paid_on, bounds));
    const billBy = {};
    pb.forEach((b) => { const k = b.bill_accounts?.name || 'Other'; billBy[k] = num((billBy[k] || 0) + Number(b.amount)); });
    const reorder = items.filter(isLow).map((i) => ({ ...i, short: num(Number(i.min_qty) - Number(i.quantity)) })).sort((a, b) => b.short - a.short);

    return {
      items, byId, pm, ins, outs, busiest, topUsed, catValue, health, days, catIn, catOut, pb, billBy, reorder,
      stockValue: num(items.reduce((t, i) => t + value(i), 0)),
      priced: items.filter((i) => Number(i.price) > 0).length,
      inQ: sumQ(ins), outQ: sumQ(outs), inV: sumV(ins), outV: sumV(outs),
      billTotal: num(pb.reduce((t, b) => t + Number(b.amount), 0))
    };
  }, [cats, moves, bills, range]);

  if (!r) return <div className="loading">Loading report...</div>;

  const healthSlices = [
    { label: '✓ OK', color: '#008300', value: r.health.ok },
    { label: '⚠ Low stock', color: '#eda100', value: r.health.low },
    { label: '✕ Out of stock', color: '#e34948', value: r.health.out },
    { label: 'No minimum set', color: '#9aa8a2', value: r.health.nomin }
  ];
  const bestDay = r.days.reduce((b, d, i) => (d.v > (r.days[b]?.v || 0) ? i : b), -1);
  const topCat = [...r.catValue].sort((a, b) => b.value - a.value)[0];
  const billSlices = Object.entries(r.billBy).map(([k, v], i) => ({ label: k, value: v, color: SERIES[i % SERIES.length] }));
  const top = r.topUsed[0];

  /* ---------- Exports ---------- */

  const movementRows = r.pm.map((m) => {
    const it = r.byId[m.item_id];
    return [fmtFullDate(m.created_at), it?.name || '', it?.category || '', m.move_type === 'in' ? 'In' : 'Out', num(m.qty), unit(it?.unit), m.note || ''];
  });
  const reorderRows = r.reorder.map((i) => [i.name, i.category, num(i.quantity), num(i.min_qty), i.short, unit(i.unit)]);
  const billRows = r.pb.map((b) => [fmtFullDate(b.paid_on), b.bill_accounts?.name || '', b.period || '', num(b.amount), b.note || '']);
  const fileBase = `Inventory report ${RANGES[range]} ${new Date().toISOString().slice(0, 10)}`;

  async function doPdf() {
    setBusy('pdf');
    try {
      await exportReportPdf(`${fileBase}.pdf`, {
        title: 'Tudo Num Office Systems: Report',
        note: `${RANGES[range]} · ${rangeNote(range)} Stock value and stock health are as of today.`,
        area: areaRef.current,
        tables: [
          { heading: `Reorder list (${r.reorder.length})`, head: ['Item', 'Category', 'Present', 'Minimum', 'Short by', 'Unit'], rows: reorderRows, numCols: [2, 3, 4] },
          { heading: `Stock movements in this period (${r.pm.length})`, head: ['Date', 'Item', 'Category', 'Type', 'Qty', 'Unit', 'Note'], rows: movementRows, numCols: [4], totalsRow: ['', '', '', 'In / Out', `${r.inQ} / ${r.outQ}`, '', ''] },
          { heading: `Bills paid in this period (${r.pb.length})`, head: ['Paid on', 'Bill', 'For month', 'Amount (OMR)', 'Note'], rows: billRows.map((x) => [x[0], x[1], x[2], x[3].toFixed(3), x[4]]), numCols: [3], totalsRow: ['', 'Total', '', r.billTotal.toFixed(3), ''] }
        ]
      });
    } catch (e) {
      console.error(e);
    }
    setBusy('');
  }

  async function doExcel() {
    setBusy('xlsx');
    try {
      await exportExcel(`${fileBase}.xlsx`, [
        {
          name: 'Summary', title: `Inventory report · ${RANGES[range]}`, subtitle: rangeNote(range), head: ['Measure', 'Value', 'Detail'], numCols: [], widths: [26, 22, 44],
          rows: [
            ['Stock value (today)', money(r.stockValue), `${r.priced} of ${r.items.length} items have a price`],
            ['Items in stock', `${r.items.length - r.health.out} of ${r.items.length}`, `${r.health.out} out of stock`],
            ['Low stock', r.reorder.length, 'At or below minimum'],
            ['Stock in', r.inQ, `${r.ins.length} entries · ${money(r.inV)}`],
            ['Stock used', r.outQ, `${r.outs.length} entries · ${money(r.outV)}`],
            ['Most used item', top ? top.item.name : '-', top ? `${top.q} ${unit(top.item.unit)}` : ''],
            ['Bills paid', `${r.billTotal.toFixed(3)} OMR`, plural(r.pb.length, 'payment')],
            ...r.catValue.map((c, i) => [`Value: ${c.label}`, money(c.value), `In ${r.catIn[i]} · Used ${r.catOut[i]}`])
          ]
        },
        { name: 'Reorder list', title: 'Reorder list', subtitle: 'Items at or below their minimum', head: ['Item', 'Category', 'Present', 'Minimum', 'Short by', 'Unit'], rows: reorderRows, numCols: [2, 3, 4], widths: [28, 18, 10, 10, 10, 10] },
        { name: 'Movements', title: `Stock movements · ${RANGES[range]}`, subtitle: rangeNote(range), head: ['Date', 'Item', 'Category', 'Type', 'Qty', 'Unit', 'Note'], rows: movementRows, numCols: [4], widths: [14, 26, 18, 8, 8, 10, 30] },
        { name: 'Bills', title: `Bills paid · ${RANGES[range]}`, subtitle: rangeNote(range), head: ['Paid on', 'Bill', 'For month', 'Amount (OMR)', 'Note'], rows: billRows, numCols: [3], widths: [14, 16, 14, 14, 30], totalsRow: ['', 'Total', '', r.billTotal, ''] }
      ]);
    } catch (e) {
      console.error(e);
    }
    setBusy('');
  }

  return (
    <>
      <div className="page-tools">
        <Link href="/inventory" className="crumb">← Inventory</Link>
        <div className="tools">
          <button type="button" className="btn" onClick={doPdf} disabled={!!busy}>{busy === 'pdf' ? 'Preparing PDF...' : '⬇ Download PDF'}</button>
          <button type="button" className="btn ghost" onClick={doExcel} disabled={!!busy}>{busy === 'xlsx' ? 'Preparing...' : '⬇ Export to Excel'}</button>
        </div>
      </div>

      <div className="rp-head">
        <div>
          <h1>Inventory Reports</h1>
          <p className="sub">Stock, usage and bills at one glance</p>
        </div>
      </div>

      <div className="rp-filters" role="group" aria-label="Report period">
        {RANGE_KEYS.map((k) => (
          <button key={k} type="button" className={`rp-chip ${range === k ? 'active' : ''}`} onClick={() => setRange(k)} aria-pressed={range === k}>{RANGES[k]}</button>
        ))}
      </div>
      <p className="rp-range-note">{rangeNote(range)} Stock value and stock health are as of today.</p>

      <div ref={areaRef} style={{ display: 'grid', gap: 12 }}>
        <div className="rp-tiles">
          <div className="rp-tile hero"><div className="rp-tile-label">💰 Stock value</div><div className="rp-tile-num">{money(r.stockValue)}</div><div className="rp-tile-sub">{r.priced} of {r.items.length} items have a price</div></div>
          <div className="rp-tile"><div className="rp-tile-label">📦 Items in stock</div><div className="rp-tile-num">{r.items.length - r.health.out}<small style={{ fontSize: 15, color: 'var(--muted)' }}> / {r.items.length}</small></div><div className="rp-tile-sub">{r.health.out} out of stock</div></div>
          <div className="rp-tile"><div className="rp-tile-label">⚠ Low stock</div><div className={`rp-tile-num ${r.reorder.length ? 'neg' : ''}`}>{r.reorder.length}</div><div className="rp-tile-sub">{r.reorder.length ? 'Need reordering' : 'Nothing to reorder'}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">⬇ Stock in</div><div className="rp-tile-num">{r.inQ}</div><div className="rp-tile-sub">{r.ins.length} {r.ins.length === 1 ? 'entry' : 'entries'} · {money(r.inV)}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">⬆ Stock used</div><div className="rp-tile-num">{r.outQ}</div><div className="rp-tile-sub">{r.outs.length} {r.outs.length === 1 ? 'entry' : 'entries'} · {money(r.outV)}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🏆 Most used</div><div className="rp-tile-num" style={{ fontSize: 20 }}>{top ? top.item.name : '-'}</div><div className="rp-tile-sub">{top ? `${top.q} ${unit(top.item.unit)} used` : 'Nothing used yet'}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🔥 Busiest day</div><div className="rp-tile-num" style={{ fontSize: 20 }}>{r.busiest ? new Date(r.busiest[0]).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '-'}</div><div className="rp-tile-sub">{r.busiest ? `${plural(r.busiest[1], 'stock movement')}` : 'No movement yet'}</div></div>
          <div className="rp-tile"><div className="rp-tile-label">🧾 Bills paid</div><div className="rp-tile-num">{r.billTotal.toFixed(3)}</div><div className="rp-tile-sub">OMR · {plural(r.pb.length, 'payment')}</div></div>
        </div>

        <div className="rp-grid">
          <div className="rp-card">
            <div className="rp-card-title">Where the stock value is <span className="rp-card-note">· today</span></div>
            <div className="rp-takeaway">{r.stockValue > 0 ? `${topCat.label} holds ${Math.round((topCat.value / r.stockValue) * 100)}% of the stock value.` : 'Add prices to items to see stock value.'}</div>
            <Donut slices={r.catValue} fmt={money} centerBig={r.stockValue >= 1 ? r.stockValue.toFixed(0) : String(Math.round(r.stockValue * 1000))} centerSmall={r.stockValue >= 1 ? 'Rials' : 'Bz'} />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Stock health <span className="rp-card-note">· today</span></div>
            <div className="rp-takeaway">{r.health.low + r.health.out ? `${r.health.low + r.health.out} of ${r.items.length} items are low or finished.` : 'All items with a minimum are well stocked.'}</div>
            <Donut slices={healthSlices} fmt={(v) => plural(v, 'item')} centerBig={String(r.items.length)} centerSmall="items" />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Most used items</div>
            <div className="rp-takeaway">{top ? `${top.item.name} is used the most: ${top.q} ${unit(top.item.unit)}.` : 'No stock was taken out in this period.'}</div>
            <HBars rows={r.topUsed.slice(0, 8).map((x) => ({ label: x.item.name, value: x.q, sub: unit(x.item.unit) }))} />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Stock used each day <span className="rp-card-note">· last 7 days</span></div>
            <div className="rp-takeaway">{bestDay >= 0 && r.days[bestDay].v > 0 ? `Most used on ${r.days[bestDay].label}: ${r.days[bestDay].v} units.` : 'Nothing used in the last 7 days.'}</div>
            <Bars labels={r.days.map((d) => d.label)} values={r.days.map((d) => d.v)} highlight={bestDay} labelAll />
          </div>
          <div className="rp-card rp-wide">
            <div className="rp-card-title">Added and used by section</div>
            <div className="rp-takeaway">{r.inQ + r.outQ ? `${r.inQ} units added and ${r.outQ} used in this period.` : 'No stock movement in this period.'}</div>
            <PairBars labels={cats.map((c) => c.name)} a={r.catIn} b={r.catOut} aLabel="Added (in)" bLabel="Used (out)" />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Bills paid</div>
            <div className="rp-takeaway">{r.billTotal ? `${r.billTotal.toFixed(3)} OMR paid in ${plural(r.pb.length, 'payment')}.` : 'No bills paid in this period.'}</div>
            <Donut slices={billSlices.length ? billSlices : [{ label: 'No payments', value: 0, color: '#9aa8a2' }]} fmt={(v) => `${Number(v).toFixed(3)} OMR`} centerBig={r.billTotal.toFixed(0)} centerSmall="OMR" />
          </div>
          <div className="rp-card">
            <div className="rp-card-title">Reorder list</div>
            <div className="rp-takeaway">{r.reorder.length ? `Buy these ${plural(r.reorder.length, 'item')} soon.` : 'Nothing needs reordering.'}</div>
            <div className="table-wrap">
              <table className="rp-block-table">
                <thead><tr><th>Item</th><th className="num">Present</th><th className="num">Minimum</th><th className="num">Short by</th></tr></thead>
                <tbody>
                  {r.reorder.slice(0, 10).map((i, n) => (
                    <tr key={i.id} className={n === 0 ? 'top' : ''}>
                      <td>{i.name}<br /><small className="muted">{i.category}</small></td>
                      <td className="num neg">{num(i.quantity)}</td>
                      <td className="num">{num(i.min_qty)}</td>
                      <td className="num"><b>{i.short}</b> <small className="muted">{unit(i.unit)}</small></td>
                    </tr>
                  ))}
                  {r.reorder.length === 0 && <tr><td colSpan={4} className="muted">All good.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <section className="panel">
        <h2>Stock movements in this period <span className="note">({r.pm.length})</span></h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Item</th><th>Section</th><th>Type</th><th className="num">Qty</th><th>Note</th></tr></thead>
            <tbody>
              {r.pm.slice(0, 60).map((m) => {
                const it = r.byId[m.item_id];
                return (
                  <tr key={m.id}>
                    <td>{fmtFullDate(m.created_at)}</td>
                    <td>{it?.name}</td>
                    <td>{it?.category}</td>
                    <td><span className={`pill ${m.move_type}`}>{m.move_type === 'in' ? 'In' : 'Out'}</span></td>
                    <td className="num">{num(m.qty)} {unit(it?.unit)}</td>
                    <td>{m.note || ''}</td>
                  </tr>
                );
              })}
              {r.pm.length === 0 && <tr><td colSpan={6} className="muted">No stock movement in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        {r.pm.length > 60 && <p className="note">Showing the latest 60. The PDF and Excel files include all {r.pm.length}.</p>}
      </section>
    </>
  );
}

export default function Page() {
  return <AuthGate wide><InventoryReports /></AuthGate>;
}
