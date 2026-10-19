'use client';

import { Suspense } from 'react';
import { MessagesWorkspace } from '@/components/employee/MessagesWorkspace';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';

export default function MessagesPage() {
  return <Suspense fallback={<WorkspaceLoading />}><MessagesWorkspace /></Suspense>;
}
