/*
  Timeline of Tudo Num Office Systems (page /timeline, top bar "🕒 Timeline" next to 🗺 Sitemap).
  Chronological hierarchy: Day > Module > what was built (time is Muscat time of the change).
  Each item: [time, what was built, page path ('' = no page of its own)]
  ADD A LINE HERE WHEN SOMETHING NEW IS BUILT (same as lib/sitemap.js).
*/
export const TIMELINE = [
  {
    date: '2026-10-21', title: 'Plan on paper',
    groups: [
      ['📝 Notebook plan', [
        ['', 'Tudo Num Group Inventory: Daily use items', ''],
        ['', 'Stationery: A4 paper, staplers, pens and pencils, punch, file folders, toner, plastic sleeves, visiting cards, sticky notes, envelopes, clips and pins, bulbs, cells and batteries, rubber', '/inventory'],
        ['', 'Kitchen: water, sugar, tea, coffee, milk powder, green tea, plastic spoons, paper cups', '/inventory'],
        ['', 'Sanitary: brush, Dettol, toilet rolls, tissue paper, Clorox, mop, garbage bags, room freshener (automatic and simple)', '/inventory'],
        ['', 'Bills: Electricity prepaid, Water postpaid, Dispenser', '/bills'],
        ['', 'Asset register (parked for later)', '']
      ]],
      ['⚙️ Setup', [
        ['16:40', 'Project files copied to GitHub (gemkam/tudo-inventory)', '']
      ]]
    ]
  },
  {
    date: '2026-10-25', title: 'Inventory is born',
    groups: [
      ['🔐 Login and look', [
        ['13:39', 'Tudo Num watermark, small and repeated behind every page', ''],
        ['13:47', 'Username login, Switch user button, Administrator-only editing', '/login']
      ]],
      ['📦 Inventory', [
        ['14:00', 'Excel-style sheet: inline editing, + / − buttons, sorting, Search', '/inventory'],
        ['14:28', 'Status column removed, Unit dropdown with Packets first', '/inventory'],
        ['14:38', 'Search, + New item and Export under the top bar', '/inventory'],
        ['14:41', 'Export to Excel and PDF', '/inventory'],
        ['14:49', 'Price in OMR (Bz / Rials), packets with pieces per packet, one Edit button', '/inventory']
      ]]
    ]
  },
  {
    date: '2026-10-26', title: 'Transport Expense, users and AI',
    groups: [
      ['🚚 Transport Expense', [
        ['12:34', 'Transport Expense module from the Transport Division Excel, green theme', '/transport'],
        ['12:46', 'Inventory and Transport reports (Snooker Cafe style)', '/transport/reports'],
        ['16:02', 'Invoice page: Transportation Invoice, Tax Invoice (VAT 5%), Interim Payment', '/transport/invoice'],
        ['16:44', 'Invoice prints on one A4 page, every label editable', '/transport/invoice'],
        ['18:12', 'Monthly transport PDF email and ✉ Email report button (Gmail still blocked)', ''],
        ['19:10', 'Received on date (payment date separate from trip date)', '/transport']
      ]],
      ['👥 Users and data entry', [
        ['13:39', 'Users dashboard with 4 access levels', '/users'],
        ['13:49', 'Data entry page linked to drivers, share on WhatsApp', '/entry'],
        ['14:29', 'No-login share links for trip entry', '']
      ]],
      ['🎨 Look and feel', [
        ['12:55', 'Pill buttons that fill with colour on hover', ''],
        ['16:07', 'Day / Night mode and colour chooser (8 pairs or own colours)', '']
      ]],
      ['🤖 AI', [
        ['13:05', 'Inventory and Transport AI assistants with mic and voice', ''],
        ['13:19', 'Listen button, Driving mode, backup AI models', ''],
        ['14:56', 'Online Urdu voice', '']
      ]]
    ]
  },
  {
    date: '2026-10-27', title: 'Home page, vehicles and Office Expense',
    groups: [
      ['🏠 Home and branding', [
        ['12:45', 'Heading Tudo Num Office Systems, letterhead on the tiles', '/'],
        ['13:01', 'Powered by KS TECH LLC (breathing)', '/'],
        ['13:06', 'Animated truck on the Transport tile', '/'],
        ['13:12', 'Name Tudo Num Office Systems everywhere, watermark follows colour', ''],
        ['13:17', 'Link preview image and app icon', '']
      ]],
      ['🚚 Transport Expense', [
        ['14:28', 'Salary slip per driver with Resident Card No.', '/transport'],
        ['14:49', 'Drivers page and Vehicles page (units and trailers)', '/transport/drivers'],
        ['15:40', 'Vehicle maintenance (PDC / Bank Transfer) and Home reminders with alarm', '/transport/vehicles'],
        ['15:41', 'Edit button on every invoice', '/transport/invoice'],
        ['16:00', 'VOC and Mulkiya expiry (insurance removed)', '/transport/vehicles']
      ]],
      ['💰 Money and dates', [
        ['15:25', 'Always 3 decimals and the new Omani Rial symbol', ''],
        ['16:08', 'Dates dd/mm/yyyy with 📅 calendar button, Edit next to each section', '']
      ]],
      ['🧾 Office Expense', [
        ['16:31', 'Office Expense from the Sumptuosity Excel: bills, heads, year summary, salary sheet', '/expenses'],
        ['16:45', 'Company switch: Modern City, Abu Wasif, Sumptuosity', '/expenses'],
        ['17:07', 'Summary: pick any companies and Transport', '/expenses/summary'],
        ['17:28', 'Letterhead with logo, CR and address for each company', '/expenses'],
        ['17:39', 'Group Summary report (tiles, donuts, ranking, monthly bars)', '/expenses/summary']
      ]]
    ]
  },
  {
    date: '2026-10-28', title: 'Rauf, alerts, documents and driver allowance',
    groups: [
      ['📊 Group Summary', [
        ['02:37', 'Budgets vs actual, cash flow, alerts, unpaid by age, year on year, drill down, PDF', '/expenses/summary']
      ]],
      ['🤖 Rauf AI assistant', [
        ['13:00', 'Noor assistant on Group Summary (talk mode, voice)', '/expenses/summary'],
        ['13:11', 'Assistant becomes Rauf (male voice, Roman Urdu)', ''],
        ['13:52', 'Rauf knows the whole app: alerts, money to pay and collect, renewals', ''],
        ['14:25', 'Rauf on every page, old assistants removed', ''],
        ['22:44', 'Smaller AI prompts, more backup models (OpenRouter)', '']
      ]],
      ['🏠 Home', [
        ['13:37', 'Glass shine on the tiles, floating Office Expense logo', '/'],
        ['13:59', 'Alerts column with numbered bubbles and ×, payment words', '/'],
        ['14:04', 'Resident Card and Visa expiry alerts', '/'],
        ['15:45', 'Home AI Search across the whole app', '/'],
        ['15:48', 'Payments always on top of alerts', '/']
      ]],
      ['🚚 Transport Expense', [
        ['13:35', 'Driver copy PDF, departments, transport costs into Modern City', '/transport'],
        ['14:33', 'Trip sheet ☑ Columns: Print, PDF, Excel with chosen columns', '/transport'],
        ['16:07', 'Drivers page sort and Driver Desk (salary receipts, trips)', '/transport/drivers'],
        ['16:27', 'Trip allowance renamed Driver allowance, Row names', '/transport/drivers'],
        ['16:31', 'All Drivers Salary Sheet', '/transport/salary-sheet'],
        ['16:43', 'Each driver has own salary sheet', '/transport/salary-sheet'],
        ['17:14', 'Previous months driver allowance on the trip sheet (Mark paid, Undo)', '/transport'],
        ['17:28', '✓ Mark all paid for driver allowance', '/transport'],
        ['17:34', '🧾 Salary slip from the trip sheet (Print, PDF, Edit)', '/transport'],
        ['17:52', 'Salary slip Edit: typed driver allowance per month', '/transport'],
        ['23:09', 'Drivers shown as cards, + Add driver button', '/transport/drivers']
      ]],
      ['🧾 Office Expense', [
        ['13:35', 'Company Invoice and Payment Receipt', '/expenses/docs']
      ]],
      ['📋 Documents Checklist', [
        ['15:25', 'Documents Checklist page (Employee, Cars, Heavy Vehicles, Govt License, Company)', '/docs'],
        ['15:37', 'AI Search, Columns chooser, delete with Undo', '/docs']
      ]],
      ['🛡 Admin and every page', [
        ['15:45', '🖨 Print with column choice on every page', ''],
        ['22:00', 'User activity log (online now, logins, pages, buttons, changes)', '/activity'],
        ['23:32', 'Phone: Transport, Inventory, Office Expense buttons in the top bar', '']
      ]]
    ]
  },
  {
    date: '2026-10-29', title: 'Attendance, cards view, sitemap and timeline',
    groups: [
      ['🤖 Rauf', [
        ['12:21', 'Rauf photo; Administrator can upload, crop and rotate it', '/settings']
      ]],
      ['🏠 Home', [
        ['12:15', 'Alarm pop-up drawn above the page, OK button at the top', '/']
      ]],
      ['📋 Documents Checklist', [
        ['14:22', 'All employees table, Company Sponsor column', '/docs']
      ]],
      ['🧾 Office Expense', [
        ['14:49', 'Staff attendance for all three companies, fills salary sheet', '/expenses/attendance'],
        ['15:00', 'Site staff Friday off, Office staff Fri + Sat, leave with reason', '/expenses/attendance'],
        ['16:25', 'Group Summary 📊 Analytics (pace, forecast, biggest changes)', '/expenses/summary'],
        ['17:09', 'Attendance Undo, Delete month or per person', '/expenses/attendance']
      ]],
      ['🚚 Transport Expense', [
        ['14:38', 'Salary slip page Edit button', '/transport'],
        ['15:52', 'Salary sheets vertical (one card per person) with unpaid balance', '/transport/salary-sheet'],
        ['16:05', 'Driver month cards: Edit, Undo, Mark paid / Not paid', '/transport/salary-sheet'],
        ['16:09', 'Trip sheet vertical, Cargo and Consignee removed', '/transport'],
        ['16:50', 'Drivers compared: Salary shows fixed + allowance, paid / not paid', '/transport/reports'],
        ['20:40', 'Trip sheet: VAT 5% button per trip, 15% Govt Tax button, 💰 Profit taken with balance', '/transport'],
        ['20:50', 'VAT 5% shown separately in Transport Reports, Report by dates and Group Summary (kept out of profit)', '/transport/reports']
      ]],
      ['🧭 Navigation and reports', [
        ['16:17', '▦ Table | ▤ Cards switch on every page', ''],
        ['16:29', '🗺 Sitemap page and Logout in the top bar', '/sitemap'],
        ['16:38', 'Sitemap 📍 You are here; side buttons on Transport and Office Expense', '/sitemap'],
        ['17:03', 'Report by dates (From / To, Print or Excel) on every report page', ''],
        ['17:12', 'Prepared by / Checked by / Approved by lines removed from reports', ''],
        ['17:30', '🕒 Timeline page (this page) next to Sitemap', '/timeline']
      ]]
    ]
  }
];

/* Count of items per day and in total */
export const countItems = (day) => day.groups.reduce((n, [, items]) => n + items.length, 0);
export const TIMELINE_TOTAL = TIMELINE.reduce((n, d) => n + countItems(d), 0);
