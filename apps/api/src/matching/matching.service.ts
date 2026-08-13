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
import { normalizeSkillKey } from '../common/skill-resolve';
import {
  canonicalTitleKey,
  normalizeJobTitleKey,
  profileRoleTexts,
  stripSeniorityFromTitle,
  titleSynonymCluster,
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

type SkillRef = { name: string; slug: string; normalizedKey?: string | null };

type MatchProfile = {
  cityId: string | null;
  headline: string | null;
  desiredPosition?: string | null;
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
  city?: { id?: string; provinceId?: string } | null;
};

type MatchJob = {
  title?: string;
  cityId: string | null;
  workMode: WorkMode;
  experienceYearsMin: number | null;
  experienceLevel: ExperienceLevel | null;
  jobTitle?: { name: string; normalizedKey: string } | null;
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
  city?: { id?: string; provinceId?: string } | null;
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

/** Floor for surfacing recommendations (baseline scoring can hit ~30+ on empty signals). */
const MIN_RECOMMENDATION_SCORE = 35;
const SKILLS_BUCKET = 40;
const TITLE_BUCKET = 15;
const REQUIRED_SKILLS_MISS_CAP = 12;
const RECOMMEND_QUERY_CAP = 200;
const RECOMMEND_FALLBACK_SCAN = 120;
const RECOMMEND_THIN_JOBS = 24;
const RECOMMEND_THIN_CANDIDATES = 40;

const VISIBLE_PROFILE = {
  in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] as ['PUBLIC', 'TO_REGISTERED_RECRUITERS'],
};

function skillIdentityKey(skill: SkillRef): string {
  if (skill.normalizedKey) {
    return normalizeSkillKey(skill.normalizedKey) || skill.normalizedKey;
  }
  return normalizeSkillKey(skill.name) || (skill.slug ? normalizeSkillKey(skill.slug) : '');
}

function findProfileSkill(
  profileSkills: MatchProfile['skills'],
  jobSkill: MatchJob['jobSkills'][number],
) {
  const byId = profileSkills.find((s) => s.skillId === jobSkill.skillId);
  if (byId) return byId;
  const jobKey = skillIdentityKey(jobSkill.skill);
  if (!jobKey) return undefined;
  const matches = profileSkills.filter((s) => skillIdentityKey(s.skill) === jobKey);
  if (!matches.length) return undefined;
  return matches.sort((a, b) => SKILL_LEVEL_SCORE[b.level] - SKILL_LEVEL_SCORE[a.level])[0];
}

function significantTitleTokens(input: string): Set<string> {
  const { roleTitle } = stripSeniorityFromTitle(input);
  return new Set(
    roleTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !TITLE_TOKEN_STOP.has(t)),
  );
}

function roleMatchScore(profileTexts: string[], job: MatchJob): number {
  if (!profileTexts.length) return 0;
  const jobName = job.jobTitle?.name || job.title || '';
  const jobKeys = new Set<string>();
  if (job.jobTitle?.normalizedKey) {
    jobKeys.add(canonicalTitleKey(job.jobTitle.normalizedKey));
    jobKeys.add(job.jobTitle.normalizedKey.toLowerCase());
  }
  if (jobName) jobKeys.add(normalizeJobTitleKey(jobName));
  if (job.title) jobKeys.add(normalizeJobTitleKey(job.title));
  jobKeys.delete('');

  const profileKeys = profileTexts.map((t) => normalizeJobTitleKey(t)).filter(Boolean);
  if (profileKeys.some((k) => jobKeys.has(k))) return TITLE_BUCKET;

  const jobCluster = new Set<string>();
  for (const k of jobKeys) {
    for (const c of titleSynonymCluster(k)) jobCluster.add(c);
  }
  if (profileKeys.some((k) => titleSynonymCluster(k).some((c) => jobCluster.has(c)))) {
    return 12;
  }

  const jobTokens = new Set<string>();
  for (const text of [jobName, job.title || '']) {
    if (!text) continue;
    for (const tok of significantTitleTokens(text)) jobTokens.add(tok);
  }
  if (!jobTokens.size) return 0;
  for (const text of profileTexts) {
    for (const tok of significantTitleTokens(text)) {
      if (jobTokens.has(tok)) return 6;
    }
  }
  return 0;
}

function mergeById<T extends { id: string }>(primary: T[], extra: T[], cap = RECOMMEND_QUERY_CAP): T[] {
  const seen = new Set(primary.map((row) => row.id));
  const out = [...primary];
  for (const row of extra) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= cap) break;
  }
  return out;
}

function profileTitleKeys(profile: MatchProfile): string[] {
  const keys = new Set<string>();
  for (const text of profileRoleTexts(profile)) {
    const key = normalizeJobTitleKey(text);
    if (!key) continue;
    for (const item of titleSynonymCluster(key)) keys.add(item);
  }
  return [...keys];
}

@Injectable()
export class MatchingService {
  constructor(private prisma: PrismaService) {}

