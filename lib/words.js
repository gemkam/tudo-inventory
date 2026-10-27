// Amount in words for Omani Rials (3 decimals = Baisa)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function words(num) {
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

export function omrInWords(total) {
  const t = Math.round(Math.abs(Number(total) || 0) * 1000) / 1000;
  const rials = Math.floor(t);
  const baisa = Math.round((t - rials) * 1000);
  return `Omani Rials ${words(rials)}${baisa ? ` and ${words(baisa)} Baisa` : ''} Only`;
}
