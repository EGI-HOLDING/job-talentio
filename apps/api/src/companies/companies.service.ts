import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { CompanyMemberRole } from '@prisma/client';
import { resolveCategoryIcon } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify } from '../common/utils';
import { normalizeCompanyName } from '../common/dedupe';
import { sanitizeStoredText } from '../common/text-sanitize';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

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

  async getBySlug(slug: string) {
    const company = await this.prisma.company.findUnique({
      where: { slug },
      include: {
        city: true,
        industry: true,
        subscription: { select: { plan: true } },
        jobPosts: {
          where: { status: 'PUBLISHED' },
          include: {
            city: true,
            category: true,
            jobSkills: { include: { skill: true }, take: 6 },
          },
          orderBy: { publishedAt: 'desc' },
          take: 20,
        },
        _count: { select: { followers: true, jobPosts: true } },
      },
    });
    if (!company || company.isBanned) throw new NotFoundException('Company not found');
    return {
      ...company,
      jobPosts: company.jobPosts.map((job) => ({
        ...job,
        category: job.category
          ? {
              ...job.category,
              icon: resolveCategoryIcon(job.category.slug, job.category.icon) || null,
            }
          : job.category,
      })),
    };
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
        const city = await this.prisma.city.findUnique({ where: { slug: data.citySlug } });
        cityId = city?.id ?? null;
      }
    }
    if (data.industrySlug !== undefined) {
      if (!data.industrySlug) industryId = null;
      else {
        const ind = await this.prisma.industry.findUnique({
          where: { slug: data.industrySlug },
        });
        industryId = ind?.id ?? null;
      }
    }
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: data.name !== undefined ? sanitizeStoredText(data.name) : undefined,
        description:
          data.description !== undefined ? sanitizeStoredText(data.description) : undefined,
        website: data.website || null,
        cityId,
        industryId,
        size: data.size as never,
      },
      include: { subscription: true, city: true, industry: true },
    });
  }

  async invite(
    user: AuthUser,
    companyId: string,
    email: string,
    role: CompanyMemberRole = 'RECRUITER',
  ) {
    await this.assertMember(user, companyId, ['OWNER', 'ADMIN']);
    // OWNER transfer is a separate flow — invites may only grant ADMIN or RECRUITER
    if (role !== 'ADMIN' && role !== 'RECRUITER') {
      throw new BadRequestException('Invite role must be ADMIN or RECRUITER');
    }
    const invitee = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!invitee) throw new NotFoundException('User must register first');
    if (invitee.role === 'SUPER_ADMIN') {
      throw new BadRequestException('Cannot invite a super admin as a company member');
    }
    if (invitee.role === 'EMPLOYEE') {
      throw new BadRequestException(
        'User is registered as an employee. They must create a recruiter account before joining a company.',
      );
    }
    try {
      return await this.prisma.companyMember.create({
        data: { companyId, userId: invitee.id, role },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
    } catch {
      throw new ConflictException('User already a member');
    }
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
