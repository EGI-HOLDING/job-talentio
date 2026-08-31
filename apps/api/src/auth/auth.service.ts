import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { translateMessage } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { emailLocale } from '../common/i18n/email-locale';
import { StorageService } from '../storage/storage.service';
import { slugify } from '../common/utils';
import { normalizeCompanyName, normalizeEmail, sha256 } from '../common/dedupe';
import { Prisma, UserRole } from '@prisma/client';
import { CompaniesService } from '../companies/companies.service';
import { UserErasureService } from '../users/user-erasure.service';
import { confirmationMatchesAccount } from '../users/erasure-guards';
import { telegramFullName, verifyTelegramLogin } from './telegram-login';
import {
  googleTokenEmailVerified,
  shouldMarkGoogleMailboxVerified,
  telegramTypedEmailVerified,
} from './oauth-email-verified';
import { isSecureRuntime } from '../common/jwt-secret';
import { isDevLoginAllowed } from './session-policy';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000; // 1 min between sends

/** Parse "15m" / "7d" style TTLs into milliseconds. */
function parseTtlMs(value: string | undefined, fallbackMs: number): number {
  const match = /^(\d+)([smhd])$/.exec((value || '').trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return amount * unit;
}

const REFRESH_TOKEN_FALLBACK_TTL_MS = 30 * 86_400_000; // 30d

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private storage: StorageService,
    private companies: CompaniesService,
    private erasure: UserErasureService,
  ) {}

  private async assertEmailAvailable(email: string) {
    const normalized = normalizeEmail(email);
    const raw = email.trim().toLowerCase();

    const exact = await this.prisma.user.findUnique({ where: { email: raw } });
    if (exact) throw new ConflictException('Email already registered');

    // Block Gmail alias / dot variants of an existing account
    if (normalized !== raw) {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { email: { endsWith: '@gmail.com' } },
            { email: { endsWith: '@googlemail.com' } },
          ],
        },
        select: { email: true },
        take: 5000,
      });
      if (users.some((u) => u.email && normalizeEmail(u.email) === normalized)) {
        throw new ConflictException(
          'An account with this email (or a Gmail alias of it) already exists',
        );
      }
    }
  }

  private async assertCompanyNameAvailable(name: string) {
    const normalized = normalizeCompanyName(name);
    if (!normalized || normalized.length < 2) {
      throw new BadRequestException('Company name is too short');
    }
    const companies = await this.prisma.company.findMany({
      where: { isBanned: false },
      select: { id: true, name: true },
      take: 5000,
    });
    const dupe = companies.find((c) => normalizeCompanyName(c.name) === normalized);
    if (dupe) {
      throw new ConflictException(
        `Company name is already taken ("${dupe.name}"). Join that company or choose a distinct name.`,
      );
    }
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const ttlMs = parseTtlMs(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      REFRESH_TOKEN_FALLBACK_TTL_MS,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    // Housekeeping: drop this user's long-expired tokens.
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
    });
    return raw;
  }

  private async tokenFor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { select: { companyId: true, role: true } },
        employeeProfile: { select: { id: true } },
      },
    });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
    });
    const refreshToken = await this.issueRefreshToken(user.id);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        locale: user.locale,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        telegramLinked: Boolean(user.telegramId),
        hasPassword: Boolean(user.passwordHash),
        memberships: user.memberships,
        employeeProfileId: user.employeeProfile?.id ?? null,
      },
    };
  }

  /** Rotate a refresh token: revoke the presented one, mint a new pair. */
  async refresh(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) {
      // Reuse of a rotated token - treat as theft and kill refresh + access JWTs.
      await this.revokeAllSessions(record.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.isBanned) throw new UnauthorizedException('Account unavailable');

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.tokenFor(record.userId);
  }

  /** Best-effort revoke; safe to call with an expired access token. */
  async logout(refreshToken?: string) {
    if (refreshToken) {
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      if (record) {
        await this.revokeAllSessions(record.userId);
      }
    }
    return { ok: true };
  }

  /** Invalidate every refresh token and every access JWT for these users. */
  async revokeSessionsForUsers(userIds: string[]) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return { ok: true as const };
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: { in: ids }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true as const };
  }

  async revokeAllSessions(userId: string) {
    return this.revokeSessionsForUsers([userId]);
  }

  async ensureEmailAvailable(email: string) {
    return this.assertEmailAvailable(email);
  }

  /**
   * Support: send the same reset mail as forgot-password, with a real error
   * instead of a silent ok. `allowWithoutPassword` is for invited operators
   * who have not chosen a password yet.
   */
  async sendPasswordResetForUser(userId: string, opts?: { allowWithoutPassword?: boolean }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBanned) throw new ForbiddenException('Account banned');
    if (!user.email) throw new BadRequestException('This account has no email');
    if (!user.passwordHash && !opts?.allowWithoutPassword) {
      throw new BadRequestException('This account signs in with Google or Telegram, not a password');
    }
    await this.dispatchPasswordReset({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
    });
    return { ok: true as const, email: user.email };
  }

  async sendVerificationForUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBanned) throw new ForbiddenException('Account banned');
    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }
    if (!user.email) throw new BadRequestException('This account has no email');
    await this.sendVerificationEmail({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
    });
    return { ok: true as const, email: user.email };
  }

  private async dispatchPasswordReset(user: {
    id: string;
    email: string;
    fullName: string;
    locale?: string | null;
  }) {
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:3000');
    const link = `${webUrl}/reset-password?token=${rawToken}`;
    const resetLocale = emailLocale(user.locale);
    const sent = await this.mail.send(
      user.email,
      translateMessage('email.resetPassword.subject', resetLocale),
      `<p>${translateMessage('email.greeting', resetLocale, { name: user.fullName })}</p>
       <p>${translateMessage('email.resetPassword.intro', resetLocale)}</p>
       <p><a href="${link}">${translateMessage('email.resetPassword.cta', resetLocale)}</a></p>
       <p>${translateMessage('email.linkFallback', resetLocale, { link })}</p>
       <p>${translateMessage('email.expires24h', resetLocale)} ${translateMessage('email.resetPassword.ignore', resetLocale)}</p>`,
    );
    if (!sent) {
      throw new BadRequestException('Could not send the reset email. Try again in a moment.');
    }
  }

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    role: 'EMPLOYEE' | 'RECRUITER';
    locale?: string;
    companyName?: string;
    inviteToken?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    await this.assertEmailAvailable(email);

    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) throw new BadRequestException('Full name is too short');

    const inviteToken = input.inviteToken?.trim();
    const role: UserRole = inviteToken ? 'RECRUITER' : input.role;

    if (role === 'RECRUITER' && !inviteToken) {
      const name = input.companyName?.trim() || `${fullName}'s Company`;
      await this.assertCompanyNameAvailable(name);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role,
          locale: input.locale ?? 'uz',
          // Platform email verify is opt-in from profile/settings (same as Google sign-up)
          emailVerified: false,
        },
      });

      if (role === 'EMPLOYEE') {
        await tx.employeeProfile.create({ data: { userId: created.id } });
      }

      if (role === 'RECRUITER' && inviteToken) {
        await this.companies.consumeInvite(tx, inviteToken, email, created.id);
      } else if (role === 'RECRUITER') {
        const name = input.companyName?.trim() || `${fullName}'s Company`;
        let slug = slugify(name) || `company-${Date.now()}`;
        const slugExists = await tx.company.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

        const company = await tx.company.create({
          data: { name, slug },
        });
        await tx.subscription.create({
          data: { companyId: company.id, plan: 'FREE', status: 'ACTIVE' },
        });
        await tx.companyMember.create({
          data: { companyId: company.id, userId: created.id, role: 'OWNER' },
        });
      }

      return created;
    });

    const welcomeLocale = emailLocale(user.locale);
    if (user.email) {
      await this.mail.send(
        user.email,
        translateMessage('email.welcome.subject', welcomeLocale),
        `<p>${translateMessage('email.greeting', welcomeLocale, { name: user.fullName })}</p>` +
          `<p>${translateMessage('email.welcome.body', welcomeLocale)}</p>`,
      );
    }

    return this.tokenFor(user.id);
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid email or password');
    if (user.isBanned) throw new ForbiddenException('Account banned');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    return this.tokenFor(user.id);
  }

  async devLogin(email: string, role?: UserRole) {
    if (!isDevLoginAllowed(this.config.get('DEV_AUTH_ENABLED') === 'true', isSecureRuntime())) {
      throw new ForbiddenException('Dev login disabled');
    }
    const normalized = email.toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      const resolvedRole = role ?? 'EMPLOYEE';
      user = await this.prisma.user.create({
        data: {
          email: normalized,
          fullName: normalized.split('@')[0],
          role: resolvedRole,
          emailVerified: false,
        },
      });
      if (resolvedRole === 'EMPLOYEE') {
        await this.prisma.employeeProfile.create({ data: { userId: user.id } });
      }
      if (resolvedRole === 'RECRUITER') {
        const slug = `dev-${Date.now().toString(36)}`;
        const company = await this.prisma.company.create({
          data: { name: `Dev Company ${slug}`, slug },
        });
        await this.prisma.subscription.create({
          data: { companyId: company.id, plan: 'FREE', status: 'ACTIVE' },
        });
        await this.prisma.companyMember.create({
          data: { companyId: company.id, userId: user.id, role: 'OWNER' },
        });
      }
    } else if (role && user.role !== role && user.role !== 'SUPER_ADMIN') {
      // keep existing role for known users unless switching intentionally via seed accounts
    }
    if (user.isBanned) throw new ForbiddenException('Account banned');
    return this.tokenFor(user.id);
  }

  async me(userId: string) {
    return this.tokenFor(userId);
  }

  async updateAccount(
    userId: string,
    data: { fullName?: string; locale?: string; avatarUrl?: string },
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        locale: data.locale,
        avatarUrl: data.avatarUrl === '' ? null : data.avatarUrl,
      },
    });
    return this.tokenFor(userId);
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('Image file is required');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname || 'avatar.jpg',
      file.mimetype,
      'public/avatars',
    );
    const oldKey = this.storage.keyFromPublicUrl(user.avatarUrl);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: uploaded.url },
    });
    if (oldKey) await this.storage.delete(oldKey);
    return this.tokenFor(userId);
  }

  async clearAvatar(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const oldKey = this.storage.keyFromPublicUrl(user.avatarUrl);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    if (oldKey) await this.storage.delete(oldKey);
    return this.tokenFor(userId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) {
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    await this.revokeAllSessions(userId);
    return this.tokenFor(userId);
  }

  // ── Google Sign-In (GIS ID-token flow) ─────────────────────

  private googleClient: OAuth2Client | null = null;

  private getGoogleClient(): OAuth2Client {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException(
        'Google sign-in is not configured yet. Please use email and password.',
      );
    }
    if (!this.googleClient) this.googleClient = new OAuth2Client(clientId);
    return this.googleClient;
  }

  private async verifyGoogleIdToken(idToken: string) {
    const client = this.getGoogleClient();
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: this.config.get<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new UnauthorizedException('Google token has no email');
      }
      return {
        googleId: payload.sub,
        email: payload.email.trim().toLowerCase(),
        fullName: (payload.name || payload.email.split('@')[0]).trim(),
        avatarUrl: payload.picture ?? null,
        emailVerified: googleTokenEmailVerified(payload),
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid Google sign-in token');
    }
  }

  private verificationLink(rawToken: string) {
    const webUrl = this.config.get('WEB_URL', 'http://localhost:3000');
    return `${webUrl}/verify-email?token=${rawToken}`;
  }

  /** Create a fresh verification token (invalidates previous ones) and email the link. */
  private async sendVerificationEmail(user: {
    id: string;
    email: string;
    fullName: string;
    locale?: string | null;
  }) {
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });
    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const link = this.verificationLink(rawToken);
    const verifyLocale = emailLocale(user.locale);
    const sent = await this.mail.send(
      user.email,
      translateMessage('email.verify.subject', verifyLocale),
      `<p>${translateMessage('email.greeting', verifyLocale, { name: user.fullName })}</p>
       <p>${translateMessage('email.verify.intro', verifyLocale)}</p>
       <p><a href="${link}">${translateMessage('email.verify.cta', verifyLocale)}</a></p>
       <p>${translateMessage('email.linkFallback', verifyLocale, { link })}</p>
       <p>${translateMessage('email.expires24h', verifyLocale)} ${translateMessage('email.verify.ignore', verifyLocale)}</p>`,
    );
    if (!sent) {
      throw new BadRequestException(
        'Could not send verification email. Please try again in a moment.',
      );
    }
  }

  /**
   * Google sign-in for job seekers and recruiters.
   * If Google already verified that mailbox, we trust it. Telegram-typed emails
   * stay unverified until the user confirms the address on this platform.
   */
  async oauthGoogle(input: {
    idToken: string;
    role?: 'EMPLOYEE' | 'RECRUITER';
    companyName?: string;
    locale?: string;
    inviteToken?: string;
  }) {
    const google = await this.verifyGoogleIdToken(input.idToken);
    const inviteToken = input.inviteToken?.trim();
    const googleMailboxVerified = shouldMarkGoogleMailboxVerified({
      tokenEmail: google.email,
      tokenEmailVerified: google.emailVerified,
      storedEmail: google.email,
    });

    let user = await this.prisma.user.findUnique({ where: { googleId: google.googleId } });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: google.email } });
      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: google.googleId,
            ...(google.avatarUrl && !byEmail.avatarUrl ? { avatarUrl: google.avatarUrl } : {}),
            ...(googleMailboxVerified && !byEmail.emailVerified ? { emailVerified: true } : {}),
          },
        });
      }
    }

    if (user) {
      if (user.isBanned) throw new ForbiddenException('Account banned');
      await this.syncGoogleMailboxVerified(user, google);
      if (inviteToken) {
        await this.acceptInviteOnExistingUser(inviteToken, google.email, user.id);
      }
      return this.tokenFor(user.id);
    }

    if (inviteToken) {
      const created = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: google.email,
            googleId: google.googleId,
            fullName: google.fullName,
            avatarUrl: google.avatarUrl,
            role: 'RECRUITER',
            locale: input.locale ?? 'uz',
            emailVerified: googleMailboxVerified,
          },
        });
        await this.companies.consumeInvite(tx, inviteToken, google.email, newUser.id);
        return newUser;
      });
      return this.tokenFor(created.id);
    }

    // First Google sign-in: the frontend must supply a role (and company for recruiters)
    if (!input.role) {
      return {
        requiresRegistration: true as const,
        email: google.email,
        fullName: google.fullName,
      };
    }

    if (input.role === 'RECRUITER') {
      const name = input.companyName?.trim() ?? '';
      if (name.length < 2) {
        throw new BadRequestException('Company name is required for recruiter accounts');
      }
      await this.assertCompanyNameAvailable(name);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: google.email,
          googleId: google.googleId,
          fullName: google.fullName,
          avatarUrl: google.avatarUrl,
          role: input.role as UserRole,
          locale: input.locale ?? 'uz',
          emailVerified: googleMailboxVerified,
        },
      });

      if (input.role === 'EMPLOYEE') {
        await tx.employeeProfile.create({ data: { userId: newUser.id } });
      }

      if (input.role === 'RECRUITER') {
        const name = input.companyName!.trim();
        let slug = slugify(name) || `company-${Date.now()}`;
        const slugExists = await tx.company.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;
        const company = await tx.company.create({ data: { name, slug } });
        await tx.subscription.create({
          data: { companyId: company.id, plan: 'FREE', status: 'ACTIVE' },
        });
        await tx.companyMember.create({
          data: { companyId: company.id, userId: newUser.id, role: 'OWNER' },
        });
      }

      return newUser;
    });

    return this.tokenFor(created.id);
  }

  private async syncGoogleMailboxVerified(
    user: { id: string; email: string | null; emailVerified: boolean },
    google: { email: string; emailVerified: boolean },
  ) {
    if (
      user.emailVerified ||
      !shouldMarkGoogleMailboxVerified({
        tokenEmail: google.email,
        tokenEmailVerified: google.emailVerified,
        storedEmail: user.email,
      })
    ) {
      return;
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }

  private async acceptInviteOnExistingUser(rawToken: string, email: string, userId: string) {
    try {
      await this.companies.consumeInviteForExistingUser(rawToken, email, userId);
    } catch (e) {
      if (e instanceof ConflictException) return;
      if (e instanceof BadRequestException) {
        const message = String(e.message);
        if (
          message.includes('different email') ||
          message.includes('employee') ||
          message.includes('super admin')
        ) {
          throw e;
        }
      }
    }
  }

  /** Confirm the emailed token, mark the account verified, and start a session. */
  async verifyEmail(rawToken: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!record || record.usedAt) {
      throw new BadRequestException('Verification link is invalid or already used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Verification link expired. Request a new one.');
    }
    if (record.user.isBanned) throw new ForbiddenException('Account banned');

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
    ]);

    return this.tokenFor(record.userId);
  }

  /** Re-send the verification email. Always responds ok to avoid leaking accounts. */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user || !user.email || user.emailVerified || user.isBanned) return { ok: true };

    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: { gte: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
      },
    });
    if (recent) return { ok: true };

    try {
      await this.sendVerificationEmail({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        locale: user.locale,
      });
    } catch {
      // Public endpoint — do not leak delivery failures
    }
    return { ok: true };
  }

  /**
   * Authenticated: job seeker (or any user) requests a platform verification email
   * from their profile. Does not block login while unverified.
   */
  async requestVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBanned) throw new ForbiddenException('Account banned');
    if (user.emailVerified) {
      return { ok: true as const, email: user.email, alreadyVerified: true as const };
    }
    if (!user.email) {
      throw new BadRequestException('Add an email in Settings before requesting verification');
    }

    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: { gte: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
      },
    });
    if (recent) {
      return {
        ok: true as const,
        email: user.email,
        message: 'Verification email was already sent. Check your inbox (and spam).',
      };
    }

    await this.sendVerificationEmail({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.locale,
    });
    return {
      ok: true as const,
      email: user.email,
      message: 'Verification email sent. Check your inbox (and spam).',
    };
  }

  /**
   * Public bot id for the Login popup. The token itself stays on the server.
   * Numeric id is the part before ':' in TELEGRAM_BOT_TOKEN and is not secret.
   */
  telegramWidgetConfig() {
    const token = (this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
    const username = (this.config.get<string>('TELEGRAM_BOT_USERNAME') || '')
      .replace(/^@/, '')
      .trim();
    const botId = token.split(':')[0] || '';
    if (!token || !username || !/^\d{5,}$/.test(botId)) {
      return { available: false as const };
    }
    return { available: true as const, botId, username };
  }

  private parseTelegramAuth(input: {
    id: string;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
  }) {
    const botToken = (this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
    if (!botToken) {
      throw new BadRequestException('Telegram sign-in is not available');
    }
    const payload = {
      id: String(input.id),
      first_name: input.first_name,
      last_name: input.last_name || undefined,
      username: input.username || undefined,
      photo_url: input.photo_url || undefined,
      auth_date: input.auth_date,
      hash: input.hash,
    };
    if (!verifyTelegramLogin(payload, botToken)) {
      throw new UnauthorizedException('Telegram login data is invalid or expired');
    }
    return {
      telegramId: payload.id,
      fullName: telegramFullName(payload) || `Telegram ${payload.id}`,
      avatarUrl: payload.photo_url || null,
      username: payload.username,
    };
  }

  /**
   * Telegram Login Widget. Returning users get a session immediately.
   * New users pick a role; email is optional and verified later from Settings.
   */
  async oauthTelegram(input: {
    id: string;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
    email?: string;
    role?: 'EMPLOYEE' | 'RECRUITER';
    companyName?: string;
    locale?: string;
    inviteToken?: string;
  }) {
    const tg = this.parseTelegramAuth(input);
    const inviteToken = input.inviteToken?.trim();

    let user = await this.prisma.user.findUnique({ where: { telegramId: tg.telegramId } });
    if (user) {
      if (user.isBanned) throw new ForbiddenException('Account banned');
      if (inviteToken && user.email) {
        await this.acceptInviteOnExistingUser(inviteToken, user.email, user.id);
      }
      return this.tokenFor(user.id);
    }

    if (!input.role) {
      return {
        requiresRegistration: true as const,
        fullName: tg.fullName,
        username: tg.username ?? null,
      };
    }

    const email = input.email?.trim().toLowerCase() || null;
    if (inviteToken && !email) {
      throw new BadRequestException('Email is required to accept a company invitation');
    }
    if (email) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        throw new ConflictException(
          'An account with this email already exists. Sign in and connect Telegram from Settings.',
        );
      }
    }

    if (inviteToken) {
      const inviteEmail = email as string;
      const created = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email: inviteEmail,
            telegramId: tg.telegramId,
            fullName: tg.fullName,
            avatarUrl: tg.avatarUrl,
            role: 'RECRUITER',
            locale: input.locale ?? 'uz',
            emailVerified: telegramTypedEmailVerified(),
          },
        });
        await this.companies.consumeInvite(tx, inviteToken, inviteEmail, newUser.id);
        return newUser;
      });
      return this.tokenFor(created.id);
    }

    if (input.role === 'RECRUITER') {
      const name = input.companyName?.trim() ?? '';
      if (name.length < 2) {
        throw new BadRequestException('Company name is required for recruiter accounts');
      }
      await this.assertCompanyNameAvailable(name);
    }

    if (email) await this.assertEmailAvailable(email);

    const created = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          telegramId: tg.telegramId,
          fullName: tg.fullName,
          avatarUrl: tg.avatarUrl,
          role: input.role as UserRole,
          locale: input.locale ?? 'uz',
          emailVerified: telegramTypedEmailVerified(),
        },
      });

      if (input.role === 'EMPLOYEE') {
        await tx.employeeProfile.create({ data: { userId: newUser.id } });
      }

      if (input.role === 'RECRUITER') {
        const name = input.companyName!.trim();
        let slug = slugify(name) || `company-${Date.now()}`;
        const slugExists = await tx.company.findUnique({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;
        const company = await tx.company.create({ data: { name, slug } });
        await tx.subscription.create({
          data: { companyId: company.id, plan: 'FREE', status: 'ACTIVE' },
        });
        await tx.companyMember.create({
          data: { companyId: company.id, userId: newUser.id, role: 'OWNER' },
        });
      }

      return newUser;
    });

    return this.tokenFor(created.id);
  }

  /** Logged-in user attaches a Telegram identity (Settings). */
  async connectTelegram(
    userId: string,
    input: {
      id: string;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      auth_date: number;
      hash: string;
    },
  ) {
    const tg = this.parseTelegramAuth(input);
    const taken = await this.prisma.user.findUnique({ where: { telegramId: tg.telegramId } });
    if (taken && taken.id !== userId) {
      throw new ConflictException('This Telegram account is already linked to another user');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isBanned) throw new ForbiddenException('Account banned');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        telegramId: tg.telegramId,
        ...(tg.avatarUrl && !user.avatarUrl ? { avatarUrl: tg.avatarUrl } : {}),
      },
    });
    return this.tokenFor(userId);
  }

  /** Always returns ok — do not leak whether the email exists. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user || user.isBanned || !user.passwordHash || !user.email) return { ok: true };
    try {
      await this.dispatchPasswordReset({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        locale: user.locale,
      });
    } catch {
      // Public endpoint — do not leak delivery failures
    }
    return { ok: true };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!record || record.usedAt) {
      throw new BadRequestException('Reset link is invalid or already used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link expired. Request a new one.');
    }
    if (record.user.isBanned) throw new ForbiddenException('Account banned');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
    ]);
    await this.revokeAllSessions(record.userId);
    return { ok: true };
  }

  async requestEmailChange(userId: string, newEmail: string, currentPassword?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash) {
      if (!currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is incorrect');
    }

    const email = newEmail.trim().toLowerCase();
    if (user.email && email === user.email) throw new BadRequestException('That is already your email');
    await this.assertEmailAvailable(email);

    await this.prisma.emailChangeToken.deleteMany({
      where: { userId, usedAt: null },
    });
    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.emailChangeToken.create({
      data: {
        userId,
        newEmail: email,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:3000');
    const link = `${webUrl}/confirm-email-change?token=${rawToken}`;
    const changeLocale = emailLocale(user.locale);
    void this.mail.send(
      email,
      translateMessage('email.changeEmail.subject', changeLocale),
      `<p>${translateMessage('email.greeting', changeLocale, { name: user.fullName })}</p>
       <p>${translateMessage('email.changeEmail.intro', changeLocale)}</p>
       <p><a href="${link}">${translateMessage('email.changeEmail.cta', changeLocale)}</a></p>
       <p>${translateMessage('email.linkFallback', changeLocale, { link })}</p>
       <p>${translateMessage('email.expires24h', changeLocale)}</p>`,
    );
    return { ok: true, message: 'Check the new inbox to confirm the change' };
  }

  async confirmEmailChange(rawToken: string) {
    const record = await this.prisma.emailChangeToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!record || record.usedAt) {
      throw new BadRequestException('Link is invalid or already used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Link expired. Request a new email change.');
    }
    if (record.user.isBanned) throw new ForbiddenException('Account banned');
    await this.assertEmailAvailable(record.newEmail);

    await this.prisma.$transaction([
      this.prisma.emailChangeToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { email: record.newEmail, emailVerified: true },
      }),
    ]);
    await this.revokeAllSessions(record.userId);
    return this.tokenFor(record.userId);
  }

  async deleteMyAccount(
    userId: string,
    input: { confirmation: string; currentPassword?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        passwordHash: true,
        anonymizedAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Account unavailable');
    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin accounts cannot be deleted here');
    }
    if (user.anonymizedAt) {
      throw new BadRequestException('Account already anonymized');
    }
    if (
      !confirmationMatchesAccount({
        confirmation: input.confirmation,
        email: user.email,
        fullName: user.fullName,
      })
    ) {
      throw new BadRequestException(
        user.email ? 'Type your email to confirm' : 'Type your name to confirm',
      );
    }
    if (user.passwordHash) {
      if (!input.currentPassword) {
        throw new BadRequestException('Current password is required');
      }
      const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is incorrect');
    }

    const result = await this.erasure.erase(userId);
    await this.revokeAllSessions(userId);
    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        action: 'USER_DELETE_ACCOUNT',
        entityType: 'User',
        entityId: userId,
        metadata: { source: 'self' } as Prisma.InputJsonValue,
      },
    });
    return result;
  }
}
