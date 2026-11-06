import { EMPLOYEE_INTENT_VERSION } from '@job-talentio/shared';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'job-talentio-api', candidateMatchingVersion:EMPLOYEE_INTENT_VERSION, ts: new Date().toISOString() };
  }
}
