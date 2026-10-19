'use client';
import { Suspense } from 'react';
import { RecruiterCandidate } from '@/components/recruiter/RecruiterCandidate';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { RoleGate } from '@/components/auth/RoleGate';
export default function CandidatePage() { return <Suspense fallback={<WorkspaceLoading />}><RoleGate role="RECRUITER"><RecruiterCandidate /></RoleGate></Suspense>; }
