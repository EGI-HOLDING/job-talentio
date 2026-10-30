'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { SeekerHome } from './SeekerHome';

export function HomePageContent() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [showSeekerLanding, setShowSeekerLanding] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const role = getSession()?.user.role ?? null;
    const showSeekerLanding = new URLSearchParams(window.location.search).get('audience') === 'seekers';
    setRole(role);
    setShowSeekerLanding(showSeekerLanding);
    if (role === 'RECRUITER' && !showSeekerLanding) router.replace('/dashboard/recruiter?tab=jobs');
    setReady(true);
  }, []);

  if (!ready) return <div className="shell muted" style={{ padding: '2rem 0' }} />;
  if (role === 'RECRUITER' && !showSeekerLanding) return null;
  return <SeekerHome isEmployee={role === 'EMPLOYEE'} />;
}
