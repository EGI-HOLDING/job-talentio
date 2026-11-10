import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';

/** Privacy and company authorization only. Candidate access never depends on
 * a package, balance, unlock record or the packages feature flag. */
@Injectable()
export class CandidateAccessService {
  constructor(private db: PrismaService) {}

  async member(actor: AuthUser, companyId: string) {
    if (actor.isBanned || !['RECRUITER', 'SUPER_ADMIN'].includes(actor.role))
      throw new ForbiddenException('Employer access required');
    const company = await this.db.company.findUnique({ where: { id: companyId } });
    if (!company || company.isBanned || company.anonymizedAt)
      throw new ForbiddenException('Company unavailable');
    if (
      actor.role !== 'SUPER_ADMIN' &&
      !(await this.db.companyMember.findUnique({
        where: { companyId_userId: { companyId, userId: actor.id } },
      }))
    )
      throw new ForbiddenException('Company membership required');
    return company;
  }

  async context(actor: AuthUser, companyId?: string) {
    if (companyId) {
      await this.member(actor, companyId);
      return companyId;
    }
    const memberships = await this.db.companyMember.findMany({
      where: { userId: actor.id, company: { isBanned: false, anonymizedAt: null } },
      select: { companyId: true },
    });
    if (memberships.length !== 1)
      throw new BadRequestException('An explicit companyId is required');
    await this.member(actor, memberships[0].companyId);
    return memberships[0].companyId;
  }

  async candidate(actor: AuthUser, companyId: string, profileId: string) {
    await this.member(actor, companyId);
    const profile = await this.db.employeeProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { id: true, email: true, isBanned: true, anonymizedAt: true } } },
    });
    if (!profile || profile.user.isBanned || profile.user.anonymizedAt)
      throw new NotFoundException('Candidate unavailable');
    const applicant = !!(await this.db.application.findFirst({
      where: { profileId, jobPost: { companyId } },
      select: { id: true },
    }));
    return { profile, applicant };
  }

  async resume(
    actor: AuthUser,
    companyId: string,
    profileId: string,
    resumeId: string,
  ) {
    const { profile } = await this.candidate(actor, companyId, profileId);
    const resume = await this.db.resume.findFirst({
      where: { id: resumeId, profileId: profile.id, deletedAt: null, fileKey: { not: null } },
      select: { id: true, title: true, fileKey: true, isPrimary: true, updatedAt: true },
    });
    if (!resume?.fileKey) throw new NotFoundException('CV file unavailable');
    return { profile, resume };
  }
}
