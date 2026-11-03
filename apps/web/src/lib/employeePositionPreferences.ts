export const employeePositionPreferencesEnabled =
  process.env.NEXT_PUBLIC_EMPLOYEE_INTENT_V3 === 'true' ||
  process.env.NEXT_PUBLIC_EMPLOYEE_INTENT_V3_PREFERENCES === 'true';

export function positionPreferenceNames(profile: {
  desiredRoles?: Array<{ jobTitle: { name: string } }>;
  desiredPositions?: string[];
  desiredPosition?: string | null;
  matchingPreferencesReviewed?: boolean;
}) {
  const selected = profile.desiredRoles?.map(role => role.jobTitle.name) || [];
  const legacy = profile.desiredPositions?.length ? profile.desiredPositions : profile.desiredPosition ? [profile.desiredPosition] : [];
  if (profile.matchingPreferencesReviewed === false) return legacy.length ? legacy : selected;
  return selected.length ? selected : legacy;
}
