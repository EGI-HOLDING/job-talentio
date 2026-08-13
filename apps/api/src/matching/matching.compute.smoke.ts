import { MatchingService } from './matching.service';
import type { MatchBreakdown } from './matching.service';
import { normalizeJobTitleKey } from '../common/title-resolve';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const matching = new MatchingService(null as never);

function baseProfile(over: Record<string, unknown> = {}) {
  return {
    cityId: null as string | null,
    headline: null as string | null,
    desiredPosition: null as string | null,
    summary: null as string | null,
    skills: [] as Array<{
      skillId: string;
      level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
      skill: { name: string; slug: string; normalizedKey?: string | null };
    }>,
    experiences: [] as Array<{
      title?: string | null;
      startDate: Date;
      endDate: Date | null;
      isCurrent: boolean;
    }>,
    educations: [] as Array<{ degree: 'HIGH_SCHOOL' | 'VOCATIONAL' | 'BACHELOR' | 'MASTER' | 'PHD' | null }>,
    languages: [] as Array<{ language: { code: string }; level: 'A1' | 'B1' | 'C1' | 'NATIVE' }>,
    certifications: [] as unknown[],
    city: null as { id?: string; provinceId?: string } | null,
    ...over,
  };
}

function baseJob(over: Record<string, unknown> = {}) {
  return {
    title: 'Software Engineer',
    cityId: null as string | null,
    workMode: 'ONSITE' as const,
    experienceYearsMin: null as number | null,
    experienceLevel: null as 'JUNIOR' | 'MIDDLE' | 'SENIOR' | null,
    jobTitle: { name: 'Software Engineer', normalizedKey: 'softwareengineer' },
    jobSkills: [] as Array<{
      skillId: string;
      isRequired: boolean;
      weight: number;
      skill: { name: string; slug: string; normalizedKey?: string | null };
    }>,
    jobLanguages: [] as Array<{
      languageId: string;
      minLevel: 'A1' | 'B1' | 'C1' | 'NATIVE';
      isRequired: boolean;
      language: { code: string; name: string };
    }>,
    city: null as { id?: string; provinceId?: string } | null,
    ...over,
  };
}

function duplicateSkillKeysCountAsHit() {
  const profile = baseProfile({
    skills: [
      {
        skillId: 'profile-react-js',
        level: 'ADVANCED',
        skill: { name: 'React.js', slug: 'react-js', normalizedKey: 'reactjs' },
      },
    ],
  });
  const job = baseJob({
    jobSkills: [
      {
        skillId: 'job-react',
        isRequired: true,
        weight: 1,
        skill: { name: 'React', slug: 'react', normalizedKey: 'react' },
      },
    ],
  });
  const breakdown = matching.compute(profile, job);
  assert(breakdown.details.matchedSkills.includes('React'), 'duplicate skill keys should match');
  assert(breakdown.skills >= 35, `expected a strong skills hit, got ${breakdown.skills}`);
}

function itHandlerMatchesItSupportRole() {
  assert(
    normalizeJobTitleKey('IT Handler') === normalizeJobTitleKey('IT Support'),
    `IT Handler key ${normalizeJobTitleKey('IT Handler')} !== IT Support ${normalizeJobTitleKey('IT Support')}`,
  );
  const profile = baseProfile({ headline: 'IT Handler' });
  const job = baseJob({
    title: 'IT Support',
    jobTitle: { name: 'IT Support', normalizedKey: 'itsupport' },
  });
  const breakdown = matching.compute(profile, job);
  assert(breakdown.title === 15, `expected full role score, got ${breakdown.title}`);
  assert(matching.passesRecommendationGate(breakdown), 'IT Handler vs IT Support should pass the recommend gate');
}

function sameProvinceBeatsOtherProvince() {
  const profile = baseProfile({
    cityId: 'tashkent-city',
    city: { id: 'tashkent-city', provinceId: 'tashkent' },
    headline: 'Accountant',
  });
  const sameProvince = matching.compute(
    profile,
    baseJob({
      title: 'Accountant',
      jobTitle: { name: 'Accountant', normalizedKey: 'accountant' },
      cityId: 'chiniq',
      city: { id: 'chiniq', provinceId: 'tashkent' },
    }),
  );
  const otherProvince = matching.compute(
    profile,
    baseJob({
      title: 'Accountant',
      jobTitle: { name: 'Accountant', normalizedKey: 'accountant' },
      cityId: 'samarkand-city',
      city: { id: 'samarkand-city', provinceId: 'samarkand' },
    }),
  );
  assert(sameProvince.location === 8, `same province should score 8, got ${sameProvince.location}`);
  assert(otherProvince.location === 3, `other province should score 3, got ${otherProvince.location}`);
  assert(
    sameProvince.location > otherProvince.location,
    'same-province city should outscore a different province',
  );
}

function missingRequiredSkillsCapsBucket() {
  const profile = baseProfile({
    skills: [
      {
        skillId: 'css-profile',
        level: 'EXPERT',
        skill: { name: 'CSS', slug: 'css', normalizedKey: 'css' },
      },
    ],
  });
  const job = baseJob({
    jobSkills: [
      {
        skillId: 'python',
        isRequired: true,
        weight: 1,
        skill: { name: 'Python', slug: 'python', normalizedKey: 'python' },
      },
      {
        skillId: 'java',
        isRequired: true,
        weight: 1,
        skill: { name: 'Java', slug: 'java', normalizedKey: 'java' },
      },
      {
        skillId: 'css-job',
        isRequired: false,
        weight: 10,
        skill: { name: 'CSS', slug: 'css', normalizedKey: 'css' },
      },
    ],
  });
  const breakdown = matching.compute(profile, job);
  assert(breakdown.details.matchedSkills.includes('CSS'), 'optional CSS should still count as a hit');
  assert(
    breakdown.details.missingRequiredSkills.includes('Python') &&
      breakdown.details.missingRequiredSkills.includes('Java'),
    'required skills should still be missing',
  );
  assert(
    breakdown.skills <= 12,
    `all required misses should cap the skills bucket, got ${breakdown.skills}`,
  );
}

function emptySkillsAndTitlesFailGate() {
  const breakdown: MatchBreakdown = matching.compute(baseProfile(), baseJob());
  assert(breakdown.title === 0, `empty titles should score 0 role, got ${breakdown.title}`);
  assert(breakdown.details.matchedSkills.length === 0, 'empty skills should not match');
  assert(!matching.passesRecommendationGate(breakdown), 'empty skills + empty titles must fail the gate');
  assert(!matching.profileHasMatchSignal(baseProfile()), 'empty profile has no match signal');
}

function main() {
  duplicateSkillKeysCountAsHit();
  itHandlerMatchesItSupportRole();
  sameProvinceBeatsOtherProvince();
  missingRequiredSkillsCapsBucket();
  emptySkillsAndTitlesFailGate();
  console.log('api: matching.compute smoke ok');
}

main();
