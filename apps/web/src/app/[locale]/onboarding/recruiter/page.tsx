import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { RecruiterOnboarding } from '@/components/onboarding/RecruiterOnboarding';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export default function RecruiterOnboardingPage() { return <RoleGate role="RECRUITER"><Suspense fallback={<WorkspaceLoading/>}><RecruiterOnboarding/></Suspense></RoleGate>; }
