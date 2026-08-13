import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { translateMessage } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { emailLocale } from '../common/i18n/email-locale';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { resolveSkill } from '../common/skill-resolve';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';

@Injectable()
export class AlertsService {
  private queue: Queue | null = null;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private notifications: NotificationsService,
  ) {}

  setQueue(queue: Queue) {
    this.queue = queue;
  }

  async create(
    user: AuthUser,
    data: {
      name: string;
      query?: string;
      citySlug?: string;
      categorySlug?: string;
      skillSlugs?: string[];
      frequency?: 'DAILY' | 'WEEKLY';
    },
  ) {
    let cityId: string | null = null;
    let categoryId: string | null = null;
    if (data.citySlug) {
      const city = await this.prisma.city.findFirst({
        where: { slug: data.citySlug, ...ACTIVE_CATALOG },
      });
      cityId = city?.id ?? null;
    }
    if (data.categorySlug) {
      const cat = await this.prisma.jobCategory.findFirst({
        where: { slug: data.categorySlug, ...ACTIVE_CATALOG },
      });
      categoryId = cat?.id ?? null;
    }

    const queryNorm = (data.query || '').trim().toLowerCase();
    const skillSlugs = [...new Set((data.skillSlugs ?? []).map((s) => s.trim()).filter(Boolean))].sort();

    const existing = await this.prisma.jobAlert.findMany({
      where: {
        userId: user.id,
        cityId,
        categoryId,
        query: data.query?.trim() || null,
      },
      include: { skills: { include: { skill: true } } },
    });
    const dupe = existing.find((a) => {
      const aSkills = a.skills.map((s) => s.skill.slug).sort().join(',');
      const bSkills = skillSlugs.join(',');
      const aQuery = (a.query || '').trim().toLowerCase();
      return aQuery === queryNorm && aSkills === bSkills;
    });
    if (dupe) {
      throw new ConflictException('An identical job alert already exists');
    }

    const alert = await this.prisma.jobAlert.create({
      data: {
        userId: user.id,
        name: data.name.trim(),
        query: data.query?.trim() || null,
        cityId,
        categoryId,
        frequency: data.frequency ?? 'DAILY',
      },
    });

    for (const slug of skillSlugs) {
      try {
        const { skill } = await resolveSkill(this.prisma, { slug, allowCreate: false });
        await this.prisma.jobAlertSkill.create({
          data: { alertId: alert.id, skillId: skill.id },
        });
      } catch {
        /* unknown skill slug — skip */
      }
    }

    return this.prisma.jobAlert.findUnique({
      where: { id: alert.id },
      include: { city: true, category: true, skills: { include: { skill: true } } },
    });
  }

  async list(userId: string) {
    return this.prisma.jobAlert.findMany({
      where: { userId },
      include: { city: true, category: true, skills: { include: { skill: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, id: string) {
    const alert = await this.prisma.jobAlert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundException();
    await this.prisma.jobAlert.delete({ where: { id } });
    return { ok: true };
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      query?: string | null;
      citySlug?: string | null;
      categorySlug?: string | null;
      skillSlugs?: string[];
      frequency?: 'DAILY' | 'WEEKLY';
      isActive?: boolean;
    },
  ) {
    const alert = await this.prisma.jobAlert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundException();

    let cityId: string | null | undefined = undefined;
    let categoryId: string | null | undefined = undefined;
    if (data.citySlug !== undefined) {
      if (!data.citySlug) cityId = null;
      else {
        const city = await this.prisma.city.findFirst({
          where: { slug: data.citySlug, ...ACTIVE_CATALOG },
        });
        cityId = city?.id ?? null;
      }
    }
    if (data.categorySlug !== undefined) {
      if (!data.categorySlug) categoryId = null;
      else {
        const cat = await this.prisma.jobCategory.findFirst({
          where: { slug: data.categorySlug, ...ACTIVE_CATALOG },
        });
        categoryId = cat?.id ?? null;
      }
    }

    await this.prisma.jobAlert.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        query: data.query === undefined ? undefined : data.query?.trim() || null,
        cityId,
        categoryId,
        frequency: data.frequency,
        isActive: data.isActive,
      },
    });

    if (data.skillSlugs) {
      await this.prisma.jobAlertSkill.deleteMany({ where: { alertId: id } });
      for (const slug of [...new Set(data.skillSlugs.map((s) => s.trim()).filter(Boolean))]) {
        try {
          const { skill } = await resolveSkill(this.prisma, { slug, allowCreate: false });
          await this.prisma.jobAlertSkill.create({
            data: { alertId: id, skillId: skill.id },
          });
        } catch {
          /* skip unknown */
        }
      }
    }

    return this.prisma.jobAlert.findUnique({
      where: { id },
      include: { city: true, category: true, skills: { include: { skill: true } } },
    });
  }

  async processDueAlerts() {
    const alerts = await this.prisma.jobAlert.findMany({
      where: { isActive: true },
      include: {
        user: true,
        city: true,
        category: true,
        skills: { include: { skill: true } },
      },
    });

    for (const alert of alerts) {
      const since = alert.lastSentAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (alert.frequency === 'WEEKLY') {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (alert.lastSentAt && alert.lastSentAt > weekAgo) continue;
      } else if (
        alert.lastSentAt &&
        alert.lastSentAt > new Date(Date.now() - 20 * 60 * 60 * 1000)
      ) {
        continue;
      }

      const and: Record<string, unknown>[] = [
        { status: 'PUBLISHED' },
        { publishedAt: { gte: since } },
      ];
      if (alert.cityId) and.push({ cityId: alert.cityId });
      if (alert.categoryId) and.push({ categoryId: alert.categoryId });
      if (alert.query) {
        and.push({
          OR: [
            { title: { contains: alert.query, mode: 'insensitive' } },
            { description: { contains: alert.query, mode: 'insensitive' } },
          ],
        });
      }
      if (alert.skills.length) {
        and.push({
          jobSkills: {
            some: { skillId: { in: alert.skills.map((s) => s.skillId) } },
          },
        });
      }

      const jobs = await this.prisma.jobPost.findMany({
        where: { AND: and },
        take: 10,
        orderBy: { publishedAt: 'desc' },
        include: {
          company: { select: { name: true } },
          city: true,
        },
      });

      if (!jobs.length) continue;

      const list = jobs
        .map(
          (j) =>
            `<li><strong>${j.title}</strong> - ${j.company.name} (${j.city?.name ?? '-'})</li>`,
        )
        .join('');
      const locale = emailLocale(alert.user.locale);
      await this.mail.send(
        alert.user.email,
        translateMessage('email.jobAlert.subject', locale, { alert: alert.name }),
        `<p>${translateMessage('email.jobAlert.intro', locale, { alert: alert.name })}</p><ul>${list}</ul>`,
      );

      await this.notifications.create({
        userId: alert.userId,
        type: 'NEW_JOB_MATCH',
        title: `Job alert: ${alert.name}`,
        body: `${jobs.length} new matching job(s)`,
        titleKey: 'notify.jobAlert.title',
        bodyKey: 'notify.jobAlert.body',
        params: { alert: alert.name, count: jobs.length },
        linkUrl: `/jobs?q=${encodeURIComponent(alert.query || '')}`,
      });

      await this.prisma.jobAlert.update({
        where: { id: alert.id },
        data: { lastSentAt: new Date() },
      });
    }
  }

  async runNow() {
    await this.processDueAlerts();
    return { ok: true };
  }
}
