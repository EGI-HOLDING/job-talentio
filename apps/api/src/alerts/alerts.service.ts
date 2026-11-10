import { liveJobWhere } from '../benefits/benefit-policy';
import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { desiredSelectionsSchema, translateMessage, type DesiredSelection } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { emailLocale } from '../common/i18n/email-locale';
import { displayCompanyName } from '../common/anonymous-job';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { AuthUser } from '../common/auth.decorators';
import { resolveSkill } from '../common/skill-resolve';
import { resolveJobLocation } from '../common/geo-selection';
import { PositionCatalogService } from '../matching/position-catalog.service';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { isDemoMailbox } from '../common/demo-mailboxes';
import {
  buildAlertJobsListPath,
  buildInAppJobAlert,
  buildJobAlertEmailHtml,
  buildJobAlertTelegramText,
  decideAlertChannels,
  ensureDeliverableAlertChannels,
  hasAnyAlertChannel,
  shouldStampLastSentAt,
  alertMatchSince,
} from './alerts.deliver';

@Injectable()
export class AlertsService {
  private queue: Queue | null = null;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private positions: PositionCatalogService,
  ) {}

  private async positionView<T extends { positionSelections: unknown }>(rows: T[]) {
    const selections = rows.map(row => desiredSelectionsSchema.parse(row.positionSelections));
    const key = (value: DesiredSelection) => value.kind + ':' + value.id;
    const options = await this.positions.describe([...new Map(selections.flat().map(value => [key(value), value])).values()]);
    const labels = new Map(options.map(value => [key(value), value]));
    return rows.map((row, i) => ({ ...row, positionSelections: selections[i].map(value => labels.get(key(value))!) }));
  }

  setQueue(queue: Queue) {
    this.queue = queue;
  }

  private async userHasTelegram(userId: string) {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true },
    });
    return Boolean(row?.telegramId);
  }

  private async resolveAlertChannels(
    userId: string,
    flags: { notifyInApp?: boolean; notifyEmail?: boolean; notifyTelegram?: boolean },
    current?: { notifyInApp: boolean; notifyEmail: boolean; notifyTelegram: boolean },
  ) {
    const linked = await this.userHasTelegram(userId);
    const notifyInApp = flags.notifyInApp ?? current?.notifyInApp ?? true;
    const notifyEmail = flags.notifyEmail ?? current?.notifyEmail ?? true;
    let notifyTelegram = flags.notifyTelegram ?? current?.notifyTelegram ?? false;
    if (!linked && (current == null || flags.notifyTelegram === true)) {
      notifyTelegram = false;
    }
    return ensureDeliverableAlertChannels({ notifyInApp, notifyEmail, notifyTelegram });
  }

  async create(
    user: AuthUser,
    data: {
      name: string;
      query?: string;
      positionSelections?: DesiredSelection[];
      citySlug?: string;
      countryId?: string | null;
      categorySlug?: string;
      skillSlugs?: string[];
      frequency?: 'DAILY' | 'WEEKLY';
      notifyInApp?: boolean;
      notifyEmail?: boolean;
      notifyTelegram?: boolean;
    },
  ) {
    const { cityId, countryId } = await resolveJobLocation(this.prisma, data);
    let categoryId: string | null = null;
    if (data.categorySlug) {
      const cat = await this.prisma.jobCategory.findFirst({
        where: { slug: data.categorySlug, ...ACTIVE_CATALOG },
      });
      categoryId = cat?.id ?? null;
    }

    if (data.query?.trim()) throw new BadRequestException('Select a position from the catalog');
    const positionSelections = await this.positions.validate(data.positionSelections ?? []);
    const selectionKey = (rows: DesiredSelection[]) => rows.map(row => row.kind + ':' + row.id).sort().join(',');
    const skillSlugs = [...new Set((data.skillSlugs ?? []).map((s) => s.trim()).filter(Boolean))].sort();

    const existing = await this.prisma.jobAlert.findMany({
      where: {
        userId: user.id,
        cityId,
        countryId,
        categoryId,
        positionReviewRequired: false,
      },
      include: { skills: { include: { skill: true } } },
    });
    const dupe = existing.find((a) => {
      const aSkills = a.skills.map((s) => s.skill.slug).sort().join(',');
      const bSkills = skillSlugs.join(',');
      return selectionKey(desiredSelectionsSchema.parse(a.positionSelections)) === selectionKey(positionSelections) && aSkills === bSkills;
    });
    if (dupe) {
      throw new ConflictException('An identical job alert already exists');
    }

    const channels = await this.resolveAlertChannels(user.id, {
      notifyInApp: data.notifyInApp,
      notifyEmail: data.notifyEmail,
      notifyTelegram: data.notifyTelegram,
    });

    const alert = await this.prisma.jobAlert.create({
      data: {
        userId: user.id,
        name: data.name.trim(),
        positionSelections,
        cityId,
        countryId,
        categoryId,
        frequency: data.frequency ?? 'DAILY',
        ...channels,
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

    const row = await this.prisma.jobAlert.findUniqueOrThrow({
      where: { id: alert.id },
      include: { city: { include: { province: { include: { country: true } } } }, country: true, category: true, skills: { include: { skill: true } } },
    });
    return (await this.positionView([row]))[0];
  }

  async list(userId: string) {
    const rows = await this.prisma.jobAlert.findMany({
      where: { userId },
      include: { city: { include: { province: { include: { country: true } } } }, country: true, category: true, skills: { include: { skill: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return this.positionView(rows);
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
      positionSelections?: DesiredSelection[];
      citySlug?: string | null;
      countryId?: string | null;
      categorySlug?: string | null;
      skillSlugs?: string[];
      frequency?: 'DAILY' | 'WEEKLY';
      isActive?: boolean;
      notifyInApp?: boolean;
      notifyEmail?: boolean;
      notifyTelegram?: boolean;
    },
  ) {
    const alert = await this.prisma.jobAlert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundException();
    if (data.query?.trim()) throw new BadRequestException('Select a position from the catalog');
    const selections = data.positionSelections === undefined ? undefined : await this.positions.validate(data.positionSelections);
    if (alert.positionReviewRequired && selections && !selections.length) {
      throw new BadRequestException('Select a position to resume this alert');
    }

    const { cityId, countryId } = await resolveJobLocation(this.prisma, data, alert);
    let categoryId: string | null | undefined = undefined;
    if (data.categorySlug !== undefined) {
      if (!data.categorySlug) categoryId = null;
      else {
        const cat = await this.prisma.jobCategory.findFirst({
          where: { slug: data.categorySlug, ...ACTIVE_CATALOG },
        });
        categoryId = cat?.id ?? null;
      }
    }

    const channels = await this.resolveAlertChannels(
      userId,
      {
        notifyInApp: data.notifyInApp,
        notifyEmail: data.notifyEmail,
        notifyTelegram: data.notifyTelegram,
      },
      alert,
    );

    await this.prisma.jobAlert.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        positionSelections: selections,
        positionReviewRequired: selections === undefined ? undefined : false,
        cityId,
        countryId,
        categoryId,
        frequency: data.frequency,
        isActive: data.isActive,
        ...channels,
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

    const row = await this.prisma.jobAlert.findUniqueOrThrow({
      where: { id },
      include: { city: { include: { province: { include: { country: true } } } }, country: true, category: true, skills: { include: { skill: true } } },
    });
    return (await this.positionView([row]))[0];
  }

  async processDueAlerts() {
    const alerts = await this.prisma.jobAlert.findMany({
      where: { isActive: true, positionReviewRequired: false },
      include: {
        user: true,
        country: true,
        city: true,
        category: true,
        skills: { include: { skill: true } },
      },
    });

    for (const alert of alerts) {
      if (!hasAnyAlertChannel(alert)) continue;
      const since = alertMatchSince(alert);
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
        liveJobWhere(),
        { company: { isBanned: false, anonymizedAt: null } },
        { publishedAt: { gte: since } },
      ];
      if (alert.cityId) and.push({ cityId: alert.cityId });
      if (alert.countryId) and.push({ OR: [{ countryId: alert.countryId }, { countryId: null, city: { province: { countryId: alert.countryId } } }] });
      if (alert.categoryId) and.push({ categoryId: alert.categoryId });
      const selections = desiredSelectionsSchema.parse(alert.positionSelections);
      if (selections.length) {
        const ids = await this.positions.jobTitleIds(selections);
        if (!ids.length) continue;
        and.push({ jobTitleId: { in: ids } });
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
          country: true,
        },
      });

      if (!jobs.length) continue;

      const locale = emailLocale(alert.user.locale);
      const digestJobs = jobs.map((j) => ({
        id: j.id,
        title: j.title,
        companyName: displayCompanyName(j, j.company.name, locale),
        cityName: j.city?.name ?? j.country?.name ?? null,
      }));
      const decisions = decideAlertChannels(
        {
          notifyInApp: alert.notifyInApp,
          notifyEmail: alert.notifyEmail,
          notifyTelegram: alert.notifyTelegram,
        },
        {
          emailVerified: alert.user.emailVerified,
          demoMailbox: isDemoMailbox(alert.user.email ?? ''),
          telegramId: alert.user.telegramId,
          telegramConfigured: this.telegram.isConfigured(),
        },
      );

      const results: { inApp?: boolean; email?: boolean; telegram?: boolean } = {};

      if (decisions.inApp === 'send') {
        try {
          const inApp = buildInAppJobAlert({
            alertName: alert.name,
            jobs: digestJobs,
            listPath: buildAlertJobsListPath({ ...alert, query: null, positionSelections: selections }),
          });
          await this.notifications.create({
            userId: alert.userId,
            type: 'NEW_JOB_MATCH',
            title: inApp.title,
            body: inApp.body,
            titleKey: inApp.titleKey,
            bodyKey: inApp.bodyKey,
            params: inApp.params,
            linkUrl: inApp.linkUrl,
          });
          results.inApp = true;
        } catch {
          results.inApp = false;
        }
      }

      if (decisions.email === 'send' && alert.user.email) {
        const sent = await this.mail.send(
          alert.user.email,
          translateMessage('email.jobAlert.subject', locale, { alert: alert.name }),
          buildJobAlertEmailHtml({ locale, alertName: alert.name, jobs: digestJobs }),
        );
        results.email = Boolean(sent) && !((sent as { skipped?: boolean })?.skipped);
      }

      if (decisions.telegram === 'send' && alert.user.telegramId) {
        results.telegram = await this.telegram.sendMessage(
          alert.user.telegramId,
          buildJobAlertTelegramText({ locale, alertName: alert.name, jobs: digestJobs }),
        );
      }

      if (shouldStampLastSentAt(decisions, results)) {
        await this.prisma.jobAlert.update({
          where: { id: alert.id },
          data: { lastSentAt: new Date() },
        });
      }
    }
  }

  async runNow() {
    await this.processDueAlerts();
    return { ok: true };
  }
}
