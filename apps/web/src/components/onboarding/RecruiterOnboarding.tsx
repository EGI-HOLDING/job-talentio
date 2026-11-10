'use client';

import { HrFlowUnavailable } from '@/components/recruiter/HrFlowUnavailable';
import { hrFlowV2Enabled } from '@/components/recruiter/HrCreationFlow';
import { RecruiterOnboardingV2 } from './RecruiterOnboardingV2';

export function RecruiterOnboarding() {
  return hrFlowV2Enabled ? <RecruiterOnboardingV2 /> : <HrFlowUnavailable />;
}