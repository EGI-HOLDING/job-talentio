import type { Metadata } from 'next';
import { EmployerLanding } from '@/components/home/EmployerLanding';
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale';
import { employers } from '@/lib/i18n/dict/employers';
import { RoleGate } from '@/components/auth/RoleGate';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return {
    title: `Job Talentio - ${employers['employers.badge'][locale]}`,
    description: `${employers['employers.subtitle1'][locale]} ${employers['employers.subtitle2'][locale]}`,
  };
}

export default function EmployersPage() {
  return <RoleGate role="RECRUITER" allowAnonymous><EmployerLanding /></RoleGate>;
}
