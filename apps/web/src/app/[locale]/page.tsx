'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/api';
import { SeekerHome } from '@/components/home/SeekerHome';
import { RecruiterHome } from '@/components/home/RecruiterHome';

export default function HomePage() {
  const [role, setRole] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setRole(getSession()?.user.role ?? null);
    setReady(true);
  }, []);

  if (!ready) {
    return <div className="shell muted" style={{ padding: '2rem 0' }} />;
  }

  if (role === 'RECRUITER') return <RecruiterHome />;
  return <SeekerHome isEmployee={role === 'EMPLOYEE'} />;
}
