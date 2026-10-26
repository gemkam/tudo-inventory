/* Transport page header. Company name as written in the Transport Division workbook. */
export const COMPANY_NAME = 'Modern City for Express Services LLC';

export default function CompanyHeader({ title, detail }) {
  return (
    <header className="letterhead">
      <div className="letterhead-text">
        <div className="letterhead-company">{COMPANY_NAME.toUpperCase()} (Transport Division)</div>
        <div className="letterhead-name">{title}</div>
        {detail && <div className="letterhead-detail">{detail}</div>}
      </div>
    </header>
  );
}
