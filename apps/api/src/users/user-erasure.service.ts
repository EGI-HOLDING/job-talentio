import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ANONYMIZED_DISPLAY_NAME,
  eraseBlockedByOpenCompany,
  type OpenOwnedCompany,
} from './erasure-guards';

const OPEN_APPLICATION_STATUSES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER'] as const;

@Injectable()
export class UserErasureService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async findOpenOwnedCompany(userId: string): Promise<OpenOwnedCompany | null> {
    const membership = await this.prisma.companyMember.findFirst({
      where: { userId, role: 'OWNER', company: { anonymizedAt: null } },
      select: {
        company: {
          select: {
            id: true,
            name: true,
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!membership) return null;
    return {
      companyId: membership.company.id,
      companyName: membership.company.name,
      memberCount: membership.company._count.members,
    };
  }

  assertCanErase(owned: OpenOwnedCompany | null) {
    const blocked = eraseBlockedByOpenCompany(owned);
    if (blocked) throw new ConflictException(blocked);
  }

  async erase(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarUrl: true, anonymizedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.anonymizedAt) {
      throw new BadRequestException('Account already anonymized');
    }

    this.assertCanErase(await this.findOpenOwnedCompany(userId));

    const avatarKey = this.storage.keyFromPublicUrl(user.avatarUrl);
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const resumes = profile
      ? await this.prisma.resume.findMany({
          where: { profileId: profile.id },
          select: { id: true, fileKey: true },
        })
      : [];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null,
          passwordHash: null,
          googleId: null,
          telegramId: null,
          avatarUrl: null,
          fullName: ANONYMIZED_DISPLAY_NAME,
          emailVerified: false,
          isBanned: true,
          anonymizedAt: new Date(),
        },
      });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.emailChangeToken.deleteMany({ where: { userId } });
      await tx.telegramLinkToken.deleteMany({ where: { userId } });
      await tx.jobAlert.updateMany({ where: { userId }, data: { isActive: false } });
      await tx.companyMember.deleteMany({ where: { userId } });

      if (!profile) return;

      await tx.application.updateMany({
        where: {
          profileId: profile.id,
          status: { in: [...OPEN_APPLICATION_STATUSES] },
        },
        data: { status: 'WITHDRAWN' },
      });

      await tx.employeeProfile.update({
        where: { id: profile.id },
        data: {
          headline: null,
          summary: null,
          phone: null,
          desiredPosition: null,
          desiredSalaryMin: null,
          cityId: null,
          contentLocale: null,
        },
      });
      await tx.employeeProfileTranslation.updateMany({
        where: { profileId: profile.id },
        data: { headline: null, summary: null },
      });
      await tx.workExperience.updateMany({
        where: { profileId: profile.id },
        data: { companyName: 'Removed', title: 'Removed', description: null, locationNote: null },
      });
      const experiences = await tx.workExperience.findMany({
        where: { profileId: profile.id },
        select: { id: true },
      });
      if (experiences.length) {
        await tx.workExperienceTranslation.updateMany({
          where: { experienceId: { in: experiences.map((e) => e.id) } },
          data: { title: 'Removed', description: null },
        });
      }
      await tx.education.updateMany({
        where: { profileId: profile.id },
        data: { school: 'Removed', field: null },
      });
      const educations = await tx.education.findMany({
        where: { profileId: profile.id },
        select: { id: true },
      });
      if (educations.length) {
        await tx.educationTranslation.updateMany({
          where: { educationId: { in: educations.map((e) => e.id) } },
          data: { field: 'Removed' },
        });
      }
      await tx.certification.updateMany({
        where: { profileId: profile.id },
        data: { name: 'Removed', issuer: null, credentialUrl: null },
      });
      for (const resume of resumes) {
        await tx.resume.update({
          where: { id: resume.id },
          data: {
            fileKey: null,
            fileUrl: null,
            content: null,
            parsedData: Prisma.DbNull,
            parseError: null,
            deletedAt: new Date(),
          },
        });
      }
    });

    if (avatarKey) {
      await this.storage.delete(avatarKey).catch(() => undefined);
    }
    for (const resume of resumes) {
      const key = (resume.fileKey || '').trim();
      if (!key) continue;
      const stillOnResume = await this.prisma.resume.count({ where: { fileKey: key } });
      if (stillOnResume) continue;
      const snapshotRefs = await this.prisma.application.count({
        where: { resumeSnapshot: { path: ['resume', 'fileKey'], equals: key } },
      });
      if (snapshotRefs) continue;
      await this.storage.delete(key).catch(() => undefined);
    }

    return { ok: true as const, id: userId };
  }
}
