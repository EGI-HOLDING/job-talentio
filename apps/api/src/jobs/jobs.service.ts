import { jobChatPeers } from '../chat/job-chat-peer';
import {
  Injectable,
  Optional,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JobStatus, LanguageLevel, Prisma, WorkMode } from '@prisma/client';
import {
  levelsAtOrAbove,
  parseLanguagesCsv,
  resolveBenefitIcon,
  resolveCategoryIcon,
  jobScreeningQuestionSchema,
} from '@job-talentio/shared';
import { exposureLog, liveJobWhere,loadExposurePolicy, HR_PUBLICATION_LOCK } from '../benefits/benefit-policy';
import { OperationsService } from '../benefits/operations.service';
import { HrAnalyticsService } from '../benefits/hr-analytics.service';
import { BenefitsService } from '../benefits/benefits.service';
import { RecruiterOnboardingService } from '../benefits/recruiter-onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { EmployeeMatchingService } from '../matching/employee-matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify, parseDto } from '../common/utils';
import {
  contentHash,
  jobFingerprint,
  normalizeJobTitle,
  titlesNearlyIdentical,
} from '../common/dedupe';
import { resolveSkill } from '../common/skill-resolve';
import { resolveBenefit } from '../common/benefit-resolve';
import { resolveJobTitle } from '../common/title-resolve';
import { resolveLanguage } from '../common/language-resolve';
import { jobKeywordOr } from '../search/job-keyword';
import { JobsSearchService } from '../search/jobs-search.service';
import { contentHash as translationSourceHash, resolveUgcContent } from '../common/i18n/content-locale';
import { TelegramService } from '../telegram/telegram.service';
import { LinkedInService } from '../linkedin/linkedin.service';
import { DEFAULT_LOCALE } from '../common/i18n/locale';
import { effectiveSourceLocale, pickStoredLocale } from '../common/i18n/detect-locale';
import type { Locale } from '../common/i18n/locale';
import { canTransition, transitionError } from './job-status';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { resolveJobLocation } from '../common/geo-selection';
import {
  displayCompanyName,
  maskAnonymousCompany,
  revealsAnonymousEmployer,
  anonymousRevealHistory,
} from '../common/anonymous-job';


type JobSkillInput = { slug?: string; name?: string; isRequired?: boolean; weight?: number; minLevel?: import('@prisma/client').SkillLevel | null };
type JobBenefitInput = { slug?: string; name?: string } | string;
type JobLanguageInput = {
  confirmed?: boolean;
  code?: string;
  name?: string;
  minLevel?: LanguageLevel | string;
  isRequired?: boolean;
};

const ACTIVE_JOB_STATUSES: JobStatus[] = ['DRAFT', 'PUBLISHED', 'PAUSED'];

/** Swaps one screening question for its version in the reader's language. */
function localizeQuestion<
  T extends {
    question: string;
    translations?: Array<{ locale: string; question: string; isMachine: boolean }>;
  },
