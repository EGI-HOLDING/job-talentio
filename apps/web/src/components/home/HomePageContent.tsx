'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import { SeekerHome } from './SeekerHome';

export function HomePageContent() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const role = getSession()?.user.role ?? null;
    setRole(role);
    if (role === 'RECRUITER') router.replace('/dashboard/recruiter?tab=jobs');
    setReady(true);
  }, []);

  if (!ready) return <div className="shell muted" style={{ padding: '2rem 0' }} />;
  if (role === 'RECRUITER') return null;
  return <SeekerHome isEmployee={role === 'EMPLOYEE'} />;
}
