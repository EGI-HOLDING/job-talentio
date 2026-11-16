import { BadRequestException, NotFoundException } from '@nestjs/common';

export const hrFlowEnabled = () => process.env.HR_CREATION_V2_ENABLED === 'true' && process.env.HR_FLOW_MARKET === 'id';
export const assessmentLanguageSelectionEnabled = () => hrFlowEnabled() && process.env.TARA_TAKA_LANGUAGE_ENABLED === 'true';
export function assertAssessmentLanguageChange(current: string | null, next: unknown) {
  if (next !== undefined && next !== current && !assessmentLanguageSelectionEnabled()) {
    throw new BadRequestException('ASSESSMENT_LANGUAGE_UNAVAILABLE');
  }
}
export function requireAssessmentLanguage(language: string | null | undefined) {
  if (assessmentLanguageSelectionEnabled() && language !== 'id' && language !== 'en') {
    throw new BadRequestException('ASSESSMENT_LANGUAGE_REQUIRED');
  }
}
export function assertHrFlowEnabled() {
  if (!hrFlowEnabled()) throw new NotFoundException('HR creation flow is not enabled');
}
