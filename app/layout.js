import './globals.css';
import { THEME_BOOT } from '@/lib/theme';

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&display=swap';

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
        {/* Phone with Chrome "Desktop site" switched on: the page is laid out 980px wide and looks tiny.
            Scale it up to the phone's real width so text stays readable (31 Oct 2026). */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){try{var t=('ontouchstart' in window)||navigator.maxTouchPoints>0;var sw=Math.min(screen.width,screen.height);var f=function(){var w=window.innerWidth;if(t&&sw&&sw<820&&w>sw*1.4){document.documentElement.style.zoom=(w/sw).toFixed(3);document.documentElement.classList.add('desk-on-phone');}};f();window.addEventListener('resize',f);}catch(e){}})();" }} />
        {/* Speed (31 Oct 2026): open the database connection early, and load the Google fonts WITHOUT holding up the page
            (the page shows at once in the normal font, the nice font swaps in when it arrives). */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preload" as="style" href={FONTS} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='${FONTS}';document.head.appendChild(l);})();` }} />
        <noscript><link rel="stylesheet" href={FONTS} /></noscript>
      </head>
      <body>
        <div className="watermark" aria-hidden="true" />
        <div className="content">{children}</div>
      </body>
    </html>
  );
}
