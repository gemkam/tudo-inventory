'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import DataGrid from '@/components/DataGrid';
import Modal from '@/components/Modal';
import EditToggle from '@/components/EditToggle';
import Expiry from '@/components/Expiry';
import { sb } from '@/lib/supabase';
import { exportExcel, exportStamp } from '@/lib/sheet';
import { fmtD } from '@/lib/reminders';
import { SECTIONS, SECTION, STATES, docStatus } from '@/lib/docChecklist';

/*
  Documents Checklist (/docs): issue date and expiry of
  Employee Docs, Cars Docs, Heavy Vehicles, Govt License, Company Docs.
  Table doc_checklist. Status is worked out from the expiry date; alerts on Home 30 days before.
  Employee tab also shows Resident Card / Visa already kept on the Drivers page and Office staff sheet (read only here).
*/

const CO = { 'modern-city': 'Modern City', 'abu-wasif': 'Abu Wasif', sumptuosity: 'Sumptuosity' };
const FILTERS = [['all', 'All'], ['bad', 'Expired'], ['soon', 'Renew in 30 days'], ['ok', 'Active'], ['none', 'No expiry date'], ['off', 'Cancelled / Transferred']];
const TAG = { ok: 'ok', soon: 'warn', bad: 'due', none: 'info', off: 'info' };

function StatusTag({ r }) {
  const st = docStatus(r);
  return <span className={`tag ${TAG[st.key]}`}>{st.label}</span>;
}

