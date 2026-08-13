import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { ANONYMIZED_DISPLAY_NAME, supportTargetError } from './admin-user-guards';

@Injectable()
export class AdminUsersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private storage: StorageService,
  ) {}

  private async loadTarget(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isBanned: true,
        emailVerified: true,
        anonymizedAt: true,
        createdAt: true,
        avatarUrl: true,
        passwordHash: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private assertLockoutTarget(actorId: string, target: { id: string; role: string }) {
    const blocked = supportTargetError(actorId, target);
    if (blocked) throw new ForbiddenException(blocked);
  }

  private audit(actorId: string, action: string, userId: string, metadata?: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'User',
        entityId: userId,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async banUser(actorId: string, userId: string, banned: boolean) {
    const target = await this.loadTarget(actorId, userId);
    this.assertLockoutTarget(actorId, target);
    if (target.isBanned === banned) {
      throw new BadRequestException(banned ? 'Already banned' : 'Not banned');
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isBanned: true,
        createdAt: true,
      },
    });
    if (banned) await this.auth.revokeAllSessions(userId);
    await this.audit(actorId, banned ? 'BAN_USER' : 'UNBAN_USER', userId);
    return user;
  }

  async sendPasswordReset(actorId: string, userId: string) {
    const target = await this.loadTarget(actorId, userId);
    if (target.id === actorId) {
      throw new ForbiddenException('Cannot do this to your own account');
    }
    if (target.role === 'SUPER_ADMIN' && target.passwordHash) {
      throw new ForbiddenException('Cannot do this to a super admin');
    }
    const result = await this.auth.sendPasswordResetForUser(userId, {
      allowWithoutPassword: !target.passwordHash,
    });
    await this.audit(actorId, 'ADMIN_SEND_PASSWORD_RESET', userId);
    return result;
  }

  async sendVerification(actorId: string, userId: string) {
    const target = await this.loadTarget(actorId, userId);
    this.assertLockoutTarget(actorId, target);
    const result = await this.auth.sendVerificationForUser(userId);
    await this.audit(actorId, 'ADMIN_SEND_VERIFICATION', userId);
    return result;
  }

  async revokeSessions(actorId: string, userId: string) {
    const target = await this.loadTarget(actorId, userId);
    this.assertLockoutTarget(actorId, target);
    await this.auth.revokeAllSessions(userId);
    await this.audit(actorId, 'ADMIN_REVOKE_SESSIONS', userId);
    return { ok: true as const };
  }

  async inviteOperator(actorId: string, input: { email: string; fullName: string }) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (fullName.length < 2) throw new BadRequestException('Full name is required');
    await this.auth.ensureEmailAvailable(email);

    const created = await this.prisma.user.create({
      data: {
        email,
        fullName,
        role: 'SUPER_ADMIN',
        emailVerified: false,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    });
    try {
      await this.auth.sendPasswordResetForUser(created.id, { allowWithoutPassword: true });
    } catch (err) {
      await this.prisma.user.delete({ where: { id: created.id } }).catch(() => undefined);
      throw err;
    }
    await this.audit(actorId, 'ADMIN_INVITE_OPERATOR', created.id, { email });
    return created;
  }

  async anonymize(actorId: string, userId: string, reason: string) {
    const why = reason.trim();
    if (why.length < 8) {
      throw new BadRequestException('Give a short reason (at least 8 characters)');
    }
    const target = await this.loadTarget(actorId, userId);
    this.assertLockoutTarget(actorId, target);
    if (target.anonymizedAt) {
      throw new BadRequestException('Account already anonymized');
    }

    const avatarKey = this.storage.keyFromPublicUrl(target.avatarUrl);
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

      if (!profile) return;

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

    await this.auth.revokeAllSessions(userId);
    await this.audit(actorId, 'ADMIN_ANONYMIZE_USER', userId, { reason: why });

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
