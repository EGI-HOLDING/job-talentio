import { Body, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { TelegramService } from './telegram.service';

/**
 * Public Telegram Bot API webhook. Authenticity is the secret token header,
 * not a JWT - same idea as billing webhooks.
 *
 * Telegram delivers updates with POST. GET is a probe so opening the URL
 * in a browser is not a 404.
 */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private telegram: TelegramService) {}

  @Get('webhook')
  @HttpCode(200)
  probe() {
    return { ok: true };
  }

  @Post('webhook')
  @HttpCode(200)
  handle(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      this.telegram.assertWebhookSecret(secret);
    } catch {
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }
    return this.telegram.handleUpdate(body);
  }
}
