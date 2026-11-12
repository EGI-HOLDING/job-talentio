import { BadRequestException, Controller, Headers, HttpCode, NotFoundException, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Webhook } from 'standardwebhooks';
import { PrismaService } from '../../prisma/prisma.service';
import { queueCvProviderWork } from './cv-assessment-store';
import { isCvResponseId } from './cv-provider';

const events = new Set(['response.completed', 'response.failed', 'response.incomplete', 'response.cancelled']);

@Controller('recruitment/provider')
export class CvWebhookController {
  constructor(private readonly config: ConfigService, private readonly db: PrismaService) {}

  @Post('openai')
  @HttpCode(204)
  async receive(@Req() request: RawBodyRequest<Request>, @Headers() headers: Request['headers']) {
    const secret = this.config.get<string>('OPENAI_CV_WEBHOOK_SECRET');
    if (!secret) throw new NotFoundException();
    const webhookId = headers['webhook-id'], timestamp = headers['webhook-timestamp'], signature = headers['webhook-signature'];
    if (!request.rawBody || typeof webhookId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(webhookId) ||
      typeof timestamp !== 'string' || typeof signature !== 'string') throw new BadRequestException('Webhook tidak valid.');
    let event: { type?: string; data?: { id?: string } };
    try {
      event = new Webhook(secret).verify(request.rawBody, {
        'webhook-id': webhookId, 'webhook-timestamp': timestamp, 'webhook-signature': signature,
      }) as typeof event;
    } catch { throw new BadRequestException('Tanda tangan webhook tidak valid.'); }
    if (event?.type && events.has(event.type) && isCvResponseId(event.data?.id))
      await queueCvProviderWork(this.db, 'CV_PROVIDER_EVENT', event.data.id, webhookId);
  }
}
