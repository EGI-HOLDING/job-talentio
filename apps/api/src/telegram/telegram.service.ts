import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'crypto';
import { translateMessage } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../common/dedupe';
import { emailLocale } from '../common/i18n/email-locale';
import { decideBareStart, decideTokenLink } from './telegram.link';

const LINK_TTL_MS = 15 * 60 * 1000;

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.botToken() && this.botUsername());
  }

  private botToken(): string {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN', '').trim();
  }

  private botUsername(): string {
    return this.config.get<string>('TELEGRAM_BOT_USERNAME', '').replace(/^@/, '').trim();
  }

  private webhookSecret(): string {
    return this.config.get<string>('TELEGRAM_WEBHOOK_SECRET', '').trim();
  }

  async onModuleInit() {
    const token = this.botToken();
    const apiUrl = (this.config.get<string>('API_URL', '') || '').replace(/\/$/, '');
    const secret = this.webhookSecret();
    if (!token || !apiUrl) return;
    try {
      await this.telegramCall('setWebhook', {
        url: `${apiUrl}/api/telegram/webhook`,
        ...(secret ? { secret_token: secret } : {}),
      });
      this.logger.log('Telegram webhook registered');
    } catch (err) {
      this.logger.warn(`Telegram setWebhook failed: ${(err as Error).message}`);
    }
  }

  assertWebhookSecret(header: string | undefined) {
    const expected = this.webhookSecret();
    if (!expected) return;
    const got = header || '';
    const a = Buffer.from(expected);
    const b = Buffer.from(got);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }
  }

  async createLink(userId: string) {
    if (!this.isConfigured()) {
      throw new BadRequestException('Telegram alerts are not configured');
    }
    const raw = randomBytes(24).toString('hex');
    await this.prisma.telegramLinkToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
    await this.prisma.telegramLinkToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
      },
    });
    const url = `https://t.me/${this.botUsername()}?start=${raw}`;
    return { url, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() };
  }

  async unlink(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { telegramId: null },
    });
    await this.prisma.telegramLinkToken.deleteMany({ where: { userId } });
    return { ok: true, telegramLinked: false };
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.botToken()) return false;
    try {
      await this.telegramCall('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      });
      return true;
    } catch (err) {
      this.logger.warn(`Telegram sendMessage failed: ${(err as Error).message}`);
      return false;
    }
  }

  async handleUpdate(body: unknown) {
    const update = (body ?? {}) as TelegramUpdate;
    const chatId = update.message?.chat?.id;
    const text = (update.message?.text || '').trim();
    if (chatId == null || !text) return { ok: true };

    const chat = String(chatId);
    const linked = await this.prisma.user.findUnique({
      where: { telegramId: chat },
      select: { id: true, locale: true },
    });
    const chatLocale = linked ? emailLocale(linked.locale) : 'uz';

    if (text === '/stop' || text.startsWith('/stop ')) {
      await this.prisma.user.updateMany({
        where: { telegramId: chat },
        data: { telegramId: null },
      });
      await this.sendMessage(chat, translateMessage('telegram.link.stopped', chatLocale));
      return { ok: true };
    }

    const startMatch = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([a-f0-9]{32,96}))?$/i);
    if (!startMatch) {
      await this.sendMessage(chat, translateMessage('telegram.link.help', chatLocale));
      return { ok: true };
    }

    const rawToken = startMatch[1];
    if (!rawToken) {
      const key =
        decideBareStart(linked?.id ?? null) === 'already'
          ? 'telegram.link.already'
          : 'telegram.link.help';
      await this.sendMessage(chat, translateMessage(key, chatLocale));
      return { ok: true };
    }

    const tokenHash = sha256(rawToken);
    const row = await this.prisma.telegramLinkToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, locale: true } } },
    });
    if (!row || row.expiresAt < new Date()) {
      if (row) await this.prisma.telegramLinkToken.delete({ where: { id: row.id } }).catch(() => undefined);
      await this.sendMessage(chat, translateMessage('telegram.link.expired', chatLocale));
      return { ok: true };
    }

    const locale = emailLocale(row.user.locale);
    const decision = decideTokenLink(row.userId, linked?.id ?? null);
    if (decision === 'taken') {
      await this.sendMessage(chat, translateMessage('telegram.link.taken', locale));
      return { ok: true };
    }

    if (decision === 'already') {
      await this.prisma.telegramLinkToken.deleteMany({ where: { userId: row.userId } });
      await this.sendMessage(chat, translateMessage('telegram.link.already', locale));
      return { ok: true };
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { telegramId: chat },
      }),
      this.prisma.telegramLinkToken.deleteMany({ where: { userId: row.userId } }),
    ]);

    await this.sendMessage(chat, translateMessage('telegram.link.ok', locale));
    return { ok: true };
  }

  private async telegramCall(method: string, payload: Record<string, unknown>) {
    const token = this.botToken();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || json.ok === false) {
      throw new Error(json.description || `Telegram ${method} failed (${res.status})`);
    }
    return json;
  }
}
