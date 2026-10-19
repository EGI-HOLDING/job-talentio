import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsListClient } from './NewsListClient';

export const metadata: Metadata = {
  title: 'Career insights - Job Talentio',
  description:
    'Ideas and guidance for your next career move: career advice, labor-market insights, events and education.',
};

export default function NewsPage() {
  return (
    <Suspense fallback={null}>
      <NewsListClient />
    </Suspense>
  );
}
