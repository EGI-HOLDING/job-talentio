import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JobStatus, PlanCode, Prisma, WorkMode } from '@prisma/client';
import { PLAN_LIMITS } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify } from '../common/utils';
import {
  contentHash,
  jobFingerprint,
  normalizeJobTitle,
  titlesNearlyIdentical,
} from '../common/dedupe';

type JobSkillInput = { slug: string; isRequired?: boolean; weight?: number };

const ACTIVE_JOB_STATUSES: JobStatus[] = ['DRAFT', 'PUBLISHED', 'PAUSED'];

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private companies: CompaniesService,
    private matching: MatchingService,
    private notifications: NotificationsService,
  ) {}

  private planLimits(plan: PlanCode) {
    return PLAN_LIMITS[plan];
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
  }) {
    const fp = jobFingerprint({
      title: opts.title,
      workMode: opts.workMode,
      cityId: opts.cityId,
    });
    const hash = contentHash(opts.description);

    const sameFingerprint = await this.prisma.jobPost.findFirst({
      where: {
        companyId: opts.companyId,
        fingerprint: fp,
        status: { in: ACTIVE_JOB_STATUSES },
        ...(opts.excludeJobId ? { id: { not: opts.excludeJobId } } : {}),
      },
      select: { id: true, title: true, status: true },
    });
    if (sameFingerprint) {
      throw new ConflictException(
        `Duplicate job blocked: an active ${sameFingerprint.status} opening with the same title, work mode, and location already exists ("${sameFingerprint.title}"). Close or edit that post instead.`,
      );
    }

    const sameContent = await this.prisma.jobPost.findFirst({
      where: {
        companyId: opts.companyId,
        contentHash: hash,
        status: { in: ACTIVE_JOB_STATUSES },
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
    const candidates = await this.prisma.jobPost.findMany({
      where: {
        companyId: opts.companyId,
        status: { in: ACTIVE_JOB_STATUSES },
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

  private jobInclude = {
    company: {
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        isVerified: true,
        city: true,
        industry: true,
        subscription: { select: { plan: true } },
        members: { select: { userId: true, role: true }, take: 5 },
        _count: { select: { followers: true } },
      },
    },
    city: true,
    category: true,
    jobSkills: { include: { skill: true } },
    benefits: { include: { benefit: true } },
    questions: { orderBy: { sortOrder: 'asc' as const } },
    _count: { select: { applications: true, views: true } },
  };

  computeRankScore(job: {
    publishedAt: Date | null;
    boostWeight: number;
    boostUntil: Date | null;
    plan?: PlanCode;
    description: string;
    skillCount: number;
  }) {
    const now = Date.now();
    const published = job.publishedAt?.getTime() ?? now;
    const ageHours = Math.max(0, (now - published) / 3_600_000);
    const baseRecency = 1000;
    const freshnessDecay = Math.exp(-0.02 * ageHours) * 500;
    const hotActive = job.boostUntil && job.boostUntil.getTime() > now;
    const hotBoost = hotActive ? 2000 * (job.boostWeight || 1) : 0;
    const planBoost =
      job.plan === 'PREMIUM' ? 80 : job.plan === 'STANDARD' ? 40 : 0;
    const qualityPenalty =
      job.description.length < 80 || job.skillCount === 0 ? 120 : 0;
    return baseRecency + freshnessDecay + hotBoost + planBoost - qualityPenalty;
  }

  private async resolveCityId(slug?: string | null) {
    if (!slug) return null;
    const city = await this.prisma.city.findUnique({ where: { slug } });
    return city?.id ?? null;
  }

  private async resolveCategoryId(slug?: string | null) {
    if (!slug) return null;
    const cat = await this.prisma.jobCategory.findUnique({ where: { slug } });
    return cat?.id ?? null;
  }

  private async syncSkills(jobPostId: string, skills: JobSkillInput[]) {
    await this.prisma.jobPostSkill.deleteMany({ where: { jobPostId } });
    for (const s of skills) {
      const skill =
        (await this.prisma.skill.findUnique({ where: { slug: s.slug } })) ??
        (await this.prisma.skill.create({
          data: {
            name: s.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            slug: s.slug || slugify(s.slug),
          },
        }));
      await this.prisma.jobPostSkill.create({
        data: {
          jobPostId,
          skillId: skill.id,
          isRequired: s.isRequired ?? true,
          weight: s.weight ?? 1,
        },
      });
    }
  }

  private async syncBenefits(jobPostId: string, benefitSlugs: string[]) {
    await this.prisma.jobPostBenefit.deleteMany({ where: { jobPostId } });
    for (const slug of benefitSlugs) {
      const benefit = await this.prisma.benefit.findUnique({ where: { slug } });
      if (!benefit) continue;
      await this.prisma.jobPostBenefit.create({
        data: { jobPostId, benefitId: benefit.id },
      });
    }
  }

  async create(user: AuthUser, companyId: string, data: Record<string, unknown>) {
    await this.companies.assertMember(user, companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    const workMode = ((data.workMode as string) || 'ONSITE') as WorkMode;
    // Remote: city is optional hub/region — never invent a fake "Remote" city
    const cityId =
      workMode === 'REMOTE' && !data.citySlug
        ? null
        : await this.resolveCityId(data.citySlug as string | undefined);
    const categoryId = await this.resolveCategoryId(data.categorySlug as string | undefined);
    const title = String(data.title).trim();
    const description = String(data.description).trim();

    const hashes = await this.assertNoDuplicateJob({
      companyId,
      title,
      description,
      workMode,
      cityId,
    });

    const job = await this.prisma.jobPost.create({
      data: {
        companyId,
        title,
        description,
        cityId,
        categoryId,
        employmentType: (data.employmentType as never) || 'FULL_TIME',
        workMode,
        salaryMin: (data.salaryMin as number) ?? null,
        salaryMax: (data.salaryMax as number) ?? null,
        salaryPeriod: (data.salaryPeriod as never) || 'MONTHLY',
        currency: (data.currency as string) || 'UZS',
        experienceYearsMin: (data.experienceYearsMin as number) ?? null,
        experienceLevel: (data.experienceLevel as never) ?? null,
        locale: (data.locale as string) || 'uz',
        status: 'DRAFT',
        fingerprint: hashes.fingerprint,
        contentHash: hashes.contentHash,
      },
    });

    await this.syncSkills(job.id, (data.skills as JobSkillInput[]) || []);
    await this.syncBenefits(job.id, (data.benefitSlugs as string[]) || []);

    return this.prisma.jobPost.findUnique({
      where: { id: job.id },
      include: this.jobInclude,
    });
  }

  async update(user: AuthUser, jobId: string, data: Record<string, unknown>) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);

    const workMode = (data.workMode as WorkMode | undefined) ?? job.workMode;
    let cityId: string | null | undefined =
      data.citySlug === undefined
        ? undefined
        : await this.resolveCityId(data.citySlug as string | null);

    // Clearing city is allowed for remote; for onsite keep existing unless explicitly set
    if (workMode === 'REMOTE' && data.citySlug === '') {
      cityId = null;
    }

    const title = data.title !== undefined ? String(data.title).trim() : job.title;
    const description =
      data.description !== undefined ? String(data.description).trim() : job.description;
    const resolvedCityId = cityId === undefined ? job.cityId : cityId;

    const hashes = await this.assertNoDuplicateJob({
      companyId: job.companyId,
      title,
      description,
      workMode,
      cityId: resolvedCityId,
      excludeJobId: jobId,
    });

    if (ACTIVE_JOB_STATUSES.includes(job.status) && job.status === 'PUBLISHED') {
      this.assertLocationRules(workMode, resolvedCityId, true);
    }

    await this.prisma.jobPost.update({
      where: { id: jobId },
      data: {
        title: data.title !== undefined ? title : undefined,
        description: data.description !== undefined ? description : undefined,
        cityId,
        categoryId:
          data.categorySlug === undefined
            ? undefined
            : await this.resolveCategoryId(data.categorySlug as string | null),
        employmentType: data.employmentType as never,
        workMode: data.workMode as never,
        salaryMin: data.salaryMin as number | null | undefined,
        salaryMax: data.salaryMax as number | null | undefined,
        salaryPeriod: data.salaryPeriod as never,
        experienceYearsMin: data.experienceYearsMin as number | null | undefined,
        experienceLevel: data.experienceLevel as never,
        locale: data.locale as string | undefined,
        fingerprint: hashes.fingerprint,
        contentHash: hashes.contentHash,
      },
    });

    if (data.skills) await this.syncSkills(jobId, data.skills as JobSkillInput[]);
    if (data.benefitSlugs) await this.syncBenefits(jobId, data.benefitSlugs as string[]);

    return this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: this.jobInclude,
    });
  }

  async changeStatus(user: AuthUser, jobId: string, status: JobStatus) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobId },
      include: { company: { include: { subscription: true, followers: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);

    if (status === 'PUBLISHED') {
      this.assertLocationRules(job.workMode, job.cityId, true);

      await this.assertNoDuplicateJob({
        companyId: job.companyId,
        title: job.title,
        description: job.description,
        workMode: job.workMode,
        cityId: job.cityId,
        excludeJobId: job.id,
      });

      const plan = job.company.subscription?.plan ?? 'FREE';
      const limit = this.planLimits(plan).activeJobs;
      const active = await this.prisma.jobPost.count({
        where: { companyId: job.companyId, status: 'PUBLISHED' },
      });
      const alreadyPublished = job.status === 'PUBLISHED';
      if (!alreadyPublished && active >= limit) {
        throw new ForbiddenException(
          `Plan ${plan} allows ${limit} active published job(s). Upgrade to publish more.`,
        );
      }
    }

    const updated = await this.prisma.jobPost.update({
      where: { id: jobId },
      data: {
        status,
        publishedAt:
          status === 'PUBLISHED' ? job.publishedAt ?? new Date() : job.publishedAt,
        closedAt: status === 'CLOSED' ? new Date() : job.closedAt,
        fingerprint:
          job.fingerprint ??
          jobFingerprint({ title: job.title, workMode: job.workMode, cityId: job.cityId }),
        contentHash: job.contentHash ?? contentHash(job.description),
      },
      include: this.jobInclude,
    });

    if (status === 'PUBLISHED' && job.status !== 'PUBLISHED') {
      for (const follower of job.company.followers) {
        await this.notifications.create({
          userId: follower.userId,
          type: 'NEW_JOB_MATCH',
          title: `New job at ${job.company.name}`,
          body: updated.title,
          linkUrl: `/jobs/${updated.id}`,
        });
      }
    }

    return updated;
  }

  async get(id: string, viewerId?: string) {
    const job = await this.prisma.jobPost.findUnique({
      where: { id },
      include: this.jobInclude,
    });
    if (!job) throw new NotFoundException('Job not found');

    await this.prisma.jobView.create({
      data: { jobPostId: id, viewerId: viewerId ?? null },
    });

    return job;
  }

  async listMine(user: AuthUser, companyId: string) {
    await this.companies.assertMember(user, companyId);
    return this.prisma.jobPost.findMany({
      where: { companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        city: true,
        category: true,
        jobSkills: { include: { skill: true } },
        _count: { select: { applications: true, views: true } },
      },
    });
  }

  async search(query: {
    q?: string;
    city?: string;
    category?: string;
    company?: string;
    employmentType?: string;
    workMode?: string;
    experienceLevel?: string;
    skills?: string;
    skillMode?: 'AND' | 'OR';
    benefits?: string;
    salaryMin?: number;
    salaryMax?: number;
    experienceYearsMax?: number;
    postedWithin?: '24h' | '7d' | '30d';
    hotOnly?: boolean;
    sort?: 'relevance' | 'newest' | 'salary_high' | 'salary_low' | 'experience' | 'match';
    page: number;
    limit: number;
    profileId?: string;
  }) {
    const and: Prisma.JobPostWhereInput[] = [{ status: 'PUBLISHED' }];

    const citySlugs = (query.city || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (citySlugs.length) and.push({ city: { slug: { in: citySlugs } } });

    const categorySlugs = (query.category || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (categorySlugs.length) and.push({ category: { slug: { in: categorySlugs } } });

    if (query.company) {
      and.push({ company: { name: { contains: query.company, mode: 'insensitive' } } });
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

    if (query.hotOnly) and.push({ boostUntil: { gt: new Date() } });

    if (query.postedWithin) {
      const hours = query.postedWithin === '24h' ? 24 : query.postedWithin === '7d' ? 168 : 720;
      and.push({ publishedAt: { gte: new Date(Date.now() - hours * 3_600_000) } });
    }

    if (query.q) {
      const terms = query.q.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        and.push({
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { company: { name: { contains: term, mode: 'insensitive' } } },
            { jobSkills: { some: { skill: { name: { contains: term, mode: 'insensitive' } } } } },
            { city: { name: { contains: term, mode: 'insensitive' } } },
            { category: { name: { contains: term, mode: 'insensitive' } } },
          ],
        });
      }
    }

    const where: Prisma.JobPostWhereInput = { AND: and };
    const sort = query.sort ?? 'relevance';

    const fetchTake =
      sort === 'relevance' || sort === 'match'
        ? Math.min(300, Math.max(query.limit * 5, 80))
        : query.limit;
    const fetchSkip =
      sort === 'relevance' || sort === 'match' ? 0 : (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      this.prisma.jobPost.findMany({
        where,
        include: {
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              logoUrl: true,
              subscription: { select: { plan: true } },
            },
          },
          city: true,
          category: true,
          jobSkills: { include: { skill: true }, take: 8 },
          benefits: { include: { benefit: true }, take: 6 },
        },
        skip: fetchSkip,
        take: fetchTake,
        orderBy:
          sort === 'newest'
            ? [{ publishedAt: 'desc' }, { createdAt: 'desc' }]
            : sort === 'salary_high'
              ? [{ salaryMax: 'desc' }, { salaryMin: 'desc' }]
              : sort === 'salary_low'
                ? [{ salaryMin: 'asc' }, { salaryMax: 'asc' }]
                : sort === 'experience'
                  ? [{ experienceYearsMin: 'asc' }, { publishedAt: 'desc' }]
                  : [{ publishedAt: 'desc' }],
      }),
      this.prisma.jobPost.count({ where }),
    ]);

    let withScore = items.map((job) => ({
      ...job,
      rankScore: this.computeRankScore({
        ...job,
        plan: job.company.subscription?.plan,
        skillCount: job.jobSkills.length,
      }),
      isHot: !!(job.boostUntil && job.boostUntil.getTime() > Date.now()),
      matchScore: null as number | null,
    }));

    if ((sort === 'match' || query.profileId) && query.profileId) {
      withScore = await Promise.all(
        withScore.map(async (job) => {
          try {
            const breakdown = await this.matching.scoreProfileAgainstJob(
              query.profileId!,
              job.id,
            );
            return { ...job, matchScore: breakdown.total };
          } catch {
            return job;
          }
        }),
      );
    }

    let sorted = withScore;
    if (sort === 'relevance') {
      sorted = withScore.sort((a, b) => b.rankScore - a.rankScore);
      const start = (query.page - 1) * query.limit;
      sorted = sorted.slice(start, start + query.limit);
    } else if (sort === 'match') {
      sorted = withScore.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
      const start = (query.page - 1) * query.limit;
      sorted = sorted.slice(start, start + query.limit);
    }

    // Facet counts on the full filtered set (without pagination)
    const facetJobs = await this.prisma.jobPost.findMany({
      where,
      select: {
        cityId: true,
        categoryId: true,
        experienceLevel: true,
        city: { select: { slug: true, name: true } },
        category: { select: { slug: true, name: true } },
      },
      take: 1000,
    });

    const cityFacets: Record<string, { slug: string; name: string; count: number }> = {};
    const categoryFacets: Record<string, { slug: string; name: string; count: number }> = {};
    const experienceFacets: Record<string, number> = {};
    for (const j of facetJobs) {
      if (j.city) {
        const key = j.city.slug;
        cityFacets[key] = cityFacets[key]
          ? { ...cityFacets[key], count: cityFacets[key].count + 1 }
          : { slug: j.city.slug, name: j.city.name, count: 1 };
      }
      if (j.category) {
        const key = j.category.slug;
        categoryFacets[key] = categoryFacets[key]
          ? { ...categoryFacets[key], count: categoryFacets[key].count + 1 }
          : { slug: j.category.slug, name: j.category.name, count: 1 };
      }
      if (j.experienceLevel) {
        experienceFacets[j.experienceLevel] = (experienceFacets[j.experienceLevel] || 0) + 1;
      }
    }

    return {
      items: sorted,
      total,
      page: query.page,
      limit: query.limit,
      sort,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      facets: {
        cities: Object.values(cityFacets).sort((a, b) => b.count - a.count),
        categories: Object.values(categoryFacets).sort((a, b) => b.count - a.count),
        experienceLevels: experienceFacets,
      },
    };
  }

  async suggest(q: string) {
    if (!q || q.length < 2) return { jobs: [], companies: [], skills: [] };
    const [jobs, companies, skills] = await Promise.all([
      this.prisma.jobPost.findMany({
        where: { status: 'PUBLISHED', title: { contains: q, mode: 'insensitive' } },
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

  async activateHotJob(user: AuthUser, jobId: string, days: 7 | 14 | 30, weight = 1) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN']);
    if (job.status !== 'PUBLISHED') {
      throw new BadRequestException('Only published jobs can be boosted');
    }
    const boostUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.prisma.jobPost.update({
      where: { id: jobId },
      data: { boostWeight: weight, boostUntil },
      include: this.jobInclude,
    });
  }

  async getStats(user: AuthUser, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);

    const [views, applications] = await Promise.all([
      this.prisma.jobView.count({ where: { jobPostId: jobId } }),
      this.prisma.application.groupBy({
        by: ['status'],
        where: { jobPostId: jobId },
        _count: true,
      }),
    ]);

    return {
      views,
      applicationsByStatus: Object.fromEntries(
        applications.map((a) => [a.status, a._count]),
      ),
      totalApplications: applications.reduce((s, a) => s + a._count, 0),
    };
  }

  async recommendedForUser(user: AuthUser) {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) return [];
    return this.matching.recommendJobsForProfile(profile.id);
  }

  async recommendedCandidates(user: AuthUser, jobId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);
    return this.matching.recommendCandidates(jobId);
  }

  // Screening questions
  async listQuestions(jobId: string) {
    return this.prisma.jobQuestion.findMany({
      where: { jobPostId: jobId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async addQuestion(
    user: AuthUser,
    jobId: string,
    data: { question: string; type?: string; isRequired?: boolean; sortOrder?: number },
  ) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    return this.prisma.jobQuestion.create({
      data: {
        jobPostId: jobId,
        question: data.question,
        type: (data.type as never) || 'TEXT',
        isRequired: data.isRequired ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async removeQuestion(user: AuthUser, jobId: string, questionId: string) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    await this.prisma.jobQuestion.deleteMany({ where: { id: questionId, jobPostId: jobId } });
    return { ok: true };
  }
}
