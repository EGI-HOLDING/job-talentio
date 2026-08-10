import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../common/auth.decorators';

const MAX_IDS = 50;

@Controller('presence')
export class PresenceController {
  constructor(private presence: PresenceService) {}

  /** Batch presence for list hydration: GET /presence?ids=a,b,c */
  @Get()
  @UseGuards(JwtAuthGuard)
  get(@Query('ids') ids?: string) {
    const list = (ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) throw new BadRequestException('ids query param is required');
    if (list.length > MAX_IDS) throw new BadRequestException(`At most ${MAX_IDS} ids per request`);
    return this.presence.getPresence(list);
  }
}
