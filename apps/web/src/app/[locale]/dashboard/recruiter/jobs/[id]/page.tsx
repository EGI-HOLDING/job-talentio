import { Suspense } from 'react';
import { RoleGate } from '@/components/auth/RoleGate';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { RecruiterJobWorkspace } from '@/components/recruiter/RecruiterJobWorkspace';

export default function JobWorkspacePage(){return <Suspense fallback={<WorkspaceLoading/>}><RoleGate role="RECRUITER"><RecruiterJobWorkspace/></RoleGate></Suspense>;}
