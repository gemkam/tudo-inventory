/* Driver trip form can be installed on a phone as an app "Tudo Trips" that opens straight on /entry
   (public/trips.webmanifest, public/sw.js, components/InstallApp.js). */
export const metadata = {
  title: 'Tudo Trips · Driver trip form',
  manifest: '/trips.webmanifest',
  appleWebApp: { capable: true, title: 'Tudo Trips', statusBarStyle: 'default' },
  icons: { apple: '/icons/trips-180.png' }
};

/* phones: no zooming in and out (drivers tap big boxes; 18px text so the phone never zooms on its own) */
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, themeColor: '#13836b' };

export default function EntryLayout({ children }) {
  return children;
}
