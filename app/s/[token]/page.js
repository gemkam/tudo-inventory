'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { COMPANIES } from '@/lib/expenses';
import { Viewer } from '@/components/DocFiles';

/*
  Employee's own salary slip link (Personnel > 📤 Send To Employee), no login.
  /s/<slip_token>: RPC public_staff_slip (SECURITY DEFINER) gives his name, company, salary and the list of his
  salary slip files; the files are read from the private bucket staff-files under slip/<token>/ (storage policy
  "staff slip by link" lets this link read only its own folder, and only while the link is on).
*/
const BUCKET = 'staff-files';
const m3 = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const isImg = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|gif|webp)$/i.test(f.name || '');

export default function StaffSlipLink() {
  const { token } = useParams();
  const [info, setInfo] = useState(undefined); // undefined = loading, null = not valid
  const [viewing, setViewing] = useState(null);
  const [msg, setMsg] = useState('');
  const flash = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); }, []);

  useEffect(() => {
    let alive = true;
    sb().rpc('public_staff_slip', { p_token: String(token || '') }).then(({ data, error }) => {
      if (alive) setInfo(error ? null : data || null);
    });
    return () => { alive = false; };
  }, [token]);

  async function download(f) {
    const { data, error } = await sb().storage.from(BUCKET).download(f.path);
    if (error || !data) { flash(`Could not download: ${error?.message || 'not found'}`); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = f.name || 'salary-slip'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const co = info ? COMPANIES.find((c) => c.key === info.company) : null;
  const files = info && Array.isArray(info.files) ? [...info.files].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];
  const rows = info ? [
    ['Basic salary', info.basic],
    ['House rent', info.house_rent],
    ['Utilities', info.utilities],
    ['Other allowance', Math.max(0, Number(info.allowances || 0) - Number(info.house_rent || 0) - Number(info.utilities || 0))]
  ].filter(([, v]) => Number(v)) : [];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner"><span className="brand">Tudo Num Office Systems</span></div>
      </header>
      <main className="page ss-page">
        {info === undefined && <div className="loading">Loading...</div>}
        {info === null && (
          <div className="card ss-card">
            <h1>Link not working</h1>
            <p className="muted">This salary slip link is turned off or wrong. Please ask the office for a new link.</p>
          </div>
        )}
        {info && (
          <div className="card ss-card">
            {co && (
              <div className="ss-head">
                {co.logo && <span className="ss-logo"><img src={co.logo} alt="" /></span>}
                <div><b>{co.name}</b><small>{co.cr} · {co.address}</small></div>
              </div>
            )}
            <h1>Salary slips</h1>
            <div className="ss-who"><b>{info.name}</b><span>{[info.designation, info.kind === 'Driver' ? '' : `${info.kind} employee`].filter(Boolean).join(' · ')}</span></div>

            {rows.length > 0 && (
              <table className="ss-table">
                <tbody>
                  {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>OMR {m3(v)}</td></tr>)}
                  {info.transport && <tr><td>Transport</td><td>Yes</td></tr>}
                  <tr className="ss-total"><td>Monthly salary</td><td>OMR {m3(Number(info.basic || 0) + Number(info.allowances || 0))}</td></tr>
                </tbody>
              </table>
            )}

            <h2>📄 My salary slips</h2>
            {!files.length && <p className="muted">No salary slip uploaded yet.</p>}
            <div className="ss-files">
              {files.map((f) => (
                <div key={f.path} className="ss-file">
                  <span>{isImg(f) ? '🖼' : '📕'} <b>{f.name}</b>{f.at && <small>{new Date(f.at).toLocaleDateString('en-GB')}</small>}</span>
                  <span className="ss-btns">
                    <button type="button" className="btn small" onClick={() => setViewing(f)}>👁 View</button>
                    <button type="button" className="btn small in" onClick={() => download(f)}>⬇ Download</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {viewing && <Viewer file={viewing} bucket={BUCKET} onClose={() => setViewing(null)} flash={flash} />}
        {msg && <div className="toast err" role="status">{msg}</div>}
      </main>
    </>
  );
}
