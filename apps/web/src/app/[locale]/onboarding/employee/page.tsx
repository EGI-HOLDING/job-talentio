import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { EmployeeOnboarding } from '@/components/onboarding/EmployeeOnboarding';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export default function EmployeeOnboardingPage() {
  return <RoleGate role="EMPLOYEE"><Suspense fallback={<WorkspaceLoading />}><EmployeeOnboarding /></Suspense></RoleGate>;
}
