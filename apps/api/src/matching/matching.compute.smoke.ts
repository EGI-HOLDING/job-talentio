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
  assert(
    sameProvince.location > otherProvince.location,
    `same province (${sameProvince.location}) should outscore a different province (${otherProvince.location})`,
  );
  assert(
    sameProvince.total > otherProvince.total,
    `same province total ${sameProvince.total} should beat ${otherProvince.total}`,
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
  assert(breakdown.skills === 0, `a job with no skills must not get a skills floor, got ${breakdown.skills}`);
  assert(breakdown.total === 0, `unrelated empty profile must score 0, got ${breakdown.total}`);
  assert(breakdown.details.matchedSkills.length === 0, 'empty skills should not match');
  assert(!matching.passesRecommendationGate(breakdown), 'empty skills + empty titles must fail the gate');
  assert(!matching.profileHasMatchSignal(baseProfile()), 'empty profile has no match signal');
}

function jobSkill(id: string, name: string, slug: string) {
  return {
    skillId: id,
    isRequired: true,
    weight: 1,
    skill: { name, slug, normalizedKey: slug.replace(/[^a-z0-9]+/gi, '') },
  };
}

function mlEngineerProfile() {
  return baseProfile({
    headline: 'ML Engineer',
    cityId: 'tashkent',
    city: { id: 'tashkent', provinceId: 'tashkent' },
    skills: [
      {
        skillId: 'py',
        level: 'ADVANCED' as const,
        skill: { name: 'Python', slug: 'python', normalizedKey: 'python' },
      },
      {
        skillId: 'pt',
        level: 'ADVANCED' as const,
        skill: { name: 'PyTorch', slug: 'pytorch', normalizedKey: 'pytorch' },
      },
      {
        skillId: 'ps',
        level: 'INTERMEDIATE' as const,
        skill: { name: 'Problem solving', slug: 'problem-solving', normalizedKey: 'problemsolving' },
      },
    ],
    experiences: [
      {
        title: 'ML Engineer',
        startDate: new Date('2020-01-01'),
        endDate: null,
        isCurrent: true,
      },
    ],
    educations: [{ degree: 'BACHELOR' as const }],
    languages: [{ language: { code: 'en' }, level: 'C1' as const }],
  });
}

function mlProfileDoesNotMatchUnrelatedRoles() {
  const profile = mlEngineerProfile();
  const mechanical = matching.compute(
    profile,
    baseJob({
      title: 'Mechanical Design Engineer',
      jobTitle: { name: 'Mechanical Design Engineer', normalizedKey: 'mechanicaldesignengineer' },
      experienceYearsMin: 3,
      experienceLevel: 'MIDDLE',
      workMode: 'ONSITE',
      cityId: 'samarkand',
      city: { id: 'samarkand', provinceId: 'samarkand' },
      jobSkills: [
        jobSkill('md', 'Mechanical design', 'mechanical-design'),
        jobSkill('ac', 'AutoCAD', 'autocad'),
        jobSkill('ps-job', 'Problem solving', 'problem-solving'),
      ],
    }),
  );
  assert(
    mechanical.details.matchedSkills.some((name) => /problem/i.test(name)),
    `problem-solving should be the only overlap, got ${mechanical.details.matchedSkills.join(', ')}`,
  );
  assert(
    mechanical.total > 0 && mechanical.total <= 5,
    `mechanical design must stay in 1..5 for a soft-skill overlap, got ${mechanical.total}`,
  );
  assert(
    mechanical.title === 0,
    `shared token "engineer" must not score the title, got ${mechanical.title}`,
  );
  assert(
    !matching.passesRecommendationGate(mechanical),
    'mechanical design must not be recommended to an ML profile',
  );

  const product = matching.compute(
    profile,
    baseJob({
      title: 'Product Designer',
      jobTitle: { name: 'Product Designer', normalizedKey: 'productdesigner' },
      experienceYearsMin: 4,
      experienceLevel: 'SENIOR',
      cityId: 'tashkent',
      city: { id: 'tashkent', provinceId: 'tashkent' },
      jobSkills: [
        jobSkill('figma', 'Figma', 'figma'),
        jobSkill('ui', 'UI/UX', 'ui-ux'),
        jobSkill('pm', 'Product management', 'product-management'),
      ],
    }),
  );
  assert(product.total === 0, `product designer with no shared skill must be 0, got ${product.total}`);
  assert(!matching.passesRecommendationGate(product), 'product designer must not be recommended');

  const mlJob = matching.compute(
    profile,
    baseJob({
      title: 'ML Engineer',
      jobTitle: { name: 'ML Engineer', normalizedKey: 'mlengineer' },
      experienceYearsMin: 3,
      experienceLevel: 'MIDDLE',
      cityId: 'tashkent',
      city: { id: 'tashkent', provinceId: 'tashkent' },
      jobSkills: [jobSkill('py-job', 'Python', 'python'), jobSkill('pt-job', 'PyTorch', 'pytorch')],
    }),
  );
  assert(mlJob.total >= 70, `an ML role must stay a strong match, got ${mlJob.total}`);
  assert(matching.passesRecommendationGate(mlJob), 'ML role must pass the recommend gate');
  assert(mlJob.total > mechanical.total, 'ML role must outscore mechanical design');
}

function profileSkill(
  id: string,
  name: string,
  slug: string,
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT' = 'ADVANCED',
) {
  return {
    skillId: id,
    level,
    skill: { name, slug, normalizedKey: slug.replace(/[^a-z0-9]+/gi, '') },
  };
}

