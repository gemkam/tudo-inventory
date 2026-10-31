/*
  Sitemap of Tudo Num Office Systems (page /sitemap, top bar "🗺 Sitemap").
  [name, path ('' = part of another page), what it shows, access ('' all readers | 'full' | 'admin' | 'open' | 'off'), children]
  Keep this list up to date when a page is added.
*/
export const SITEMAP = ['Home', '/', 'Tiles, AI Search with Ready questions, Alerts (on phones a floating alarm clock: tap to open, drag to move)', '', [
  ['Inventory', '/inventory', 'Stock of office items, prices, Search, + New item, Excel / PDF', '', [
    ['Category sheets', '/c/:id', 'Office Supplies, Kitchen, Sanitary: packets and pieces, + / − buttons, Unit dropdown'],
    ['Bills', '/bills', 'Electricity prepaid, Water postpaid, Dispenser, Internet: payments by month'],
    ['Inventory reports', '/inventory/reports', 'Stock, low / out, bills paid'],
    ['Stock log', '/log', 'Every stock in / out with who and when']
  ]],
  ['Transport Expense', '/transport', 'Modern City Transport Division: driver cards, monthly summary, money to collect', '', [
    ['Trip sheet (one per driver)', '/transport/:id', 'Trips as cards or table, ☑ Columns print, 🧾 Salary slip, 🚚 Driver copy, ✓ Mark all paid', '', [
      ['Salary slip overlay', '', 'Inside the trip sheet: print, PDF, Edit with typed driver allowance', 'full']
    ]],
    ['All Drivers Trip Sheets', '/transport/trip-sheets', 'Every driver\'s trips for a month in one place, driver chips, ☑ Columns, Print, PDF, Excel, totals per driver'],
    ['Drivers', '/transport/drivers', 'Resident card, mobile, status, expiries. Driver Desk: salary receipts and trips per driver'],
    ['Vehicles', '/transport/vehicles', 'Units and trailers, plate, VOC and Mulkiya expiry, driver, Own / Rent', '', [
      ['Maintenance', '', 'On the Vehicles page: work, charges, PDC / Bank Transfer, Pending / Paid']
    ]],
    ['All Drivers Salary Sheet', '/transport/salary-sheet', 'One month, all drivers: unpaid balance, Paid boxes, totals, signatures', '', [
      ['Driver salary sheet', '/transport/salary-sheet/:id', 'One driver: unpaid balance, salary by month with Edit / Undo / Mark paid, other expenses'],
      ['Salary slip page', '/transport/salary/:id', 'Printable slip with Resident Card No.']
    ]],
    ['Transport invoice', '/transport/invoice', 'Transportation Invoice, Tax Invoice (VAT 5%), Interim Payment Application', 'full'],
    ['Transport reports', '/transport/reports', 'Charts and tables by month and driver'],
    ['Monthly email report', '', 'Full PDF on the 1st of each month (Gmail app password still rejected)', 'off']
  ]],
  ['Office Expense', '/expenses', 'Modern City, Abu Wasif, Sumptuosity: bills, By department, Summary by month, Salary sheet', '', [
    ['Bills (expense entries)', '', 'Paid / Unpaid, VAT, department, head of account. 🔗 Auto rows come from Transport'],
    ['Office staff salary sheet', '', 'Same page, bottom: net pay, Paid, unpaid balance'],
    ['Group Summary', '/expenses/summary', 'Budget vs actual, cash flow, alerts, unpaid by age, year on year, 📊 Analytics, PDF'],
    ['Attendance', '/expenses/attendance', 'Per company and month, leave with reason, fills working days'],
    ['Invoice / Payment Receipt', '/expenses/docs', 'Company letterhead invoices and receipts. Receipts go into Office Expense', 'full'],
    ['Documents Checklist', '/docs', 'Last Office Expense tab: Employee, Cars, Heavy Vehicles, Govt License, Company Docs: expiry status, AI search, alerts']
  ]],
  ['Admin', '/admin', '/admin page: Users, User activity, Settings, Data entry, Invoices, Timeline, Sitemap, Rauf picture. Admin button on Home and in the top bar', '', [
    ['Data entry', '/entry', 'Simple trip entry form (Data entry users see only this)'],
    ['Settings', '/settings', 'App settings, Rauf picture', 'full'],
    ['Users', '/users', 'Create users, 4 levels, online status', 'admin'],
    ['User activity', '/activity', 'Online now, logins, pages, buttons pressed, changes', 'admin']
  ]],
  ['Outside login', '', '', '', [
    ['Login', '/login', 'Username and password'],
    ['Share link entry', '/f/:token', 'No-login trip entry links, can be fixed to one driver', 'open']
  ]],
  ['Sitemap', '/sitemap', 'This page'],
  ['Timeline', '/timeline', 'How the site was built day by day: Day > Module > what was built, with time and page links']
]];

export const EVERY_PAGE = [
  'Top bar: Home, 🗺 Sitemap, 🕒 Timeline, ▦ Table | ▤ Cards, Day / Night and colours, Switch user, Logout',
  'Rauf AI assistant (bottom right, not for Data entry users)',
  '🖨 Print with column picker (bottom left, not on invoices and slips)',
  '✏️ Edit next to each section for Administrator / Full access',
  '🖨 Report by dates (From date to To date, then Print or Excel) on Transport, every trip sheet, Transport reports, Vehicles maintenance, Office Expense, Group Summary, Attendance, Inventory reports, Bills, Stock log and Documents Checklist (expiring)',
  'Side buttons on every Transport and Office Expense page (stay in view while you scroll)',
  'Clickable "where am I" map on top of every page, e.g. Home › Transport › Drivers › All Drivers Trip Sheets'
];
