export type FeaturedCompanyRank = {
  slug: string;
  tier: number;
  latestPublishedAt: Date | null;
};

/** Premium outranks Standard and Free; publication recency and slug are stable tie-breakers. */
export function compareFeaturedCompanies(a: FeaturedCompanyRank, b: FeaturedCompanyRank) {
  const tierOrder = b.tier - a.tier;
  if (tierOrder) return tierOrder;
  const publicationOrder = (b.latestPublishedAt?.getTime() ?? 0) - (a.latestPublishedAt?.getTime() ?? 0);
  if (publicationOrder) return publicationOrder;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}
