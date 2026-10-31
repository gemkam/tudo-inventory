/* Driver trip form can be installed on a phone as an app "Tudo Trips" that opens straight on /entry
   (public/trips.webmanifest, public/sw.js, components/InstallApp.js). */
export const metadata = {
  title: 'Tudo Trips · Driver trip form',
  manifest: '/trips.webmanifest',
  appleWebApp: { capable: true, title: 'Tudo Trips', statusBarStyle: 'default' },
  icons: { apple: '/icons/trips-180.png' }
};

export default function EntryLayout({ children }) {
  return children;
}
