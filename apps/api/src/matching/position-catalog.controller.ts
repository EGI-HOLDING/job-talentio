import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { RawLocaleNames } from '../common/locale.interceptor';
import { parseDto } from '../common/utils';
import { PositionCatalogService } from './position-catalog.service';

const requestSchema = z.object({
  q: z.string().max(160).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  scope: z.enum(['candidate', 'role', 'directory', 'hr']).default('candidate'),
  groupId: z.string().min(1).max(100).optional(),
  ids: z.string().max(1300).optional(),
  slugs: z.string().max(2000).optional(),
});

export function parsePositionRefs(value: string | undefined) {
  if (!value) return [];
  return parseDto(z.array(z.string().regex(/^(ROLE|GROUP):[a-zA-Z0-9:_-]{1,100}$/)).max(10), value.split(','))
    .map(ref => ({ kind: ref.startsWith('ROLE:') ? 'ROLE' as const : 'GROUP' as const, id: ref.slice(ref.indexOf(':') + 1) }));
}

@Controller('meta/positions')
@RawLocaleNames()
export class PositionCatalogController {
  constructor(private catalog: PositionCatalogService) {}

  @Get('groups/:id/job-scope')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('RECRUITER', 'SUPER_ADMIN')
  jobGroupScope(@Param('id') id: string) {
    return this.catalog.previewJobGroup(id);
  }

  @Get('search')
  async search(@Query() query: unknown) {
    const input = parseDto(requestSchema, query);
    let selections = input.ids || input.slugs ? parsePositionRefs(input.ids) : undefined;
    if (input.slugs) {
      const { slugs } = await this.catalog.snapshot();
      const roles = input.slugs.split(',').slice(0, 10).flatMap(slug => slugs.get(slug) ?? []);
      selections = [...selections ?? [], ...roles.map(id => ({ id, kind: 'ROLE' as const }))];
    }
    return this.catalog.search({ ...input, selections });
  }
}

@Controller('admin/positions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@RawLocaleNames()
export class AdminPositionCatalogController {
  constructor(private catalog: PositionCatalogService) {}

  @Get('search')
  search(@Query() query: unknown) {
    const input = parseDto(requestSchema, query);
    return this.catalog.search({ ...input, scope: 'admin', selections: input.ids ? parsePositionRefs(input.ids) : undefined });
  }
}
