import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { JobPackageCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { BenefitsService } from './benefits.service';
import { companySchema } from '@job-talentio/shared';
import { parseDto, slugify } from '../common/utils';
import { normalizeCompanyName } from '../common/dedupe';
import { resolveJobLocation } from '../common/geo-selection';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { sanitizeStoredText } from '../common/text-sanitize';

@Injectable()
export class RecruiterOnboardingService {
  constructor(private db: PrismaService, private benefits: BenefitsService) {}
  async state(user: AuthUser) {
    const progress = await this.db.recruiterOnboarding.upsert({ where: {userId: user.id},
      create: {userId: user.id}, update: {} });
    const memberships = await this.db.companyMember.findMany({where: {userId: user.id, company: {isBanned: false, anonymizedAt: null}},
      include: {company: {include: {city: {include: {province: {include: {country: true}}}}, industry: true}}} });
    return {...progress, memberships};
  }
  async assertCompany(user: AuthUser, companyId: string, db: Prisma.TransactionClient = this.db) {
    await this.benefits.member(user, companyId, db);
    const company = await db.company.findUniqueOrThrow({where: {id: companyId}, include: {city: {include: {province: {include: {country: true}}}}, industry: true}});
    if (!company.description || company.description.trim().length < 20)
      throw new BadRequestException('COMPANY_DESCRIPTION_TOO_SHORT: Company description must contain at least 20 characters');
    if (company.name.trim().length < 2
      || !company.size || !company.city || !company.industry)
      throw new BadRequestException('COMPANY_PROFILE_REQUIRED: Complete company name, description, industry, size, country and city');
    return company;
  }
  async beforePublish(user: AuthUser, companyId: string, db: Prisma.TransactionClient) {
    if (user.role !== 'RECRUITER') return;
    const progress = await db.recruiterOnboarding.findUnique({where: {userId: user.id}});
    if (!progress || progress.status === 'IN_PROGRESS') await this.assertCompany(user, companyId, db);
  }
  async save(user: AuthUser, input: {companyId?: string|null; jobId?: string|null; step: number; companyDraft?: Record<string,string>; preferredPackage?: JobPackageCode; locale?: string}) {
    return this.db.$transaction(async db => {
      await db.$queryRaw`SELECT "userId" FROM "RecruiterOnboarding" WHERE "userId"=${user.id} FOR UPDATE`;
      const existing = await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: user.id}});
      if (existing.status !== 'IN_PROGRESS') throw new ConflictException('Onboarding is already complete');
      let companyId = input.companyId || existing.companyId;
      if (!companyId && input.step > 1) {
        const data = parseDto(companySchema, {...input.companyDraft, locale: input.locale});
        const name = sanitizeStoredText(data.name).trim();
        const description = sanitizeStoredText(data.description || '').trim();
        if (description.length < 20)
          throw new BadRequestException('COMPANY_DESCRIPTION_TOO_SHORT: Company description must contain at least 20 characters');
        const normalized = normalizeCompanyName(name);
        if (!normalized || normalized.length < 2 || !data.size || !data.industrySlug || !data.citySlug || !data.countryId)
          throw new BadRequestException('COMPANY_PROFILE_REQUIRED: Complete company details');
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))::text`;
        const companies = await db.company.findMany({where: {isBanned: false}, select: {name: true}, take: 5000});
        if (companies.some(row => normalizeCompanyName(row.name) === normalized))
          throw new ConflictException('Company name already in use');
        const location = await resolveJobLocation(db, data);
        const industry = await db.industry.findFirst({where: {slug: data.industrySlug, ...ACTIVE_CATALOG}});
        if (!industry) throw new BadRequestException('Industry is not available');
        const company = await db.company.create({data: {name, description, slug: `${slugify(name) || 'company'}-${user.id}`,
          cityId: location.cityId, industryId: industry.id, size: data.size, website: data.website || null, locale: data.locale || 'uz'}});
        companyId = company.id;
        await db.companyMember.create({data: {companyId, userId: user.id, role: 'OWNER'}});
      }
      if (companyId) {
        await db.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
        await this.benefits.member(user, companyId, db);
        if (input.step > 1) await this.assertCompany(user, companyId, db);
      }
      if (input.jobId && (!companyId || !await db.jobPost.findFirst({where: {id: input.jobId, companyId}})))
        throw new BadRequestException('Job does not belong to the selected company');
      if (input.step === 3) {
        const jobId = input.jobId === undefined ? existing.jobId : input.jobId;
        if (!companyId || !jobId || !await db.jobBenefit.findFirst({where: {jobId, companyId, selectionConfirmedAt: {not: null}}}))
          throw new BadRequestException('PACKAGE_REQUIRED: Choose a package before reviewing publication');
      }
      const {locale: _locale, ...progress} = input;
      return db.recruiterOnboarding.update({where: {userId: user.id}, data: {...progress, companyId,
        jobId: input.jobId === undefined && existing.companyId !== companyId ? null : input.jobId}});
    });
  }
  async complete(user: AuthUser, skipJob: boolean) {
    return this.db.$transaction(async db => {
      await db.$queryRaw`SELECT "userId" FROM "RecruiterOnboarding" WHERE "userId"=${user.id} FOR UPDATE`;
      const before = await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: user.id}});
      if (before.status !== 'IN_PROGRESS') return before;
      if (!before.companyId) throw new BadRequestException('Choose a company first');
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      const progress = await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: user.id}});
      if (progress.status !== 'IN_PROGRESS') return progress;
      if (progress.companyId !== before.companyId) throw new ConflictException('Company changed. Refresh onboarding');
      await this.assertCompany(user, progress.companyId, db);
      if (!skipJob && (!progress.jobId || !await db.jobPost.findFirst({where: {id: progress.jobId, companyId: progress.companyId, status: 'PUBLISHED'}})))
        throw new BadRequestException('Publish your first job or choose to do it later');
      return db.recruiterOnboarding.update({where: {userId: user.id}, data: {status: 'COMPLETE', step: 3, completedAt: new Date()}});
    });
  }
}
