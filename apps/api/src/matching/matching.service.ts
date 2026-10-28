import { liveJobWhere } from '../benefits/benefit-policy';
import { Injectable } from '@nestjs/common';
import {
  DegreeLevel,
  ExperienceLevel,
  LanguageLevel,
  Prisma,
  SkillLevel,
  WorkMode,
} from '@prisma/client';
import { languageLevelRank } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RecruiterMatchingService } from './recruiter-matching.service';
import { compareRecruiterMatches, evaluateRecruiter, type RecruiterBreakdown } from './recruiter-matching';
import { normalizeSkillKey } from '../common/skill-resolve';
import {
  canonicalTitleKey,
  normalizeJobTitleKey,
  profileRoleTexts,
  stripSeniorityFromTitle,
} from '../common/title-resolve';

export type MatchBreakdown = {
  skills: number;
  title: number;
  experience: number;
  location: number;
  education: number;
  language: number;
  total: number;
  details: {
    matchedSkills: string[];
    missingRequiredSkills: string[];
    matchedLanguages: string[];
    missingRequiredLanguages: string[];
    experienceYears: number;
    requiredYears: number | null;
  };
};

type SkillRef = {
  name: string;
  slug: string;
  normalizedKey?: string | null;
  aliases?: Array<{ aliasKey: string }>;
};

type MatchProfile = {
  cityId: string | null;
  headline: string | null;
  desiredPosition?: string | null;
  desiredPositions?: string[];
  preferredCountries?: Array<{id:string}>;
  summary: string | null;
  skills: Array<{ skillId: string; level: SkillLevel; skill: SkillRef }>;
  experiences: Array<{
    title?: string | null;
    startDate: Date;
    endDate: Date | null;
    isCurrent: boolean;
  }>;
  educations: Array<{ degree: DegreeLevel | null }>;
  languages: Array<{ language: { code: string }; level: LanguageLevel }>;
  certifications: unknown[];
  city?: { id?: string; provinceId?: string; province?: {countryId:string} } | null;
};

type MatchJob = {
  title?: string;
  countryId?: string | null;
  cityId: string | null;
  workMode: WorkMode;
  experienceYearsMin: number | null;
  experienceLevel: ExperienceLevel | null;
  jobTitle?: {
    name: string;
    nameRu?: string | null;
    nameUz?: string | null;
    nameId?: string | null;
    normalizedKey: string;
    aliases?: Array<{ aliasKey: string }>;
  } | null;
  jobSkills: Array<{
    skillId: string;
    isRequired: boolean;
    weight: number;
    skill: SkillRef;
  }>;
  jobLanguages?: Array<{
    languageId: string;
    minLevel: LanguageLevel;
    isRequired: boolean;
    language: { code: string; name: string };
  }>;
  city?: { id?: string; provinceId?: string; province?: {countryId:string} } | null;
};

const SKILL_LEVEL_SCORE: Record<SkillLevel, number> = {
  BEGINNER: 0.5,
  INTERMEDIATE: 0.75,
  ADVANCED: 1,
  EXPERT: 1.15,
};

const DEGREE_RANK: Record<DegreeLevel, number> = {
  HIGH_SCHOOL: 1,
  VOCATIONAL: 2,
  BACHELOR: 3,
  MASTER: 4,
  PHD: 5,
};

const EXP_LEVEL_YEARS: Record<ExperienceLevel, number> = {
  INTERN: 0,
  JUNIOR: 1,
  MIDDLE: 3,
  SENIOR: 5,
  LEAD: 8,
  EXECUTIVE: 12,
};

const TITLE_TOKEN_STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'of',
  'at',
  'in',
  'on',
  'to',
  'a',
  'an',
  'or',
]);

/** Role nouns that show up in unrelated titles ("ML Engineer" vs "Mechanical Design Engineer"). */
const GENERIC_TITLE_TOKENS = new Set([
  'analyst',
  'assistant',
  'associate',
  'consultant',
  'coordinator',
  'design',
  'designer',
  'developer',
  'development',
  'director',
  'engineer',
  'engineering',
  'executive',
  'expert',
  'head',
  'intern',
  'junior',
  'lead',
  'management',
  'manager',
  'officer',
  'senior',
  'specialist',
  'staff',
]);

/** Keys after normalizeSkillKey. These must not carry a role match by themselves. */
const SOFT_SKILL_KEYS = new Set([
  'communication',
  'english',
  'excel',
  'leadership',
  'problemsolving',
  'teamwork',
]);

