import './globals.css';
import { THEME_BOOT } from '@/lib/theme';

export const metadata = {
  metadataBase: new URL('https://tudo-inventory.vercel.app'),
  title: 'Tudo Num Office Systems',
  description: 'Office inventory and transport expense for Modern City for Express Services LLC',
  openGraph: {
    title: 'Tudo Num Office Systems',
    description: 'Office inventory and transport expense for Modern City for Express Services LLC',
    siteName: 'Tudo Num Office Systems',
    type: 'website'
  },
  twitter: { card: 'summary_large_image', title: 'Tudo Num Office Systems' }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#13836b" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <div className="watermark" aria-hidden="true" />
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
