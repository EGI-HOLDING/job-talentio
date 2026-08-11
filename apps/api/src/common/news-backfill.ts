import type { PrismaClient } from '@prisma/client';
import { NEWS_ARTICLES } from './news-catalog';

type Db = Pick<PrismaClient, 'newsArticle'>;

/** Idempotent upsert of the curated news catalog (keyed by slug). */
export async function backfillNews(db: Db): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const article of NEWS_ARTICLES) {
    const data = {
      category: article.category,
      title: article.title,
      excerpt: article.excerpt,
      body: article.body,
      coverUrl: article.coverUrl,
      coverCredit: article.coverCredit,
      sourceName: article.sourceName,
      sourceUrl: article.sourceUrl,
      locale: article.locale,
      publishedAt: new Date(article.publishedAt),
      isPublished: true,
    };
    await db.newsArticle.upsert({
      where: { slug: article.slug },
      update: data,
      create: { slug: article.slug, ...data },
    });
    upserted += 1;
  }
  return { upserted };
}
