import { JobPackageCode } from '@prisma/client';

/** IDR has zero minor units. Amounts always come from the server catalog. */
export const PACKAGE_CATALOG_VERSION = 1;
export const PACKAGE_PRICES: Record<JobPackageCode, number> = {
  FREE: 0, STANDARD: 149_000, PREMIUM: 299_000,
};
export type PurchaseIntent = 'PURCHASE' | 'UPGRADE' | 'RENEW';

export function packageAmount(code: JobPackageCode, intent: PurchaseIntent, current: JobPackageCode) {
  return intent === 'UPGRADE' ? PACKAGE_PRICES[code] - PACKAGE_PRICES[current] : PACKAGE_PRICES[code];
}

/** Test completion is an explicit local deployment capability, never a fallback
 * for a missing gateway and never enabled by a request parameter. */
export function localCheckoutEnabled(env = process.env): boolean {
  if (env.CHECKOUT_TEST_MODE !== 'true' || env.APP_ENV === 'production' || env.NODE_ENV === 'production') return false;
  try {
    const db = new URL(env.DATABASE_URL || '');
    const web = new URL(env.WEB_URL || env.FRONTEND_URL || '');
    const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    return local(db.hostname) && local(web.hostname);
  } catch { return false; }
}
