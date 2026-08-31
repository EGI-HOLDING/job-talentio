export type ProfileCompletenessCheck = {
  id: string;
  ok: boolean;
  labelKey: string;
  /** Career items sum to 100. Account chips are 0 and do not move the bar. */
  weight: number;
};

export type ProfileCompletenessInput = {
  headline?: string | null;
  city?: unknown;
  skills?: unknown[] | null;
  experiences?: unknown[] | null;
  educations?: unknown[] | null;
  languages?: unknown[] | null;
  resumes?: unknown[] | null;
  avatarUrl?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  telegramLinked?: boolean;
};

function filled(value?: string | null) {
  return Boolean(value?.trim());
}

/**
 * Career-weighted profile strength (0-100).
 * Imported Google/Telegram photos and OAuth identity do not add percent.
 */
export function scoreProfileCompleteness(input: ProfileCompletenessInput): {
  percent: number;
  checks: ProfileCompletenessCheck[];
  missing: ProfileCompletenessCheck[];
} {
  const career: ProfileCompletenessCheck[] = [
    {
      id: 'headline',
      ok: filled(input.headline),
      labelKey: 'emp.checkAddHeadline',
      weight: 12,
    },
    {
      id: 'city',
      ok: Boolean(input.city),
      labelKey: 'emp.checkSetCity',
      weight: 10,
    },
    {
      id: 'skills',
      ok: (input.skills ?? []).length >= 3,
      labelKey: 'emp.checkAddSkills',
      weight: 18,
    },
    {
      id: 'experience',
      ok: (input.experiences ?? []).length >= 1,
      labelKey: 'emp.checkAddExperience',
      weight: 20,
    },
    {
      id: 'education',
      ok: (input.educations ?? []).length >= 1,
      labelKey: 'emp.checkAddEducation',
      weight: 12,
    },
    {
      id: 'language',
      ok: (input.languages ?? []).length >= 1,
      labelKey: 'emp.checkAddLanguage',
      weight: 8,
    },
    {
      id: 'resume',
      ok: (input.resumes ?? []).length >= 1,
      labelKey: 'emp.checkAddResume',
      weight: 20,
    },
  ];

  const total = career.reduce((sum, item) => sum + item.weight, 0);
  const earned = career.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0);
  const percent = total === 0 ? 0 : Math.round((earned / total) * 100);

  const reachable = Boolean(input.emailVerified) || Boolean(input.telegramLinked);
  const hasEmail = filled(input.email);
  const account: ProfileCompletenessCheck[] = [
    {
      id: 'contact',
      ok: reachable,
      labelKey: hasEmail ? 'emp.checkVerifyEmail' : 'emp.checkAddEmail',
      weight: 0,
    },
    {
      id: 'photo',
      ok: filled(input.avatarUrl),
      labelKey: 'emp.checkAddPhoto',
      weight: 0,
    },
  ];

  if (input.telegramLinked && !hasEmail) {
    account.push({
      id: 'optionalEmail',
      ok: false,
      labelKey: 'emp.checkAddEmail',
      weight: 0,
    });
  }

  const checks = [...career, ...account];
  const missing = [...career.filter((item) => !item.ok), ...account.filter((item) => !item.ok)];
  return { percent, checks, missing };
}
