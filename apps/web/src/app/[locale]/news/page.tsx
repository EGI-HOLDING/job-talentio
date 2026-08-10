import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsListClient } from './NewsListClient';

export const metadata: Metadata = {
  title: 'News - Job Talentio',
  description:
    'Career news, labor-market insights, events and education updates across Uzbekistan.',
};

export default function NewsPage() {
  return (
    <Suspense fallback={null}>
      <NewsListClient />
    </Suspense>
  );
}
