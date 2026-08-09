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
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { slugify } from '../common/utils';
import { normalizeCompanyName, normalizeEmail, sha256 } from '../common/dedupe';
import { UserRole } from '@prisma/client';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000; // 1 min between sends

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
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
      if (users.some((u) => normalizeEmail(u.email) === normalized)) {
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

  private async tokenFor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: { select: { companyId: true, role: true } },
        employeeProfile: { select: { id: true } },
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        locale: user.locale,
        avatarUrl: user.avatarUrl,
        memberships: user.memberships,
        employeeProfileId: user.employeeProfile?.id ?? null,
      },
    };
  }

  async register(input: {
    email: string;
    password: string;
    fullName: string;
    role: 'EMPLOYEE' | 'RECRUITER';
    locale?: string;
    companyName?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    await this.assertEmailAvailable(email);

    const fullName = input.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) throw new BadRequestException('Full name is too short');

    if (input.role === 'RECRUITER') {
      const name = input.companyName?.trim() || `${fullName}'s Company`;
      await this.assertCompanyNameAvailable(name);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const role: UserRole = input.role;

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role,
          locale: input.locale ?? 'uz',
          emailVerified: true,
        },
      });

      if (role === 'EMPLOYEE') {
        await tx.employeeProfile.create({ data: { userId: created.id } });
      }

      if (role === 'RECRUITER') {
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

    await this.mail.send(
      user.email,
      'Welcome to Job Talentio',
      `<p>Salom ${user.fullName}!</p><p>Your Job Talentio account is ready.</p>`,
    );

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
    if (this.config.get('DEV_AUTH_ENABLED') !== 'true') {
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
          emailVerified: true,
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
    return { ok: true };
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
  private async sendVerificationEmail(user: { id: string; email: string; fullName: string }) {
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
    // Do not await SMTP — a hung Hostinger connection must not block OAuth/register.
    void this.mail.send(
      user.email,
      'Verify your email — Job Talentio',
      `<p>Salom ${user.fullName}!</p>
       <p>Confirm this email address to activate your Job Talentio account:</p>
       <p><a href="${link}">Verify my email</a></p>
       <p>Or open this link: ${link}</p>
       <p>The link expires in 24 hours. If you didn't request this, you can ignore this email.</p>`,
    );
  }

  /**
   * Google sign-in for job seekers and recruiters.
   * Google already verified the email address, so we issue a session immediately
   * (no platform email-verification gate). Platform email verify can be added later
   * for password sign-ups if needed.
   */
  async oauthGoogle(input: {
    idToken: string;
    role?: 'EMPLOYEE' | 'RECRUITER';
    companyName?: string;
    locale?: string;
  }) {
    const google = await this.verifyGoogleIdToken(input.idToken);

    let user = await this.prisma.user.findUnique({ where: { googleId: google.googleId } });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: google.email } });
      if (byEmail) {
        // Link Google identity to the existing account
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: google.googleId,
            emailVerified: true,
            ...(google.avatarUrl && !byEmail.avatarUrl ? { avatarUrl: google.avatarUrl } : {}),
          },
        });
      }
    }

    if (user) {
      if (user.isBanned) throw new ForbiddenException('Account banned');
      // Unblock accounts that signed up via Google while verification was still required
      if (!user.emailVerified) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });
      }
      return this.tokenFor(user.id);
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
          emailVerified: true,
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
    if (!user || user.emailVerified || user.isBanned) return { ok: true };

    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: { gte: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS) },
      },
    });
    if (recent) return { ok: true };

    await this.sendVerificationEmail(user);
    return { ok: true };
  }

  /** Optional Telegram Login stub */
  async oauthTelegramStub() {
    throw new BadRequestException(
      'Telegram sign-in is not available yet. Please use email and password.',
    );
  }
}
