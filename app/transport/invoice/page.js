'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import Modal from '@/components/Modal';
import { sb } from '@/lib/supabase';

/* ---------- Company details (shown on the invoice only, every line can be edited on the invoice) ---------- */
const COMPANY = {
  name: 'MODERN CITY FOR EXPRESS SERVICES LLC',
  short: 'Modern City For Express Services LLC',
  cr: 'CR No. 1404742',
  vat: 'VAT Registration No. OM11008665',
  address: 'PO Box 149, PC 133, Sultanate of Oman',
  web: 'www.tudonumgroup.com'
};
const VAT_RATE = 5;

const KINDS = {
  invoice: { label: 'Transportation Invoice', title: 'INVOICE' },
  tax: { label: 'Tax Invoice (VAT)', title: 'TAX INVOICE' },
  interim: { label: 'Interim Payment Application', title: 'INTERIM PAYMENT APPLICATION' }
};

const BLANK_ITEM = {
  invoice: { vehicle: '', container: '', description: '', amount: '' },
  tax: { description: '', qty: '1', unit: '', rate: String(VAT_RATE) },
  interim: { description: '', amount: '' }
};
const BLANK_DELIVERY = { vehicle: '', container: '', driver: '', consignee: '', received_by: '' };

/* ---------- Helpers ---------- */
const n = (v) => {
  const x = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const money = (v) => r3(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dmy = (d) => (d ? d.split('-').reverse().join('.') : '');
const uniq = (arr) => [...new Set(arr.map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const isEmptyRow = (row) => Object.entries(row).every(([k, v]) => (k === 'qty' || k === 'rate') || !String(v || '').trim());

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(num) {
  if (num === 0) return 'Zero';
  const chunk = (x) => {
    let s = '';
    if (x >= 100) { s += `${ONES[Math.floor(x / 100)]} Hundred`; x %= 100; if (x) s += ' and '; }
    if (x >= 20) { s += TENS[Math.floor(x / 10)]; if (x % 10) s += `-${ONES[x % 10]}`; } else if (x) s += ONES[x];
    return s;
  };
  const parts = [];
  [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']].forEach(([v, name]) => {
    if (num >= v) { parts.push(`${chunk(Math.floor(num / v))} ${name}`); num %= v; }
  });
  if (num) parts.push(chunk(num));
  return parts.join(' ');
}
function amountInWords(total) {
  const rials = Math.floor(r3(total));
  const baisa = Math.round((r3(total) - rials) * 1000);
  return `Omani Rials ${words(rials)}${baisa ? ` and ${words(baisa)} Baisa` : ''} Only`;
}

function totals(inv) {
  const items = inv.items || [];
  if (inv.kind === 'tax') {
    const net = items.reduce((t, it) => t + n(it.qty) * n(it.unit), 0);
    const vat = items.reduce((t, it) => t + (n(it.qty) * n(it.unit) * n(it.rate)) / 100, 0);
    return { net: r3(net), vat: r3(vat), total: r3(net + vat) };
  }
  const total = items.reduce((t, it) => t + n(it.amount), 0);
  return { net: r3(total), vat: 0, total: r3(total) };
}

function nextNumber(kind, list, date) {
  const year = (date || today()).slice(0, 4);
  const same = list.filter((x) => x.kind === kind);
  if (kind === 'tax') {
    const max = same.reduce((m, x) => {
      const mm = String(x.invoice_no || '').match(new RegExp(`^MC-${year}-(\\d+)$`));
      return mm ? Math.max(m, Number(mm[1])) : m;
    }, 0);
    return `MC-${year}-${String(max + 1).padStart(4, '0')}`;
  }
  if (kind === 'invoice') {
    const max = same.reduce((m, x) => {
      const mm = String(x.invoice_no || '').match(new RegExp(`^\\d{2}-(\\d+)-${year}$`));
      return mm ? Math.max(m, Number(mm[1])) : m;
    }, 0);
    return `${(date || today()).slice(8, 10)}-${String(max + 1).padStart(3, '0')}-${year}`;
  }
  const max = same.reduce((m, x) => Math.max(m, parseInt(x.invoice_no, 10) || 0), 0);
  return String(max + 1);
}

// A new invoice keeps the wording (labels) of the last saved invoice of the same type
function blankInvoice(kind, list) {
  const date = today();
  const last = list.find((x) => x.kind === kind && x.labels && Object.keys(x.labels).length);
  return {
    id: null, kind, invoice_no: nextNumber(kind, list, date), invoice_date: date,
    customer: '', bill_address: '', client_vat: '', from_place: '', to_place: '',
    supply_date: date, due_text: 'On receipt', payment_text: 'Not recorded',
    project: '', location: 'Sultanate of Oman', client: '', contractor: '',
    items: [{ ...BLANK_ITEM[kind] }, { ...BLANK_ITEM[kind] }],
    delivery: [{ ...BLANK_DELIVERY }],
    signatory: '', notes: '',
    description: '', cargo: '', consignee: '', status: 'Completed', credit_in: '',
    labels: last ? { ...last.labels } : {}
  };
}

/* ---------- Small input that looks like printed text ---------- */
function F({ value, onChange, list, ro, className = '', placeholder = '', type = 'text', align, inputMode, onBlur, fmt, auto }) {
  const shown = fmt && String(value ?? '').trim() ? fmt(value) : (value ?? '');
  const cls = `${className}${auto ? ' iv-auto' : ''}`;
  const style = align ? { textAlign: align } : undefined;
  // On paper (print, or view-only) show plain text so long values wrap instead of being cut off
  if (ro) return <span className={`iv-in iv-txt ${cls}`} style={style}>{shown}</span>;
  const input = (
      <input
        className={`iv-in no-print ${cls}`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        list={list}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        title={String(value ?? '')}
        size={auto ? 1 : undefined}
        style={style}
        autoComplete="off"
      />
  );
  return (
    <>
      {/* auto: the box grows with its text (a hidden copy of the text sets the width) */}
      {auto ? <span className={`iv-grow no-print ${cls}`} data-value={String(value || placeholder || ' ')}>{input}</span> : input}
      <span className={`iv-print-only iv-txt ${cls}`} style={style}>{shown}</span>
    </>
  );
}

/* Date field: date picker on screen, DD.MM.YYYY on paper */
function D({ value, onChange, ro }) {
  if (ro) return <span className="iv-in iv-date-text">{dmy(value)}</span>;
  return (
    <>
      <input className="iv-in no-print" type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      <span className="iv-print-only">{dmy(value)}</span>
    </>
  );
}

/* ================================================================== */

function InvoicePage() {
  const { isAdmin, name: userName } = useUser();
  const [list, setList] = useState(null);
  const [lookups, setLookups] = useState({ drivers: [], entries: [] });
  const [inv, setInv] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const toastTimer = useRef(null);
  const ro = !isAdmin;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const [i, d, e] = await Promise.all([
      s.from('transport_invoices').select('*').order('invoice_date', { ascending: false }).order('created_at', { ascending: false }),
      s.from('transport_drivers').select('id, name, vehicle_no').order('sort').order('name'),
      s.from('transport_entries').select('from_place, to_place, consignee, description, cargo, credit_in').limit(2000)
    ]);
    if (i.error) flash(i.error.message, 'err');
    setList(i.data || []);
    setLookups({ drivers: d.data || [], entries: e.data || [] });
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  /* Dropdown values: everything already used before, plus drivers and trips */
  const opts = useMemo(() => {
    const L = list || [];
    const items = L.flatMap((x) => x.items || []);
    const dels = L.flatMap((x) => x.delivery || []);
    const vehicles = lookups.drivers.flatMap((d) => String(d.vehicle_no || '').split('/'));
    return {
      customers: uniq([...L.map((x) => x.customer), ...L.map((x) => x.client)]),
      addresses: uniq(L.map((x) => x.bill_address)),
      vats: uniq(L.map((x) => x.client_vat)),
      places: uniq([...lookups.entries.flatMap((x) => [x.from_place, x.to_place]), ...L.flatMap((x) => [x.from_place, x.to_place])]),
      vehicles: uniq([...vehicles, ...items.map((x) => x.vehicle), ...dels.map((x) => x.vehicle)]),
      containers: uniq([...items.map((x) => x.container), ...dels.map((x) => x.container)]),
      descriptions: uniq([...items.map((x) => x.description), ...L.map((x) => x.description), ...lookups.entries.flatMap((x) => [x.description, x.cargo])]),
      cargos: uniq([...lookups.entries.map((x) => x.cargo), ...L.map((x) => x.cargo)]),
      credits: uniq(['Account', 'Cash', 'Bank transfer', 'Cheque', ...lookups.entries.map((x) => x.credit_in), ...L.map((x) => x.credit_in)]),
      drivers: uniq([...lookups.drivers.map((d) => d.name), ...dels.map((x) => x.driver)]),
      consignees: uniq([...lookups.entries.map((x) => x.consignee), ...dels.map((x) => x.consignee), ...L.map((x) => x.consignee)]),
      receivers: uniq(dels.map((x) => x.received_by)),
      projects: uniq(L.map((x) => x.project)),
      locations: uniq(['Sultanate of Oman', ...L.map((x) => x.location)]),
      contractors: uniq(L.map((x) => x.contractor)),
      terms: uniq(['On receipt', '15 days', '30 days', '45 days', '60 days', ...L.map((x) => x.due_text)]),
      payments: uniq(['Not recorded', 'Paid', 'Partly paid', ...L.map((x) => x.payment_text)])
    };
  }, [list, lookups]);

  function set(field, value) {
    setInv((v) => ({ ...v, [field]: value }));
    setDirty(true);
  }
  function setLabel(key, value) {
    setInv((v) => ({ ...v, labels: { ...(v.labels || {}), [key]: value } }));
    setDirty(true);
  }
  function setRow(group, idx, field, value) {
    setInv((v) => {
      const rows = v[group].map((r, i) => (i === idx ? { ...r, [field]: value } : r));
      // Picking a vehicle in Delivery Details fills the driver of that truck
      if (group === 'delivery' && field === 'vehicle' && !rows[idx].driver) {
        const d = lookups.drivers.find((x) => String(x.vehicle_no || '').split('/').map((s) => s.trim()).includes(value.trim()));
        if (d) rows[idx] = { ...rows[idx], driver: d.name };
      }
      return { ...v, [group]: rows };
    });
    setDirty(true);
  }
  function addRow(group) {
    setInv((v) => ({ ...v, [group]: [...v[group], group === 'items' ? { ...BLANK_ITEM[v.kind] } : { ...BLANK_DELIVERY }] }));
    setDirty(true);
  }
  function delRow(group, idx) {
    setInv((v) => ({ ...v, [group]: v[group].length > 1 ? v[group].filter((_, i) => i !== idx) : [group === 'items' ? { ...BLANK_ITEM[v.kind] } : { ...BLANK_DELIVERY }] }));
    setDirty(true);
  }
  function changeKind(kind) {
    setInv((v) => {
      const keep = v.items.filter((r) => !isEmptyRow(r)).map((r) => {
        const b = { ...BLANK_ITEM[kind], description: r.description || '' };
        if ('amount' in b) b.amount = r.amount || (r.unit ? String(r3(n(r.qty) * n(r.unit))) : '');
        if ('unit' in b) b.unit = r.amount || r.unit || '';
        if ('vehicle' in b) { b.vehicle = r.vehicle || ''; b.container = r.container || ''; }
        return b;
      });
      return {
        ...v, kind,
        invoice_no: v.id ? v.invoice_no : nextNumber(kind, list || [], v.invoice_date),
        customer: v.customer || v.client, client: v.client || v.customer,
        items: keep.length ? keep : [{ ...BLANK_ITEM[kind] }, { ...BLANK_ITEM[kind] }]
      };
    });
    setDirty(true);
  }

  function open(row) {
    setInv({
      ...row,
      labels: row.labels || {},
      items: row.items?.length ? row.items : [{ ...BLANK_ITEM[row.kind] }],
      delivery: row.delivery?.length ? row.delivery : [{ ...BLANK_DELIVERY }]
    });
    setDirty(false);
    window.scrollTo({ top: 0 });
  }

  function newInvoice(kind = 'invoice') {
    setInv(blankInvoice(kind, list || []));
    setDirty(false);
    window.scrollTo({ top: 0 });
  }

  function back() {
    if (dirty && !window.confirm('You have changes that are not saved. Leave anyway?')) return;
    setInv(null);
    setDirty(false);
  }

  async function save() {
    if (!inv.invoice_no?.trim()) { flash('Enter the invoice number.', 'err'); return; }
    setSaving(true);
    const clean = (rows) => rows.filter((r) => !isEmptyRow(r));
    const payload = {
      kind: inv.kind, invoice_no: inv.invoice_no.trim(), invoice_date: inv.invoice_date || today(),
      customer: inv.customer || null, bill_address: inv.bill_address || null, client_vat: inv.client_vat || null,
      from_place: inv.from_place || null, to_place: inv.to_place || null,
      supply_date: inv.supply_date || null, due_text: inv.due_text || null, payment_text: inv.payment_text || null,
      project: inv.project || null, location: inv.location || null, client: inv.client || null, contractor: inv.contractor || null,
      items: clean(inv.items), delivery: inv.kind === 'invoice' ? clean(inv.delivery) : [],
      signatory: inv.signatory || null, notes: inv.notes || null,
      description: inv.description || null, cargo: inv.cargo || null, consignee: inv.consignee || null,
      status: inv.status || null, credit_in: inv.credit_in || null,
      labels: inv.labels || {}, updated_at: new Date().toISOString()
    };
    const s = sb().from('transport_invoices');
    const res = inv.id
      ? await s.update(payload).eq('id', inv.id).select().single()
      : await s.insert({ ...payload, created_by: userName }).select().single();
    setSaving(false);
    if (res.error) { flash(res.error.message, 'err'); return; }
    flash('Invoice saved');
    setDirty(false);
    setInv((v) => ({ ...v, id: res.data.id }));
    load();
  }

  async function remove() {
    setConfirmDel(false);
    const { error } = await sb().from('transport_invoices').delete().eq('id', inv.id);
    if (error) { flash(error.message, 'err'); return; }
    flash('Invoice deleted');
    setInv(null);
    setDirty(false);
    load();
  }

  function print() {
    const old = document.title;
    document.title = `${KINDS[inv.kind].label} ${inv.invoice_no || ''}`.trim();
    window.print();
    setTimeout(() => { document.title = old; }, 500);
  }

  /* ---------- List view ---------- */
  if (!list) return <div className="loading">Loading invoices...</div>;

  if (!inv) {
    const shown = list.filter((x) => {
      const t = `${x.invoice_no} ${x.customer} ${x.client} ${x.project} ${KINDS[x.kind]?.label}`.toLowerCase();
      return t.includes(q.trim().toLowerCase());
    });
    return (
      <>
        <div className="page-tools">
          <Link href="/transport" className="crumb">← Transport</Link>
          <div className="tools">
            <input className="iv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoices" aria-label="Search invoices" />
            {isAdmin && (
              <label className="iv-new">
                <span>+ New invoice</span>
                <select value="" onChange={(e) => { if (e.target.value) newInvoice(e.target.value); }} aria-label="New invoice: choose layout">
                  <option value="">Choose invoice type...</option>
                  {Object.entries(KINDS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="iv-list-head">
          <h1>Invoices</h1>
          <p>{list.length} saved · Modern City for Express Services LLC</p>
        </div>

        {shown.length === 0 ? (
          <div className="iv-empty">
            <div className="iv-empty-mark">🧾</div>
            <p>{list.length ? 'No invoice matches your search.' : 'No invoices yet.'}</p>
            {isAdmin && !list.length && <button type="button" className="btn in" onClick={() => newInvoice('invoice')}>Create the first invoice</button>}
          </div>
        ) : (
          <div className="iv-table-wrap">
            <table className="iv-list">
              <thead>
                <tr><th>No.</th><th>Type</th><th>Date</th><th>Customer / Client</th><th className="num">Total (OMR)</th></tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.id} onClick={() => open(x)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(x); }}>
                    <td className="iv-list-no">{x.kind === 'interim' ? `IPA – ${x.invoice_no}` : x.invoice_no}</td>
                    <td><span className={`iv-kind k-${x.kind}`}>{KINDS[x.kind]?.label}</span></td>
                    <td>{dmy(x.invoice_date)}</td>
                    <td>{x.kind === 'interim' ? (x.client || x.project) : x.customer}</td>
                    <td className="num">{money(totals(x).total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">{toast.text}</div>}
      </>
    );
  }

  /* ---------- Invoice editor / paper ---------- */
  const k = inv.kind;
  const T = totals(inv);
  const lists = Object.keys(opts);
  const lab = (key, def) => (inv.labels && inv.labels[key] != null ? inv.labels[key] : def);
  // Editable label / heading text (looks like normal printed text)
  const L = (key, def, className = '', auto = false) => (
    <F value={lab(key, def)} onChange={(v) => setLabel(key, v)} ro={ro} className={`iv-lbl ${className}`} auto={auto} />
  );

  return (
    <>
      {lists.map((key) => (
        <datalist id={`iv-${key}`} key={key}>
          {opts[key].map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}

      <div className="page-tools no-print">
        <button type="button" className="crumb link-like" onClick={back}>← All invoices</button>
        <div className="tools">
          <label className="iv-type">
            <span>Invoice type</span>
            <select value={k} onChange={(e) => changeKind(e.target.value)} disabled={ro}>
              {Object.entries(KINDS).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
            </select>
          </label>
          {isAdmin && <button type="button" className="btn in" onClick={save} disabled={saving}>{saving ? 'Saving...' : dirty || !inv.id ? '💾 Save' : '✓ Saved'}</button>}
          <button type="button" className="btn" onClick={print}>🖨 Print / PDF</button>
          {isAdmin && inv.id && <button type="button" className="btn ghost" onClick={() => setConfirmDel(true)}>Delete</button>}
        </div>
      </div>
      {!ro && <p className="iv-hint no-print">✏️ Everything on the invoice can be edited: click any text, heading or label to change it. New invoices keep your wording. Empty rows and helper buttons do not print.</p>}

      <article className={`iv-paper k-${k}${ro ? ' ro' : ''}`}>
        <div className="iv-mark" aria-hidden="true" />
        <div className="iv-topline" aria-hidden="true" />

        {/* Letterhead: logo on the extreme left */}
        <header className="iv-head">
          <img src="/tudonum-logo.png" alt="Tudo Num" className="iv-logo" />
          <div className="iv-co">
            {L('co_name', COMPANY.name, 'iv-co-name')}
            <div className="iv-co-line">
              {L('co_cr', COMPANY.cr, '', true)}<i>·</i>{L('co_vat', COMPANY.vat, '', true)}
            </div>
            <div className="iv-co-line">
              {L('co_addr', COMPANY.address, '', true)}<i>·</i>{L('co_web', COMPANY.web, 'iv-web', true)}
            </div>
          </div>
        </header>

        <div className="iv-rule" aria-hidden="true"><span /></div>

        {/* Title: below the letterhead, in the middle */}
        <div className="iv-titlebar">
          <div className="iv-title-main">
            {L(`title_${k}`, KINDS[k].title, 'iv-title-text', true)}
            {k === 'interim' && <><span className="iv-dash">–</span><F value={inv.invoice_no} onChange={(v) => set('invoice_no', v)} ro={ro} className="iv-title-no" auto /></>}
          </div>
          {k !== 'interim' && <div className="iv-title-no-line">{L('no', 'No.', '', true)} <b>{inv.invoice_no || '—'}</b></div>}
          {k === 'tax' && <div className="iv-title-sub">{L('supplier_vat', `Supplier ${COMPANY.vat}`, '', true)}</div>}
          <div className="iv-title-orn" aria-hidden="true"><i /><b /><i /></div>
        </div>

        {/* ---------- Transport invoice ---------- */}
        {k === 'invoice' && (
          <section className="iv-meta-grid">
            <dl className="iv-dl">
              <dt>{L('lbl_no', 'Invoice No.')}</dt><dd><F value={inv.invoice_no} onChange={(v) => set('invoice_no', v)} ro={ro} /></dd>
              <dt>{L('lbl_date', 'Date')}</dt><dd><D value={inv.invoice_date} onChange={(v) => set('invoice_date', v)} ro={ro} /></dd>
              <dt>{L('lbl_customer', 'Customer Name')}</dt><dd><F value={inv.customer} onChange={(v) => set('customer', v)} list="iv-customers" ro={ro} placeholder="Pick or type customer" /></dd>
            </dl>
            <div className="iv-route">
              <div className="iv-route-end">
                <div className="iv-route-cap">{L('lbl_from', 'From')}</div>
                <F value={inv.from_place} onChange={(v) => set('from_place', v)} list="iv-places" ro={ro} placeholder="Loading point" className="iv-route-val" />
              </div>
              <div className="iv-route-line" aria-hidden="true"><i /><b>→</b><i /></div>
              <div className="iv-route-end">
                <div className="iv-route-cap">{L('lbl_to', 'To')}</div>
                <F value={inv.to_place} onChange={(v) => set('to_place', v)} list="iv-places" ro={ro} placeholder="Delivery point" className="iv-route-val" />
              </div>
            </div>
          </section>
        )}

        {/* ---------- Tax invoice ---------- */}
        {k === 'tax' && (
          <section className="iv-meta-grid">
            <div className="iv-billto">
              <div className="iv-cap">{L('lbl_billto', 'Bill To')}</div>
              <F value={inv.customer} onChange={(v) => set('customer', v)} list="iv-customers" ro={ro} className="iv-big" placeholder="Client name" />
              <F value={inv.bill_address} onChange={(v) => set('bill_address', v)} list="iv-addresses" ro={ro} placeholder="Address" />
              <div className="iv-inline">{L('lbl_clientvat', 'Client VAT:', '', true)}<F value={inv.client_vat} onChange={(v) => set('client_vat', v)} list="iv-vats" ro={ro} placeholder="VAT number" /></div>
            </div>
            <dl className="iv-dl">
              <dt>{L('lbl_no', 'Invoice No.')}</dt><dd><F value={inv.invoice_no} onChange={(v) => set('invoice_no', v)} ro={ro} /></dd>
              <dt>{L('lbl_invdate', 'Invoice date')}</dt><dd><D value={inv.invoice_date} onChange={(v) => set('invoice_date', v)} ro={ro} /></dd>
            </dl>
          </section>
        )}

        {/* ---------- Interim payment ---------- */}
        {k === 'interim' && (
          <section className="iv-ipa">
            <div className="iv-ipa-row"><div className="iv-ipa-lbl">{L('lbl_project', 'Name of Project')}</div><b>:</b>
              <div className="iv-ipa-val">
                <F value={inv.project} onChange={(v) => set('project', v)} list="iv-projects" ro={ro} className="iv-strong" placeholder="Project name and plot no." />
                <F value={inv.location} onChange={(v) => set('location', v)} list="iv-locations" ro={ro} />
              </div>
            </div>
            <div className="iv-ipa-row"><div className="iv-ipa-lbl">{L('lbl_client', 'Client')}</div><b>:</b>
              <div className="iv-ipa-val"><F value={inv.client} onChange={(v) => set('client', v)} list="iv-customers" ro={ro} className="iv-strong" placeholder="Client" /></div>
            </div>
            <div className="iv-ipa-row"><div className="iv-ipa-lbl">{L('lbl_contractor', 'Contractor')}</div><b>:</b>
              <div className="iv-ipa-val"><F value={inv.contractor} onChange={(v) => set('contractor', v)} list="iv-contractors" ro={ro} className="iv-strong" placeholder="Contractor" /></div>
            </div>
            <div className="iv-ipa-row"><div className="iv-ipa-lbl">{L('lbl_date', 'Date')}</div><b>:</b>
              <div className="iv-ipa-val"><D value={inv.invoice_date} onChange={(v) => set('invoice_date', v)} ro={ro} /></div>
            </div>
          </section>
        )}

        {/* ---------- Items ---------- */}
        <section className="iv-block">
          {k !== 'interim' && <h3 className="iv-h">{k === 'tax' ? L('h_services', 'Services', '', true) : L('h_items', 'Details', '', true)}</h3>}
          <table className="iv-t">
            <thead>
              {k === 'invoice' && (
                <tr>
                  <th className="c-no">{L('th_sno', 'S.No')}</th>
                  <th className="c-veh">{L('th_vehicle', 'Vehicle No.')}</th>
                  <th className="c-con">{L('th_container', 'Container No.')}</th>
                  <th>{L('th_desc', 'Description')}</th>
                  <th className="num">{L('th_freight', 'Freight (OMR)')}</th>
                  <th className="no-print c-x" />
                </tr>
              )}
              {k === 'tax' && (
                <tr>
                  <th>{L('th_service', 'Service / description')}</th>
                  <th className="num c-s">{L('th_qty', 'Qty')}</th>
                  <th className="num c-m">{L('th_unit', 'Unit net')}</th>
                  <th className="num c-s">{L('th_rate', 'Rate')}</th>
                  <th className="num c-m">{L('th_vat', 'VAT')}</th>
                  <th className="num c-m">{L('th_net', 'Net total')}</th>
                  <th className="no-print c-x" />
                </tr>
              )}
              {k === 'interim' && (
                <tr>
                  <th className="c-no">{L('th_ipa_no', 'NO')}</th>
                  <th>{L('th_ipa_desc', 'DESCRIPTION')}</th>
                  <th className="num c-l">{L('th_ipa_amount', 'AMOUNT (OMR)')}</th>
                  <th className="no-print c-x" />
                </tr>
              )}
            </thead>
            <tbody>
              {inv.items.map((it, i) => {
                const empty = isEmptyRow(it);
                const amt = (f) => ({ fmt: (v) => money(n(v)), value: it[f], onChange: (v) => setRow('items', i, f, v), ro, align: 'right', inputMode: 'decimal', placeholder: '0.000', onBlur: () => { if (String(it[f]).trim()) setRow('items', i, f, money(n(it[f])).replace(/,/g, '')); } });
                return (
                  <tr key={i} className={empty ? 'is-empty' : ''}>
                    {k === 'invoice' && (
                      <>
                        <td className="c-no">{i + 1}</td>
                        <td><F value={it.vehicle} onChange={(v) => setRow('items', i, 'vehicle', v)} list="iv-vehicles" ro={ro} placeholder="Vehicle" /></td>
                        <td><F value={it.container} onChange={(v) => setRow('items', i, 'container', v)} list="iv-containers" ro={ro} placeholder="Container" /></td>
                        <td><F value={it.description} onChange={(v) => setRow('items', i, 'description', v)} list="iv-descriptions" ro={ro} placeholder="Description" /></td>
                        <td className="num"><F {...amt('amount')} /></td>
                      </>
                    )}
                    {k === 'tax' && (
                      <>
                        <td><F value={it.description} onChange={(v) => setRow('items', i, 'description', v)} list="iv-descriptions" ro={ro} placeholder="Service / description" /></td>
                        <td className="num"><F value={it.qty} onChange={(v) => setRow('items', i, 'qty', v)} ro={ro} align="right" inputMode="decimal" /></td>
                        <td className="num"><F {...amt('unit')} /></td>
                        <td className="num iv-rate"><F value={it.rate} onChange={(v) => setRow('items', i, 'rate', v)} ro={ro} align="right" inputMode="decimal" /><span>%</span></td>
                        <td className="num">{money((n(it.qty) * n(it.unit) * n(it.rate)) / 100)}</td>
                        <td className="num b">{money(n(it.qty) * n(it.unit))}</td>
                      </>
                    )}
                    {k === 'interim' && (
                      <>
                        <td className="c-no">{i + 1}</td>
                        <td><F value={it.description} onChange={(v) => setRow('items', i, 'description', v)} list="iv-descriptions" ro={ro} placeholder="Description" /></td>
                        <td className="num"><F {...amt('amount')} /></td>
                      </>
                    )}
                    <td className="no-print c-x">{!ro && <button type="button" className="iv-x" onClick={() => delRow('items', i)} aria-label="Remove row">×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!ro && <button type="button" className="iv-add no-print" onClick={() => addRow('items')}>+ Add row</button>}

          <div className="iv-sum">
            <div className="iv-words"><div className="iv-words-cap">{L('lbl_words', 'Amount in words')}</div>{amountInWords(T.total)}</div>
            <div className="iv-totals">
              {k === 'tax' && (
                <>
                  <div><div className="iv-tl">{L('lbl_excl', 'Total excluding VAT')}</div><b>{money(T.net)}</b></div>
                  <div><div className="iv-tl">{L('lbl_vat', 'VAT')}</div><b>{money(T.vat)}</b></div>
                </>
              )}
              <div className="iv-grand">
                <div className="iv-tl">{k === 'tax' ? L('lbl_incl', 'Total including VAT') : L('lbl_total', 'Total')}</div>
                <b><small>{L('lbl_cur', 'OMR', '', true)}</small> {money(T.total)}</b>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Delivery details (transport invoice) ---------- */}
        {k === 'invoice' && (
          <section className="iv-block">
            <h3 className="iv-h">{L('h_delivery', 'Delivery Details', '', true)}</h3>
            <table className="iv-t">
              <thead>
                <tr>
                  <th className="c-veh">{L('th_d_vehicle', 'Vehicle No.')}</th>
                  <th className="c-con">{L('th_d_container', 'Container No.')}</th>
                  <th>{L('th_d_driver', 'Driver Name')}</th>
                  <th>{L('th_d_consignee', 'Consignee')}</th>
                  <th>{L('th_d_received', 'Received By')}</th>
                  <th className="no-print c-x" />
                </tr>
              </thead>
              <tbody>
                {inv.delivery.map((d, i) => (
                  <tr key={i} className={isEmptyRow(d) ? 'is-empty' : ''}>
                    <td><F value={d.vehicle} onChange={(v) => setRow('delivery', i, 'vehicle', v)} list="iv-vehicles" ro={ro} placeholder="Vehicle" /></td>
                    <td><F value={d.container} onChange={(v) => setRow('delivery', i, 'container', v)} list="iv-containers" ro={ro} placeholder="Container" /></td>
                    <td><F value={d.driver} onChange={(v) => setRow('delivery', i, 'driver', v)} list="iv-drivers" ro={ro} placeholder="Driver" /></td>
                    <td><F value={d.consignee} onChange={(v) => setRow('delivery', i, 'consignee', v)} list="iv-consignees" ro={ro} placeholder="Consignee" /></td>
                    <td><F value={d.received_by} onChange={(v) => setRow('delivery', i, 'received_by', v)} list="iv-receivers" ro={ro} placeholder="Received by" /></td>
                    <td className="no-print c-x">{!ro && <button type="button" className="iv-x" onClick={() => delRow('delivery', i)} aria-label="Remove row">×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ro && <button type="button" className="iv-add no-print" onClick={() => addRow('delivery')}>+ Add row</button>}
          </section>
        )}

        {/* ---------- Notes ---------- */}
        {(!ro || inv.notes) && (
          <section className={`iv-notes ${inv.notes ? '' : 'is-empty'}`}>
            <div className="iv-notes-cap">{L('lbl_notes', 'Notes', '', true)}</div>
            <F value={inv.notes} onChange={(v) => set('notes', v)} ro={ro} placeholder="Optional note, bank details or terms" />
          </section>
        )}

        {/* ---------- Signatures (no name list: the line is left free to sign) ---------- */}
        <footer className="iv-sign">
          <div className="iv-sign-box">
            <div className="iv-cap">{L('lbl_sign', 'Authorized Signatory')}</div>
            <div className="iv-sign-space" />
            <F value={inv.signatory} onChange={(v) => set('signatory', v)} ro={ro} className="iv-sign-name" placeholder="Name (optional)" />
            {L('lbl_sign_co', COMPANY.short, 'iv-sign-co')}
          </div>
          <div className="iv-sign-box right">
            <div className="iv-cap">{L(k === 'interim' ? 'lbl_approval' : 'lbl_custsign', k === 'interim' ? 'Client Approval' : 'Customer Signature & Stamp')}</div>
            <div className="iv-sign-space stamp" />
            {L('lbl_sign_date', 'Date: ____ / ____ / ________', 'iv-sign-co')}
          </div>
        </footer>

        <div className="iv-foot">
          {L('foot_left', 'Thank you for your business', 'iv-foot-l', true)}
          {L('foot_right', `${COMPANY.short} · ${COMPANY.web}`, 'iv-foot-r', true)}
        </div>
        <div className="iv-bottomline" aria-hidden="true" />
      </article>

      {confirmDel && (
        <Modal title="Delete invoice" onClose={() => setConfirmDel(false)}>
          <p>Delete invoice <b>{inv.invoice_no}</b>? This cannot be undone.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
            <button type="button" className="btn danger" onClick={remove}>Delete</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><InvoicePage /></AuthGate>;
}
