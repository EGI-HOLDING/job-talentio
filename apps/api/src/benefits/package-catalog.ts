import { JobPackageCode } from '@prisma/client';
import { JOB_PACKAGE_OFFERS, LEGACY_JOB_PACKAGE_OFFERS } from '@job-talentio/shared';

/** IDR has zero minor units. Amounts always come from the server catalog. */
export const PACKAGE_PRICES: Record<JobPackageCode, number> = {
  FREE: 0, LITE: 49_000, STANDARD: 149_000, PREMIUM: 299_000,
};
const PREVIEW_CAPACITIES = {
  LITE: { importedCvs: 75, interviewedCandidates: 100 },
  STANDARD: { importedCvs: 250, interviewedCandidates: 300 },
  PREMIUM: { importedCvs: 1000, interviewedCandidates: 500 },
};
export type PurchaseIntent = 'PURCHASE' | 'UPGRADE' | 'RENEW';

export function packageAmount(code: JobPackageCode, intent: PurchaseIntent, current: JobPackageCode) {
  return intent === 'UPGRADE' ? PACKAGE_PRICES[code] - PACKAGE_PRICES[current] : PACKAGE_PRICES[code];
}

export function localCommerce(env = process.env): boolean {
  if (env.APP_ENV === 'production' || env.NODE_ENV === 'production' || env.MIDTRANS_ENV === 'production') return false;
  try {
    const db = new URL(env.DATABASE_URL || '');
    const web = new URL(env.WEB_URL || env.FRONTEND_URL || '');
    const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    return local(db.hostname) && local(web.hostname);
  } catch { return false; }
}

export function packageCatalog(env = process.env) {
  if (env.HR_PACKAGE_CATALOG_V2 === 'true' && env.HR_FLOW_MARKET === 'id') {
    return {
      version: 2,
      offers: JOB_PACKAGE_OFFERS as readonly JobPackageCode[],
      previewCapacities: localCommerce(env) ? PREVIEW_CAPACITIES : undefined,
    };
  }
  return { version: 1, offers: LEGACY_JOB_PACKAGE_OFFERS as readonly JobPackageCode[] };
}

/** Internal test completion is separate from the real sandbox. */
export function localCheckoutEnabled(env = process.env): boolean {
  if (env.CHECKOUT_TEST_MODE !== 'true' || (env.MIDTRANS_ENV === 'sandbox' && env.MIDTRANS_CHECKOUT_ENABLED === 'true')) return false;
  return localCommerce(env);
}
