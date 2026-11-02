'use client';

import { useEffect, useState } from 'react';
import { sb } from '@/lib/supabase';

/*
  Shows the ORIGINAL scanned bill (first photo or PDF in files) on the page, from private bucket doc-files.
  Used on Payment receipts (app/expenses/docs/page.js): a receipt is our purchase, so the supplier's own paper is
  shown instead of our letterhead (Kamran, 2 Nov 2026).
*/
const isPdf = (f) => /pdf/i.test(f?.type || '') || /\.pdf$/i.test(f?.name || '');

export default function PaperPreview({ files, bucket = 'doc-files' }) {
  const f = (files || []).find((x) => x && x.path);
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!f) return undefined;
    let u = null; let live = true;
    setUrl(null); setErr('');
    sb().storage.from(bucket).download(f.path).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setErr(error?.message || 'File not found'); return; }
      u = URL.createObjectURL(data);
      setUrl(u);
    });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [f?.path, bucket]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;
  return (
    <figure className="pp-box">
      {err ? <p className="muted">Could not open the paper: {err}</p>
        : !url ? <p className="muted">Loading the paper...</p>
          : isPdf(f) ? <iframe className="pp-pdf" src={url} title={f.name} />
            : <img className="pp-img" src={url} alt={f.name} />}
    </figure>
  );
}
