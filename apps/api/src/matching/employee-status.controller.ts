import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AuthUser } from '../common/auth.decorators';
import { EmployeeIntentService } from './employee-intent.service';

@Controller('profiles/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('EMPLOYEE','SUPER_ADMIN')
export class EmployeeMatchingStatusController {
  constructor(private intent:EmployeeIntentService) {}
  @Get('matching-status')
  status(@CurrentUser() user:AuthUser) { return this.intent.status(user.id); }
}
