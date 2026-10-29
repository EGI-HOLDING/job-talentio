import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { RecruiterSupport } from '@/components/recruiter/RecruiterSupport';

export default function SupportPage() {
  return <RoleGate role="RECRUITER"><Suspense fallback={<WorkspaceLoading />}><RecruiterSupport /></Suspense></RoleGate>;
}
