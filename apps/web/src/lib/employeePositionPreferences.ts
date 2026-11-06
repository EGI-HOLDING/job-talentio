export const employeePositionPreferencesEnabled = true;

export function positionPreferenceNames(profile: {
  desiredRoles?: Array<{ jobTitle: { name: string } }>;
  desiredPositions?: string[];
  desiredPosition?: string | null;
  matchingPreferencesReviewed?: boolean;
}) {
  const selected = profile.desiredRoles?.map(role => role.jobTitle.name) || [];
  const legacy = profile.desiredPositions?.length ? profile.desiredPositions : profile.desiredPosition ? [profile.desiredPosition] : [];
  if (profile.matchingPreferencesReviewed === false) return [...selected,...legacy.filter(name=>!selected.includes(name))];
  return selected.length ? selected : legacy;
}
