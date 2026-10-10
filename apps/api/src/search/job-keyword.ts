import { Prisma } from '@prisma/client';

/** One query word must hit the posting, a translation, or a catalog label. */
export function jobKeywordOr(term: string): Prisma.JobPostWhereInput {
  const like = { contains: term, mode: 'insensitive' as const };
  return {
    OR: [
      { title: like },
      { description: like },
      { translations: { some: { title: like } } },
      { translations: { some: { description: like } } },
      { jobTitle: { OR: [{ name: like }, { nameUz: like }, { nameRu: like }] } },
      { company: { name: like } },
      {
        jobSkills: {
          some: { skill: { OR: [{ name: like }, { nameUz: like }, { nameRu: like }] } },
        },
      },
      { city: { OR: [{ name: like }, { nameUz: like }, { nameRu: like }] } },
      { category: { OR: [{ name: like }, { nameUz: like }, { nameRu: like }] } },
    ],
  };
}

/**
 * Meili ids are a filter only when at least one of them is still a published
 * posting. An empty list is truthy in JS and would match nothing (`id IN ()`).
 * Null means Meili is off, down, or had no hits — use Postgres instead.
 */
export function shouldTrustMeiliIds(ids: string[] | null, livePublished: number): boolean {
  return Boolean(ids && ids.length > 0 && livePublished > 0);
}
