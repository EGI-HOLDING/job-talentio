import type { MetadataRoute } from 'next';
import { LOCALES } from '@/lib/locale';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobtalent.io').replace(/\/$/, '');

const STATIC_PATHS = ['', '/jobs', '/news', '/explore/categories', '/explore/cities', '/explore/companies'];

/** Every URL is emitted once per locale with hreflang alternates. */
function entry(path: string, lastModified?: Date): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => ({
    url: `${SITE_URL}/${locale}${path}`,
    lastModified,
    alternates: {
      languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])),
    },
  }));
}

async function fetchList<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: T[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [jobs, news] = await Promise.all([
    fetchList<{ id: string; updatedAt?: string }>('/jobs?limit=200&sort=newest'),
    fetchList<{ slug: string; publishedAt?: string }>('/news?limit=24'),
  ]);

  return [
    ...STATIC_PATHS.flatMap((path) => entry(path)),
    ...jobs.flatMap((job) =>
      entry(`/jobs/${job.id}`, job.updatedAt ? new Date(job.updatedAt) : undefined),
    ),
    ...news.flatMap((article) =>
      entry(
        `/news/${article.slug}`,
        article.publishedAt ? new Date(article.publishedAt) : undefined,
      ),
    ),
  ];
}