  /** Profiles without skills or a role title are not matchable for discovery. */
  profileHasMatchSignal(profile: {
    skills: unknown[];
    headline?: string | null;
    desiredPosition?: string | null;
    experiences?: Array<{ title?: string | null }>;
  }) {
    return profile.skills.length > 0 || profileRoleTexts(profile).length > 0;
  }

  passesRecommendationGate(breakdown: MatchBreakdown) {
    if (breakdown.total < MIN_RECOMMENDATION_SCORE) return false;
    return breakdown.details.matchedSkills.length > 0 || breakdown.title >= 6;
  }

  async scoreProfileAgainstJob(
    profileId: string,
    jobPostId: string,
  ): Promise<MatchBreakdown> {
    const [profile, job] = await Promise.all([
      this.prisma.employeeProfile.findUniqueOrThrow({
        where: { id: profileId },
        include: {
          skills: { include: { skill: true } },
          experiences: true,
          educations: true,
          languages: { include: { language: true } },
          certifications: true,
          city: true,
        },
      }),
      this.prisma.jobPost.findUniqueOrThrow({
        where: { id: jobPostId },
        include: {
          jobTitle: { select: { name: true, normalizedKey: true } },
          jobSkills: { include: { skill: true } },
          jobLanguages: { include: { language: true } },
          city: true,
        },
      }),
    ]);

    return this.compute(profile, job);
  }

  compute(profile: MatchProfile, job: MatchJob): MatchBreakdown {
    const matchedSkills: string[] = [];
    const missingRequiredSkills: string[] = [];

    let skillsScore = SKILLS_BUCKET;
    if (job.jobSkills.length === 0) {
      skillsScore = 16;
    } else {
      let weightedHit = 0;
      let weightedTotal = 0;
      for (const js of job.jobSkills) {
        const w = (js.weight || 1) * (js.isRequired ? 1.5 : 1);
        weightedTotal += w;
        const ps = findProfileSkill(profile.skills, js);
        if (ps) {
          weightedHit += w * Math.min(1.15, SKILL_LEVEL_SCORE[ps.level]);
          matchedSkills.push(js.skill.name);
        } else if (js.isRequired) {
          missingRequiredSkills.push(js.skill.name);
        }
      }
      skillsScore = weightedTotal
        ? Math.round((weightedHit / weightedTotal) * SKILLS_BUCKET)
        : 16;
      const requiredCount = job.jobSkills.filter((js) => js.isRequired).length;
      if (requiredCount > 0 && missingRequiredSkills.length === requiredCount) {
        skillsScore = Math.min(skillsScore, REQUIRED_SKILLS_MISS_CAP);
      }
    }

    const titleScore = roleMatchScore(profileRoleTexts(profile), job);

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
    if (job.workMode === 'REMOTE') {
      locationScore = 12;
    } else if (job.cityId && profile.cityId && job.cityId === profile.cityId) {
      locationScore = 12;
    } else if (
      job.city?.provinceId &&
      profile.city?.provinceId &&
      job.city.provinceId === profile.city.provinceId
    ) {
      locationScore = 8;
    } else if (!job.cityId) {
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

    const total = Math.min(
      100,
      Math.round(
        skillsScore + titleScore + experienceScore + locationScore + educationScore + languageScore,
      ),
    );

    return {
      skills: skillsScore,
      title: titleScore,
      experience: experienceScore,
      location: locationScore,
      education: educationScore,
      language: languageScore,
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
    let months = 0;
    const now = Date.now();
    for (const exp of experiences) {
      const start = exp.startDate.getTime();
      const end = exp.isCurrent || !exp.endDate ? now : exp.endDate.getTime();
      months += Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30.44));
    }
    return Math.round((months / 12) * 10) / 10;
  }

