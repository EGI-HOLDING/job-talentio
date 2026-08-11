import type { PrismaClient } from '@prisma/client';
import { NEWS_ARTICLES } from './news-catalog';
import { NEWS_TRANSLATIONS } from './i18n/news-translations';

type Db = Pick<PrismaClient, 'newsArticle' | 'newsArticleTranslation'>;

/** Idempotent upsert of the curated news catalog and its uz/ru versions. */
export async function backfillNews(
  db: Db,
): Promise<{ upserted: number; translations: number }> {
  let upserted = 0;
  let translations = 0;

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
    const row = await db.newsArticle.upsert({
      where: { slug: article.slug },
      update: data,
      create: { slug: article.slug, ...data },
    });
    upserted += 1;

    const localized = NEWS_TRANSLATIONS[article.slug];
    if (!localized) continue;

    for (const [locale, value] of Object.entries(localized)) {
      const translation = {
        title: value.title,
        excerpt: value.excerpt,
        body: value.body,
        isMachine: false,
      };
      await db.newsArticleTranslation.upsert({
        where: { articleId_locale: { articleId: row.id, locale } },
        update: translation,
        create: { articleId: row.id, locale, ...translation },
      });
      translations += 1;
    }
  }

  return { upserted, translations };
}
