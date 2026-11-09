import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard, type AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { GenerateJobContentInput, generateJobContentSchema } from './job-content-ai.schema';
import { JobContentAiService } from './job-content-ai.service';

@Controller('job-content-ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('RECRUITER', 'SUPER_ADMIN')
export class JobContentAiController {
  constructor(private readonly content: JobContentAiService) {}

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.content.generate(user, parseDto(generateJobContentSchema, body) as GenerateJobContentInput);
  }
}
