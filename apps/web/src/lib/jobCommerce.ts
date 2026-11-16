import { safeAuthNext } from './authReturn';
import { accountReturnHref, employerJobHref } from './accountNavigation';
import { JOB_PACKAGE_CODES, type JobPackageCode } from '@job-talentio/shared';
export type PackageCode = JobPackageCode;
export type PurchaseIntent = 'PURCHASE'|'UPGRADE'|'RENEW';
export type JobPackage = {code: PackageCode; amount: number; currency: string; version: number;
  settings: {durationDays: number; boostDays: number; featuredDays: number; conversions: boolean; reports: boolean; prioritySupport: boolean; companyPageLinkedIn?: boolean};
  previewCapacity?: { importedCvs: number; interviewedCandidates: number };
  linkedin: boolean; instagram: string};
export type PackageCatalog = {version: number; packages: JobPackage[]; enabled: boolean; testMode: boolean; paymentAvailable: boolean; sandbox?: boolean; hrFlowV2?: boolean; assessmentLanguageSelection?: boolean};
export type JobOrder = {id: string; jobId: string|null; companyId: string; jobTitle: string; companyName: string; code: PackageCode;
  creationSessionId?:string|null;
  intent: PurchaseIntent; status: string; amount: number; currency: string; expiresAt: string; createdAt: string;
  fulfilledAt: string|null; provider: string|null; policyVersion?: number; policySnapshot?: JobPackage['settings']};
export function money(amount: number, locale: string, currency = 'IDR') {
  return new Intl.NumberFormat(locale === 'id' ? 'id-ID' : locale, {style: 'currency', currency, maximumFractionDigits: 0}).format(amount);
}
export function commerceReturn(value: string|null, jobId: string): string {
  if (value === '/onboarding/recruiter') return value;
  if (value?.startsWith('/onboarding/recruiter?')) {
    const next = accountReturnHref('RECRUITER', new URL(value, 'https://jobtalent.internal').searchParams.get('next'));
    if (next) return '/onboarding/recruiter?next=' + encodeURIComponent(next);
  }
  return safeAuthNext(value) || employerJobHref(jobId, 'details') + '&review=1';
}
export function packageCode(value?: string|null): PackageCode|undefined {
  return JOB_PACKAGE_CODES.find(code => code === value);
}
export function packageLabel(code: PackageCode) {
  return { FREE: 'Free', LITE: 'Lite', STANDARD: 'Standard', PREMIUM: 'Premium' }[code];
}
export function packagePreference(search: string): PackageCode|undefined {
  const params = new URLSearchParams(search), next = safeAuthNext(params.get('next'));
  return packageCode(params.get('package')) || (next ? packageCode(new URL(next, 'https://jobtalent.internal').searchParams.get('package')) : undefined);
}
export function withPackagePreference(href: string, code?: PackageCode|null) {
  if (!code) return href;
  const url = new URL(href, 'https://jobtalent.internal');
  url.searchParams.set('package', code);
  return url.pathname + url.search + url.hash;
}
export function packageHref(jobId: string, returnTo?: string, preferred?: PackageCode) {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (preferred) params.set('package', preferred);
  return '/dashboard/recruiter/jobs/' + encodeURIComponent(jobId) + '/package' + (params.size ? '?' + params : '');
}
