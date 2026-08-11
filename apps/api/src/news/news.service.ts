import { Injectable, NotFoundException } from '@nestjs/common';
import { NewsCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveContent } from '../common/i18n/content-locale';
import type { Locale } from '../common/i18n/locale';

const LIST_SELECT = {
  id: true,
  slug: true,
  category: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  coverCredit: true,
  sourceName: true,
  locale: true,
  publishedAt: true,
  translations: { select: { locale: true, title: true, excerpt: true, isMachine: true } },
} satisfies Prisma.NewsArticleSelect;

type ListRow = Prisma.NewsArticleGetPayload<{ select: typeof LIST_SELECT }>;

@Injectable()
export class NewsService {
  constructor(private prisma: PrismaService) {}

  /** Cards only need the headline pair, so translations are resolved in memory. */
  private toCard(row: ListRow, locale: Locale) {
    const { translations, locale: sourceLocale, id: _id, ...article } = row;
    const resolved = resolveContent(
      { title: article.title, excerpt: article.excerpt },
      sourceLocale,
      translations,
      locale,
    );
    return {
      ...article,
      ...resolved.content,
      contentLocale: resolved.contentLocale,
      isMachineTranslated: resolved.isMachineTranslated,
    };
  }

  async browse(query: {
    category?: NewsCategory;
    page: number;
    limit: number;
    locale: Locale;
  }) {
    const limit = Math.min(Math.max(query.limit || 12, 1), 24);
    const where: Prisma.NewsArticleWhereInput = {
      isPublished: true,
      ...(query.category ? { category: query.category } : {}),
    };

    const total = await this.prisma.newsArticle.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const safePage = Math.min(Math.max(query.page || 1, 1), total === 0 ? 1 : totalPages);

    const rows = await this.prisma.newsArticle.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { publishedAt: 'desc' },
      skip: (safePage - 1) * limit,
      take: limit,
    });

    return {
      items: rows.map((row) => this.toCard(row, query.locale)),
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  async latest(limit: number, locale: Locale) {
    const rows = await this.prisma.newsArticle.findMany({
      where: { isPublished: true },
      select: LIST_SELECT,
      orderBy: { publishedAt: 'desc' },
      take: Math.min(Math.max(limit || 4, 1), 8),
    });
    return { items: rows.map((row) => this.toCard(row, locale)) };
  }

  async getBySlug(slug: string, locale: Locale) {
    const article = await this.prisma.newsArticle.findUnique({
      where: { slug },
      include: {
        translations: {
          select: { locale: true, title: true, excerpt: true, body: true, isMachine: true },
        },
      },
    });
    if (!article || !article.isPublished) throw new NotFoundException('Article not found');

    const { translations, ...rest } = article;
    const resolved = resolveContent(
      { title: rest.title, excerpt: rest.excerpt, body: rest.body },
      rest.locale,
      translations,
      locale,
    );

    return {
      ...rest,
      ...resolved.content,
      contentLocale: resolved.contentLocale,
      isMachineTranslated: resolved.isMachineTranslated,
      availableLocales: resolved.availableLocales,
    };
  }
}
