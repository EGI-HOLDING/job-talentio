'use client';

import { Suspense } from 'react';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { CvEditorWorkspace } from '@/components/profile/CvEditorWorkspace';
import { RoleGate } from '@/components/auth/RoleGate';

export default function ResumeBuilderPage() {
  return <Suspense fallback={<DashboardSkeleton />}><RoleGate role="EMPLOYEE"><CvEditorWorkspace /></RoleGate></Suspense>;
}
