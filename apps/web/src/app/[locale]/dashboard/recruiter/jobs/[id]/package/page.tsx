import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { JobPackageSelection } from '@/components/recruiter/JobPackageSelection';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
export default function PackagePage() { return <RoleGate role="RECRUITER"><Suspense fallback={<WorkspaceLoading/>}><JobPackageSelection/></Suspense></RoleGate>; }
