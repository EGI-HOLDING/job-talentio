'use client';

import { useEffect } from 'react';
import { useRouter } from '@/lib/navigation';

/** The company directory was removed from the candidate-facing discovery flow. */
export default function ExploreIndustriesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/jobs');
  }, [router]);
  return null;
}
