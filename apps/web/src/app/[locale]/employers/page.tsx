import type { Metadata } from 'next';
import { EmployerLanding } from '@/components/home/EmployerLanding';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { employers } from '@/lib/i18n/dict/employers';
import { RoleGate } from '@/components/auth/RoleGate';
import { ID_TRANSLATIONS } from '@/lib/i18n/id';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const text = (key: 'employers.badge' | 'employers.subtitle1' | 'employers.subtitle2') =>
    locale === 'id' ? ID_TRANSLATIONS[key] ?? employers[key].en : employers[key][locale];
  return {
    title: `Job Talentio - ${text('employers.badge')}`,
    description: `${text('employers.subtitle1')} ${text('employers.subtitle2')}`,
  };
}

export default function EmployersPage() {
  return <RoleGate role="RECRUITER" allowAnonymous><EmployerLanding /></RoleGate>;
}
