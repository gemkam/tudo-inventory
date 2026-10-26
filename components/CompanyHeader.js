/* Letterhead used on Transport pages, matching the company's transport report */
export const COMPANY_NAME = 'Modern City for Express Services LLC';
export const COMPANY_LINES = [
  'CR No. 1404742  |  VAT Registration No. OM11008665',
  'PO Box 149, PC 133, Sultanate of Oman  |  www.tudonumgroup.com'
];

export default function CompanyHeader({ title, detail }) {
  return (
    <header className="letterhead">
      <img src="/tudo-num-logo.png" alt="Tudo Num" width="64" height="67" className="letterhead-logo" />
      <div className="letterhead-text">
        <div className="letterhead-name">{COMPANY_NAME.toUpperCase()}</div>
        {COMPANY_LINES.map((l) => <div key={l} className="letterhead-line">{l}</div>)}
        <div className="letterhead-title">Transport Division  |  {title}</div>
        {detail && <div className="letterhead-detail">{detail}</div>}
      </div>
    </header>
  );
}
