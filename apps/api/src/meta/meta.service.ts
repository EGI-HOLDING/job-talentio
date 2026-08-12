import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveBenefitIcon, resolveCategoryIcon } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { normalizeSkillKey } from '../common/skill-resolve';
import { normalizeJobTitleKey } from '../common/title-resolve';

export type PlatformStats = {
  openRoles: number;
  companies: number;
  talentProfiles: number;
  citiesCovered: number;
};

const PLATFORM_STATS_TTL_MS = 60_000;

@Injectable()
export class MetaService {
  private platformStatsCache: { at: number; value: PlatformStats } | null = null;

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
            ...ACTIVE_CATALOG,
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
          ...ACTIVE_CATALOG,
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
        ...ACTIVE_CATALOG,
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
      ...ACTIVE_CATALOG,
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
        nameUz: s.nameUz,
        nameRu: s.nameRu,
        slug: s.slug,
        category: s.category,
        aliases: s.aliases.map((a) => a.alias),
        usageCount: s._count.jobPostSkills + s._count.profileSkills,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  countries() {
    return this.prisma.country.findMany({
      where: { isActive: true, ...ACTIVE_CATALOG },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameUz: true,
        nameRu: true,
        slug: true,
        iso2: true,
        iso3: true,
        phoneCode: true,
        currencyCode: true,
      },
    });
  }

  async provinces(country?: string) {
    const raw = (country || 'uz').trim().toLowerCase();
    const where =
      raw === 'uz' || raw === 'uzbekistan'
        ? { OR: [{ iso2: 'UZ' }, { slug: 'uzbekistan' }] }
        : raw.length === 2
          ? { iso2: raw.toUpperCase() }
          : { slug: raw };
    const c = await this.prisma.country.findFirst({ where: { ...where, ...ACTIVE_CATALOG } });
    if (!c) return [];
    return this.prisma.province.findMany({
      where: { countryId: c.id, NOT: { slug: 'other-uzbekistan' }, ...ACTIVE_CATALOG },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameUz: true,
        nameRu: true,
        slug: true,
        type: true,
        country: { select: { slug: true, name: true, nameUz: true, nameRu: true, iso2: true } },
      },
    });
  }

  private citySelect = {
    id: true,
    name: true,
    nameUz: true,
    nameRu: true,
    slug: true,
    province: {
      select: {
        id: true,
        name: true,
        nameUz: true,
        nameRu: true,
        slug: true,
        type: true,
        country: { select: { slug: true, name: true, nameUz: true, nameRu: true, iso2: true } },
      },
    },
  } as const;

  async cities(q?: string, province?: string, group?: string) {
    const term = q?.trim();
    const provinceSlug = province?.trim();
    const rows = await this.prisma.city.findMany({
      where: {
        ...ACTIVE_CATALOG,
        AND: [
          term
            ? {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { slug: { contains: term, mode: 'insensitive' } },
                  { province: { name: { contains: term, mode: 'insensitive' } } },
                ],
              }
            : {},
          provinceSlug ? { province: { slug: provinceSlug } } : {},
          { province: { NOT: { slug: 'other-uzbekistan' }, ...ACTIVE_CATALOG } },
        ],
      },
      orderBy: [{ province: { name: 'asc' } }, { name: 'asc' }],
      select: this.citySelect,
    });

    if (group === 'province') {
      const sections = new Map<
        string,
        { province: { slug: string; name: string; type: string }; cities: typeof rows }
      >();
      for (const city of rows) {
        const key = city.province.slug;
        if (!sections.has(key)) {
          sections.set(key, {
            province: {
              slug: city.province.slug,
              name: city.province.name,
              type: city.province.type,
            },
            cities: [],
          });
        }
        sections.get(key)!.cities.push(city);
      }
      return {
        group: 'province' as const,
        sections: [...sections.values()].sort((a, b) =>
          a.province.name.localeCompare(b.province.name),
        ),
      };
    }

    return rows;
  }

  async categories() {
    const rows = await this.prisma.jobCategory.findMany({
      where: ACTIVE_CATALOG,
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      ...c,
      icon: resolveCategoryIcon(c.slug, c.icon) || null,
    }));
  }

  async industries(group?: string) {
    if (group === '1' || group === 'true' || group === 'group') {
      const groups = await this.prisma.industryGroup.findMany({
        where: ACTIVE_CATALOG,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          industries: {
            where: ACTIVE_CATALOG,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: {
              _count: {
                select: {
                  companies: { where: { isBanned: false } },
                },
              },
            },
          },
        },
      });
      return {
        group: 'industry' as const,
        groups: groups.map((g) => ({
          slug: g.slug,
          name: g.name,
          nameUz: g.nameUz,
          nameRu: g.nameRu,
          sortOrder: g.sortOrder,
          industries: g.industries.map((i) => ({
            slug: i.slug,
            name: i.name,
            nameUz: i.nameUz,
            nameRu: i.nameRu,
            sortOrder: i.sortOrder,
            companyCount: i._count.companies,
          })),
        })),
      };
    }
    const rows = await this.prisma.industry.findMany({
      where: ACTIVE_CATALOG,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        group: { select: { slug: true, name: true, nameUz: true, nameRu: true } },
        _count: {
          select: {
            companies: { where: { isBanned: false } },
          },
        },
      },
    });
    return rows.map(({ _count, ...i }) => ({
      ...i,
      companyCount: _count.companies,
    }));
  }

  async benefits() {
    const rows = await this.prisma.benefit.findMany({
      where: ACTIVE_CATALOG,
      orderBy: { name: 'asc' },
    });
    return rows.map((b) => ({
      ...b,
      icon: resolveBenefitIcon(b.slug, b.icon) || null,
    }));
  }

  async suggestBenefits(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    const rows = await this.prisma.benefit.findMany({
      where: {
        ...ACTIVE_CATALOG,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
                { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
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
        nameUz: b.nameUz,
        nameRu: b.nameRu,
        slug: b.slug,
        icon: resolveBenefitIcon(b.slug, b.icon) || null,
        aliases: b.aliases.map((a) => a.alias),
        usageCount: b._count.jobPostBenefits,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  languages() {
    return this.prisma.language.findMany({ where: ACTIVE_CATALOG, orderBy: { name: 'asc' } });
  }

  async suggestLanguages(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    const rows = await this.prisma.language.findMany({
      where: {
        ...ACTIVE_CATALOG,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { code: { contains: term.toLowerCase(), mode: 'insensitive' } },
                { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
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
        nameUz: l.nameUz,
        nameRu: l.nameRu,
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
    const rows = await this.prisma.city.findMany({
      where: {
        ...ACTIVE_CATALOG,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
                { province: { name: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: limit,
      select: this.citySelect,
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      nameUz: c.nameUz,
      nameRu: c.nameRu,
      slug: c.slug,
      province: c.province,
      // Mirrors province.name; kept in sync per locale by the same columns.
      provinceLabel: c.province.name,
      provinceLabelUz: c.province.nameUz,
      provinceLabelRu: c.province.nameRu,
    }));
  }

  async jobTitles(q?: string, page = 1, limit = 24) {
    const take = Math.min(Math.max(limit || 24, 1), 100);
    const skip = (Math.max(page || 1, 1) - 1) * take;
    const term = q?.trim();
    const where: Prisma.JobTitleWhereInput = {
      ...ACTIVE_CATALOG,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.jobTitle.count({ where }),
      this.prisma.jobTitle.findMany({
        where,
        include: {
          _count: {
            select: { jobPosts: { where: { status: 'PUBLISHED' } } },
          },
        },
        orderBy: [{ jobPosts: { _count: 'desc' } }, { name: 'asc' }],
        skip,
        take,
      }),
    ]);

    const items = rows.map((t) => ({
      id: t.id,
      name: t.name,
      nameUz: t.nameUz,
      nameRu: t.nameRu,
      slug: t.slug,
      count: t._count.jobPosts,
    }));

    return {
      items,
      total,
      page: Math.max(page || 1, 1),
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take) || 1),
    };
  }

  async suggestJobTitles(q?: string, take = 10) {
    const limit = Math.min(Math.max(take || 10, 1), 20);
    const term = q?.trim();
    const key = term ? normalizeJobTitleKey(term) : '';

    const where: Prisma.JobTitleWhereInput = {
      ...ACTIVE_CATALOG,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
              ...(key
                ? [
                    { normalizedKey: key },
                    { aliases: { some: { aliasKey: key } } },
                    {
                      aliases: {
                        some: { alias: { contains: term, mode: 'insensitive' as const } },
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const rows = await this.prisma.jobTitle.findMany({
      where,
      include: {
        _count: { select: { jobPosts: { where: { status: 'PUBLISHED' } } } },
        aliases: { take: 3, select: { alias: true } },
      },
      orderBy: { name: 'asc' },
      take: limit * 2,
    });

    return rows
      .map((t) => ({
        id: t.id,
        name: t.name,
        nameUz: t.nameUz,
        nameRu: t.nameRu,
        slug: t.slug,
        aliases: t.aliases.map((a) => a.alias),
        usageCount: t._count.jobPosts,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * Lightweight homepage counters. Indexed counts + short TTL cache so
   * high traffic / large tables stay cheap for the public home page.
   */
  async platformStats(): Promise<PlatformStats> {
    const now = Date.now();
    if (this.platformStatsCache && now - this.platformStatsCache.at < PLATFORM_STATS_TTL_MS) {
      return this.platformStatsCache.value;
    }

    const [openRoles, companies, talentProfiles, cityRows] = await Promise.all([
      this.prisma.jobPost.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.company.count(),
      this.prisma.employeeProfile.count(),
      this.prisma.jobPost.findMany({
        where: { status: 'PUBLISHED', cityId: { not: null } },
        select: { cityId: true },
        distinct: ['cityId'],
      }),
    ]);

    const value: PlatformStats = {
      openRoles,
      companies,
      talentProfiles,
      citiesCovered: cityRows.length,
    };
    this.platformStatsCache = { at: now, value };
    return value;
  }
}
