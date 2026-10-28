import { redirect } from 'next/navigation';

/** Retired billing URLs cannot load or settle payments. */
export default async function RetiredBillingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect('/' + locale + '/dashboard/recruiter?tab=jobs');
}
