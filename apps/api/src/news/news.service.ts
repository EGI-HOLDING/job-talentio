import { Injectable, NotFoundException } from '@nestjs/common';
import { NewsCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const LIST_SELECT = {
  slug: true,
  category: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  coverCredit: true,
  sourceName: true,
  publishedAt: true,
} satisfies Prisma.NewsArticleSelect;

@Injectable()
export class NewsService {
  constructor(private prisma: PrismaService) {}

  async browse(query: { category?: NewsCategory; page: number; limit: number }) {
    const limit = Math.min(Math.max(query.limit || 12, 1), 24);
    const where: Prisma.NewsArticleWhereInput = {
      isPublished: true,
      ...(query.category ? { category: query.category } : {}),
    };

    const total = await this.prisma.newsArticle.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const safePage = Math.min(Math.max(query.page || 1, 1), total === 0 ? 1 : totalPages);

    const items = await this.prisma.newsArticle.findMany({
      where,
      select: LIST_SELECT,
      orderBy: { publishedAt: 'desc' },
      skip: (safePage - 1) * limit,
      take: limit,
    });

    return { items, total, page: safePage, limit, totalPages };
  }

  latest(limit: number) {
    return this.prisma.newsArticle
      .findMany({
        where: { isPublished: true },
        select: LIST_SELECT,
        orderBy: { publishedAt: 'desc' },
        take: Math.min(Math.max(limit || 4, 1), 8),
      })
      .then((items) => ({ items }));
  }

  async getBySlug(slug: string) {
    const article = await this.prisma.newsArticle.findUnique({ where: { slug } });
    if (!article || !article.isPublished) throw new NotFoundException('Article not found');
    return article;
  }
}
