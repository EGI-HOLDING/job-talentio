import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isSecureRuntime } from '../common/jwt-secret';
import { sha256 } from '../common/dedupe';
import { TelegramService } from './telegram.service';

/** Development receiver for phone sign-in when Telegram cannot reach localhost. */
@Injectable()
export class TelegramLocalPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramLocalPollingService.name);
  private stopped = false;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private offset = 0;
  ready = false;

  constructor(private config: ConfigService, private prisma: PrismaService, private telegram: TelegramService) {}

  async onModuleInit() {
    if (this.config.get('TELEGRAM_DEV_POLLING') !== 'true') return;
    let local = false;
    try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(this.config.get('DATABASE_URL', '')).hostname); } catch { /* unavailable */ }
    if (isSecureRuntime() || !local || !this.telegram.isConfigured()) {
      this.logger.warn('Local Telegram polling requires development, a local database and bot credentials');
      return;
    }
    try {
      const info = await this.call('getWebhookInfo', {});
      if (info.result?.url) { this.logger.warn('Local Telegram polling disabled: this bot already has a webhook'); return; }
      this.ready = true;
      this.logger.log('Local Telegram phone sign-in receiver enabled');
      void this.poll();
    } catch { this.logger.warn('Local Telegram receiver could not connect'); }
  }

  onModuleDestroy() {
    this.stopped = true; this.ready = false; this.controller?.abort();
    if (this.timer) clearTimeout(this.timer);
  }

  private async call(method: string, body: Record<string, unknown>) {
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 30_000);
    try {
      const token = this.config.get<string>('TELEGRAM_BOT_TOKEN', '').trim();
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: this.controller.signal });
      const result = await response.json() as { ok: boolean; error_code?: number; result?: any };
      if (!response.ok || !result.ok) throw new Error(response.status === 409 || result.error_code === 409 ? 'CONFLICT' : 'UNAVAILABLE');
      return result;
    } finally { clearTimeout(timeout); }
  }

  private async poll() {
    if (this.stopped) return;
    try {
      const response = await this.call('getUpdates', { offset: this.offset, timeout: 20, allowed_updates: ['message'] });
      for (const update of response.result || []) {
        if (this.stopped) break;
        await this.handleLocalLogin(update);
        this.offset = update.update_id + 1;
      }
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof Error && error.message === 'CONFLICT') { this.ready = false; this.logger.warn('Local Telegram polling stopped: another receiver is active'); return; }
      this.logger.warn('Local Telegram polling will retry after a connection failure');
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 1000);
  }

  private async handleLocalLogin(update: any) {
    const message = update.message;
    if (!message || message.chat?.type !== 'private' || !message.from?.id || message.chat.id !== message.from.id) return;
    // Handle only sign-ins started in this local database. Other bot activity is ignored.
    const start = String(message.text || '').match(/^\/start(?:@[A-Za-z0-9_]+)?\s+phone_([a-f0-9]{32,96})$/i);
    const pending = start
      ? await this.prisma.phoneLoginToken.findFirst({ where: { tokenHash: sha256(start[1]), status: 'PENDING', expiresAt: { gt: new Date() } }, select: { id: true } })
      : message.contact ? await this.prisma.phoneLoginToken.findFirst({ where: { chatId: String(message.chat.id), status: 'CONTACT_REQUESTED', expiresAt: { gt: new Date() } }, select: { id: true } }) : null;
    if (pending) await this.telegram.handleUpdate(update);
  }
}
