'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AuthGate, { useUser } from '@/components/AuthGate';
import { SITEMAP, EVERY_PAGE } from '@/lib/sitemap';

/* Sitemap: every page and where it sits (data in lib/sitemap.js). Admin-only pages are hidden for other users. CSS sm-* in globals.css */

const TAGS = { admin: ['sm-admin', 'Administrator'], full: ['sm-full', 'Full access'], open: ['sm-open', 'No login'], off: ['sm-off', 'Not working'] };

function Node({ item, q, can, depth }) {
  const [name, path, what = '', tag = '', kids = []] = item;
  const shown = kids.filter((k) => can(k) && match(k, q));
  const self = `${name} ${path} ${what}`.toLowerCase().includes(q);
  const hit = q && self;
  const live = path && !path.includes(':');
  const row = (
    <span className={`sm-row ${hit ? 'hit' : ''}`}>
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
        <ul className="sm-kids">{shown.map((k) => <Node key={k[0]} item={k} q={q} can={can} depth={depth + 1} />)}</ul>
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

  return (
    <div className="sm-page">
      <div className="sm-head">
        <h1>🗺 Sitemap</h1>
        <p>Every page of Tudo Num Office Systems and where it sits. Tap a name to open it.</p>
        <input id="sm-q" type="search" className="sm-search" placeholder="Find a page, e.g. salary, VOC, invoice, attendance" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {any ? <ul className="sm-tree"><Node item={SITEMAP} q={q} can={can} depth={0} /></ul> : <p className="muted">No page matches that.</p>}
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
