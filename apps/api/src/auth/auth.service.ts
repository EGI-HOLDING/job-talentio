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
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { slugify } from '../common/utils';
import { normalizeCompanyName, normalizeEmail } from '../common/dedupe';
import { UserRole } from '@prisma/client';

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
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials');
    if (user.isBanned) throw new ForbiddenException('Account banned');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
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

  /** Optional Google OAuth stub — requires credentials later */
  async oauthGoogleStub() {
    throw new BadRequestException(
      'Google OAuth not configured. Use email/password or Dev Login locally.',
    );
  }

  /** Optional Telegram Login stub */
  async oauthTelegramStub() {
    throw new BadRequestException(
      'Telegram Login not configured. Use email/password or Dev Login locally.',
    );
  }
}
