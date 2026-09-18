import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { LEGAL_DOCS } from '@/lib/i18n/legal';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return { title: `${LEGAL_DOCS.privacy[locale].title} - Job Talentio` };
}

export default async function PrivacyPage({ params }: Params) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return <LegalDocument kind="privacy" locale={locale} />;
}
