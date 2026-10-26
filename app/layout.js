import './globals.css';
import { THEME_BOOT } from '@/lib/theme';

export const metadata = {
  title: 'Tudo Office Inventory System',
  description: 'Office supplies, kitchen, sanitary stock and bills for Tudo office'
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
