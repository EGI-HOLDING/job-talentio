import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { newsBrowseSchema, newsLatestSchema } from '@job-talentio/shared';
import { NewsService } from './news.service';
import { parseDto } from '../common/utils';
import { requestLocale } from '../common/i18n/request-locale';

@Controller('news')
export class NewsController {
  constructor(private news: NewsService) {}

  @Get()
  browse(@Query() query: unknown, @Req() req: Request) {
    const data = parseDto(newsBrowseSchema, query);
    return this.news.browse({
      category: data.category,
      page: data.page ?? 1,
      limit: data.limit ?? 12,
      locale: requestLocale(req),
    });
  }

  @Get('latest')
  latest(@Query() query: unknown, @Req() req: Request) {
    const data = parseDto(newsLatestSchema, query);
    return this.news.latest(data.limit ?? 4, requestLocale(req));
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string, @Req() req: Request) {
    return this.news.getBySlug(slug, requestLocale(req));
  }
}
