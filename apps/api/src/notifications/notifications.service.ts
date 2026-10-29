import { Injectable, Optional } from '@nestjs/common';
import { LiveUpdates } from '../common/live-updates';
import { NotificationType, Prisma } from '@prisma/client';
import { translateMessage } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';

type MessageParams = Record<string, string | number>;

type NotificationRow = {
  title: string;
  body: string | null;
  messageKey: string | null;
  messageParams: Prisma.JsonValue | null;
};

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, @Optional() private live?: LiveUpdates) {}

  /**
   * `titleKey`/`bodyKey` are preferred: the text is rendered per reader, so an
   * old notification follows the user when they switch language. `title`/`body`
   * remain for anything without a dictionary entry.
   */
  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    linkUrl?: string;
    titleKey?: string;
    bodyKey?: string;
    params?: MessageParams;
  }) {
    const { titleKey, bodyKey, params, ...rest } = data;
    const result = await this.prisma.notification.create({
      data: {
        ...rest,
        messageKey: titleKey ?? null,
        messageParams: titleKey
          ? ({ ...(params ?? {}), ...(bodyKey ? { __bodyKey: bodyKey } : {}) } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    this.live?.publish([data.userId], 'notifications');
    return result;
  }

  private render<T extends NotificationRow>(row: T, locale: Locale): T {
    if (!row.messageKey) return row;

    const params = (row.messageParams ?? {}) as Record<string, string | number> & {
      __bodyKey?: string;
    };
    const { __bodyKey: bodyKey, ...rest } = params;

    // Pipeline stages arrive as raw enums; render them as words too.
    if (typeof rest.status === 'string') {
      rest.status = translateMessage(`status.${rest.status}`, locale);
    }

    return {
      ...row,
      title: translateMessage(row.messageKey, locale, rest),
      body: bodyKey ? translateMessage(bodyKey, locale, rest) : row.body,
    };
  }

  async list(userId: string, page = 1, limit = 30, locale: string = DEFAULT_LOCALE) {
    const active = isLocale(locale) ? locale : DEFAULT_LOCALE;
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: items.map((item) => this.render(item, active)),
      total,
      unread,
      page,
      limit,
    };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
