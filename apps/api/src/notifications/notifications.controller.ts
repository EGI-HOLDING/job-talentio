import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { requestLocale } from '../common/i18n/request-locale';
import { notificationListSchema } from '@job-talentio/shared';
import { parseDto } from '../common/utils';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Req() req: Request, @Query() query: unknown) {
    const data = parseDto(notificationListSchema, query);
    return this.notifications.list(user.id, data.page, 30, requestLocale(req));
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id).then((count) => ({ count }));
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }
}
