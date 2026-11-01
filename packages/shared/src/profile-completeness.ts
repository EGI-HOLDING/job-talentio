export type ProfileCompletenessCheck = {
  id: string;
  ok: boolean;
  labelKey: string;
  /** Basic information and a stored CV sum to 100. Optional account chips are 0. */
  weight: number;
};

export type ProfileCompletenessInput = {
  phone?: string | null;
  desiredPosition?: string | null;
  desiredPositions?: string[];
  headline?: string | null;
  city?: unknown;
  residenceCountryId?: string | null;
  noExperience?: boolean;
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
 * CV and basic information readiness (0-100).
 * Imported Google/Telegram photos and OAuth identity do not add percent.
 */
export function scoreProfileCompleteness(input: ProfileCompletenessInput): {
  percent: number;
  checks: ProfileCompletenessCheck[];
  missing: ProfileCompletenessCheck[];
} {
  const career: ProfileCompletenessCheck[] = [
    {id:'city',ok:Boolean(input.residenceCountryId||input.city),labelKey:'emp.checkSetCountry',weight:20},
    {id:'preferences',ok:Boolean(input.desiredPositions?.length||filled(input.desiredPosition)),labelKey:'cv.addPreferences',weight:20},
    {id:'phone',ok:filled(input.phone),labelKey:'cv.addPhone',weight:20},
    {id:'resume',ok:(input.resumes??[]).some(row=>Boolean(row&&typeof row==='object'&&('hasFile' in row?row.hasFile:'fileKey' in row&&row.fileKey))),labelKey:'emp.checkAddResume',weight:40},
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
