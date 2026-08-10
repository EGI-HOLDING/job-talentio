import { Controller, Get, Param, Query } from '@nestjs/common';
import { newsBrowseSchema, newsLatestSchema } from '@job-talentio/shared';
import { NewsService } from './news.service';
import { parseDto } from '../common/utils';

@Controller('news')
export class NewsController {
  constructor(private news: NewsService) {}

  @Get()
  browse(@Query() query: unknown) {
    const data = parseDto(newsBrowseSchema, query);
    return this.news.browse({
      category: data.category,
      page: data.page ?? 1,
      limit: data.limit ?? 12,
    });
  }

  @Get('latest')
  latest(@Query() query: unknown) {
    const data = parseDto(newsLatestSchema, query);
    return this.news.latest(data.limit ?? 4);
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.news.getBySlug(slug);
  }
}