/** Floor once a role signal exists. Context alone must not clear this. */
const MIN_RECOMMENDATION_SCORE = 35;
const SKILLS_BUCKET = 40;
const TITLE_BUCKET = 15;
const ROLE_MAX = SKILLS_BUCKET + TITLE_BUCKET;
/** Soft-skill-only overlap must not look like a role match. */
const SOFT_ONLY_CAP = 5;
/** A past job title can support a match, but it is not the current role. */
const HISTORY_TITLE_CAP = 8;
/** Shared generic skills must not outrank a different role family. */
const CONFLICT_SKILL_FACTOR = 0.5;
const REQUIRED_SKILLS_MISS_CAP = 12;
const FOR_YOU_JOBS_LIMIT = 300;
const FOR_YOU_SCAN_BATCH = 100;

const VISIBLE_PROFILE = {
  in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] as ['PUBLIC', 'TO_REGISTERED_RECRUITERS'],
};

function skillIdentityKey(skill: SkillRef): string {
  if (skill.normalizedKey) {
    return normalizeSkillKey(skill.normalizedKey) || skill.normalizedKey;
  }
  return normalizeSkillKey(skill.name) || (skill.slug ? normalizeSkillKey(skill.slug) : '');
}

function skillIdentityKeys(skill: SkillRef): Set<string> {
  return new Set(
    [skillIdentityKey(skill), ...(skill.aliases ?? []).map((alias) => normalizeSkillKey(alias.aliasKey))]
      .filter(Boolean),
  );
}

function findProfileSkill(
  profileSkills: MatchProfile['skills'],
  jobSkill: MatchJob['jobSkills'][number],
) {
  const byId = profileSkills.find((s) => s.skillId === jobSkill.skillId);
  if (byId) return byId;
  const jobKeys = skillIdentityKeys(jobSkill.skill);
  if (!jobKeys.size) return undefined;
  const matches = profileSkills.filter((s) =>
    [...skillIdentityKeys(s.skill)].some((key) => jobKeys.has(key)),
  );
  if (!matches.length) return undefined;
  return matches.sort((a, b) => SKILL_LEVEL_SCORE[b.level] - SKILL_LEVEL_SCORE[a.level])[0];
}

function significantTitleTokens(input: string): Set<string> {
  const { roleTitle } = stripSeniorityFromTitle(input);
  return new Set(
    roleTitle.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !TITLE_TOKEN_STOP.has(t)),
  );
}

function distinctiveTitleTokens(input: string): Set<string> {
  return new Set([...significantTitleTokens(input)].filter((t) => !GENERIC_TITLE_TOKENS.has(t)));
}

function isSoftSkill(skill: SkillRef): boolean {
  const keys = [skill.normalizedKey, skill.slug, skill.name].filter((v): v is string => Boolean(v));
  return (
    keys.some((key) => SOFT_SKILL_KEYS.has(normalizeSkillKey(key))) ||
    (skill.aliases ?? []).some((alias) => SOFT_SKILL_KEYS.has(normalizeSkillKey(alias.aliasKey)))
  );
}

function isSoftSkillLabel(name: string): boolean {
  return SOFT_SKILL_KEYS.has(normalizeSkillKey(name));
}

function jobTitleKeys(job: MatchJob): Set<string> {
  const jobName = job.jobTitle?.name || job.title || '';
  const jobKeys = new Set<string>();
  if (job.jobTitle?.normalizedKey) {
    jobKeys.add(canonicalTitleKey(job.jobTitle.normalizedKey));
    jobKeys.add(job.jobTitle.normalizedKey.toLowerCase());
  }
  for (const alias of job.jobTitle?.aliases ?? []) {
    if (alias.aliasKey) jobKeys.add(alias.aliasKey.toLowerCase());
  }
  if (jobName) jobKeys.add(normalizeJobTitleKey(jobName));
  for (const label of [job.jobTitle?.nameRu, job.jobTitle?.nameUz, job.jobTitle?.nameId]) if (label) jobKeys.add(normalizeJobTitleKey(label));
  if (job.title) jobKeys.add(normalizeJobTitleKey(job.title));
  jobKeys.delete('');
  return jobKeys;
}

function jobTitleTokens(job: MatchJob): Set<string> {
  const tokens = new Set<string>();
  for (const text of [job.jobTitle?.name || '', job.title || '']) {
    if (!text) continue;
    for (const tok of distinctiveTitleTokens(text)) tokens.add(tok);
  }
  return tokens;
}

