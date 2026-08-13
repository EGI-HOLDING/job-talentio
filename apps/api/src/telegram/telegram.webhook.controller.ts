import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { TelegramService } from './telegram.service';

/**
 * Public Telegram Bot API webhook. Authenticity is the secret token header,
 * not a JWT - same idea as billing webhooks.
 */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private telegram: TelegramService) {}

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
