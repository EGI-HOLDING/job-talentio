import type { Metadata } from 'next';
import './globals.css';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Job Talentio',
  description: 'Job portal for Uzbekistan — find work and hire talent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider>
          <SiteNav />
          <main>{children}</main>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
