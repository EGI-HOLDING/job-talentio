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
          phone: null,
          phoneVerifiedAt: null,
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
      await tx.linkedInOAuthState.deleteMany({ where: { userId } });
      await tx.linkedInConnection.updateMany({ where: { userId }, data: { status: 'DISCONNECTED', autoShareEnabled: false, tokenCiphertext: null, tokenKeyVersion: null, tokenExpiresAt: null, subject: null, authorUrn: null, displayName: null, avatarUrl: null, generation: { increment: 1 }, disconnectedAt: new Date() } });
      await tx.linkedInSocialPost.updateMany({ where: { userId, status: { in: ['PENDING', 'RENDERING', 'UPLOADING'] } }, data: { status: 'CANCELLED', errorCode: 'ACCOUNT_REMOVED', errorSummary: 'The account was removed.' } });
      await tx.linkedInSocialPost.updateMany({ where: { userId, status: 'PUBLISHING' }, data: { status: 'UNKNOWN', retrySafe: false, errorCode: 'ACCOUNT_REMOVED_DURING_PUBLISH', errorSummary: 'The account was removed while a posting request was in flight.' } });
      // These records can contain saved searches, candidate names, and message
      // text. Preserve unrelated company history while removing this user's data.
      await tx.jobAlert.deleteMany({ where: { userId } });
      await tx.companyFollower.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      // Chat notifications delivered to the other participant include the
      // sender's name in their parameters and point back to this user.
      await tx.notification.deleteMany({
        where: { type: 'CHAT_MESSAGE', linkUrl: { contains: `peer=${userId}` } },
      });
      await tx.savedJob.deleteMany({ where: { profile: { userId } } });
      await tx.chatMessage.updateMany({
        where: { senderId: userId },
        data: { body: 'Message removed' },
      });
      await tx.bulkCampaignRecipient.updateMany({
        where: { userId },
        data: { candidateName: ANONYMIZED_DISPLAY_NAME, errorMessage: null },
      });
      await tx.companyMember.deleteMany({ where: { userId } });

      if (!profile) return;

      const applications = await tx.application.findMany({
        where: { profileId: profile.id },
        select: { id: true, status: true },
      });
      for (const application of applications) {
        const withdraw = (OPEN_APPLICATION_STATUSES as readonly string[]).includes(
          application.status,
        );
        await tx.application.update({
          where: { id: application.id },
          data: {
            ...(withdraw ? { status: 'WITHDRAWN' as const } : {}),
            coverLetter: null,
            resumeSnapshot: { anonymized: true },
            matchScore: null,
            matchBreakdown: Prisma.DbNull,
            answers: { deleteMany: {} },
            interviews: { deleteMany: {} },
            events: {
              updateMany: { where: {}, data: { note: null } },
              ...(withdraw
                ? {
                    create: {
                      fromStatus: application.status,
                      toStatus: 'WITHDRAWN',
                      note: 'Candidate account deleted',
                    },
                  }
                : {}),
            },
          },
        });
      }

      await tx.employeeProfile.update({
        where: { id: profile.id },
        data: {
          headline: null,
          summary: null,
          phone: null,
          desiredPosition: null,
          desiredPositions: [],
          preferredCountries: { set: [] },
          residenceCountryId: null,
          onboardingDraft: Prisma.DbNull,
          desiredSalaryMin: null,
          cityId: null,
          contentLocale: null,
          visibility: 'PRIVATE',
          bulkCommsOptOut: false,
          bulkCommsOptOutAt: null,
        },
      });
      await tx.employeeProfileTranslation.deleteMany({ where: { profileId: profile.id } });
      await tx.profileSkill.deleteMany({ where: { profileId: profile.id } });
      await tx.profileLanguage.deleteMany({ where: { profileId: profile.id } });
      await tx.workExperience.deleteMany({ where: { profileId: profile.id } });
      await tx.education.deleteMany({ where: { profileId: profile.id } });
      await tx.certification.deleteMany({ where: { profileId: profile.id } });
      for (const resume of resumes) {
        await tx.resume.update({
          where: { id: resume.id },
          data: {
            title: 'Removed',
            targetJobTitleId: null,
            fileKey: null,
            fileUrl: null,
            content: null,
            parsedData: Prisma.DbNull,
            parseError: null,
            parseStatus: 'NONE',
            builderMeta: Prisma.DbNull,
            isPrimary: false,
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