function textTitleTokens(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const tok of distinctiveTitleTokens(text)) tokens.add(tok);
  }
  return tokens;
}

/** Exact, synonym, or distinctive-token score for one set of role texts. */
function scoreTitleTexts(profileTexts: string[], job: MatchJob): number {
  if (!profileTexts.length) return 0;
  const jobKeys = jobTitleKeys(job);
  const profileKeys = profileTexts.map((t) => normalizeJobTitleKey(t)).filter(Boolean);
  if (profileKeys.some((k) => jobKeys.has(k))) return TITLE_BUCKET;

  const jobTokens = jobTitleTokens(job);
  if (!jobTokens.size) return 0;
  for (const tok of textTitleTokens(profileTexts)) {
    if (jobTokens.has(tok)) return 6;
  }
  return 0;
}

/**
 * Primary role (desired position, headline, current job) disagrees with the
 * vacancy: both sides have distinctive tokens, none are shared, and the titles
 * are not synonyms. A missing token on either side is not a conflict.
 */
function titleFamiliesConflict(primaryTexts: string[], job: MatchJob): boolean {
  if (!primaryTexts.length) return false;
  if (scoreTitleTexts(primaryTexts, job) >= 12) return false;
  const profileTokens = textTitleTokens(primaryTexts);
  const jobTokens = jobTitleTokens(job);
  if (!profileTokens.size || !jobTokens.size) return false;
  for (const tok of profileTokens) {
    if (jobTokens.has(tok)) return false;
  }
  return true;
}

function roleMatchScore(primaryTexts: string[], historyTexts: string[], job: MatchJob): number {
  const primaryScore = scoreTitleTexts(primaryTexts, job);
  // A past title must not pull the score toward a role the person has left.
  if (titleFamiliesConflict(primaryTexts, job)) return primaryScore;
  const historyScore = Math.min(HISTORY_TITLE_CAP, scoreTitleTexts(historyTexts, job));
  return Math.max(primaryScore, historyScore);
}

function splitRoleTexts(profile: MatchProfile): { primary: string[]; history: string[] } {
  const clean = (value: string | null | undefined) => (value || '').trim();
  const primary = [...(profile.desiredPositions || []), profile.desiredPosition, profile.headline]
    .map(clean)
    .filter(Boolean);
  const history: string[] = [];
  for (const exp of profile.experiences) {
    const title = clean(exp.title);
    if (!title) continue;
    if (exp.isCurrent) primary.push(title);
    else history.push(title);
  }
  return { primary, history };
}

@Injectable()
export class MatchingService {
  private readonly recruiter: RecruiterMatchingService;
  constructor(private prisma: PrismaService) { this.recruiter = new RecruiterMatchingService(prisma); }

  scoreInputs(...args: Parameters<RecruiterMatchingService['scoreInputs']>) { return this.recruiter.scoreInputs(...args); }

  /** Profiles without skills or a role title are not matchable for discovery. */
  profileHasMatchSignal(profile: {
    skills: unknown[];
    headline?: string | null;
    desiredPosition?: string | null;
    desiredPositions?: string[];
    experiences?: Array<{ title?: string | null }>;
  }) {
    return profile.skills.length > 0 || profileRoleTexts(profile).length > 0;
  }

  passesRecommendationGate(breakdown: MatchBreakdown) {
    // Exact or synonym title is a role match even when the profile has no skills yet.
    if (breakdown.title >= 12) return true;
    if (breakdown.total < MIN_RECOMMENDATION_SCORE) return false;
    const distinctive = breakdown.details.matchedSkills.filter((name) => !isSoftSkillLabel(name));
    return distinctive.length > 0 || breakdown.title >= 6;
  }

  private readonly scoringProfileInclude = {
    skills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
    experiences: true, educations: true, languages: { include: { language: true } },
    certifications: true, preferredCountries: true, city: { include: { province: true } },
  } as const;
  private readonly scoringJobInclude = {
    jobTitle: { select: { name: true, nameRu: true, nameUz: true, nameId: true, normalizedKey: true, aliases: { select: { aliasKey: true } } } },
    jobSkills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
    jobLanguages: { include: { language: true } }, city: { include: { province: true } },
  } as const;

  async scoreProfileAgainstJob(profileId: string, jobPostId: string) {
    return this.recruiter.forProfile(profileId,jobPostId);
  }

