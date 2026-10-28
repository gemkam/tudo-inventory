// Turns everything on the Group Summary page into plain text the AI assistant (Rauf) can read.
// Runs in the browser: it uses exactly the numbers the user sees, plus month by month history.
import { GROUP_SOURCES, fmt } from '@/lib/groupSummary';

const r3 = (v) => Math.round(Number(v || 0) * 1000) / 1000;
const mName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);

export function groupContext({ G, lines, income, allMonths, pick, periodLabel, extraAlerts = [] }) {
  const L = [];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Muscat' });
  L.push(`TODAY: ${today} (Muscat, Oman). Currency OMR (Omani Rial). 1 OMR = 1000 Baisa.`);
  L.push('Companies in the group: Modern City (Modern City for Express Services LLC), Abu Wasif (Abu Wasif and Associates LLC), Sumptuosity (Sumptuosity Tropical LLC), and Transport Expense (Modern City Transport Division: trucks, drivers, trips).');
  L.push('');
  L.push(`SCREEN NOW SHOWS: period "${periodLabel}", companies chosen: ${G.chosen.map((s) => s.label).join(', ') || 'none'}.`);
  L.push(`Total spent: ${fmt(G.grand.spent)} OMR. Unpaid: ${fmt(G.grand.unpaid)} OMR. VAT: ${fmt(G.grand.vat)} OMR. Bill lines counted: ${G.sel.length}.`);
  if (G.change != null) L.push(`Change vs previous period (${G.prevPeriod}): ${G.change > 0 ? 'up' : G.change < 0 ? 'down' : 'same'} ${Math.abs(G.change)}% (previous ${fmt(G.prevSpent)} OMR).`);
  L.push('');
  L.push('PER COMPANY (this period). Company | Spent | Unpaid | VAT | Lines | Transport work (rent) | Received | Profit');
  G.perSource.forEach((s) => L.push([s.label, fmt(s.spent), fmt(s.unpaid), fmt(s.vat), s.count, s.kind === 'transport' ? fmt(s.work) : '-', s.kind === 'transport' ? fmt(s.received) : '-', s.kind === 'transport' ? fmt(s.profit) : '-'].join(' | ')));
  const top = [...G.perSource].sort((a, b) => b.spent - a.spent)[0];
  if (top?.spent) L.push(`Spent the most: ${top.label}, ${pct(top.spent, G.grand.spent)}% of total.`);
  L.push('Note: Transport profit = work amount minus all transport costs including salaries. Only Transport has income in the system; the 3 companies have no income recorded.');
  L.push('');
  L.push(`EXPENSE HEADS (this period, biggest first). Head | Total | ${G.chosen.map((s) => s.label).join(' | ')} | Share`);
  G.heads.forEach((h) => L.push([h.head, fmt(h.total), ...h.vals.map(fmt), `${pct(h.total, G.grand.spent)}%`].join(' | ')));
  L.push('');
  if (G.byMonth.length > 1) {
    L.push('MONTHS INSIDE THIS PERIOD. Month | Total');
    G.byMonth.forEach((m) => L.push(`${mName(m.month)} | ${fmt(m.total)}`));
    L.push('');
  }
  L.push(`BUDGET VS ACTUAL (monthly budget x ${G.nMonths} month(s)). Head | Budget | Actual | Left | Used %`);
  if (G.budgetHeads.length) G.budgetHeads.forEach((b) => L.push([b.head, fmt(b.budget), fmt(b.actual), fmt(b.left), `${b.pct}%`].join(' | ')));
  else L.push('(no budgets set yet; an Administrator can set them with the Budgets button)');
  if (G.budgetTotal.budget) L.push(`Budget total used: ${pct(G.budgetTotal.actual, G.budgetTotal.budget)}% (${fmt(G.budgetTotal.actual)} of ${fmt(G.budgetTotal.budget)}).`);
  L.push('');
  L.push('CASH FLOW (money in = transport money received, by the month it was received; money out = all spending). Month | In | Out | Net');
  G.cash.months.forEach((m, i) => L.push([mName(m), fmt(G.cash.in[i]), fmt(G.cash.out[i]), fmt(G.cash.net[i])].join(' | ')));
  L.push(`Cash totals: in ${fmt(G.cash.totalIn)}, out ${fmt(G.cash.totalOut)}, net ${fmt(G.cash.totalNet)} OMR. Transport money still to receive (all time): ${fmt(G.owed)} OMR.`);
  L.push('');
  L.push(`UNPAID BILLS BY AGE (all months). Total unpaid ${fmt(G.unpaidAll)} OMR.`);
  G.ageing.forEach((a) => L.push(`${a.label}: ${a.count} bill(s), ${fmt(a.amount)} OMR`));
  if (G.unpaidBills.length) {
    L.push('Oldest unpaid bills. Date | Company | Head | Unpaid | Days | Details');
    G.unpaidBills.slice(0, 12).forEach((l) => L.push([dmy(l.date), label(l.src), l.head, fmt(l.unpaid), l.age, l.desc || l.ref || ''].join(' | ')));
  }
  L.push('');
  L.push(`YEAR ON YEAR (${G.yoy.year} vs ${G.yoy.prevYear}). ${G.yoy.year} total ${fmt(G.yoy.curTotal)} OMR; ${G.yoy.prevYear} total ${fmt(G.yoy.prevTotal)} OMR${G.yoy.hasPrev ? '' : ' (no data for last year yet)'}.`);
  L.push('');
  const alerts = [...G.alerts, ...extraAlerts];
  L.push(`ALERTS / NEEDS ATTENTION (${alerts.length}):`);
  alerts.forEach((a) => L.push(`- ${a.text}`));
  if (!alerts.length) L.push('- none');
  L.push('');
  const big = [...G.sel].sort((a, b) => b.amount - a.amount).slice(0, 20);
  L.push('BIGGEST BILLS THIS PERIOD. Date | Company | Head | Paid | Details');
  big.forEach((l) => L.push([dmy(l.date), label(l.src), l.head, fmt(l.amount), l.desc || l.ref || ''].join(' | ')));
  L.push('');

  // History: every month, every company (not only the chosen ones), so any month can be answered
  L.push('HISTORY: SPENT PER MONTH PER COMPANY (all companies, all months). Month | Modern City | Abu Wasif | Sumptuosity | Transport | All');
  allMonths.forEach((m) => {
    const v = GROUP_SOURCES.map((s) => r3(lines.filter((l) => l.month === m && l.src === s.key).reduce((t, l) => t + l.amount, 0)));
    L.push([mName(m), ...v.map(fmt), fmt(v.reduce((t, x) => t + x, 0))].join(' | '));
  });
  L.push('');
  L.push('HISTORY: TRANSPORT INCOME PER MONTH. Month | Work (rent) | Received');
  allMonths.forEach((m) => {
    const inc = income.filter((i) => i.month === m);
    if (inc.length) L.push([mName(m), fmt(inc.reduce((t, i) => t + i.work, 0)), fmt(inc.reduce((t, i) => t + i.received, 0))].join(' | '));
  });
  L.push('');
  L.push('HISTORY: HEADS PER MONTH (chosen companies). Month | Head | Amount');
  allMonths.slice(-8).forEach((m) => {
    const heads = {};
    lines.filter((l) => l.month === m && pick.includes(l.src)).forEach((l) => { heads[l.head] = (heads[l.head] || 0) + l.amount; });
    Object.entries(heads).sort((a, b) => b[1] - a[1]).forEach(([h, v]) => L.push(`${mName(m)} | ${h} | ${fmt(v)}`));
  });
  return L.join('\n').slice(0, 30000);
}

function label(key) {
  return GROUP_SOURCES.find((s) => s.key === key)?.label || key;
}

// Short greeting line made without the AI, so Rauf can say hello instantly
export function groupGreeting({ G, periodLabel, extraAlerts = [], lang }) {
  const h = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Muscat' }));
  const nAlerts = G.alerts.filter((a) => a.level !== 'info').length + extraAlerts.length;
  if (lang === 'ru') {
    return `Assalam o Alaikum! Main Rauf hoon, aap ka assistant. ${periodLabel} mein total kharcha ${fmt(G.grand.spent)} OMR hai${nAlerts ? ` aur ${nAlerts} cheezon par tawajjo chahiye` : ''}. Main aap ki kya madad kar sakta hoon? Boliye, main sun raha hoon.`;
  }
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}! I am Rauf, your assistant. For ${periodLabel} the total spent is ${fmt(G.grand.spent)} OMR${nAlerts ? ` and ${nAlerts} thing${nAlerts === 1 ? '' : 's'} need${nAlerts === 1 ? 's' : ''} attention` : ''}. How can I help you? Please go ahead, I am listening.`;
}
