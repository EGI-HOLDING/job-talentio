import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyMemberRole, PlanCode, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { resolveCategoryIcon, translateMessage } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify } from '../common/utils';
import { normalizeCompanyName, normalizeEmail, sha256 } from '../common/dedupe';
import { sanitizeStoredText } from '../common/text-sanitize';
import { contentHash as translationSourceHash, resolveContent } from '../common/i18n/content-locale';
import { detectLocale } from '../common/i18n/detect-locale';
import { DEFAULT_LOCALE, isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { emailLocale } from '../common/i18n/email-locale';
import { TranslationService } from '../translation/translation.service';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CompaniesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private translation: TranslationService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  private async assertCompanyNameAvailable(name: string, excludeId?: string) {
    const normalized = normalizeCompanyName(name);
    if (!normalized || normalized.length < 2) {
      throw new ConflictException('Company name is too short or invalid');
    }
    const companies = await this.prisma.company.findMany({
      where: {
        isBanned: false,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true },
      take: 5000,
    });
    const dupe = companies.find((c) => normalizeCompanyName(c.name) === normalized);
    if (dupe) {
      throw new ConflictException(`Company name already in use ("${dupe.name}")`);
    }
  }

  async assertMember(
    user: AuthUser,
    companyId: string,
    roles?: CompanyMemberRole[],
  ) {
    if (user.role === 'SUPER_ADMIN') {
      const company = await this.prisma.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException('Company not found');
      return { company, membershipRole: 'OWNER' as CompanyMemberRole };
    }
    const membership = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: user.id } },
      include: { company: true },
    });
    if (!membership) throw new ForbiddenException('Not a company member');
    if (roles && !roles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient company role');
    }
    return { company: membership.company, membershipRole: membership.role };
  }

  async myCompanies(userId: string) {
    return this.prisma.companyMember.findMany({
      where: { userId },
      include: {
        company: {
          include: {
            subscription: true,
            city: true,
            industry: true,
            _count: { select: { jobPosts: true, members: true, followers: true } },
          },
        },
      },
    });
  }

  /** Public directory of hiring companies (published jobs). */
  async browse(query: {
    q?: string;
    industrySlug?: string;
    plan?: PlanCode;
    sort: 'jobs' | 'name';
    page: number;
    limit: number;
  }) {
    const limit = Math.min(Math.max(query.limit || 24, 1), 48);
    const page = Math.max(1, query.page || 1);
    const q = query.q?.trim();

    const where: Prisma.CompanyWhereInput = {
      isBanned: false,
      jobPosts: { some: { status: 'PUBLISHED' } },
      ...(query.plan ? { subscription: { plan: query.plan } } : {}),
      ...(query.industrySlug ? { industry: { slug: query.industrySlug } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.company.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const safePage = Math.min(page, total === 0 ? 1 : totalPages);

    const rows = await this.prisma.company.findMany({
      where,
      select: {
        slug: true,
        name: true,
        logoUrl: true,
        industry: { select: { slug: true, name: true, nameUz: true, nameRu: true } },
        subscription: { select: { plan: true } },
        _count: {
          select: { jobPosts: { where: { status: 'PUBLISHED' } } },
        },
      },
      orderBy:
        query.sort === 'name'
          ? [{ name: 'asc' }]
          : [{ jobPosts: { _count: 'desc' } }, { name: 'asc' }],
      skip: (safePage - 1) * limit,
      take: limit,
    });

    return {
      items: rows.map((c) => ({
        slug: c.slug,
        name: c.name,
        logoUrl: c.logoUrl,
        industry: c.industry,
        plan: c.subscription?.plan ?? 'FREE',
        openJobsCount: c._count.jobPosts,
      })),
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  async get(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        subscription: true,
        city: true,
        industry: true,
        members: {
          include: {
            user: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
          },
        },
        _count: { select: { jobPosts: true, followers: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async getBySlug(slug: string, locale: Locale = DEFAULT_LOCALE) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      include: {
        city: true,
        industry: true,
        subscription: { select: { plan: true } },
        translations: { select: { locale: true, description: true, isMachine: true } },
        jobPosts: {
          where: { status: 'PUBLISHED' },
          include: {
            city: true,
            category: true,
            jobSkills: { include: { skill: true }, take: 6 },
            translations: {
              select: { locale: true, title: true, description: true, isMachine: true },
            },
          },
          orderBy: { publishedAt: 'desc' },
          take: 20,
        },
        _count: { select: { followers: true, jobPosts: true } },
      },
    });
    if (!company || company.isBanned) throw new NotFoundException('Company not found');

    const { translations, ...rest } = company;
    const described = this.withDescriptionLocale(rest, translations, locale);

    return {
      ...described,
      // Listings on this page follow the same language rules as job search.
      jobPosts: company.jobPosts.map(({ translations: jobTranslations, ...job }) => {
        const resolved = resolveContent(
          { title: job.title, description: job.description },
          job.locale,
          jobTranslations,
          locale,
        );
        return {
          ...job,
          ...resolved.content,
          contentLocale: resolved.contentLocale,
          isMachineTranslated: resolved.isMachineTranslated,
          category: job.category
            ? {
                ...job.category,
                icon: resolveCategoryIcon(job.category.slug, job.category.icon) || null,
              }
            : job.category,
        };
      }),
    };
  }

  /**
   * Serves the company blurb in the reader's language when a version exists.
   * The legal name is never translated, so only `description` is swapped.
   */
  private withDescriptionLocale<T extends { description: string | null; locale: string }>(
    company: T,
    translations: Array<{ locale: string; description: string; isMachine: boolean }>,
    locale: Locale,
  ) {
    const resolved = resolveContent(
      { description: company.description ?? '' },
      company.locale,
      translations,
      locale,
    );
    return {
      ...company,
      description: resolved.content.description || null,
      contentLocale: resolved.contentLocale,
      isMachineTranslated: resolved.isMachineTranslated,
      availableLocales: resolved.availableLocales,
      canMachineTranslate:
        this.translation.enabled && resolved.isFallback && Boolean(company.description),
    };
  }

  /** Every stored language of the company blurb, for the recruiter editor. */
  async listTranslations(user: AuthUser, companyId: string) {
    const { company } = await this.assertMember(user, companyId);
    const translations = await this.prisma.companyTranslation.findMany({
      where: { companyId },
      select: { locale: true, description: true, isMachine: true },
    });
    return {
      sourceLocale: company.locale,
      source: { description: company.description },
      translations,
    };
  }

  async upsertTranslation(
    user: AuthUser,
    companyId: string,
    locale: Locale,
    description: string,
  ) {
    const { company } = await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    if (locale === company.locale) {
      throw new BadRequestException(
        'This is the language the profile was written in; edit the company instead',
      );
    }
    const value = {
      description: sanitizeStoredText(description),
      isMachine: false,
      sourceHash: translationSourceHash(company.description),
    };
    return this.prisma.companyTranslation.upsert({
      where: { companyId_locale: { companyId, locale } },
      update: value,
      create: { companyId, locale, ...value },
    });
  }

  async deleteTranslation(user: AuthUser, companyId: string, locale: Locale) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    await this.prisma.companyTranslation
      .delete({ where: { companyId_locale: { companyId, locale } } })
      .catch(() => undefined);
    return { ok: true };
  }

  /** Reader-triggered fallback, cached so the text is paid for only once. */
  async machineTranslate(slug: string, locale: Locale) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    const result = await this.translation.translateCompany(company.id, locale);
    if (result.status === 'failed') throw new BadRequestException(result.reason);
    return { status: result.status, company: await this.getBySlug(slug, locale) };
  }

  async update(
    user: AuthUser,
    companyId: string,
    data: {
      name?: string;
      description?: string;
      website?: string;
      citySlug?: string;
      industrySlug?: string;
      size?: string;
      locale?: string;
    },
  ) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    if (data.name) {
      await this.assertCompanyNameAvailable(data.name, companyId);
    }
    let cityId: string | undefined | null = undefined;
    let industryId: string | undefined | null = undefined;
    if (data.citySlug !== undefined) {
      if (!data.citySlug) cityId = null;
      else {
        const city = await this.prisma.city.findFirst({
          where: { slug: data.citySlug, ...ACTIVE_CATALOG },
        });
        cityId = city?.id ?? null;
      }
    }
    if (data.industrySlug !== undefined) {
      if (!data.industrySlug) industryId = null;
      else {
        const ind = await this.prisma.industry.findFirst({
          where: { slug: data.industrySlug, ...ACTIVE_CATALOG },
        });
        industryId = ind?.id ?? null;
      }
    }
    const description =
      data.description !== undefined ? sanitizeStoredText(data.description) : undefined;

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: data.name !== undefined ? sanitizeStoredText(data.name) : undefined,
        description,
        // Recording the language the blurb is written in keeps readers in other
        // languages from being told it is already theirs.
        locale: this.descriptionLocale(description, data.locale),
        website: data.website || null,
        cityId,
        industryId,
        size: data.size as never,
      },
      include: { subscription: true, city: true, industry: true },
    });
  }

  private descriptionLocale(description?: string, explicit?: string): Locale | undefined {
    if (explicit && isLocale(explicit)) return explicit;
    if (!description) return undefined;
    return detectLocale(description) ?? undefined;
  }

  async uploadLogo(user: AuthUser, companyId: string, file: Express.Multer.File) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    if (!file?.buffer?.length) throw new BadRequestException('Image file is required');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname || 'logo.png',
      file.mimetype,
      'public/logos',
    );
    const oldKey = this.storage.keyFromPublicUrl(company.logoUrl);
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: uploaded.url },
      include: { subscription: true, city: true, industry: true },
    });
    if (oldKey) await this.storage.delete(oldKey);
    return updated;
  }

  async clearLogo(user: AuthUser, companyId: string) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const oldKey = this.storage.keyFromPublicUrl(company.logoUrl);
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { logoUrl: null },
      include: { subscription: true, city: true, industry: true },
    });
    if (oldKey) await this.storage.delete(oldKey);
    return updated;
  }

  async removeMember(user: AuthUser, companyId: string, memberUserId: string) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    if (memberUserId === user.id) {
      throw new BadRequestException('You cannot remove yourself');
    }
    const target = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: memberUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new BadRequestException('Cannot remove the company owner');
    }
    await this.prisma.companyMember.delete({
      where: { companyId_userId: { companyId, userId: memberUserId } },
    });
    return { ok: true };
  }

  async invite(
    user: AuthUser,
    companyId: string,
    email: string,
    role: CompanyMemberRole = 'RECRUITER',
  ) {
    const { company } = await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    if (role !== 'ADMIN' && role !== 'RECRUITER') {
      throw new BadRequestException('Invite role must be ADMIN or RECRUITER');
    }
    const storedEmail = email.trim().toLowerCase();
    if (!storedEmail || !storedEmail.includes('@')) {
      throw new BadRequestException('Email is required');
    }

    const invitee = await this.findUserByInviteEmail(storedEmail);
    if (invitee) {
      if (invitee.role === 'SUPER_ADMIN') {
        throw new BadRequestException('Cannot invite a super admin as a company member');
      }
      if (invitee.role === 'EMPLOYEE') {
        throw new BadRequestException(
          'User is registered as an employee. They must create a recruiter account before joining a company.',
        );
      }
      try {
        const member = await this.prisma.companyMember.create({
          data: { companyId, userId: invitee.id, role },
          include: { user: { select: { id: true, email: true, fullName: true } } },
        });
        await this.closePendingInvites(companyId, storedEmail);
        await this.sendAddedEmail(invitee, company.name);
        return { status: 'added' as const, member };
      } catch {
        await this.closePendingInvites(companyId, storedEmail);
        throw new ConflictException('User already a member');
      }
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const pending = await this.prisma.companyInvite.findFirst({
      where: { companyId, email: storedEmail, acceptedAt: null },
    });
    if (pending) {
      await this.prisma.companyInvite.update({
        where: { id: pending.id },
        data: { tokenHash, expiresAt, role, invitedById: user.id },
      });
    } else {
      await this.prisma.companyInvite.create({
        data: {
          companyId,
          email: storedEmail,
          role,
          tokenHash,
          expiresAt,
          invitedById: user.id,
        },
      });
    }
    await this.sendInviteEmail(storedEmail, company.name, rawToken);
    return { status: 'invited' as const, email: storedEmail, role, expiresAt };
  }

  async previewInvite(rawToken: string) {
    const invite = await this.findPendingInvite(rawToken);
    if (!invite) throw new NotFoundException('Invite not found');
    return {
      companyName: invite.company.name,
      email: invite.email,
      role: invite.role,
    };
  }

  async listPendingInvites(user: AuthUser, companyId: string) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    return this.prisma.companyInvite.findMany({
      where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  }

  async revokeInvite(user: AuthUser, companyId: string, inviteId: string) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    const invite = await this.prisma.companyInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.companyId !== companyId) throw new NotFoundException('Invite not found');
    if (invite.acceptedAt) throw new BadRequestException('This invitation was already accepted');
    await this.prisma.companyInvite.delete({ where: { id: inviteId } });
    return { ok: true };
  }

  /**
   * Marks a pending invite used and attaches membership. Call inside the same
   * transaction that creates the user so a failed signup cannot leave a
   * recruiter with no company.
   */
  async consumeInvite(db: DbClient, rawToken: string, email: string, userId: string) {
    const invite = await db.companyInvite.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invitation is invalid or has expired');
    }
    if (invite.role !== 'ADMIN' && invite.role !== 'RECRUITER') {
      throw new BadRequestException('This invitation is invalid or has expired');
    }
    if (normalizeEmail(invite.email) !== normalizeEmail(email)) {
      throw new BadRequestException('This invitation was sent to a different email address');
    }
    const claimed = await db.companyInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This invitation is invalid or has expired');
    }
    try {
      await db.companyMember.create({
        data: { companyId: invite.companyId, userId, role: invite.role },
      });
    } catch {
      throw new ConflictException('User already a member');
    }
    return invite;
  }

  /** Existing recruiter who later opens the invite link still gets membership. */
  async consumeInviteForExistingUser(rawToken: string, email: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('This invitation is invalid or has expired');
    if (user.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot invite a super admin as a company member');
    }
    if (user.role === 'EMPLOYEE') {
      throw new BadRequestException(
        'User is registered as an employee. They must create a recruiter account before joining a company.',
      );
    }
    return this.consumeInvite(this.prisma, rawToken, email, userId);
  }

  private async findUserByInviteEmail(email: string) {
    const raw = email.trim().toLowerCase();
    const normalized = normalizeEmail(raw);
    const exact = await this.prisma.user.findUnique({ where: { email: raw } });
    if (exact) return exact;
    if (normalized !== raw) {
      const alias = await this.prisma.user.findUnique({ where: { email: normalized } });
      if (alias) return alias;
    }
    if (!raw.endsWith('@gmail.com') && !raw.endsWith('@googlemail.com')) return null;
    const users = await this.prisma.user.findMany({
      where: {
        OR: [{ email: { endsWith: '@gmail.com' } }, { email: { endsWith: '@googlemail.com' } }],
      },
      take: 5000,
    });
    return users.find((u) => normalizeEmail(u.email) === normalized) ?? null;
  }

  private async closePendingInvites(companyId: string, email: string) {
    await this.prisma.companyInvite.updateMany({
      where: { companyId, email, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
  }

  private async findPendingInvite(rawToken: string) {
    const invite = await this.prisma.companyInvite.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { company: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;
    return invite;
  }

  private webUrl() {
    return this.config.get('WEB_URL', 'http://localhost:3000').replace(/\/$/, '');
  }

  private async sendInviteEmail(email: string, companyName: string, rawToken: string) {
    const link = `${this.webUrl()}/register?invite=${rawToken}`;
    const locale = emailLocale(null);
    const sent = await this.mail.send(
      email,
      translateMessage('email.invite.subject', locale, { company: companyName }),
      `<p>${translateMessage('email.greetingShort', locale)}</p>
       <p>${translateMessage('email.invite.intro', locale, { company: companyName })}</p>
       <p><a href="${link}">${translateMessage('email.invite.cta', locale)}</a></p>
       <p>${translateMessage('email.linkFallback', locale, { link })}</p>
       <p>${translateMessage('email.expires7d', locale)} ${translateMessage('email.invite.ignore', locale)}</p>`,
    );
    if (!sent) {
      throw new BadRequestException(
        'Could not send the invitation email. Please try again in a moment.',
      );
    }
  }

  private async sendAddedEmail(
    user: { email: string; fullName: string; locale?: string | null },
    companyName: string,
  ) {
    const link = `${this.webUrl()}/login`;
    const locale = emailLocale(user.locale);
    await this.mail.send(
      user.email,
      translateMessage('email.inviteAdded.subject', locale, { company: companyName }),
      `<p>${translateMessage('email.greeting', locale, { name: user.fullName })}</p>
       <p>${translateMessage('email.inviteAdded.intro', locale, { company: companyName })}</p>
       <p><a href="${link}">${translateMessage('email.inviteAdded.cta', locale)}</a></p>
       <p>${translateMessage('email.linkFallback', locale, { link })}</p>`,
    );
  }

  async follow(user: AuthUser, companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException();
    await this.prisma.companyFollower.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      create: { userId: user.id, companyId },
      update: {},
    });
    const count = await this.prisma.companyFollower.count({ where: { companyId } });
    return { following: true, followers: count };
  }

  async unfollow(user: AuthUser, companyId: string) {
    await this.prisma.companyFollower.deleteMany({
      where: { userId: user.id, companyId },
    });
    const count = await this.prisma.companyFollower.count({ where: { companyId } });
    return { following: false, followers: count };
  }

  async isFollowing(userId: string, companyId: string) {
    const f = await this.prisma.companyFollower.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    return { following: !!f };
  }

  async ensureUniqueSlug(name: string) {
    let slug = slugify(name) || `company-${Date.now()}`;
    const exists = await this.prisma.company.findUnique({ where: { slug } });
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;
    return slug;
  }
}
