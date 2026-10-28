import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { JobPackageCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { BenefitsService } from './benefits.service';

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
    if (company.name.trim().length < 2 || !company.description || company.description.trim().length < 20
      || !company.size || !company.city || !company.industry)
      throw new BadRequestException('COMPANY_PROFILE_REQUIRED: Complete company name, description, industry, size, country and city');
    return company;
  }
  async beforePublish(user: AuthUser, companyId: string, db: Prisma.TransactionClient) {
    if (user.role !== 'RECRUITER') return;
    const progress = await db.recruiterOnboarding.findUnique({where: {userId: user.id}});
    if (!progress || progress.status === 'IN_PROGRESS') await this.assertCompany(user, companyId, db);
  }
  async save(user: AuthUser, input: {companyId: string; jobId?: string|null; step: number; companyDraft?: Record<string,string>; preferredPackage?: JobPackageCode}) {
    return this.db.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${input.companyId} FOR UPDATE`;
      await this.benefits.member(user, input.companyId, db);
      const existing = await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: user.id}});
      if (existing.status !== 'IN_PROGRESS') throw new ConflictException('Onboarding is already complete');
      if (input.step > 1) await this.assertCompany(user, input.companyId, db);
      if (input.jobId && !await db.jobPost.findFirst({where: {id: input.jobId, companyId: input.companyId}}))
        throw new BadRequestException('Job does not belong to the selected company');
      return db.recruiterOnboarding.update({where: {userId: user.id}, data: {...input, jobId: input.jobId === undefined && existing.companyId !== input.companyId ? null : input.jobId}});
    });
  }
  async complete(user: AuthUser, skipJob: boolean) {
    return this.db.$transaction(async db => {
      const before = await db.recruiterOnboarding.findUniqueOrThrow({where: {userId: user.id}});
      if (before.status !== 'IN_PROGRESS') return before;
      if (!before.companyId) throw new BadRequestException('Choose a company first');
      await db.$queryRaw`SELECT id FROM "Company" WHERE id=${before.companyId} FOR UPDATE`;
      await db.$queryRaw`SELECT "userId" FROM "RecruiterOnboarding" WHERE "userId"=${user.id} FOR UPDATE`;
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
