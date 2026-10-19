'use client';
import { Suspense } from 'react';
import { FindTalentPanel } from '@/components/talent/FindTalentPanel';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { RoleGate } from '@/components/auth/RoleGate';
export default function TalentPage() { return <Suspense fallback={<WorkspaceLoading />}><RoleGate role="RECRUITER"><FindTalentPanel /></RoleGate></Suspense>; }
