import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { RoleGate } from '@/components/auth/RoleGate';
import { WorkspaceLoading } from '@/components/employee/WorkspacePrimitives';
import { CandidateReview } from '@/components/recruiter/CandidateReview';
import type { ReviewReport } from '@/components/recruiter/candidate-review-route';

export default async function CandidateReviewPage({ params }: {
  params: Promise<{ candidateId: string; view?: string[] }>;
}) {
  const { candidateId, view = [] } = await params;
  let report: ReviewReport | undefined;
  if (view.length) {
    if (view[0] !== 'reports') notFound();
    if (view.length === 2 && (view[1] === 'cv' || view[1] === 'application')) report = { kind: view[1] };
    else if (view.length === 3 && view[1] === 'interviews') report = { kind: 'interview', invitationId: view[2] };
    else notFound();
  }
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <RoleGate role="RECRUITER"><CandidateReview key={candidateId} id={candidateId} report={report} /></RoleGate>
    </Suspense>
  );
}
