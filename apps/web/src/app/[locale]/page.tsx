import type { Metadata } from 'next';
import { HomePageContent } from '@/components/home/HomePageContent';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { landing } from '@/lib/i18n/dict/landing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return {
    title: `Job Talentio - ${landing['landing.title1'][locale]} ${landing['landing.title2'][locale]}`,
    description: `${landing['landing.subtitle1'][locale]} ${landing['landing.subtitle2'][locale]}`,
  };
}

export default function HomePage() {
  return <HomePageContent />;
}
