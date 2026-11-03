'use client';

import { Suspense, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation';
import { RoleGate } from '@/components/auth/RoleGate';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
const AlertsWorkspace=dynamic(()=>import('@/components/employee/AlertsWorkspace').then(module=>module.AlertsWorkspace),{loading:()=> <WorkspaceLoading/>});
const ApplicationsWorkspace=dynamic(()=>import('@/components/employee/ApplicationsWorkspace').then(module=>module.ApplicationsWorkspace),{loading:()=> <WorkspaceLoading/>});
const SavedJobsWorkspace=dynamic(()=>import('@/components/employee/SavedJobsWorkspace').then(module=>module.SavedJobsWorkspace),{loading:()=> <WorkspaceLoading/>});
const ProfileCvWorkspace=dynamic(()=>import('@/components/profile/ProfileCvWorkspace').then(module=>module.ProfileCvWorkspace),{loading:()=> <WorkspaceLoading/>});

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
