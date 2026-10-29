'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { SITEMAP, EVERY_PAGE } from '@/lib/sitemap';

/* Sitemap: every page and where it sits (data in lib/sitemap.js). Admin-only pages are hidden for other users. CSS sm-* in globals.css */

const TAGS = { admin: ['sm-admin', 'Administrator'], full: ['sm-full', 'Full access'], open: ['sm-open', 'No login'], off: ['sm-off', 'Not working'] };

/* page address -> does this sitemap path (with :id) match it */
const fits = (pattern, at) => !!pattern && !!at && new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:id/g, '[0-9a-f-]{8,}').replace(/:token/g, '[^/]+')}$`).test(at);
function trail(item, at, up = []) {
  const [name, path, , , kids = []] = item;
  const here = [...up, name];
  if (fits(path, at)) return here;
  for (const k of kids) { const t = trail(k, at, here); if (t) return t; }
  return null;
}

function Node({ item, q, can, depth, at }) {
  const [name, path, what = '', tag = '', kids = []] = item;
  const isHere = fits(path, at);
  const shown = kids.filter((k) => can(k) && match(k, q));
  const self = `${name} ${path} ${what}`.toLowerCase().includes(q);
  const hit = q && self;
  const live = path && !path.includes(':');
  const row = (
    <span className={`sm-row ${hit ? 'hit' : ''} ${isHere ? 'here' : ''}`} data-here={isHere ? '1' : undefined}>
      {isHere && <b className="sm-here">📍 You are here</b>}
      {live ? <Link href={path} className="sm-name">{name}</Link> : <span className="sm-name">{name}</span>}
      {path && <code className="sm-path">{path}</code>}
      {TAGS[tag] && <i className={`sm-tag ${TAGS[tag][0]}`}>{TAGS[tag][1]}</i>}
      {what && <span className="sm-what">{what}</span>}
    </span>
  );
  if (!kids.length) return <li className={`sm-leaf d${depth}`}>{row}</li>;
  return (
    <li className={`sm-branch d${depth}`}>
      <details open>
        <summary>{row}</summary>
        <ul className="sm-kids">{shown.map((k) => <Node key={k[0]} item={k} q={q} can={can} depth={depth + 1} at={at} />)}</ul>
      </details>
    </li>
  );
}

function match(item, q) {
  if (!q) return true;
  const [name, path, what = '', , kids = []] = item;
  return `${name} ${path} ${what}`.toLowerCase().includes(q) || kids.some((k) => match(k, q));
}

function SitemapPage() {
  const { isOwner } = useUser();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const can = useMemo(() => (item) => item[3] !== 'admin' || isOwner, [isOwner]);
  const any = match(SITEMAP, q);
  const [at, setAt] = useState('');
  const [who, setWho] = useState('');
  const treeRef = useRef(null);
  useEffect(() => {
    let from = '';
    try { from = new URLSearchParams(window.location.search).get('from') || ''; } catch { /* ignore */ }
    setAt(from.split('?')[0]);
    const id = (from.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) || [])[0];
    if (id && /^\/transport/.test(from)) sb().from('transport_drivers').select('name').eq('id', id).maybeSingle().then(({ data }) => setWho(data?.name || ''));
  }, []);
  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => treeRef.current?.querySelector('[data-here]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
    return () => clearTimeout(t);
  }, [at]);
  const path = at ? trail(SITEMAP, at) : null;

  return (
    <div className="sm-page">
      <div className="sm-head">
        <h1>🗺 Sitemap</h1>
        <p>Every page of Tudo Num Office Systems and where it sits. Tap a name to open it.</p>
        <input id="sm-q" type="search" className="sm-search" placeholder="Find a page, e.g. salary, VOC, invoice, attendance" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {at && (
        <div className="sm-where">
          <span className="sm-pin" aria-hidden="true">📍</span>
          <div>
            <b>You are here</b>
            <span className="sm-crumb">{path ? path.join(' › ') : at}{who ? ` › ${who}` : ''}</span>
          </div>
          <Link href={at} className="btn small">← Back to this page</Link>
        </div>
      )}
      {any ? <ul className="sm-tree" ref={treeRef}><Node item={SITEMAP} q={q} can={can} depth={0} at={at} /></ul> : <p className="muted">No page matches that.</p>}
      <section className="sm-every">
        <h2>On every page</h2>
        <ul>{EVERY_PAGE.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
    </div>
  );
}

export default function Page() {
  return <AuthGate><SitemapPage /></AuthGate>;
}
