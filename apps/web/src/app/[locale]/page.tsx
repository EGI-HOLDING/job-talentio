import type { Metadata } from 'next';
import { HomePageContent } from '@/components/home/HomePageContent';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { landing } from '@/lib/i18n/dict/landing';
import { ID_TRANSLATIONS } from '@/lib/i18n/id';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const text = (key: 'landing.title1' | 'landing.title2' | 'landing.subtitle1' | 'landing.subtitle2') =>
    locale === 'id' ? ID_TRANSLATIONS[key] ?? landing[key].en : landing[key][locale];
  return {
    title: `Job Talentio - ${text('landing.title1')} ${text('landing.title2')}`,
    description: `${text('landing.subtitle1')} ${text('landing.subtitle2')}`,
  };
}

export default function HomePage() {
  return <HomePageContent />;
}
