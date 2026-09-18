import type { Metadata, Viewport } from 'next';
import '../globals.css';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { I18nProvider } from '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { PresenceConnection } from '@/lib/presence';
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { DEFAULT_LOCALE, LOCALES, isLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Job Talentio',
  description: 'Job portal for Uzbekistan - find work and hire talent',
  applicationName: 'Job Talentio',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Job Talentio',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
            <PwaRegister />
            <SiteNav />
            <main>{children}</main>
            <SiteFooter />
            <InstallPrompt />
          </ConfirmProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
