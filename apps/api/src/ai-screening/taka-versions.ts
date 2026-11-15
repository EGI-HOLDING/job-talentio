export const TAKA_ROLE_EVIDENCE_VERSION = 'taka-role-evidence-v2';
export const TAKA_ROLE_VALIDATION_VERSION = 'taka-role-evidence-v2.1';
export const TAKA_LIVE_COMPLETION_VERSION = 'taka-role-evidence-v3';

export function isTakaRoleEvidence(version: string) {
    return version === TAKA_ROLE_EVIDENCE_VERSION || version === TAKA_LIVE_COMPLETION_VERSION;
}