  async scoreProfilesAgainstJob(profiles: Parameters<RecruiterMatchingService['forProfiles']>[0], jobPostId: string) {
    return this.recruiter.forProfiles(profiles,jobPostId);
  }

  async scoreJobsForProfile(profileId: string, jobIds: string[]) {
    const [profile, jobs] = await Promise.all([
      this.prisma.employeeProfile.findUniqueOrThrow({ where: { id: profileId }, include: this.scoringProfileInclude }),
      this.prisma.jobPost.findMany({ where: { id: { in: jobIds } }, include: this.scoringJobInclude }),
    ]);
    return new Map(jobs.map(job => [job.id, this.compute(profile, job)]));
  }

  compute(profile: MatchProfile, job: MatchJob): MatchBreakdown {
    const matchedSkills: string[] = [];
    const missingRequiredSkills: string[] = [];

    let skillsScore = 0;
    let matchedDistinctive = 0;
    let matchedSoft = 0;
    let coverage = 0;
    if (job.jobSkills.length > 0) {
      let weightedHit = 0;
      let weightedTotal = 0;
      for (const js of job.jobSkills) {
        const w = (js.weight || 1) * (js.isRequired ? 1.5 : 1);
        weightedTotal += w;
        const ps = findProfileSkill(profile.skills, js);
        if (ps) {
          weightedHit += w * Math.min(1.15, SKILL_LEVEL_SCORE[ps.level]);
          matchedSkills.push(js.skill.name);
          if (isSoftSkill(js.skill)) matchedSoft += 1;
          else matchedDistinctive += 1;
        } else if (js.isRequired) {
          missingRequiredSkills.push(js.skill.name);
        }
      }
      coverage = weightedTotal ? Math.min(1, weightedHit / weightedTotal) : 0;
      skillsScore = weightedTotal ? Math.round(coverage * SKILLS_BUCKET) : 0;
    }

    const roles = splitRoleTexts(profile);
    const titleScore = roleMatchScore(roles.primary, roles.history, job);
    const softOnlyPreview = matchedDistinctive === 0 && matchedSoft > 0 && titleScore === 0;
    const conflict = titleFamiliesConflict(roles.primary, job);
    if (conflict && !softOnlyPreview && job.jobSkills.length > 0) {
      const profileDistinctive = profile.skills.filter((s) => !isSoftSkill(s.skill));
      const fit = profileDistinctive.length
        ? profileDistinctive.filter((ps) =>
            job.jobSkills.some(
              (js) =>
                ps.skillId === js.skillId ||
                (skillIdentityKey(ps.skill) !== '' &&
                  skillIdentityKey(ps.skill) === skillIdentityKey(js.skill)),
            ),
          ).length / profileDistinctive.length
        : 0;
      skillsScore = Math.round(
        Math.sqrt(coverage * fit) * SKILLS_BUCKET * CONFLICT_SKILL_FACTOR,
      );
    }
    const requiredCount = job.jobSkills.filter(skill => skill.isRequired).length;
    if (requiredCount > 0 && missingRequiredSkills.length === requiredCount) skillsScore = Math.min(skillsScore, REQUIRED_SKILLS_MISS_CAP);

    const experienceYears = this.totalExperienceYears(profile.experiences);
    const requiredYears =
      job.experienceYearsMin ??
      (job.experienceLevel ? EXP_LEVEL_YEARS[job.experienceLevel] : null);
    let experienceScore = 9;
    if (requiredYears === null || requiredYears === 0) {
      experienceScore = 12;
    } else if (experienceYears >= requiredYears) {
      experienceScore = 15;
    } else if (experienceYears >= requiredYears * 0.7) {
      experienceScore = 10;
    } else if (experienceYears >= requiredYears * 0.4) {
      experienceScore = 6;
    } else {
      experienceScore = 2;
    }

    let locationScore = 3;
    const jobCountryId = job.countryId || job.city?.province?.countryId;
    const preferredCountry = !profile.preferredCountries?.length || profile.preferredCountries.some(country => country.id === jobCountryId);
    if (job.workMode === 'REMOTE' && (!jobCountryId || preferredCountry)) {
      locationScore = 12;
    } else if (job.cityId && profile.cityId && job.cityId === profile.cityId) {
      locationScore = 12;
    } else if (
      job.city?.provinceId &&
      profile.city?.provinceId &&
      job.city.provinceId === profile.city.provinceId
    ) {
      locationScore = 8;
    } else if (jobCountryId && profile.preferredCountries?.some(c => c.id === jobCountryId)) {
      locationScore = 8;
    } else if (!job.cityId && !jobCountryId) {
      locationScore = 8;
    }

    const maxDegree = profile.educations.reduce((max, e) => {
      if (!e.degree) return max;
      return Math.max(max, DEGREE_RANK[e.degree]);
    }, 0);
    let educationScore = 1;
    if (maxDegree >= DEGREE_RANK.MASTER) educationScore = 8;
    else if (maxDegree >= DEGREE_RANK.BACHELOR) educationScore = 6;
    else if (maxDegree >= DEGREE_RANK.VOCATIONAL) educationScore = 4;
    else if (maxDegree >= DEGREE_RANK.HIGH_SCHOOL) educationScore = 3;

    const matchedLanguages: string[] = [];
    const missingRequiredLanguages: string[] = [];
    let languageScore = 4;
    const jobLangs = job.jobLanguages ?? [];
    if (jobLangs.length > 0) {
      const profileByCode = new Map(
        profile.languages.map((l) => [l.language.code.toLowerCase(), l]),
      );
      let earned = 0;
      let weightTotal = 0;
      for (const jl of jobLangs) {
        const w = jl.isRequired ? 1.5 : 0.75;
        weightTotal += w;
        const pl = profileByCode.get(jl.language.code.toLowerCase());
        const label = `${jl.language.name} ${jl.minLevel}+`;
        if (!pl) {
          if (jl.isRequired) missingRequiredLanguages.push(label);
          continue;
        }
        const profileRank = languageLevelRank(pl.level);
        const needRank = languageLevelRank(jl.minLevel);
        if (profileRank >= needRank) {
          earned += w;
          matchedLanguages.push(label);
        } else if (profileRank >= needRank - 1) {
          earned += w * 0.55;
          matchedLanguages.push(`${jl.language.name} ${pl.level}`);
          if (jl.isRequired) missingRequiredLanguages.push(label);
        } else if (jl.isRequired) {
          missingRequiredLanguages.push(label);
        }
      }
      languageScore = weightTotal
        ? Math.min(10, Math.round((earned / weightTotal) * 10))
        : 5;
    } else {
      const codes = new Set(profile.languages.map((l) => l.language.code));
      if (codes.has('uz') || codes.has('ru')) languageScore += 2;
      if (codes.has('en')) languageScore += 2;
      if (profile.headline && profile.summary) languageScore += 1;
      if (profile.certifications.length > 0) languageScore += 1;
      languageScore = Math.min(10, languageScore);
    }

    // Experience, city, education and language scale a real role signal.
    // They must not add a floor when the title and distinctive skills miss.
    const softOnly = matchedDistinctive === 0 && matchedSoft > 0 && titleScore === 0;
    const role = titleScore + (softOnly ? 0 : skillsScore);
    let experienceOut = 0;
    let locationOut = 0;
    let educationOut = 0;
    let languageOut = 0;
    let total = 0;
    if (softOnly) {
      skillsScore = Math.min(skillsScore, SOFT_ONLY_CAP);
      total = skillsScore;
    } else if (role > 0) {
      const scale = role / ROLE_MAX;
      const context = experienceScore + locationScore + educationScore + languageScore;
      experienceOut = Math.round(experienceScore * scale);
      locationOut = Math.round(locationScore * scale);
      educationOut = Math.round(educationScore * scale);
      languageOut = Math.round(languageScore * scale);
      total = Math.min(100, role + experienceOut + locationOut + educationOut + languageOut);
    }

    return {
      skills: skillsScore,
      title: titleScore,
      experience: experienceOut,
      location: locationOut,
      education: educationOut,
      language: languageOut,
      total,
      details: {
        matchedSkills,
        missingRequiredSkills,
        matchedLanguages,
        missingRequiredLanguages,
        experienceYears,
        requiredYears,
      },
    };
  }