>(question: T, sourceLocale: string, locale: Locale) {
  const { translations = [], ...rest } = question;
  const resolved = resolveUgcContent(
    { question: rest.question },
    sourceLocale,
    translations.filter((translation) => !translation.isMachine),
    locale,
    rest.question,
  );
  return { ...rest, question: resolved.content.question };
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private companies: CompaniesService,
    private matching: MatchingService,
    private notifications: NotificationsService,
    private jobsSearch: JobsSearchService,
    private telegram: TelegramService,
    private employeeMatching: EmployeeMatchingService = new EmployeeMatchingService(prisma),
    @Optional() private benefits?: BenefitsService,
    @Optional() private analytics: HrAnalyticsService = new HrAnalyticsService(prisma,benefits??new BenefitsService(prisma,new OperationsService(prisma))),
    @Optional() private linkedin?: LinkedInService,
    @Optional() private recruiterOnboarding?: RecruiterOnboardingService,
  ) {}

  private assertSalaryRange(min: number | null | undefined, max: number | null | undefined) {
    if (min != null && max != null && max < min) {
      throw new BadRequestException('Maximum salary must be at least the minimum.');
    }
  }

  /** City is optional for REMOTE (hub/timezone); required when publishing ONSITE/HYBRID. */
  private assertLocationRules(workMode: WorkMode | string, cityId: string | null | undefined, forPublish = false) {
    if (forPublish && workMode !== 'REMOTE' && !cityId) {
      throw new BadRequestException(
        'City is required for onsite/hybrid jobs. Remote jobs may omit city or set a hiring-region hub.',
      );
    }
  }

  private async assertNoDuplicateJob(opts: {
    companyId: string;
    title: string;
    description: string;
    workMode: string;
    cityId: string | null;
    excludeJobId?: string;
  }, db: Prisma.TransactionClient = this.prisma) {
    const fp = jobFingerprint({
      title: opts.title,
      workMode: opts.workMode,
      cityId: opts.cityId,
    });
    const hash = contentHash(opts.description);

    const sameFingerprint = await db.jobPost.findFirst({
      where: {
        companyId: opts.companyId,
        fingerprint: fp,
        status: { in: ACTIVE_JOB_STATUSES },
        AND: [{OR:[{benefit:{is:null}},{benefit:{expiresAt:null}},{benefit:{expiresAt:{gt:new Date()}}}]}],
        ...(opts.excludeJobId ? { id: { not: opts.excludeJobId } } : {}),
      },
      select: { id: true, title: true, status: true },
    });
    if (sameFingerprint) {
      throw new ConflictException(
        `Duplicate job blocked: an active ${sameFingerprint.status} opening with the same title, work mode, and location already exists ("${sameFingerprint.title}"). Close or edit that post instead.`,
      );
    }

    const sameContent = await db.jobPost.findFirst({
      where: {
        companyId: opts.companyId,
        contentHash: hash,
        status: { in: ACTIVE_JOB_STATUSES },
        AND: [{OR:[{benefit:{is:null}},{benefit:{expiresAt:null}},{benefit:{expiresAt:{gt:new Date()}}}]}],
        ...(opts.excludeJobId ? { id: { not: opts.excludeJobId } } : {}),
      },
      select: { id: true, title: true },
    });
    if (sameContent) {
      throw new ConflictException(
        `Duplicate job blocked: description matches an active post ("${sameContent.title}"). Reuse that listing or change the content substantially.`,
      );
    }

    // Near-title soft check among active company jobs (covers missing fingerprint on legacy rows)
    const candidates = await db.jobPost.findMany({
      where: {
        companyId: opts.companyId,
        status: { in: ACTIVE_JOB_STATUSES },
        AND: [{OR:[{benefit:{is:null}},{benefit:{expiresAt:null}},{benefit:{expiresAt:{gt:new Date()}}}]}],
        workMode: opts.workMode as WorkMode,
        cityId: opts.cityId,
        ...(opts.excludeJobId ? { id: { not: opts.excludeJobId } } : {}),
      },
      select: { id: true, title: true },
      take: 50,
    });
    const near = candidates.find((j) => titlesNearlyIdentical(j.title, opts.title));
    if (near) {
      throw new ConflictException(
        `Duplicate job blocked: title is nearly identical to active post "${near.title}".`,
      );
    }

    return { fingerprint: fp, contentHash: hash, titleNormalized: normalizeJobTitle(opts.title) };
  }

  private translationSelect = {
    select: { locale: true, title: true, description: true, isMachine: true },
  } as const;

  private jobInclude = {
    translations: {
      select: { locale: true, title: true, description: true, isMachine: true },
    },
    company: {
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        isVerified: true,
        city: true,
        industry: true,
        members: { select: { userId: true, role: true }, take: 5 },
        _count: { select: { followers: true } },
      },
    },
    city: { include: { province: { include: { country: true } } } },
    country: true,
    category: true,
    jobTitle: { select: { id: true, name: true, nameUz: true, nameRu: true, nameId: true, slug: true } },
    jobSkills: { include: { skill: true } },
    jobLanguages: { include: { language: true } },
    benefits: { include: { benefit: true } },
    questions: {
      where: { archivedAt: null },
      orderBy: { sortOrder: 'asc' as const },
      include: {
        translations: { select: { locale: true, question: true, isMachine: true } },
      },
    },
    _count: { select: { applications: true, views: true } },
  };

  computeRankScore(job: {
    publishedAt: Date | null;
    description: string;
    skillCount: number;
  }) {
    return exposureLog({publishedAt:job.publishedAt,visibility:1});
  }

  // findFirst rather than findUnique: an archived entry must not be selectable
  // for a new posting, and findUnique cannot filter on a non-unique column.
  private async resolveCityId(slug?: string | null) {
    if (!slug) return null;
    const city = await this.prisma.city.findFirst({ where: { slug, ...ACTIVE_CATALOG } });
    return city?.id ?? null;
  }

  private async resolveCategoryId(slug?: string | null, db: Prisma.TransactionClient = this.prisma) {
    if (!slug) return null;
    const cat = await db.jobCategory.findFirst({ where: { slug, ...ACTIVE_CATALOG } });
    return cat?.id ?? null;
  }

  private async syncSkills(jobPostId: string, skills: JobSkillInput[], db: Prisma.TransactionClient) {
    await db.jobPostSkill.deleteMany({ where: { jobPostId } });
    const seen = new Set<string>();
    for (const s of skills) {
      if (!s.slug && !s.name) continue;
      const { skill } = await resolveSkill(db, {
        slug: s.slug,
        name: s.name,
        allowCreate: true,
      });
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      await db.jobPostSkill.create({
        data: {
          jobPostId,
          skillId: skill.id,
          minLevel:s.minLevel ?? null,
          isRequired: s.isRequired ?? true,
          weight: s.weight ?? 1,
        },
      });
    }
  }

  private async syncBenefits(jobPostId: string, benefits: JobBenefitInput[], db: Prisma.TransactionClient) {
    await db.jobPostBenefit.deleteMany({ where: { jobPostId } });
    const seen = new Set<string>();
    for (const b of benefits) {
      const slug = typeof b === 'string' ? b : b.slug;
      const name = typeof b === 'string' ? undefined : b.name;
      if (!slug && !name) continue;
        const { benefit } = await resolveBenefit(db, {
          slug,
          name,
          allowCreate: true,
        });
        if (seen.has(benefit.id)) continue;
        seen.add(benefit.id);
        await db.jobPostBenefit.create({
          data: { jobPostId, benefitId: benefit.id },
        });
    }
  }

  private async syncLanguages(jobPostId: string, languages: JobLanguageInput[], db: Prisma.TransactionClient) {
    await db.jobPostLanguage.deleteMany({ where: { jobPostId } });
    const seen = new Set<string>();
    for (const item of languages.slice(0, 4)) {
      if (!item.code && !item.name) continue;
        const { language } = await resolveLanguage(db, {
          code: item.code,
          name: item.name,
          allowCreate: true,
        });
        if (seen.has(language.id)) continue;
        seen.add(language.id);
        const minLevel = (item.minLevel as LanguageLevel | undefined) || 'B1';
        await db.jobPostLanguage.create({
          data: {
            jobPostId,
            languageId: language.id,
            minLevel,
            isRequired: item.isRequired ?? true,
            provenance: item.confirmed === false ? 'LEGACY_UNVERIFIED' : 'EMPLOYER_CONFIRMED',
          },
        });
    }
  }

  private async syncQuestions(jobId: string, input: unknown, db: Prisma.TransactionClient) {
    const questions = parseDto(jobScreeningQuestionSchema.array().max(20), input);
    await db.$queryRaw(Prisma.sql`SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
    const current = await db.jobQuestion.findMany({ where: { jobPostId: jobId, archivedAt: null } });
    const ids = questions.flatMap(row => row.id ? [row.id] : []);
    if (new Set(ids).size !== ids.length || ids.some(id => !current.some(row => row.id === id)))
      throw new BadRequestException('A screening question is duplicated, archived or belongs to another job');
    for (const old of current) {
      await db.jobQuestionVersion.upsert({ where: { questionId_revision: { questionId: old.id, revision: old.revision } },
        create: { questionId: old.id, revision: old.revision, snapshot: JSON.parse(JSON.stringify(old)) }, update: {} });
      if (!ids.includes(old.id)) await db.jobQuestion.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
    }
    for (const question of questions) {
      const { id, ...data } = question;
      const old = current.find(row => row.id === id);
      if (old && old.question === data.question && old.type === data.type && old.isRequired === data.isRequired && old.sortOrder === data.sortOrder) continue;
      const saved = old
        ? await db.jobQuestion.update({ where: { id: old.id }, data: { ...data, revision: { increment: 1 } } })
        : await db.jobQuestion.create({ data: { jobPostId: jobId, ...data } });
      await db.jobQuestionVersion.create({ data: { questionId: saved.id, revision: saved.revision, snapshot: JSON.parse(JSON.stringify(saved)) } });
      if (old && old.question !== saved.question) await db.jobQuestionTranslation.deleteMany({ where: { questionId: old.id } });
    }
  }

  async create(user: AuthUser, companyId: string, data: Record<string, unknown>) {
    const created = await this.prisma.$transaction(async db => {
      await db.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`);
      return this.createInside(user, companyId, data, db);
    }, { timeout: 30000 });
    if (created) void this.jobsSearch.syncJob(created.id);
    return created;
  }
  private async createInside(user: AuthUser, companyId: string, data: Record<string, unknown>, db: Prisma.TransactionClient) {
    const { company } = await this.companies.assertMember(user, companyId, [
      'OWNER',
      'ADMIN',
      'RECRUITER',
    ]);
    this.companies.assertOpen(company);
    // Release partial unique indexes for expired openings even if the worker is late.
    await db.jobPost.updateMany({where:{companyId,status:{in:['PUBLISHED','PAUSED']},benefit:{expiresAt:{lte:new Date()}}},data:{status:'EXPIRED'}});
    this.assertSalaryRange(data.salaryMin as number | null | undefined, data.salaryMax as number | null | undefined);
    const workMode = ((data.workMode as string) || 'ONSITE') as WorkMode;
    // Remote: city is optional hub/region — never invent a fake "Remote" city
    const { cityId, countryId } = await resolveJobLocation(db, data);
    const categoryId = await this.resolveCategoryId(data.categorySlug as string | undefined, db);
    const resolvedTitle = await resolveJobTitle(db, {
      name: String(data.title).trim(),
      slug: data.jobTitleSlug ? String(data.jobTitleSlug) : undefined,
    });
    const title = resolvedTitle.jobTitle.name;
    const description = String(data.description).trim();
    if (description.length < 20) throw new BadRequestException("Description must contain at least 20 characters");
    const experienceLevel =
      (data.experienceLevel as never) ?? resolvedTitle.inferredLevel ?? null;

    const hashes = await this.assertNoDuplicateJob({
      companyId,
      title,
      description,
      workMode,
      cityId,
    }, db);

    const job = await db.jobPost.create({
      data: {
        companyId,
        jobTitleId: resolvedTitle.jobTitle.id,
        title,
        description,
        cityId,
        countryId,
        categoryId,
        employmentType: (data.employmentType as never) || 'FULL_TIME',
        workMode,
        salaryMin: (data.salaryMin as number) ?? null,
        salaryMax: (data.salaryMax as number) ?? null,
        salaryPeriod: (data.salaryPeriod as never) || 'MONTHLY',
        currency: (data.currency as string) || 'UZS',
        experienceYearsMin: (data.experienceYearsMin as number) ?? null,
        experienceLevel,
        isAnonymous: data.isAnonymous === true,
        locale: pickStoredLocale({
          text: `${title}\n${description}`,
          explicit: typeof data.locale === 'string' ? data.locale : null,
        }) ?? undefined,
        status: 'DRAFT',
        fingerprint: hashes.fingerprint,
        contentHash: hashes.contentHash,
      },
    });

    await this.syncSkills(job.id, (data.skills as JobSkillInput[]) || [], db);
    await this.syncBenefits(
      job.id,
      ([
        ...((data.benefits as JobBenefitInput[]) || []),
        ...((data.benefitSlugs as string[]) || []),
      ] as JobBenefitInput[]), db,
    );
    await this.syncLanguages(job.id, (data.languages as JobLanguageInput[]) || [], db);
    if (data.screeningQuestions !== undefined) await this.syncQuestions(job.id, data.screeningQuestions, db);

    const created = await db.jobPost.findUnique({
      where: { id: job.id },
      include: this.jobInclude,
    });
    return created ? this.withResolvedIcons(created) : created;
  }

  async update(user: AuthUser, jobId: string, data: Record<string, unknown>) {
    const job = await this.prisma.jobPost.findUniqueOrThrow({ where: { id: jobId } });
    const updated = await this.prisma.$transaction(async db => {
      await db.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id = ${job.companyId} FOR UPDATE`);
      return this.updateInside(user, jobId, data, db);
    }, { timeout: 30000 });
    if (updated) void this.jobsSearch.syncJob(jobId);
    return updated;
  }
  private async updateInside(user: AuthUser, jobId: string, data: Record<string, unknown>, db: Prisma.TransactionClient) {
    const job = await db.jobPost.findUnique({
      where: { id: jobId },
      include: { company: { select: { anonymizedAt: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    this.companies.assertOpen(job.company);
    if (data.expectedUpdatedAt && data.expectedUpdatedAt !== job.updatedAt.toISOString())
      throw new ConflictException('Job changed. Refresh before saving your changes.');
    this.assertSalaryRange(
      data.salaryMin === undefined ? job.salaryMin : data.salaryMin as number | null,
      data.salaryMax === undefined ? job.salaryMax : data.salaryMax as number | null,
    );

    const workMode = (data.workMode as WorkMode | undefined) ?? job.workMode;
    const { cityId, countryId } = await resolveJobLocation(db, data, job);

    let title = job.title;
    let jobTitleId = job.jobTitleId;
    let inferredLevel: typeof job.experienceLevel = null;
    if (data.title !== undefined || data.jobTitleSlug !== undefined) {
      const resolvedTitle = await resolveJobTitle(db, {
        name: data.title !== undefined ? String(data.title).trim() : job.title,
        slug: data.jobTitleSlug ? String(data.jobTitleSlug) : undefined,
      });
      title = resolvedTitle.jobTitle.name;
      jobTitleId = resolvedTitle.jobTitle.id;
      inferredLevel = resolvedTitle.inferredLevel;
    }
    const description =
      data.description !== undefined ? String(data.description).trim() : job.description;
    if (description.length < 20) throw new BadRequestException("Description must contain at least 20 characters");
    const resolvedCityId = cityId === undefined ? job.cityId : cityId;

    const hashes = await this.assertNoDuplicateJob({
      companyId: job.companyId,
      title,
      description,
      workMode,
      cityId: resolvedCityId,
      excludeJobId: jobId,
    }, db);

    if (ACTIVE_JOB_STATUSES.includes(job.status) && job.status === 'PUBLISHED') {
      this.assertLocationRules(workMode, resolvedCityId, true);
    }

    const nextExperienceLevel =
      data.experienceLevel !== undefined
        ? (data.experienceLevel as never)
        : inferredLevel && !job.experienceLevel
          ? inferredLevel
          : undefined;

    await db.jobPost.update({
      where: { id: jobId },
      data: {
        updatedAt: new Date(Math.max(Date.now(), job.updatedAt.getTime() + 1)),
        title: data.title !== undefined || data.jobTitleSlug !== undefined ? title : undefined,
        jobTitleId:
          data.title !== undefined || data.jobTitleSlug !== undefined ? jobTitleId : undefined,
        description: data.description !== undefined ? description : undefined,
        cityId,
        countryId,
        categoryId:
          data.categorySlug === undefined
            ? undefined
            : await this.resolveCategoryId(data.categorySlug as string | null, db),
        employmentType: data.employmentType as never,
        workMode: data.workMode as never,
        salaryMin: data.salaryMin as number | null | undefined,
        salaryMax: data.salaryMax as number | null | undefined,
        salaryPeriod: data.salaryPeriod as never,
        currency: data.currency as string | undefined,
        experienceYearsMin: data.experienceYearsMin as number | null | undefined,
        experienceLevel: nextExperienceLevel as never,
        isAnonymous: typeof data.isAnonymous === 'boolean' ? data.isAnonymous : undefined,
        locale:
          pickStoredLocale({
            text: `${title}\n${description}`,
            explicit: typeof data.locale === 'string' ? data.locale : null,
            existing: job.locale,
          }) ?? undefined,
        fingerprint: hashes.fingerprint,
        contentHash: hashes.contentHash,
      },
    });

    if (data.skills) await this.syncSkills(jobId, data.skills as JobSkillInput[], db);
    if (data.benefits || data.benefitSlugs) {
      await this.syncBenefits(jobId, [
        ...((data.benefits as JobBenefitInput[]) || []),
        ...((data.benefitSlugs as string[]) || []),
      ], db);
    }
    if (data.languages) {
      await this.syncLanguages(jobId, data.languages as JobLanguageInput[], db);
    }
    if (data.screeningQuestions !== undefined) await this.syncQuestions(jobId, data.screeningQuestions, db);

    const updated = await db.jobPost.findUnique({
      where: { id: jobId },
      include: this.jobInclude,
    });
    return updated ? this.withResolvedIcons(updated) : updated;
  }

  async changeStatus(
    user: AuthUser,
    jobId: string,
    status: JobStatus,
    adminAudit?: { actorId: string; bulk?: boolean },
    linkedinPreviewId?: string,
  ) {
    if (linkedinPreviewId && status !== 'PUBLISHED') throw new BadRequestException('LinkedIn approval can only accompany publication');
    if (linkedinPreviewId && !this.linkedin) throw new ServiceUnavailableException('LinkedIn sharing is unavailable');
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: { company: { include: { followers: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    const existingBenefit = await this.prisma.jobBenefit.findUnique({ where: { jobId } });
    if (status === 'PUBLISHED' && existingBenefit?.expiresAt && existingBenefit.expiresAt <= new Date()) throw new ConflictException('Posting expired. Copy it as a new draft.');
    if (status !== 'CLOSED') this.companies.assertOpen(job.company);
    if (status === 'PUBLISHED' && job.company.isBanned) {
      throw new ForbiddenException('A banned company cannot publish jobs');
    }

    if (job.status === status) {
      if (!adminAudit && !linkedinPreviewId) {
        return this.withResolvedIcons(
          await this.prisma.jobPost.findUniqueOrThrow({
            where: { id: jobId },
            include: this.jobInclude,
          }),
        );
      }
      const unchanged = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id"=${job.companyId} FOR UPDATE`;
        const current = await tx.jobPost.findUniqueOrThrow({
          where: { id: jobId },
          include: this.jobInclude,
        });
        if (adminAudit) {
          await tx.auditLog.create({
            data: {
              actorId: adminAudit.actorId,
              action: 'FORCE_JOB_STATUS',
              entityType: 'JobPost',
              entityId: jobId,
              metadata: { status, ...(adminAudit.bulk ? { bulk: true } : {}) },
            },
          });
        }
        if (linkedinPreviewId) await this.linkedin!.enqueueApproved(tx, user, jobId, linkedinPreviewId);
        return current;
      });
      return this.withResolvedIcons(unchanged);
    }

    if (!canTransition(job.status, status)) {
      throw new BadRequestException(transitionError(job.status, status));
    }

    // Becoming active again (incl. reopen CLOSED → DRAFT/PUBLISHED) must pass dedupe
    if (ACTIVE_JOB_STATUSES.includes(status)) {
      await this.assertNoDuplicateJob({
        companyId: job.companyId,
        title: job.title,
        description: job.description,
        workMode: job.workMode,
        cityId: job.cityId,
        excludeJobId: job.id,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (status === 'PUBLISHED') await tx.$queryRaw(Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock_shared(${HR_PUBLICATION_LOCK}::bigint)`);
      // Serialize company status changes and preserve idempotent publishing.
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Company" WHERE "id" = ${job.companyId} FOR UPDATE`;
      const current = await tx.jobPost.findUniqueOrThrow({
        where: { id: jobId }, include: { company: true },
      });
      if (status !== 'CLOSED') this.companies.assertOpen(current.company);
      if (current.status === status) {
        const updated = await tx.jobPost.findUniqueOrThrow({ where: { id: jobId }, include: this.jobInclude });
        if (adminAudit) {
          await tx.auditLog.create({
            data: {
              actorId: adminAudit.actorId,
              action: 'FORCE_JOB_STATUS',
              entityType: 'JobPost',
              entityId: jobId,
              metadata: { status, ...(adminAudit.bulk ? { bulk: true } : {}) },
            },
          });
        }
        if (linkedinPreviewId) await this.linkedin!.enqueueApproved(tx, user, jobId, linkedinPreviewId);
        return { changed: false, updated };
      }
      if (current.updatedAt.getTime() !== job.updatedAt.getTime()) {
        throw new ConflictException('Job changed. Refresh and try again.');
      }
      if (status === 'PUBLISHED') {
        await this.recruiterOnboarding?.beforePublish(user, current.companyId, tx);
        this.assertLocationRules(current.workMode, current.cityId, true);
        if (current.description.trim().length < 20) throw new BadRequestException('Description is too short');
        await this.benefits?.publish(jobId, tx);
      }
      const updated = await tx.jobPost.update({
        where: { id: jobId },
        data: {
          status,
          publishedAt: status === 'PUBLISHED' ? current.publishedAt ?? new Date() : current.publishedAt,
          closedAt: status === 'CLOSED' ? new Date() : current.status === 'CLOSED' ? null : current.closedAt,
          fingerprint: current.fingerprint ?? jobFingerprint({ title: current.title, workMode: current.workMode, cityId: current.cityId }),
          contentHash: current.contentHash ?? contentHash(current.description),
        },
        include: this.jobInclude,
      });
      if (adminAudit) {
        await tx.auditLog.create({
          data: {
            actorId: adminAudit.actorId,
            action: 'FORCE_JOB_STATUS',
            entityType: 'JobPost',
            entityId: jobId,
            metadata: { status, ...(adminAudit.bulk ? { bulk: true } : {}) },
          },
        });
      }
      if (linkedinPreviewId) await this.linkedin!.enqueueApproved(tx, user, jobId, linkedinPreviewId);
      if (status !== 'PUBLISHED') await this.linkedin?.cancelForJob(tx, jobId);
      return { changed: true, updated };
    }, { maxWait: 10_000, timeout: 15_000 });
    const updated = result.updated;
    if (!result.changed) return this.withResolvedIcons(updated);

    if (status === 'PUBLISHED' && !job.publishedAt) {
      for (const follower of updated.isAnonymous ? [] : job.company.followers) {
        try {
          await this.notifications.create({
            userId: follower.userId,
            type: 'NEW_JOB_MATCH',
            title: `New job at ${job.company.name}`,
            body: updated.title,
            titleKey: 'notify.newJobAtCompany.title',
            params: { company: job.company.name },
            linkUrl: `/jobs/${updated.id}`,
          });
        } catch (err) {
          this.logger.warn(`New job notification failed: ${(err as Error).message}`);
        }
      }
      // First publish only: pausing and resuming must not spam the channel.
      if (!job.publishedAt) {
        void this.telegram
          .announceJob({
            id: updated.id,
            title: updated.title,
            locale: updated.locale,
            companyName: displayCompanyName(updated, updated.company.name, updated.locale),
            cityName: updated.city?.name ?? updated.country?.name ?? null,
            workMode: updated.workMode,
            employmentType: updated.employmentType,
            salaryMin: updated.salaryMin,
            salaryMax: updated.salaryMax,
            currency: updated.currency,
            skills: updated.jobSkills.map((js) => js.skill.name),
          })
          .catch(() => undefined);
      }
    }

    void this.jobsSearch.syncJob(jobId);
    return this.withResolvedIcons(updated);
  }

  withResolvedIcons<T extends {
    category?: { slug?: string; icon?: string | null } | null;
    benefits?: Array<{ benefit?: { slug?: string; icon?: string | null } | null }>;
  }>(job: T): T {
    return {
      ...job,
      isHot: false,
      boostWeight: 0,
      boostUntil: null,
      category: job.category
        ? {
            ...job.category,
            icon: resolveCategoryIcon(job.category.slug, job.category.icon) || null,
          }
        : job.category,
      benefits: Array.isArray(job.benefits)
        ? job.benefits.map((jb) =>
            jb?.benefit
              ? {
                  ...jb,
                  benefit: {
                    ...jb.benefit,
                    icon: resolveBenefitIcon(jb.benefit.slug, jb.benefit.icon) || null,
                  },
                }
              : jb,
          )
        : job.benefits,
    };
  }

  private isCompanyMember(viewer: AuthUser | undefined, companyId: string) {
    if (!viewer) return false;
    if (viewer.role === 'SUPER_ADMIN') return true;
    return (viewer.memberships ?? []).some((m) => m.companyId === companyId);
  }

  private stripPrivateCompanyFields<T extends { company?: { members?: unknown } | null }>(job: T): T {
    if (!job.company || !('members' in job.company)) return job;
    const { members: _members, ...company } = job.company as {
      members?: unknown;
    } & Record<string, unknown>;
    return { ...job, company };
  }

  /** Single safe contact for employee chat — never return full members list publicly. */
  private async chatPeerUserIdForCompany(companyId: string): Promise<string | null> {
    const owner = await this.prisma.companyMember.findFirst({
      where: { companyId, role: 'OWNER' },
      select: { userId: true },
    });
    if (owner) return owner.userId;
    const admin = await this.prisma.companyMember.findFirst({
      where: { companyId, role: 'ADMIN' },
      select: { userId: true },
    });
    return admin?.userId ?? null;
  }

  async get(id: string, viewer?: AuthUser, locale: Locale = DEFAULT_LOCALE) {
    const found = await this.prisma.jobPost.findUnique({
      where: { id },
      include: this.jobInclude,
    });
    if (!found) throw new NotFoundException('Job not found');
    const job = this.withContentLocale(found, locale);

    if (job.status === 'PUBLISHED') {
      const company = await this.prisma.company.findUnique({
        where: { id: job.companyId },
        select: { isBanned: true, anonymizedAt: true },
      });
      if (!company || company.isBanned || company.anonymizedAt) {
        throw new NotFoundException('Job not found');
      }
    }

    const member = this.isCompanyMember(viewer, job.companyId);
    const benefit = await this.prisma.jobBenefit.findUnique({ where: { jobId: id } });
    if (!member && benefit?.expiresAt && benefit.expiresAt <= new Date()) throw new NotFoundException('Job expired');
    if (job.status !== 'PUBLISHED' && !member) {
      throw new NotFoundException('Job not found');
    }


    const resolved = this.withResolvedIcons(job);
    const viewerMatch = await this.matchForEmployeeViewer(viewer, id);

    if (member) {
      return viewerMatch ? { ...resolved, ...viewerMatch } : resolved;
    }

    const stripped = this.stripPrivateCompanyFields(resolved);
    // Confidential posting: the employer stays hidden until this candidate is at interview stage.
    const reveal = job.isAnonymous ? await this.viewerReachedInterview(viewer, id) : true;
    const masked = maskAnonymousCompany(stripped, locale, { reveal });
    const existingPeer = reveal && viewer?.role === 'EMPLOYEE' ? (await jobChatPeers(this.prisma,viewer.id,[{id,companyId:job.companyId}])).get(id) : null;
    const chatPeerUserId = reveal ? existingPeer || await this.chatPeerUserIdForCompany(job.companyId) : null;
    return {
      ...masked,
      chatPeerUserId,
      ...(viewerMatch || {}),
    };
  }

  private async viewerReachedInterview(viewer: AuthUser | undefined, jobId: string): Promise<boolean> {
    if (!viewer) return false;
    const application = await this.prisma.application.findFirst({
      where: { jobPostId: jobId, profile: { userId: viewer.id } },
      select: { status: true, events: anonymousRevealHistory },
    });
    return revealsAnonymousEmployer(application?.status, application?.events);
  }

  /** Minimal public fields for JobPosting JSON-LD. No JobView side effect. */
  async getSeo(id: string, locale: Locale = DEFAULT_LOCALE) {
    const found = await this.prisma.jobPost.findFirst({
      where: {
        id,
        ...liveJobWhere(),
      },
      select: {
        id: true,
        title: true,
        description: true,
        locale: true,
        translations: {
          select: { locale: true, title: true, description: true, isMachine: true },
        },
        employmentType: true,
        workMode: true,
        salaryMin: true,
        salaryMax: true,
        salaryPeriod: true,
        currency: true,
        status: true,
        publishedAt: true,
        closedAt: true,
        createdAt: true,
        isAnonymous: true,
        company: { select: { name: true, slug: true, logoUrl: true } },
        city: { select: { name: true, province: { select: { name: true, country: { select: { name: true, iso2: true } } } } } },
        country: { select: { name: true, iso2: true } },
      },
    });
    if (!found) {
      throw new NotFoundException('Job not found');
    }
    const job = this.withContentLocale(found, locale);
    const { status: _status, ...publicJob } = maskAnonymousCompany(job, locale);
    return publicJob;
  }

  /**
   * Swaps title/description for the requested language when a version exists.
   * The response also reports which language was served so the UI can badge
   * machine output and emit correct hreflang links.
   */
  private withContentLocale<
    T extends {
      title: string;
      description: string;
      locale: string;
      translations: Array<{
        locale: string;
        title: string;
        description: string;
        isMachine: boolean;
      }>;
      questions?: Array<{
        question: string;
        translations?: Array<{ locale: string; question: string; isMachine: boolean }>;
      }>;
    },
  >(job: T, locale: Locale) {
    const { translations, ...rest } = job;
    const resolved = resolveUgcContent(
      { title: rest.title, description: rest.description },
      rest.locale,
      translations.filter((translation) => !translation.isMachine),
      locale,
      `${rest.title}\n${rest.description}`,
    );
    const sourceLocale = resolved.contentLocale ?? rest.locale;
    return {
      ...rest,
      ...resolved.content,
      // Screening questions belong to the posting and follow its source language.
      ...(rest.questions
        ? { questions: rest.questions.map((q) => localizeQuestion(q, sourceLocale, locale)) }
        : {}),
      contentLocale: resolved.contentLocale,
      availableLocales: resolved.availableLocales,
    };
  }

  /** Recruiter-authored translation of a posting (create or replace). */
  async upsertTranslation(
    user: AuthUser,
    jobId: string,
    locale: Locale,
    data: {
      title: string;
      description: string;
      questions?: Array<{ id: string; question: string }>;
    },
  ) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: { company: { select: { anonymizedAt: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    this.companies.assertOpen(job.company);

    const sourceLocale = effectiveSourceLocale(job.locale, `${job.title}\n${job.description}`);
    if (sourceLocale && locale === sourceLocale) {
      throw new BadRequestException(
        'This is the language the posting was written in; edit the job itself instead',
      );
    }

    const value = {
      title: data.title,
      description: data.description,
      isMachine: false,
      sourceHash: translationSourceHash(job.title, job.description),
    };
    const saved = await this.prisma.jobPostTranslation.upsert({
      where: { jobPostId_locale: { jobPostId: jobId, locale } },
      update: value,
      create: { jobPostId: jobId, locale, ...value },
    });
    if (data.questions?.length) {
      await this.upsertQuestionTranslations(jobId, locale, data.questions);
    }
    void this.jobsSearch.syncJob(jobId);
    return saved;
  }

  /** Question wording written by the recruiter, keyed to the original question. */
  private async upsertQuestionTranslations(
    jobId: string,
    locale: Locale,
    questions: Array<{ id: string; question: string }>,
  ) {
    const owned = await this.prisma.jobQuestion.findMany({
      where: { jobPostId: jobId, id: { in: questions.map((q) => q.id) } },
      select: { id: true, question: true },
    });

    for (const question of owned) {
      const input = questions.find((q) => q.id === question.id);
      if (!input) continue;
      const value = {
        question: input.question,
        isMachine: false,
        sourceHash: translationSourceHash(question.question),
      };
      await this.prisma.jobQuestionTranslation.upsert({
        where: { questionId_locale: { questionId: question.id, locale } },
        update: value,
        create: { questionId: question.id, locale, ...value },
      });
    }
  }

  async deleteTranslation(user: AuthUser, jobId: string, locale: Locale) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);

    await this.prisma.jobPostTranslation
      .delete({ where: { jobPostId_locale: { jobPostId: jobId, locale } } })
      .catch(() => undefined);
    // Questions are part of the same language version. Leaving them behind
    // would serve Uzbek questions on a posting that reports only English.
    await this.prisma.jobQuestionTranslation.deleteMany({
      where: { locale, jobQuestion: { jobPostId: jobId } },
    });
    void this.jobsSearch.syncJob(jobId);
    return { ok: true };
  }

  /** Every stored language of a posting, for the recruiter editor. */
  async listTranslations(user: AuthUser, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: {
        translations: {
          where: { isMachine: false },
          select: { locale: true, title: true, description: true },
        },
        questions: {
          where: { archivedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            question: true,
            translations: {
              where: { isMachine: false },
              select: { locale: true, question: true },
            },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);

    return {
      sourceLocale:
        effectiveSourceLocale(job.locale, `${job.title}\n${job.description}`) ?? job.locale,
      source: { title: job.title, description: job.description },
      translations: job.translations,
      questions: job.questions,
    };
  }

  /** Read-only endpoint; opening application explanations must not record a JobView. */
  async employeeInsights(user:AuthUser, jobPostId:string) {
    const job = await this.prisma.jobPost.findFirst({where:{id:jobPostId,company:{isBanned:false,anonymizedAt:null},
      OR:[liveJobWhere(),{status:'CLOSED',applications:{some:{profile:{userId:user.id}}}}]},select:{id:true}});
    if (!job) throw new NotFoundException('Job not found');
    return await this.matchForEmployeeViewer(user,jobPostId) ?? {matchInsights:null};
  }

  /** Live match for logged-in employees (pre-apply job detail breakdown). */
  private async matchForEmployeeViewer(viewer: AuthUser | undefined, jobPostId: string) {
    if (!viewer || (viewer.role !== 'EMPLOYEE' && viewer.role !== 'SUPER_ADMIN')) {
      return null;
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: viewer.id },
      select: { id: true },
    });
    if (!profile) return null;
    try {
      const evaluation = await this.employeeMatching.forJob(profile.id, jobPostId);
      return evaluation ? { matchScore:evaluation.score, matchInsights:evaluation.insights } : null;
    } catch {
      return null;
    }
  }

  async listMine(user: AuthUser, companyId: string) {
    await this.companies.assertMember(user, companyId);
    const rows = await this.prisma.jobPost.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        benefit: { select: { code: true, selectionConfirmedAt: true, expiresAt: true } },
        city: true,
        country: true,
        category: true,
        jobSkills: { include: { skill: true } },
        jobLanguages: { include: { language: true } },
        // Source-language wording: the owner edits what they wrote, not a translation.
        questions: {
          where: { archivedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            question: true,
            type: true,
            isRequired: true,
            sortOrder: true,
            _count: { select: { answers: true } },
          },
        },
        _count: { select: { applications: true, views: true } },
      },
    });
    const counts=await this.prisma.$queryRaw<Array<{jobId:string;count:number}>>(Prisma.sql`SELECT s."jobId",COUNT(*)::int count FROM "JobEvent" e JOIN "JobFunnelSession" s ON s.id=e."sessionId" JOIN "JobPost" j ON j.id=s."jobId" WHERE j."companyId"=${companyId} AND e.kind='DETAIL_VIEW' GROUP BY s."jobId"`);
    const views=new Map(counts.map(row=>[row.jobId,row.count]));
    return rows.map(job=>this.withResolvedIcons({...job,status:job.benefit?.expiresAt&&job.benefit.expiresAt<=new Date()&&['PUBLISHED','PAUSED'].includes(job.status)?'EXPIRED':job.status,_count:{...job._count,views:views.get(job.id)||0}}));
  }

  async search(query: {
    q?: string;
    country?: string;
    city?: string;
    category?: string;
    company?: string;
    companySlug?: string;
    industrySlug?: string;
    jobTitle?: string;
    employmentType?: string;
    workMode?: string;
    experienceLevel?: string;
    skills?: string;
    skillMode?: 'AND' | 'OR';
    benefits?: string;
    languages?: string;
    salaryMin?: number;
    salaryMax?: number;
    experienceYearsMax?: number;
    postedWithin?: '24h' | '7d' | '30d';
    hotOnly?: boolean;
    sort?: 'relevance' | 'newest' | 'salary_high' | 'salary_low' | 'experience' | 'match';
    page: number;
    limit: number;
    profileId?: string;
    locale?: Locale;
  }) {
    const locale = query.locale ?? DEFAULT_LOCALE;
    const and: Prisma.JobPostWhereInput[] = [liveJobWhere()];

    const citySlugs = (query.city || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (citySlugs.length) and.push({ city: { slug: { in: citySlugs } } });
    const countrySlugs = (query.country || '').split(',').map(value => value.trim()).filter(Boolean);
    if (countrySlugs.length) and.push({ OR: [
      { country: { slug: { in: countrySlugs } } },
      { countryId: null, city: { province: { country: { slug: { in: countrySlugs } } } } },
    ] });

    const categorySlugs = (query.category || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (categorySlugs.length) and.push({ category: { slug: { in: categorySlugs } } });

    const jobTitleSlugs = (query.jobTitle || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (jobTitleSlugs.length) {
      and.push({ jobTitle: { slug: { in: jobTitleSlugs } } });
    }

    if (query.company) {
      and.push({ isAnonymous: false, company: { name: { contains: query.company, mode: 'insensitive' } } });
    }
    const companySlugs = (query.companySlug || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (companySlugs.length) {
      and.push({ isAnonymous: false, company: { slug: { in: companySlugs } } });
    }
    const industrySlugs = (query.industrySlug || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (industrySlugs.length) {
      and.push({ company: { industry: { slug: { in: industrySlugs } } } });
    }
    if (query.employmentType) and.push({ employmentType: query.employmentType as never });
    if (query.workMode) and.push({ workMode: query.workMode as never });

    const expLevels = (query.experienceLevel || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (expLevels.length) and.push({ experienceLevel: { in: expLevels as never[] } });

    if (query.salaryMin !== undefined) {
      and.push({
        OR: [{ salaryMax: { gte: query.salaryMin } }, { salaryMin: { gte: query.salaryMin } }],
      });
    }
    if (query.salaryMax !== undefined) {
      and.push({
        OR: [
          { salaryMin: { lte: query.salaryMax } },
          { AND: [{ salaryMin: null }, { salaryMax: { lte: query.salaryMax } }] },
          { salaryMax: { lte: query.salaryMax } },
        ],
      });
    }

    if (query.experienceYearsMax !== undefined) {
      and.push({
        OR: [
          { experienceYearsMin: null },
          { experienceYearsMin: { lte: query.experienceYearsMax } },
        ],
      });
    }

    const skillSlugs = (query.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (skillSlugs.length) {
      if (query.skillMode === 'AND') {
        for (const slug of skillSlugs) {
          and.push({ jobSkills: { some: { skill: { slug } } } });
        }
      } else {
        and.push({ jobSkills: { some: { skill: { slug: { in: skillSlugs } } } } });
      }
    }

    const benefitSlugs = (query.benefits || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (benefitSlugs.length) {
      and.push({ benefits: { some: { benefit: { slug: { in: benefitSlugs } } } } });
    }

    const languageTokens = parseLanguagesCsv(query.languages);
    if (languageTokens.length) {
      and.push({
        OR: languageTokens.map((token) => ({
          jobLanguages: {
            some: {
              provenance:'EMPLOYER_CONFIRMED',
              language: { code: token.code },
              minLevel: { in: levelsAtOrAbove(token.minLevel) as LanguageLevel[] },
            },
          },
        })),
      });
    }

    // Legacy hotOnly URLs are accepted without filtering.

    if (query.postedWithin) {
      const hours = query.postedWithin === '24h' ? 24 : query.postedWithin === '7d' ? 168 : 720;
      and.push({ publishedAt: { gte: new Date(Date.now() - hours * 3_600_000) } });
    }

    let meiliTrusted = false;
    let rankedIds: string[] | null = null;
    const sort = query.sort ?? 'relevance';
    if (sort !== 'match') {
      const eligible = await this.prisma.jobPost.findMany({ where: { AND: and }, select: { id: true } });
      rankedIds = await this.jobsSearch.rankedIds(query.q?.trim() ?? '', eligible.map(job => job.id));
      if (rankedIds?.length) { and.push({ id: { in: rankedIds } }); meiliTrusted = true; }
      else rankedIds = null;
    }
    if (!meiliTrusted && query.q?.trim()) for (const term of query.q.trim().split(/\s+/)) and.push(jobKeywordOr(term));

    const where: Prisma.JobPostWhereInput = { AND: and };
    const limit = query.limit;

    const needsInMemoryRank = sort === 'match';


    const jobInclude = {
      translations: {
        select: { locale: true, title: true, description: true, isMachine: true },
      },
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
        },
      },
      city: true,
      country: true,
      category: true,
      jobTitle: { select: { id: true, name: true, nameUz: true, nameRu: true, nameId: true, slug: true } },
      jobSkills: { include: { skill: true }, take: 8 },
      jobLanguages: { include: { language: true }, take: 4 },
      benefits: { include: { benefit: true }, take: 6 },
    } as const;

    const dbOrderBy =
      sort === 'newest'
        ? ([{ publishedAt: 'desc' }, { createdAt: 'desc' }] as const)
        : sort === 'salary_high'
          ? ([{ salaryMax: 'desc' }, { salaryMin: 'desc' }] as const)
          : sort === 'salary_low'
            ? ([{ salaryMin: 'asc' }, { salaryMax: 'asc' }] as const)
            : sort === 'experience'
              ? ([{ experienceYearsMin: 'asc' }, { publishedAt: 'desc' }] as const)
              : ([{ publishedAt: 'desc' }] as const);

    const matchedTotal = await this.prisma.jobPost.count({ where });
    if (query.q?.trim() && !meiliTrusted && this.jobsSearch.enabled && matchedTotal > 0) {
      this.jobsSearch.reindexInBackground();
    }
    let page = Math.max(1, query.page);
    let truncated = false;
    let total = matchedTotal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sorted: any[] = [];

    if (!needsInMemoryRank) {
      const totalPages = Math.max(1, Math.ceil(matchedTotal / limit) || 1);
      page = Math.min(page, matchedTotal === 0 ? 1 : totalPages);
      if (sort === 'relevance' && !rankedIds) {
        const eligible = await this.prisma.jobPost.findMany({ where, select: { id: true } });
        const now = new Date();
        const promoted = (await this.benefits?.enabled() ?? false) && (await this.benefits?.enabled('hr_promotions') ?? false);
        const exposure=await loadExposurePolicy(this.prisma);
        const q = query.q?.trim() ?? '';
        const ranked = eligible.length ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT j.id FROM "JobPost" j LEFT JOIN "JobBenefit" b ON b."jobId"=j.id
          LEFT JOIN LATERAL (SELECT * FROM "BoostEpisode" WHERE "benefitId"=b.id AND "startsAt" <= ${now} AND "endsAt">${now} ORDER BY "startsAt" DESC LIMIT 1) e ON true
          WHERE j.id = ANY(${eligible.map(job => job.id)}::text[])
          ORDER BY CASE WHEN ${q}='' THEN 0 WHEN lower(j.title)=lower(${q}) THEN 2 WHEN j.title ILIKE ${q + '%'} THEN 1 ELSE 0 END DESC,
          EXTRACT(EPOCH FROM COALESCE(j."publishedAt",j."createdAt"))/${exposure.halfLifeDays*86400}*ln(2.0) +
          ln(LEAST(${exposure.cap},(CASE WHEN ${promoted} THEN COALESCE((b."policySnapshot"->>'visibility')::float,1) ELSE 1 END)*
          (1+CASE WHEN ${promoted} AND e.id IS NOT NULL THEN ${exposure.boostAmplitude}*GREATEST(0,LEAST(1,EXTRACT(EPOCH FROM(e."endsAt"-${now}))/EXTRACT(EPOCH FROM(e."endsAt"-e."startsAt")))) ELSE 0 END))) DESC,j.id ASC
          OFFSET ${(page-1)*limit} LIMIT ${limit}`) : [];
        rankedIds = ranked.map(job => job.id);
      } else if (sort === 'relevance' && rankedIds) rankedIds = rankedIds.slice((page-1)*limit,page*limit);
      const items = await this.prisma.jobPost.findMany({
        where: sort === 'relevance' ? { AND: [where, { id: { in: rankedIds ?? [] } }] } : where,
        include: jobInclude,
        ...(sort === 'relevance' ? {} : { skip: (page - 1) * limit, take: limit }),
        orderBy: [...dbOrderBy] as Prisma.JobPostOrderByWithRelationInput[],
      });
      if (sort === 'relevance' && rankedIds) items.sort((a,b) => rankedIds!.indexOf(a.id)-rankedIds!.indexOf(b.id));
      sorted = items.map((job) => ({
        ...job,
        rankScore: this.computeRankScore({
          ...job,
          skillCount: job.jobSkills.length,
        }),
        isHot: false,
        boostWeight: 0,
        boostUntil: null,
        matchScore: null as number | null,
      }));

      if (query.profileId) {
        const scores = await this.employeeMatching.scoreJobsForProfile(query.profileId, sorted.map(job => job.id));
        sorted = sorted.map(job => ({ ...job, matchScore: scores.get(job.id)?.score ?? null, matchInsights:scores.get(job.id)?.insights }));
      }

    } else {
      truncated = false;
      const items: Prisma.JobPostGetPayload<{ include: typeof jobInclude }>[] = [];
      {
        let cursor: string | undefined;
        while (true) {
          const batch = await this.prisma.jobPost.findMany({ where, include: jobInclude, take: 100,
            orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
          items.push(...batch);
          if (batch.length < 100) break;
          cursor = batch[batch.length - 1].id;
        }
      }

      let withScore = items.map((job) => ({
        ...job,
        rankScore: this.computeRankScore({
          ...job,
          skillCount: job.jobSkills.length,
        }),
        isHot: false,
        boostWeight: 0,
        boostUntil: null,
        matchScore: null as number | null,
      }));

      if (query.profileId) {
        const scores = await this.employeeMatching.scoreJobsForProfile(query.profileId, withScore.map(job => job.id));
        withScore = withScore.map(job => ({ ...job, matchScore: scores.get(job.id)?.score ?? null, matchInsights:scores.get(job.id)?.insights,
          employeeCore:scores.get(job.id)?.positiveCore ?? false }));
      }

      withScore =
        sort === 'match'
          ? withScore.sort((a, b) => Number((b as typeof b & {employeeCore?:boolean}).employeeCore ?? false) - Number((a as typeof a & {employeeCore?:boolean}).employeeCore ?? false)
            || ((a as typeof a & {employeeCore?:boolean}).employeeCore ? (b.matchScore ?? 0) - (a.matchScore ?? 0) : 0)
            || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))
          : withScore.sort((a, b) => b.rankScore - a.rankScore);

      // Paginate the ranked window only — never advertise pages beyond what we ranked.
      total = withScore.length;
      const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
      page = Math.min(page, total === 0 ? 1 : totalPages);
      sorted = withScore.slice((page - 1) * limit, page * limit);
    }

    // Facet counts on the full filtered set (without pagination)
    const facetJobs = await this.prisma.jobPost.findMany({
      where,
      select: {
        cityId: true,
        categoryId: true,
        jobTitleId: true,
        experienceLevel: true,
        isAnonymous: true,
        // archivedAt comes along so an archived term can be left out of the
        // facet options while the postings that use it still render normally.
        city: { select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true } },
        category: {
          select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
        },
        jobTitle: {
          select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
        },
        company: {
          select: {
            slug: true,
            name: true,
            logoUrl: true,
            industry: {
              select: {
                slug: true,
                name: true,
                nameUz: true,
                nameRu: true, nameId: true,
                archivedAt: true,
                group: { select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true } },
              },
            },
          },
        },
        jobSkills: {
          select: {
            skill: {
              select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
            },
          },
        },
        jobLanguages: {
          select: {
            provenance:true,
            language: {
              select: { code: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
            },
          },
        },
      },
    });

    type Facet = {
      slug: string;
      name: string;
      nameUz?: string | null;
      nameRu?: string | null;
      nameId?: string | null;
      count: number;
    };
    const cityFacets: Record<string, Facet> = {};
    const categoryFacets: Record<string, Facet> = {};
    const jobTitleFacets: Record<string, Facet> = {};
    const companyFacets: Record<
      string,
      { slug: string; name: string; logoUrl?: string | null; count: number }
    > = {};
    const industryFacets: Record<
      string,
      Facet & { groupSlug?: string; groupName?: string }
    > = {};
    const skillFacets: Record<string, Facet> = {};
    const languageFacets: Record<
      string,
      { code: string; name: string; nameUz?: string | null; nameRu?: string | null; nameId?: string | null; count: number }
    > = {};
    const experienceFacets: Record<string, number> = {};
    for (const j of facetJobs) {
      if (j.city && !j.city.archivedAt) {
        const key = j.city.slug;
        cityFacets[key] = cityFacets[key]
          ? { ...cityFacets[key], count: cityFacets[key].count + 1 }
          : { slug: j.city.slug, name: j.city.name, nameUz: j.city.nameUz, nameRu: j.city.nameRu, nameId: j.city.nameId, count: 1 };
      }
      if (j.category && !j.category.archivedAt) {
        const key = j.category.slug;
        categoryFacets[key] = categoryFacets[key]
          ? { ...categoryFacets[key], count: categoryFacets[key].count + 1 }
          : {
              slug: j.category.slug,
              name: j.category.name,
              nameUz: j.category.nameUz,
              nameRu: j.category.nameRu, nameId: j.category.nameId,
              count: 1,
            };
      }
      if (j.jobTitle && !j.jobTitle.archivedAt) {
        const key = j.jobTitle.slug;
        jobTitleFacets[key] = jobTitleFacets[key]
          ? { ...jobTitleFacets[key], count: jobTitleFacets[key].count + 1 }
          : {
              slug: j.jobTitle.slug,
              name: j.jobTitle.name,
              nameUz: j.jobTitle.nameUz,
              nameRu: j.jobTitle.nameRu, nameId: j.jobTitle.nameId,
              count: 1,
            };
      }
      // A company facet on a confidential posting would name the employer.
      if (j.company && !j.isAnonymous) {
        const key = j.company.slug;
        companyFacets[key] = companyFacets[key]
          ? { ...companyFacets[key], count: companyFacets[key].count + 1 }
          : {
              slug: j.company.slug,
              name: j.company.name,
              logoUrl: j.company.logoUrl,
              count: 1,
            };
        if (j.company.industry && !j.company.industry.archivedAt) {
          const ik = j.company.industry.slug;
          industryFacets[ik] = industryFacets[ik]
            ? { ...industryFacets[ik], count: industryFacets[ik].count + 1 }
            : {
                slug: j.company.industry.slug,
                name: j.company.industry.name,
                nameUz: j.company.industry.nameUz,
                nameRu: j.company.industry.nameRu, nameId: j.company.industry.nameId,
                groupSlug: j.company.industry.group?.slug,
                groupName: j.company.industry.group?.name,
                count: 1,
              };
        }
      }
      if (j.experienceLevel) {
        experienceFacets[j.experienceLevel] = (experienceFacets[j.experienceLevel] || 0) + 1;
      }
      for (const js of j.jobSkills) {
        const sk = js.skill;
        if (!sk || sk.archivedAt) continue;
        skillFacets[sk.slug] = skillFacets[sk.slug]
          ? { ...skillFacets[sk.slug], count: skillFacets[sk.slug].count + 1 }
          : { slug: sk.slug, name: sk.name, nameUz: sk.nameUz, nameRu: sk.nameRu, nameId: sk.nameId, count: 1 };
      }
      for (const jl of j.jobLanguages) {
        if (jl.provenance !== 'EMPLOYER_CONFIRMED') continue;
        const lang = jl.language;
        if (!lang || lang.archivedAt) continue;
        languageFacets[lang.code] = languageFacets[lang.code]
          ? { ...languageFacets[lang.code], count: languageFacets[lang.code].count + 1 }
          : { code: lang.code, name: lang.name, nameUz: lang.nameUz, nameRu: lang.nameRu, nameId: lang.nameId, count: 1 };
      }
    }

    return {
      items: sorted.map((job) =>
        maskAnonymousCompany(this.withContentLocale(this.withResolvedIcons(job), locale), locale),
      ),
      total,
      matchedTotal,
      truncated,
      page,
      limit,
      sort,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
      facets: {
        cities: Object.values(cityFacets).sort((a, b) => b.count - a.count),
        categories: Object.values(categoryFacets).sort((a, b) => b.count - a.count),
        jobTitles: Object.values(jobTitleFacets).sort((a, b) => b.count - a.count),
        companies: Object.values(companyFacets).sort((a, b) => b.count - a.count),
        industries: Object.values(industryFacets).sort((a, b) => b.count - a.count),
        skills: Object.values(skillFacets).sort((a, b) => b.count - a.count),
        languages: Object.values(languageFacets).sort((a, b) => b.count - a.count),
        experienceLevels: experienceFacets,
      },
    };
  }

  async suggest(q: string) {
    if (!q || q.length < 2) return { jobs: [], companies: [], skills: [] };
    const [jobs, companies, skills] = await Promise.all([
      this.prisma.jobPost.findMany({
        where: {
          status: 'PUBLISHED',
          title: { contains: q, mode: 'insensitive' },
          company: { isBanned: false, anonymizedAt: null },
        },
        select: { id: true, title: true },
        take: 5,
      }),
      this.prisma.company.findMany({
        where: { name: { contains: q, mode: 'insensitive' }, isBanned: false },
        select: { id: true, name: true, slug: true },
        take: 5,
      }),
      this.prisma.skill.findMany({
        where: {
          ...ACTIVE_CATALOG,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 8,
      }),
    ]);
    return { jobs, companies, skills };
  }

  async getStats(user: AuthUser, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);
    return this.analytics.summary(user, job.companyId, jobId);
  }

  /** Same shape as per-job stats, across every posting of the company. */
  async getCompanyStats(user: AuthUser, companyId: string) {
    await this.companies.assertMember(user, companyId);
    return this.analytics.summary(user, companyId);
  }

  async recommendedForUser(user: AuthUser, locale: Locale = DEFAULT_LOCALE, page?: number, limit = 24) {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) return page ? { items:[],page:1,limit,total:0,totalPages:1,mode:'LATEST' } : [];
    const result = await this.employeeMatching.recommend(profile.id,page ?? 1,limit);
    const items = result.items.map((row) => ({
      ...row,
      job: maskAnonymousCompany(this.withResolvedIcons(row.job), locale),
    }));
    return page ? { ...result,items } : items;
  }

  async recommendedCandidates(user: AuthUser, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);
    if (job.status === 'DRAFT' || !job.publishedAt) throw new BadRequestException('Publish this job before ranking candidates');
    return this.matching.recommendCandidates(jobId);
  }

  async duplicate(user: AuthUser, jobId: string) {
    const source = await this.prisma.jobPost.findUnique({ where: { id: jobId }, include: { jobSkills: { include: { skill: true } }, benefits: { include: { benefit: true } }, jobLanguages: { include: { language: true } }, questions: { where: { archivedAt: null } }, city: true, category: true } });
    if (!source) throw new NotFoundException();
    await this.companies.assertMember(user, source.companyId, ['OWNER','ADMIN','RECRUITER']);
    const benefit = await this.prisma.jobBenefit.findUnique({ where: { jobId } });
    if (!['CLOSED','EXPIRED'].includes(source.status) && !(benefit?.expiresAt && benefit.expiresAt <= new Date())) throw new ConflictException('Close the original job before copying it');
    const job = await this.prisma.$transaction(async db => {
      await db.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id=${source.companyId} FOR UPDATE`);
      const created = await this.createInside(user,source.companyId,{ ...source, citySlug: source.city?.slug, categorySlug: source.category?.slug, skills: source.jobSkills.map(row=>({name:row.skill.name,isRequired:row.isRequired,weight:row.weight,minLevel:row.minLevel})), benefits: source.benefits.map(row=>({name:row.benefit.name})), languages:source.jobLanguages.map(row=>({code:row.language.code,minLevel:row.minLevel,isRequired:row.isRequired,confirmed:row.provenance==='EMPLOYER_CONFIRMED'})) },db);
      if (!created) throw new NotFoundException();
      await this.syncQuestions(created.id,source.questions.map(({question,type,isRequired,sortOrder})=>({question,type,isRequired,sortOrder})),db);
      return this.withResolvedIcons(await db.jobPost.findUniqueOrThrow({ where: { id: created.id }, include: this.jobInclude }));
    },{timeout:30000});
    return job;
  }

  // Screening questions
  async listQuestions(jobId: string, viewer?: AuthUser, locale: Locale = DEFAULT_LOCALE) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    const member = this.isCompanyMember(viewer, job.companyId);
    if (!member && !(await this.prisma.jobPost.findFirst({where:{id:jobId,...liveJobWhere()},select:{id:true}}))) throw new NotFoundException('Job not found');
    const questions = await this.prisma.jobQuestion.findMany({
      where: { jobPostId: jobId, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { translations: { select: { locale: true, question: true, isMachine: true } } },
    });
    const sourceLocale =
      effectiveSourceLocale(job.locale, `${job.title}\n${job.description}`) ?? job.locale;
    return questions.map((q) => localizeQuestion(q, sourceLocale, locale));
  }

  async addQuestion(
    user: AuthUser,
    jobId: string,
    data: { question: string; type?: string; isRequired?: boolean; sortOrder?: number },
  ) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    return this.prisma.$transaction(async db=>{
    await db.$queryRaw(Prisma.sql`SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
    if (await db.jobQuestion.count({ where: { jobPostId: jobId, archivedAt: null } }) >= 20)
      throw new BadRequestException('A job can have at most 20 screening questions');
    const question=await db.jobQuestion.create({
      data: {
        jobPostId: jobId,
        question: data.question,
        type: (data.type as never) || 'TEXT',
        isRequired: data.isRequired ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    await db.jobQuestionVersion.create({data:{questionId:question.id,revision:1,snapshot:JSON.parse(JSON.stringify(question))}});
    await db.$executeRaw(Prisma.sql`UPDATE "JobPost" SET "updatedAt"=GREATEST(clock_timestamp(),"updatedAt" + INTERVAL '1 millisecond') WHERE id=${jobId}`);
    return question;
    });
  }

  async updateQuestion(
    user: AuthUser,
    jobId: string,
    questionId: string,
    data: { question?: string; type?: string; isRequired?: boolean; sortOrder?: number },
  ) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    return this.prisma.$transaction(async db => {
      await db.$queryRaw(Prisma.sql`SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
      const existing = await db.jobQuestion.findFirst({ where: { id: questionId, jobPostId: jobId, archivedAt: null } });
      if (!existing) throw new NotFoundException('Question not found');
      await db.jobQuestionVersion.upsert({ where: { questionId_revision: { questionId, revision: existing.revision } }, create: { questionId, revision: existing.revision, snapshot: JSON.parse(JSON.stringify(existing)) }, update: {} });
      const updated = await db.jobQuestion.update({ where: { id: questionId }, data: { ...data, type: data.type as never, revision: { increment: 1 } } });
      await db.jobQuestionVersion.create({ data: { questionId, revision: updated.revision, snapshot: JSON.parse(JSON.stringify(updated)) } });
      if (data.question !== undefined && data.question !== existing.question) await db.jobQuestionTranslation.deleteMany({ where: { questionId } });
      await db.$executeRaw(Prisma.sql`UPDATE "JobPost" SET "updatedAt"=GREATEST(clock_timestamp(),"updatedAt" + INTERVAL '1 millisecond') WHERE id=${jobId}`);
      return updated;
    });
  }

  async removeQuestion(user: AuthUser, jobId: string, questionId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    await this.prisma.$transaction(async db => {
      await db.$queryRaw(Prisma.sql`SELECT id FROM "JobPost" WHERE id=${jobId} FOR UPDATE`);
      await db.jobQuestion.updateMany({ where: { id: questionId, jobPostId: jobId }, data: { archivedAt: new Date() } });
      await db.$executeRaw(Prisma.sql`UPDATE "JobPost" SET "updatedAt"=GREATEST(clock_timestamp(),"updatedAt" + INTERVAL '1 millisecond') WHERE id=${jobId}`);
    });
    return { ok: true };
  }
}
