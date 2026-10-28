'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { RoleGate } from '@/components/auth/RoleGate';
import { AlertsWorkspace } from '@/components/employee/AlertsWorkspace';
import { ApplicationsWorkspace } from '@/components/employee/ApplicationsWorkspace';
import { SavedJobsWorkspace } from '@/components/employee/SavedJobsWorkspace';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { ProfileCvWorkspace } from '@/components/profile/ProfileCvWorkspace';

/** Old overview/recommended dashboard URLs now open the current job discovery page. */
function RedirectLegacyDashboard() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/jobs?mode=for-you');
  }, [router]);

  return <WorkspaceLoading />;
}

function EmployeeWorkspaceRoute() {
  const tab = useSearchParams().get('tab');

  if (tab === 'applications') return <ApplicationsWorkspace />;
  if (tab === 'saved') return <SavedJobsWorkspace />;
  if (tab === 'alerts') return <AlertsWorkspace />;
  if (tab === 'profile') return <ProfileCvWorkspace />;

  return <RedirectLegacyDashboard />;
}

export default function EmployeeDashboard() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <RoleGate role="EMPLOYEE">
        <EmployeeWorkspaceRoute />
      </RoleGate>
    </Suspense>
  );
}
