import {
  resolveBenefitIcon,
  resolveCategoryIcon,
  isBrokenIcon,
} from '@job-talentio/shared';

export { resolveBenefitIcon, resolveCategoryIcon, isBrokenIcon };

/** Safe display string for category/benefit icons (hides ????). */
export function categoryIconLabel(slug?: string | null, icon?: string | null): string {
  const resolved = resolveCategoryIcon(slug, icon);
  return resolved ? `${resolved} ` : '';
}

export function benefitIconLabel(slug?: string | null, icon?: string | null): string {
  const resolved = resolveBenefitIcon(slug, icon);
  return resolved ? `${resolved} ` : '';
}
