import { Suspense } from 'react';
import { EmployeePhoneRequired } from '@/components/onboarding/EmployeePhoneRequired';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';

export default function EmployeePhoneRequiredPage() {
  return <Suspense fallback={<WorkspaceLoading />}><EmployeePhoneRequired /></Suspense>;
}
