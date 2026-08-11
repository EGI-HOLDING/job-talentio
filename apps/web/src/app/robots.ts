import type { MetadataRoute } from 'next';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobtalent.io').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Authenticated surfaces carry no public value and can leak query noise.
      disallow: ['/*/dashboard/', '/*/settings', '/*/messages', '/*/billing/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
