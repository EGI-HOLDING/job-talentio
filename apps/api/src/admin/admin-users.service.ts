import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UserErasureService } from '../users/user-erasure.service';
import { supportTargetError } from './admin-user-guards';

@Injectable()
export class AdminUsersService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private erasure: UserErasureService,
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
    const result = await this.erasure.erase(userId);
    await this.auth.revokeAllSessions(userId);
    await this.audit(actorId, 'ADMIN_ANONYMIZE_USER', userId, { reason: why });
    return result;
  }
}
