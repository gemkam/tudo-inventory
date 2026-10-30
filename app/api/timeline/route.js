export const runtime = 'nodejs';
export const revalidate = 900; // refresh at most every 15 minutes

/*
  Live Timeline: reads every update (commit) of gemkam/tudo-inventory from GitHub and groups it by day
  in Muscat time, so /timeline keeps adding new days on its own.
  Returns { days: [{ date, items: [[time, what, path, module]] }], updated }.
  Optional env GITHUB_TOKEN (read-only) raises the GitHub limit; the repo is public so it works without it.
*/
const REPO = process.env.TIMELINE_REPO || 'gemkam/tudo-inventory';
const SINCE = '2026-10-21T00:00:00Z';

// First match wins: [module label, words to look for, page]
const MODULES = [
  ['🎨 Look and layout', /\b(phone|top bar|layout|theme|dark|night|colou?r|font|watermark|design|look)\b/i, ''],
  ['🧭 Navigation', /\b(timeline|sitemap)\b/i, '/timeline'],
  ['📊 Group Summary', /\b(group summary|p&l|profit and loss|vat return|cash forecast)\b/i, '/expenses/summary'],
  ['🚚 Transport', /\b(transport|trip|diesel|driver|vehicle|truck|toll|maintenance|salary|attendance)\b/i, '/transport'],
  ['📦 Inventory', /\b(inventory|stock|stationery|kitchen|sanitary|badge|flyer|shield|stand)\b/i, '/inventory'],
  ['🧾 Office Expense', /\b(office expense|expense|bill|invoice|receipt|petrol|utility)\b/i, '/expenses'],
  ['📋 Documents', /\b(document|licen[cs]e|expiry|expire)\b/i, '/docs'],
  ['🤖 Rauf and AI', /\b(rauf|ai|assistant|search)\b/i, ''],
  ['👥 Users', /\b(user|login|logout|role|activity)\b/i, '']
];

const toMuscat = (iso) => {
  const d = new Date(new Date(iso).getTime() + 4 * 3600000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};

const clean = (msg) => String(msg || '').split('\n')[0].trim();

export async function GET() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tudo-num-timeline' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const commits = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const url = `https://api.github.com/repos/${REPO}/commits?since=${SINCE}&per_page=100&page=${page}`;
      let res = await fetch(url, { headers, next: { revalidate } });
      if (res.status === 401 && headers.Authorization) { // bad token: the repo is public, so try without it
        delete headers.Authorization;
        res = await fetch(url, { headers, next: { revalidate } });
      }
      if (!res.ok) {
        if (!commits.length) return Response.json({ days: [], error: `GitHub ${res.status}` }, { status: 200 });
        break;
      }
      const list = await res.json();
      commits.push(...list);
      if (list.length < 100) break;
    }
  } catch (e) {
    return Response.json({ days: [], error: 'GitHub not reachable' }, { status: 200 });
  }

  const byDay = new Map();
  for (const c of commits) {
    if ((c.parents || []).length > 1) continue; // skip merges
    const what = clean(c.commit?.message);
    if (!what || /^merge\b/i.test(what)) continue;
    const { date, time } = toMuscat(c.commit?.author?.date || c.commit?.committer?.date);
    const [mod, , path] = MODULES.find(([, re]) => re.test(what)) || ['⚙️ Other updates', null, ''];
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push([time, what, path, mod]);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => a[0].localeCompare(b[0])) }));

  return Response.json({ days, updated: new Date().toISOString() });
}
