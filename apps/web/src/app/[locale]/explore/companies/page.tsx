'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation';

/** Keep old bookmarks useful after company discovery was removed. */
export default function ExploreCompaniesPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/jobs'); }, [router]);
  return null;
}
