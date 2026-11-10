import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsListClient } from './NewsListClient';

export const metadata: Metadata = {
  title: 'Hiring insights - Job Talentio',
  description: 'Ideas and perspectives for building your team.',
};

export default function NewsPage() {
  return (
    <Suspense fallback={null}>
      <NewsListClient />
    </Suspense>
  );
}
