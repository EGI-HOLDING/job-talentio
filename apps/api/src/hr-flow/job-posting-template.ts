import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jobPostSchema } from '@job-talentio/shared';
import { resolveSeniority } from '../catalogs/business-catalog';
import { resolveJobLocation } from '../common/geo-selection';
import { parseDto } from '../common/utils';
import { previewJobGroup } from '../matching/job-group-scope';
import { effectiveExperience, resolveHrPosition } from './job-input';

export const templateJobInclude = {
  city: { include: { province: { select: { countryId: true } } } },
  country: true, category: true,
  jobSkills: { include: { skill: true } },
  jobLanguages: { include: { language: true } },
  benefits: { include: { benefit: true } },
} satisfies Prisma.JobPostInclude;

type Source = Prisma.JobPostGetPayload<{ include: typeof templateJobInclude }>;

export function snapshotJob(source: Source) {
  const position = source.positionEntryMode === 'GROUP'
    ? { positionEntryMode: 'GROUP', positionGroupId: source.positionGroupId,
        positionGroupScopeRevision: source.positionGroupScopeRevision }
    : source.positionEntryMode === 'CATALOG'
      ? { positionEntryMode: 'CATALOG', jobTitleId: source.jobTitleId }
      : { positionEntryMode: 'MANUAL' };
  const location = [source.city?.name, source.country?.name].filter(Boolean).join(', ') || null;
  const draft = {
    ...position, title: source.title, description: source.description,
    responsibilities: source.responsibilities, kpis: source.kpis, specificExpectations: source.specificExpectations,
    employmentType: source.employmentType, workMode: source.workMode,
    countryId: source.countryId ?? source.city?.province.countryId ?? null, citySlug: source.city?.slug ?? '',
    salaryMin: source.salaryMin, salaryMax: source.salaryMax, salaryPeriod: source.salaryPeriod, currency: source.currency,
    seniorityLevelCode: source.seniorityLevelCode,
    ...(source.seniorityLevelCode && source.experienceRangeSource
      ? { experienceRangeMin: source.experienceRangeMin, experienceRangeMax: source.experienceRangeMax }
      : {}),
    skills: source.jobSkills.map(row => ({
      slug: row.skill.slug, name: row.skill.name, isRequired: row.isRequired, weight: row.weight, minLevel: row.minLevel,
    })),
    languages: source.jobLanguages.map(row => ({
      code: row.language.code, name: row.language.name, isRequired: row.isRequired, minLevel: row.minLevel,
      confirmed: row.provenance === 'EMPLOYER_CONFIRMED',
    })),
    benefits: source.benefits.map(row => ({ slug: row.benefit.slug, name: row.benefit.name })),
    _senioritySnapshot: source.seniorityVersion ? { seniorityVersion: source.seniorityVersion } : null,
    _templateFields: {
      location, isAnonymous: source.isAnonymous, locale: source.locale,
      categorySlug: source.category?.slug ?? '',
      experienceYearsMin: source.experienceYearsMin, experienceLevel: source.experienceLevel,
    },
  };
  return { title: source.title, location, draft };
}

export function creationJobInput(draft: Prisma.JsonValue, fromTemplate: boolean) {
  const raw = draft as Record<string, unknown>;
  const settings = fromTemplate ? raw._templateFields as Record<string, unknown> | undefined : undefined;
  const data = parseDto(jobPostSchema, {
    ...raw,
    responsibilities: (raw.responsibilities as string[] | undefined)?.filter(value => value.trim()),
    kpis: (raw.kpis as string[] | undefined)?.filter(value => value.trim()),
    isAnonymous: settings?.isAnonymous === true,
    ...(settings ? {
      locale: settings.locale, categorySlug: settings.categorySlug || undefined,
      experienceLevel: settings.experienceLevel,
      experienceYearsMin: raw.seniorityLevelCode ? undefined : settings.experienceYearsMin,
    } : {}),
  });
  const version = (raw._senioritySnapshot as { seniorityVersion?: string } | null)?.seniorityVersion;
  return { data, version };
}

export async function validateTemplateDraft(tx: Prisma.TransactionClient, draft: Prisma.JsonValue) {
  const { data, version } = creationJobInput(draft, true);
  const { cityId } = await resolveJobLocation(tx, data);
  if (data.workMode !== 'REMOTE' && !cityId) throw new BadRequestException('City is required for onsite/hybrid jobs.');
  if (data.salaryMin != null && data.salaryMax != null && data.salaryMax < data.salaryMin)
    throw new BadRequestException('Maximum salary must be at least the minimum.');
  effectiveExperience(data, await resolveSeniority(tx, data, undefined, version));
  if (data.positionEntryMode === 'GROUP') {
    const scope = await previewJobGroup(tx, data.positionGroupId!);
    if (scope.scopeRevision !== data.positionGroupScopeRevision) throw new ConflictException('POSITION_GROUP_SCOPE_CHANGED');
    if (!scope.members.length) throw new BadRequestException('POSITION_GROUP_HAS_NO_VERIFIED_MEMBERS');
  } else {
    await resolveHrPosition(tx, data);
  }
}
