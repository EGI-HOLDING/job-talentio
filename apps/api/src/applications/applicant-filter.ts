import { LanguageLevel, Prisma } from '@prisma/client';
import { levelsAtOrAbove, parseLanguagesCsv } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
export type ApplicantFilters = {
  q?: string;
  country?: string;
  city?: string;
  skills?: string;
  skillMode?: 'AND' | 'OR';
  degree?: string;
  languages?: string;
  hasCertification?: boolean;
  experienceYearsMin?: number;
  experienceYearsMax?: number;
};
export async function applicantFilter(
  db: PrismaService,
  filters: ApplicantFilters,
): Promise<Prisma.EmployeeProfileWhereInput> {
  const and: Prisma.EmployeeProfileWhereInput[] = [];
  const csv = (value?: string) =>
    value
      ?.split(',')
      .map((v) => v.trim())
      .filter(Boolean) ?? [];
  if (filters.q?.trim())
    and.push({
      OR: [
        { user: { fullName: { contains: filters.q.trim(), mode: 'insensitive' } } },
        { headline: { contains: filters.q.trim(), mode: 'insensitive' } },
      ],
    });
  if (csv(filters.country).length)
    and.push({
      OR: [
        { residenceCountry: { slug: { in: csv(filters.country) } } },
        {
          residenceCountryId: null,
          city: { province: { country: { slug: { in: csv(filters.country) } } } },
        },
      ],
    });
  if (csv(filters.city).length) and.push({ city: { slug: { in: csv(filters.city) } } });
  if (csv(filters.skills).length) {
    const skills = csv(filters.skills);
    if (filters.skillMode === 'AND')
      and.push(...skills.map((slug) => ({ skills: { some: { skill: { slug } } } })));
    else and.push({ skills: { some: { skill: { slug: { in: skills } } } } });
  }
  if (filters.degree) and.push({ educations: { some: { degree: filters.degree as never } } });
  if (filters.hasCertification) and.push({ certifications: { some: {} } });
  const languages = parseLanguagesCsv(filters.languages);
  if (languages.length)
    and.push({
      OR: languages.map((token) => ({
        languages: {
          some: {
            language: { code: token.code },
            level: { in: levelsAtOrAbove(token.minLevel) as LanguageLevel[] },
          },
        },
      })),
    });
  if (filters.experienceYearsMin !== undefined || filters.experienceYearsMax !== undefined) {
    // Merge overlapping intervals in PostgreSQL instead of double-counting jobs.
    const profiles = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH intervals AS (
        SELECT "profileId", range_agg(daterange("startDate"::date, LEAST(COALESCE("endDate"::date,CURRENT_DATE),CURRENT_DATE),'[)')) periods
        FROM "WorkExperience" WHERE "startDate"::date < LEAST(COALESCE("endDate"::date,CURRENT_DATE),CURRENT_DATE) GROUP BY "profileId"
      ), years AS (SELECT "profileId", SUM(upper(period)-lower(period))/365.25 value FROM intervals, unnest(periods) period GROUP BY "profileId")
      SELECT p.id FROM "EmployeeProfile" p LEFT JOIN years y ON y."profileId"=p.id
      WHERE COALESCE(y.value,0) >= ${filters.experienceYearsMin ?? 0} AND COALESCE(y.value,0) <= ${filters.experienceYearsMax ?? 1000}`);
    and.push({ id: { in: profiles.map((p) => p.id) } });
  }
  return { AND: and };
}
