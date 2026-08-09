'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Industry browse lives on Jobs by company (company context). */
export default function ExploreIndustriesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/explore/companies?tab=industry');
  }, [router]);
  return (
    <div className="shell" style={{ padding: '2rem 1.5rem' }}>
      Redirecting...
    </div>
  );
}
