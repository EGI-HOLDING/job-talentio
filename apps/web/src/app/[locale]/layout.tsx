import type { Metadata } from 'next';
import '../globals.css';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { I18nProvider } from '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { PresenceConnection } from '@/lib/presence';
import { DEFAULT_LOCALE, LOCALES, isLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Job Talentio',
  description: 'Job portal for Uzbekistan - find work and hire talent',
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  // Unknown segments only reach here via 404 rendering; keep a valid lang attribute.
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <ConfirmProvider>
            <PresenceConnection />
            <SiteNav />
            <main>{children}</main>
            <SiteFooter />
          </ConfirmProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
