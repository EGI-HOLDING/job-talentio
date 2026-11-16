export const JOB_PACKAGE_CODES = ['FREE', 'LITE', 'STANDARD', 'PREMIUM'] as const;
export type JobPackageCode = typeof JOB_PACKAGE_CODES[number];

export const LEGACY_JOB_PACKAGE_OFFERS = ['FREE', 'STANDARD', 'PREMIUM'] as const;
export const JOB_PACKAGE_OFFERS = ['LITE', 'STANDARD', 'PREMIUM'] as const;

export function jobPackageRank(code: string): number {
  return JOB_PACKAGE_CODES.indexOf(code as JobPackageCode);
}