  async recommendCandidates(jobPostId: string, limit = 20) {
    const job = await this.prisma.jobPost.findUniqueOrThrow({
      where: { id: jobPostId },
      include: {
        jobTitle: { select: { name: true, normalizedKey: true } },
        jobSkills: { include: { skill: true } },
        jobLanguages: { include: { language: true } },
        city: true,
        applications: { select: { profileId: true } },
      },
    });
    const appliedIds = new Set(job.applications.map((a) => a.profileId));
    const skillIds = job.jobSkills.map((s) => s.skillId);
    const skillKeys = [
      ...new Set(job.jobSkills.map((s) => skillIdentityKey(s.skill)).filter(Boolean)),
    ];
    const jobTitleKey =
      (job.jobTitle?.normalizedKey && canonicalTitleKey(job.jobTitle.normalizedKey)) ||
      normalizeJobTitleKey(job.title);

    if (!skillIds.length && !jobTitleKey) return [];

    const profileInclude = {
      user: { select: { id: true, fullName: true, avatarUrl: true } },
      skills: { include: { skill: true } },
      experiences: true,
      educations: true,
      languages: { include: { language: true } },
      certifications: true,
      city: true,
    } as const;

    const skillOr: Prisma.EmployeeProfileWhereInput[] = [];
    if (skillIds.length) {
      skillOr.push({ skills: { some: { skillId: { in: skillIds } } } });
    }
    if (skillKeys.length) {
      skillOr.push({ skills: { some: { skill: { normalizedKey: { in: skillKeys } } } } });
    }

    let profiles =
      skillOr.length > 0
        ? await this.prisma.employeeProfile.findMany({
            where: { visibility: VISIBLE_PROFILE, OR: skillOr },
            include: profileInclude,
            take: RECOMMEND_QUERY_CAP,
          })
        : [];

    if (profiles.length < RECOMMEND_THIN_CANDIDATES) {
      const extra = await this.prisma.employeeProfile.findMany({
        where: {
          visibility: VISIBLE_PROFILE,
          ...(profiles.length ? { id: { notIn: profiles.map((p) => p.id) } } : {}),
          OR: [
            { headline: { not: null } },
            { desiredPosition: { not: null } },
            { experiences: { some: {} } },
            { skills: { some: {} } },
          ],
        },
        include: profileInclude,
        take: RECOMMEND_FALLBACK_SCAN,
        orderBy: { updatedAt: 'desc' },
      });
      const keep = extra.filter((p) => {
        const breakdown = this.compute(p, job);
        return breakdown.details.matchedSkills.length > 0 || breakdown.title >= 6;
      });
      profiles = mergeById(profiles, keep);
    }

    return profiles
      .filter((p) => !appliedIds.has(p.id) && this.profileHasMatchSignal(p))
      .map((p) => {
        const breakdown = this.compute(p, job);
        return {
          profile: {
            id: p.id,
            headline: p.headline,
            city: p.city,
            user: p.user,
            skills: p.skills.map((s) => ({
              name: s.skill.name,
              slug: s.skill.slug,
              level: s.level,
            })),
          },
          matchScore: breakdown.total,
          matchBreakdown: breakdown,
        };
      })
      .filter((row) => this.passesRecommendationGate(row.matchBreakdown))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }

  async recommendJobsForProfile(profileId: string, limit = 20) {
    const profile = await this.prisma.employeeProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        skills: { include: { skill: true } },
        experiences: true,
        educations: true,
        languages: { include: { language: true } },
        certifications: true,
        city: true,
        applications: { select: { jobPostId: true } },
      },
    });

    if (!this.profileHasMatchSignal(profile)) return [];

    const appliedJobIds = new Set(profile.applications.map((a) => a.jobPostId));
    const skillIds = profile.skills.map((s) => s.skillId);
    const skillKeys = [
      ...new Set(profile.skills.map((s) => skillIdentityKey(s.skill)).filter(Boolean)),
    ];
    const titleKeys = profileTitleKeys(profile);

    const jobInclude = {
      company: {
        select: { id: true, name: true, slug: true, logoUrl: true },
      },
      city: true,
      category: true,
      jobTitle: { select: { name: true, normalizedKey: true } },
      jobSkills: { include: { skill: true } },
      jobLanguages: { include: { language: true } },
    } as const;

    const jobOr: Prisma.JobPostWhereInput[] = [];
    if (skillIds.length) {
      jobOr.push({ jobSkills: { some: { skillId: { in: skillIds } } } });
    }
    if (skillKeys.length) {
      jobOr.push({ jobSkills: { some: { skill: { normalizedKey: { in: skillKeys } } } } });
    }
    if (titleKeys.length) {
      jobOr.push({ jobTitle: { normalizedKey: { in: titleKeys } } });
    }

    let jobs =
      jobOr.length > 0
        ? await this.prisma.jobPost.findMany({
            where: { status: 'PUBLISHED', OR: jobOr },
            include: jobInclude,
            take: RECOMMEND_QUERY_CAP,
            orderBy: { publishedAt: 'desc' },
          })
        : [];

    if (jobs.length < RECOMMEND_THIN_JOBS) {
      const extra = await this.prisma.jobPost.findMany({
        where: {
          status: 'PUBLISHED',
          ...(jobs.length ? { id: { notIn: jobs.map((j) => j.id) } } : {}),
        },
        include: jobInclude,
        take: RECOMMEND_FALLBACK_SCAN,
        orderBy: { publishedAt: 'desc' },
      });
      const keep = extra.filter((j) => {
        const breakdown = this.compute(profile, j);
        return breakdown.details.matchedSkills.length > 0 || breakdown.title >= 6;
      });
      jobs = mergeById(jobs, keep);
    }

    return jobs
      .filter((j) => !appliedJobIds.has(j.id))
      .map((j) => {
        const breakdown = this.compute(profile, j);
        return {
          job: j,
          matchScore: breakdown.total,
          matchBreakdown: breakdown,
        };
      })
      .filter((row) => this.passesRecommendationGate(row.matchBreakdown))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }
}
