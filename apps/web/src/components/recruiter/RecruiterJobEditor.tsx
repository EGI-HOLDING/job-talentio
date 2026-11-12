'use client';

import { HrFlowUnavailable } from './HrFlowUnavailable';
import { HrCreationFlow, hrFlowV2Enabled } from './HrCreationFlow';
import { RecruiterJobEditorV2 } from './RecruiterJobEditorV2';

type Props = {
  companyId: string;
  company: any;
  job: any | null;
  meta: any;
  initialStep?: number;
  onboardingMode?: boolean;
  onClose: () => void;
  onPublished?: (id: string) => void;
  onDraftSaved?: (id: string) => Promise<void>;
  onChoosePackage?: (id: string) => Promise<void>;
  onSaved: (message: string) => Promise<void>;
};

export function RecruiterJobEditor(props: Props) {
  if (props.job && !props.job._creationSessionId) {
    return (
      <RecruiterJobEditorV2
        companyId={props.companyId}
        company={props.company}
        job={props.job}
        onClose={props.onClose}
        onSaved={props.onSaved}
        onPublished={props.onboardingMode ? props.onPublished : () => props.onClose()}
      />
    );
  }

  if (!hrFlowV2Enabled) return <HrFlowUnavailable />;

  return (
    <HrCreationFlow
      companyId={props.companyId}
      company={props.company}
      sessionId={props.job?._creationSessionId}
      onClose={props.onClose}
      onPublished={(id, fromTemplate) => {
        if (fromTemplate && props.onPublished) { props.onPublished(id); return; }
        void props.onSaved('Lowongan berhasil dipublikasikan.')
          .finally(() => props.onClose())
          .catch(() => undefined);
      }}
    />
  );
}