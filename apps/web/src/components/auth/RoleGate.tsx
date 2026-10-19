'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ADMIN_URL, getSession } from '@/lib/api';
import { authLink } from '@/lib/authReturn';
import { useRouter, usePathname } from '@/lib/navigation';
import { useI18n } from '@/lib/i18n';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';

type AppRole = 'EMPLOYEE' | 'RECRUITER';

/** Keeps role-specific pages hidden until the local session has been checked. */
export function RoleGate({
  role,
  allowAnonymous = false,
  children,
}: {
  role: AppRole;
  allowAnonymous?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      if (allowAnonymous) {
        setAllowed(true);
        return;
      }
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(authLink('/login', next, role));
      return;
    }

    if (session.user.role === role || (role === 'RECRUITER' && session.user.role === 'SUPER_ADMIN')) {
      setAllowed(true);
      return;
    }

    if (session.user.role === 'EMPLOYEE') {
      router.replace('/jobs');
      return;
    }
    if (session.user.role === 'RECRUITER') {
      router.replace('/dashboard/recruiter?tab=jobs');
      return;
    }
    if (session.user.role === 'SUPER_ADMIN') {
      window.location.replace(ADMIN_URL);
      return;
    }

    router.replace('/');
  }, [allowAnonymous, pathname, role, router]);

  if (!allowed) return <WorkspaceLoading />;
  return <>{children}</>;
}
