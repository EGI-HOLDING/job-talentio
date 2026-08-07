import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveBenefitIcon, resolveCategoryIcon } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSkillKey } from '../common/skill-resolve';

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  async skills(q?: string, category?: string, sort?: string, take = 100) {
    const limit = Math.min(Math.max(take || 100, 1), 200);
    if (sort === 'popular') {
      const grouped = await this.prisma.jobPostSkill.groupBy({
        by: ['skillId'],
        _count: { skillId: true },
        orderBy: { _count: { skillId: 'desc' } },
        take: limit,
      });
      const profileGrouped = await this.prisma.profileSkill.groupBy({
        by: ['skillId'],
        _count: { skillId: true },
      });
      const profileCounts = new Map(
        profileGrouped.map((g) => [g.skillId, g._count.skillId]),
      );
      const ids = grouped.map((g) => g.skillId);
      const extra = profileGrouped
        .filter((g) => !ids.includes(g.skillId))
        .sort((a, b) => b._count.skillId - a._count.skillId)
        .slice(0, Math.max(0, limit - ids.length))
        .map((g) => g.skillId);
      const allIds = [...ids, ...extra];
      if (!allIds.length) {
        return this.prisma.skill.findMany({
          where: {
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { slug: { contains: q, mode: 'insensitive' } },
                  ],
                }
              : {}),
            ...(category ? { category } : {}),
          },
          orderBy: { name: 'asc' },
          take: limit,
        });
      }
      const rows = await this.prisma.skill.findMany({
        where: {
          id: { in: allIds },
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(category ? { category } : {}),
        },
      });
      const jobCount = new Map(grouped.map((g) => [g.skillId, g._count.skillId]));
      return rows
        .map((s) => ({
          ...s,
          usageCount: (jobCount.get(s.id) || 0) + (profileCounts.get(s.id) || 0),
        }))
        .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
    }

    return this.prisma.skill.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { slug: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { name: 'asc' },
      take: limit,
    });
  }

  async suggestSkills(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    if (!q || q.trim().length < 1) {
      return this.skills(undefined, undefined, 'popular', limit);
    }
    const term = q.trim();
    const key = normalizeSkillKey(term);

    const where: Prisma.SkillWhereInput = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
        ...(key
          ? [
              { normalizedKey: key },
              { aliases: { some: { aliasKey: key } } },
              { aliases: { some: { alias: { contains: term, mode: 'insensitive' as const } } } },
            ]
          : []),
      ],
    };

    const rows = await this.prisma.skill.findMany({
      where,
      include: {
        _count: { select: { jobPostSkills: true, profileSkills: true } },
        aliases: { take: 3, select: { alias: true } },
      },
      take: limit * 2,
    });

    return rows
      .map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        category: s.category,
        aliases: s.aliases.map((a) => a.alias),
        usageCount: s._count.jobPostSkills + s._count.profileSkills,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  cities(q?: string) {
    return this.prisma.city.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async categories() {
    const rows = await this.prisma.jobCategory.findMany({ orderBy: { name: 'asc' } });
    return rows.map((c) => ({
      ...c,
      icon: resolveCategoryIcon(c.slug, c.icon) || c.icon,
    }));
  }

  industries() {
    return this.prisma.industry.findMany({ orderBy: { name: 'asc' } });
  }

  async benefits() {
    const rows = await this.prisma.benefit.findMany({ orderBy: { name: 'asc' } });
    return rows.map((b) => ({
      ...b,
      icon: resolveBenefitIcon(b.slug, b.icon) || b.icon,
    }));
  }

  async suggestBenefits(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    const rows = await this.prisma.benefit.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      include: {
        _count: { select: { jobPostBenefits: true } },
        aliases: { take: 3, select: { alias: true } },
      },
      orderBy: { name: 'asc' },
      take: limit * 2,
    });
    return rows
      .map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        icon: resolveBenefitIcon(b.slug, b.icon) || b.icon,
        aliases: b.aliases.map((a) => a.alias),
        usageCount: b._count.jobPostBenefits,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  languages() {
    return this.prisma.language.findMany({ orderBy: { name: 'asc' } });
  }

  async suggestLanguages(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    const rows = await this.prisma.language.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { code: { contains: term.toLowerCase(), mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      include: {
        _count: { select: { profileLanguages: true } },
        aliases: { take: 3, select: { alias: true } },
      },
      orderBy: { name: 'asc' },
      take: limit * 2,
    });
    return rows
      .map((l) => ({
        id: l.id,
        name: l.name,
        slug: l.code,
        code: l.code,
        aliases: l.aliases.map((a) => a.alias),
        usageCount: l._count.profileLanguages,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async suggestCities(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    return this.prisma.city.findMany({
      where: term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: limit,
    });
  }
}