function DocsPage() {
  const { isAdmin, name } = useUser();
  const [rows, setRows] = useState(null);
  const [people, setPeople] = useState([]);
  const [tab, setTab] = useState('company');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('owner');
  const [editMode, setEditMode] = useState(false);
  const [del, setDel] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const canChange = isAdmin && editMode;

  const flash = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && SECTION[t]) setTab(t);
  }, []);

  const load = useCallback(async () => {
    const s = sb();
    const q = (p) => p.then((r) => r.data || []).catch(() => []);
    const [d, drv, staff] = await Promise.all([
      s.from('doc_checklist').select('*').order('sort'),
      q(s.from('transport_drivers').select('id, name, status, resident_card, resident_card_expiry, visa_expiry')),
      q(s.from('exp_staff').select('id, name, company, active, resident_card, resident_card_expiry, visa_expiry'))
    ]);
    if (d.error) { flash(d.error.message, 'err'); setRows([]); return; }
    setRows(d.data || []);
    const linked = [];
    drv.filter((x) => x.status !== 'Inactive').forEach((x) => {
      linked.push({ id: `drv-rc-${x.id}`, owner: `${x.name} (driver)`, doc_name: 'Resident Card', doc_no: x.resident_card, expiry_date: x.resident_card_expiry, href: '/transport/drivers', from: 'Drivers page' });
      linked.push({ id: `drv-visa-${x.id}`, owner: `${x.name} (driver)`, doc_name: 'Visa', expiry_date: x.visa_expiry, href: '/transport/drivers', from: 'Drivers page' });
    });
    staff.filter((x) => x.active !== false).forEach((x) => {
      const who = `${x.name} (${CO[x.company] || x.company || 'staff'})`;
      linked.push({ id: `stf-rc-${x.id}`, owner: who, doc_name: 'Resident Card', doc_no: x.resident_card, expiry_date: x.resident_card_expiry, href: `/expenses?co=${x.company}`, from: 'Office Expense salary sheet' });
      linked.push({ id: `stf-visa-${x.id}`, owner: who, doc_name: 'Visa', expiry_date: x.visa_expiry, href: `/expenses?co=${x.company}`, from: 'Office Expense salary sheet' });
    });
    setPeople(linked);
  }, [flash]);
  useEffect(() => { load(); }, [load]);

  function pickTab(k) {
    setTab(k);
    setFilter('all');
    try { window.history.replaceState(null, '', `/docs?tab=${k}`); } catch { /* ignore */ }
  }

  const counts = useMemo(() => {
    const c = {};
    for (const s of SECTIONS) {
      const list = (rows || []).filter((r) => r.section === s.key);
      c[s.key] = { all: list.length, bad: list.filter((r) => docStatus(r).key === 'bad').length, soon: list.filter((r) => docStatus(r).key === 'soon').length };
    }
    return c;
  }, [rows]);

  const sec = SECTION[tab];
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (rows || []).filter((r) => r.section === tab);
    if (filter !== 'all') list = list.filter((r) => docStatus(r).key === filter);
    if (q) list = list.filter((r) => [r.owner, r.doc_name, r.doc_no, r.notes].some((v) => String(v || '').toLowerCase().includes(q)));
    const exp = (r) => (r.state ? '9999' : r.expiry_date || '9998');
    if (sortBy === 'expiry') list = [...list].sort((a, b) => exp(a).localeCompare(exp(b)));
    else list = [...list].sort((a, b) => String(a.owner || '').localeCompare(String(b.owner || '')) || (a.sort || 0) - (b.sort || 0));
    return list;
  }, [rows, tab, filter, search, sortBy]);

  const owners = useMemo(() => [...new Set((rows || []).filter((r) => r.section === tab).map((r) => r.owner).filter(Boolean))].sort(), [rows, tab]);
  const docNames = useMemo(() => [...new Set([...(sec?.docs || []), ...(rows || []).filter((r) => r.section === tab).map((r) => r.doc_name).filter(Boolean)])], [rows, tab, sec]);

  async function save(row, key, value) {
    const patch = { [key]: value === '' ? null : value };
    setRows((list) => list.map((x) => (x.id === row.id ? { ...x, ...patch } : x)));
    const { error } = await sb().from('doc_checklist').update(patch).eq('id', row.id);
    if (error) { flash(error.message, 'err'); load(); return; }
    flash('Saved');
  }

  async function addRow() {
    const sort = (rows || []).reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const last = shown[shown.length - 1];
    const { data, error } = await sb().from('doc_checklist')
      .insert({ section: tab, owner: last?.owner || null, doc_name: null, sort, entered_by: name || null })
      .select().single();
    if (error) { flash(error.message, 'err'); return; }
    setRows((list) => [...list, data]);
    setFilter('all');
    flash('New line added. Type the document and dates.');
  }

  async function confirmDelete() {
    const { error } = await sb().from('doc_checklist').delete().eq('id', del.id);
    if (error) { flash(error.message, 'err'); setDel(null); return; }
    setRows((list) => list.filter((x) => x.id !== del.id));
    setDel(null);
    flash('Deleted');
  }

  async function doExcel() {
    const sheets = SECTIONS.map((s) => ({
      name: s.label,
      title: `Documents Checklist: ${s.label}`,
      subtitle: `Tudo Num Group · status on ${fmtD(new Date().toISOString())}`,
      head: ['S.No', s.owner, 'Document', 'Document No.', 'Issue date', 'Expiry date', 'Status', 'Days left', 'Notes'],
      rows: (rows || []).filter((r) => r.section === s.key)
        .sort((a, b) => String(a.owner || '').localeCompare(String(b.owner || '')) || (a.sort || 0) - (b.sort || 0))
        .map((r, i) => {
          const st = docStatus(r);
          return [i + 1, r.owner || '', r.doc_name || '', r.doc_no || '', fmtD(r.issue_date), fmtD(r.expiry_date), st.label, st.left ?? '', r.notes || ''];
        }),
      numCols: [], widths: [6, 40, 34, 16, 13, 13, 15, 10, 28]
    }));
    await exportExcel(`Documents Checklist ${exportStamp()}.xlsx`, sheets);
    flash('Excel file downloaded');
  }

  if (!rows) return <div className="loading">Loading documents...</div>;

  const columns = [
    { key: 'owner', label: sec.owner, type: 'combo', options: owners, width: 300, render: (r) => <b>{r.owner || <span className="muted">–</span>}</b> },
    { key: 'doc_name', label: 'Document', type: 'combo', options: docNames, width: 270 },
    { key: 'doc_no', label: 'Document No.', type: 'text', width: 140 },
    { key: 'issue_date', label: 'Issue date', type: 'date', width: 120 },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', width: 150, render: (r) => (r.state ? <span className="muted">{fmtD(r.expiry_date) || '–'}</span> : <Expiry date={r.expiry_date} />) },
    { key: 'status', label: 'Status', type: 'calc', width: 130, render: (r) => <StatusTag r={r} /> },
    { key: 'state', label: 'Stop alerts', type: 'select', options: STATES, width: 120, render: (r) => r.state || <span className="muted">–</span> },
    { key: 'notes', label: 'Notes', type: 'text', width: 220 }
  ];

  const all = rows.length;
  const tot = { bad: 0, soon: 0, ok: 0, none: 0 };
  rows.forEach((r) => { const k = docStatus(r).key; if (k in tot) tot[k] += 1; });
  const empSoon = people.filter((p) => p.expiry_date && docStatus(p).key !== 'ok');
  const empMissing = people.filter((p) => !p.expiry_date).length;

  return (
    <>
      <div className="page-tools">
        <Link href="/" className="crumb">← Home</Link>
        <div className="tools">
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn ghost" onClick={doExcel}>Export Excel</button>
        </div>
      </div>
      <div>
        <h1>📋 Documents Checklist</h1>
        <p className="sub">Issue date and expiry of every document. Status is worked out from the expiry date. Alerts show on Home {30} days before.</p>
      </div>

      <div className="kpi-row">
        <div className="kpi"><span>Documents</span><strong>{all}</strong><small>{SECTIONS.length} sections</small></div>
        <div className={`kpi ${tot.bad ? 'kpi-bad' : ''}`}><span>Expired</span><strong>{tot.bad}</strong><small>renew now</small></div>
        <div className="kpi"><span>Renew in 30 days</span><strong>{tot.soon}</strong><small>coming up</small></div>
        <div className="kpi"><span>Active</span><strong>{tot.ok}</strong><small>{tot.none ? `${tot.none} with no expiry date` : 'all dated'}</small></div>
      </div>

      <div className="dc-tabs co-switch" role="tablist" aria-label="Document sections">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={tab === s.key} className={tab === s.key ? 'on' : ''} onClick={() => pickTab(s.key)}>
            <span aria-hidden="true">{s.icon}</span> {s.label}
            <small className="dc-n">{counts[s.key].all}</small>
            {counts[s.key].bad > 0 && <small className="dc-bad" title="Expired">{counts[s.key].bad}</small>}
            {counts[s.key].soon > 0 && <small className="dc-soon" title="Renew in 30 days">{counts[s.key].soon}</small>}
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>{sec.icon} {sec.label}</h2>
          <EditToggle show={isAdmin} on={editMode} onClick={() => setEditMode((v) => !v)} />
        </div>

        <div className="dc-bar">
          <div className="head-chips">
            {FILTERS.map(([k, label]) => {
              const n = k === 'all' ? counts[tab].all : (rows || []).filter((r) => r.section === tab && docStatus(r).key === k).length;
              if (k !== 'all' && !n) return null;
              return <button key={k} type="button" className={`rp-chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label} · {n}</button>;
            })}
          </div>
          <div className="dc-right">
            <div className="search"><input type="search" placeholder="Search name, plate, document..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search documents" /></div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
              <option value="owner">Sort: {sec.owner.split(' ')[0]}</option>
              <option value="expiry">Sort: Expiry first</option>
            </select>
          </div>
        </div>

        <DataGrid
          columns={columns}
          rows={shown}
          canEdit={canChange}
          onSave={save}
          onAdd={addRow}
          addLabel={`+ Add ${sec.label.replace(/s$/, '').toLowerCase()} line`}
          onDelete={(r) => setDel(r)}
          rowClass={(r) => { const k = docStatus(r).key; return k === 'bad' ? 'dc-row-bad' : k === 'off' ? 'muted-row' : ''; }}
          emptyText={filter === 'all' && !search ? 'Nothing here yet. Press Edit, then + Add.' : 'No documents match.'}
          flash={flash}
        />

        {tab === 'employee' && people.length > 0 && (
          <div className="dc-linked">
            <h3>🔗 Resident Card and Visa from Drivers and Office staff</h3>
            <p className="muted">These are kept on their own pages (alerts already come from there). {empMissing ? `${empMissing} expiry dates not entered yet.` : ''}</p>
            <div className="table-wrap">
              <table className="dc-table">
                <thead><tr><th>Employee</th><th>Document</th><th>No.</th><th>Expiry date</th><th>Status</th><th>Change on</th></tr></thead>
                <tbody>
                  {(empSoon.length ? [...empSoon, ...people.filter((p) => !empSoon.includes(p))] : people).map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.owner}</b></td>
                      <td>{p.doc_name}</td>
                      <td>{p.doc_no || <span className="muted">–</span>}</td>
                      <td><Expiry date={p.expiry_date} /></td>
                      <td><StatusTag r={p} /></td>
                      <td><Link href={p.href}>{p.from}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {del && (
        <Modal title="Delete document line?" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Delete <b>{del.doc_name || 'this line'}</b>{del.owner ? <> of <b>{del.owner}</b></> : ''}? If it was cancelled or the vehicle was sold, you can set Stop alerts instead and keep the record.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn danger" onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

export default function Page() {
  return <AuthGate wide><DocsPage /></AuthGate>;
}