function mlHeadlineBeatsDataAndPythonJobs() {
  assert(
    normalizeJobTitleKey('ML Engineer') === normalizeJobTitleKey('Machine Learning Engineer'),
    'ML Engineer must share a key with Machine Learning Engineer',
  );
  assert(
    normalizeJobTitleKey('AI Engineer') === normalizeJobTitleKey('Machine Learning Engineer'),
    'AI Engineer must share the ML family',
  );
  assert(
    normalizeJobTitleKey('Data Engineer') !== normalizeJobTitleKey('Machine Learning Engineer'),
    'Data Engineer must stay outside the ML family',
  );
  assert(
    normalizeJobTitleKey('Python Developer') !== normalizeJobTitleKey('ML Engineer'),
    'Python Developer must stay outside the ML family',
  );

  const profile = baseProfile({
    headline: 'ML Engineer',
    cityId: 'tashkent',
    city: { id: 'tashkent', provinceId: 'tashkent' },
    skills: [
      profileSkill('py', 'Python', 'python'),
      profileSkill('sql', 'SQL', 'sql'),
      profileSkill('pg', 'PostgreSQL', 'postgresql'),
    ],
    experiences: [
      {
        title: 'Data Engineer',
        startDate: new Date('2016-01-01'),
        endDate: new Date('2019-12-01'),
        isCurrent: false,
      },
    ],
    educations: [{ degree: 'BACHELOR' as const }],
    languages: [{ language: { code: 'en' }, level: 'C1' as const }],
  });
  const place = {
    experienceYearsMin: 3,
    experienceLevel: 'MIDDLE' as const,
    cityId: 'tashkent',
    city: { id: 'tashkent', provinceId: 'tashkent' },
  };
  const ml = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'Machine Learning Engineer',
      jobTitle: { name: 'Machine Learning Engineer', normalizedKey: 'machinelearningengineer' },
      jobSkills: [
        jobSkill('py-job', 'Python', 'python'),
        jobSkill('ml', 'Machine Learning', 'machine-learning'),
        jobSkill('sql-job', 'SQL', 'sql'),
      ],
    }),
  );
  const data = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'Data Engineer',
      jobTitle: { name: 'Data Engineer', normalizedKey: 'dataengineer' },
      jobSkills: [
        jobSkill('py-data', 'Python', 'python'),
        jobSkill('sql-data', 'SQL', 'sql'),
        jobSkill('pg-data', 'PostgreSQL', 'postgresql'),
      ],
    }),
  );
  const python = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'Python Developer',
      jobTitle: { name: 'Python Developer', normalizedKey: 'pythondeveloper' },
      jobSkills: [
        jobSkill('py-dev', 'Python', 'python'),
        jobSkill('django', 'Django', 'django'),
        jobSkill('pg-dev', 'PostgreSQL', 'postgresql'),
      ],
    }),
  );
  const ai = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'AI Engineer',
      jobTitle: { name: 'AI Engineer', normalizedKey: 'aiengineer' },
      jobSkills: [
        jobSkill('py-ai', 'Python', 'python'),
        jobSkill('ml-ai', 'Machine Learning', 'machine-learning'),
        jobSkill('da', 'Data Analysis', 'data-analysis'),
      ],
    }),
  );
  assert(
    ml.total >= data.total + 15,
    `ML ${ml.total} must lead Data Engineer ${data.total} by at least 15`,
  );
  assert(
    ml.total >= python.total + 15,
    `ML ${ml.total} must lead Python Developer ${python.total} by at least 15`,
  );
  assert(ai.total > data.total, `AI Engineer ${ai.total} must beat Data Engineer ${data.total}`);
}

function accountantBeatsSalesThatOnlySharesExcel() {
  const profile = baseProfile({
    headline: 'Accountant',
    cityId: 'tashkent',
    city: { id: 'tashkent', provinceId: 'tashkent' },
    skills: [
      profileSkill('acc', 'Accounting', 'accounting'),
      profileSkill('1c', '1C', '1c'),
      profileSkill('excel', 'Excel', 'excel'),
    ],
    educations: [{ degree: 'BACHELOR' as const }],
  });
  const place = {
    experienceYearsMin: 3,
    experienceLevel: 'MIDDLE' as const,
    cityId: 'tashkent',
    city: { id: 'tashkent', provinceId: 'tashkent' },
  };
  const accountant = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'Accountant',
      jobTitle: { name: 'Accountant', normalizedKey: 'accountant' },
      jobSkills: [
        jobSkill('acc-job', 'Accounting', 'accounting'),
        jobSkill('1c-job', '1C', '1c'),
        jobSkill('excel-job', 'Excel', 'excel'),
      ],
    }),
  );
  const sales = matching.compute(
    profile,
    baseJob({
      ...place,
      title: 'Sales Manager',
      jobTitle: { name: 'Sales Manager', normalizedKey: 'salesmanager' },
      jobSkills: [
        jobSkill('sales', 'Sales', 'sales'),
        jobSkill('comm', 'Communication', 'communication'),
        jobSkill('excel-sales', 'Excel', 'excel'),
      ],
    }),
  );
  assert(
    accountant.total >= sales.total + 15,
    `Accountant ${accountant.total} must lead Sales Manager ${sales.total} by at least 15`,
  );
}

function main() {
  duplicateSkillKeysCountAsHit();
  itHandlerMatchesItSupportRole();
  sameProvinceBeatsOtherProvince();
  missingRequiredSkillsCapsBucket();
  emptySkillsAndTitlesFailGate();
  mlProfileDoesNotMatchUnrelatedRoles();
  mlHeadlineBeatsDataAndPythonJobs();
  accountantBeatsSalesThatOnlySharesExcel();
  console.log('api: matching.compute smoke ok');
}

main();