  totalExperienceYears(
    experiences: Array<{ startDate: Date; endDate: Date | null; isCurrent: boolean }>,
  ) {
    const now = Date.now();
    const intervals: Array<[number, number]> = [];
    for (const exp of experiences) {
      const start = exp.startDate.getTime();
      // Missing end dates on past work are unknown, not "still employed".
      const end = exp.isCurrent ? now : exp.endDate?.getTime();
      if (!Number.isFinite(start) || end == null || !Number.isFinite(end) || start >= now || end <= start) continue;
      intervals.push([start, Math.min(end, now)]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0, left = 0, right = 0;
    for (const [start, end] of intervals) {
      if (start > right) { covered += right - left; left = start; right = end; }
      else right = Math.max(right, end);
    }
    covered += right - left;
    return Math.round(covered / (1000 * 60 * 60 * 24 * 365.25) * 10) / 10;
  }

  async recommendCandidates(jobPostId: string, limit = 20) {
    const context = await this.recruiter.context(jobPostId);
    // Response-size protection applies equally to every job; it is not a package quota.
    const resultLimit = Math.max(1, Math.min(200, Math.floor(limit) || 20));
    const include = {...this.scoringProfileInclude,user:{select:{id:true,fullName:true,avatarUrl:true}},residenceCountry:true} as const;
    type Candidate = Prisma.EmployeeProfileGetPayload<{include:typeof include}>;
    let cursor:string|undefined;
    let ranked:Array<{profile:Candidate;matchScore:number;matchBreakdown:RecruiterBreakdown}>=[];
    while(true) {
      const batch=await this.prisma.employeeProfile.findMany({where:{visibility:VISIBLE_PROFILE,user:{isBanned:false,anonymizedAt:null},applications:{none:{jobPostId}}},include,take:100,orderBy:{id:'asc'},...(cursor?{cursor:{id:cursor},skip:1}:{})});
      const scored=batch.map(profile=>{const matchBreakdown=evaluateRecruiter(profile,context.job,context.index,context.now);return {profile,matchScore:matchBreakdown.total,matchBreakdown};}).filter(row=>row.matchBreakdown.positiveCore);
      ranked=[...ranked,...scored].sort((a,b)=>compareRecruiterMatches(a.matchBreakdown,b.matchBreakdown)||a.profile.id.localeCompare(b.profile.id)).slice(0,resultLimit);
      if(batch.length<100)break;
      cursor=batch[batch.length-1].id;
    }
    return ranked.map(row=>({...row,profile:{id:row.profile.id,headline:row.profile.headline,city:row.profile.city,residenceCountry:row.profile.residenceCountry,user:row.profile.user,skills:row.profile.skills.map(skill=>({name:skill.skill.name,slug:skill.skill.slug,level:skill.level}))}}));
  }

  async recommendJobsForProfile(profileId: string, limit = FOR_YOU_JOBS_LIMIT) {
    const profile = await this.prisma.employeeProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        skills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
        experiences: true,
        educations: true,
        languages: { include: { language: true } },
        certifications: true,
        preferredCountries: true,
        city: { include: {province:true} },
      },
    });

