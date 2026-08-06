import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { jobAlertSchema } from '@job-talentio/shared';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get()
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  list(@CurrentUser() user: AuthUser) {
    return this.alerts.list(user.id);
  }

  @Post('run')
  @Roles('SUPER_ADMIN')
  run() {
    return this.alerts.runNow();
  }

  @Post()
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(jobAlertSchema, body);
    return this.alerts.create(user, data);
  }

  @Delete(':id')
  @Roles('EMPLOYEE', 'SUPER_ADMIN')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.alerts.remove(user.id, id);
  }
}
