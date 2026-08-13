import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { newsBrowseSchema, newsLatestSchema } from '@job-talentio/shared';
import { NewsService } from './news.service';
import { parseDto } from '../common/utils';
import { requestLocale } from '../common/i18n/request-locale';
import { isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { OptionalJwtAuthGuard } from '../common/auth.decorators';
import { SearchRateLimitGuard } from '../rate-limit/search-rate-limit.guard';

function assertLocale(value: string): Locale {
  if (!isLocale(value)) throw new BadRequestException('Unsupported locale');
  return value;
}

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

  /** Guests included. Rate limited and budgeted: first miss pays, later readers cache. */
  @Post('slug/:slug/translate/:locale')
  @UseGuards(OptionalJwtAuthGuard, SearchRateLimitGuard)
  machineTranslate(@Param('slug') slug: string, @Param('locale') locale: string) {
    return this.news.machineTranslate(slug, assertLocale(locale));
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string, @Req() req: Request) {
    return this.news.getBySlug(slug, requestLocale(req));
  }
}