    const resultLimit = Math.max(1, Math.min(FOR_YOU_JOBS_LIMIT, Math.floor(limit)));

    const jobInclude = {
      company: {
        select: { id: true, name: true, slug: true, logoUrl: true },
      },
      city: { include: {province:true} },
      country: true,
      category: true,
      jobTitle: {
        select: { name: true, nameRu: true, nameUz: true, nameId: true, normalizedKey: true, aliases: { select: { aliasKey: true } } },
      },
      jobSkills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
      jobLanguages: { include: { language: true } },
    } as const;
    type ForYouRow = {
      job: Prisma.JobPostGetPayload<{ include: typeof jobInclude }>;
      matchScore: number;
      matchBreakdown: MatchBreakdown;
    };

    // For you is the published jobs catalog sorted by the existing match score.
    // Scan the full catalog in batches so older high-match jobs can rank above newer ones,
    // while retaining only the best 300 rows in memory and in the API response.
    let cursorId: string | undefined;
    let ranked: ForYouRow[] = [];

    while (true) {
      const jobs = await this.prisma.jobPost.findMany({
        where: {
          ...liveJobWhere(),
          company: { isBanned: false, anonymizedAt: null },
        },
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include: jobInclude,
        take: FOR_YOU_SCAN_BATCH,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      });
      if (!jobs.length) break;

      const scored = jobs.map((job) => {
        const matchBreakdown = this.compute(profile, job);
        return { job, matchScore: matchBreakdown.total, matchBreakdown };
      });
      ranked = [...ranked, ...scored]
        .sort(
          (a, b) =>
            b.matchScore - a.matchScore ||
            (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) ||
            a.job.id.localeCompare(b.job.id),
        )
        .slice(0, resultLimit);

      if (jobs.length < FOR_YOU_SCAN_BATCH) break;
      cursorId = jobs[jobs.length - 1].id;
    }

    return ranked;
  }
}
