import { Injectable } from '@nestjs/common';
import {
  DegreeLevel,
  ExperienceLevel,
  LanguageLevel,
  SkillLevel,
  WorkMode,
} from '@prisma/client';
import { languageLevelRank } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';

export type MatchBreakdown = {
  skills: number;
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

@Injectable()
export class MatchingService {
  constructor(private prisma: PrismaService) {}

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
          jobSkills: { include: { skill: true } },
          jobLanguages: { include: { language: true } },
          city: true,
        },
      }),
    ]);

    return this.compute(profile, job);
  }

  compute(
    profile: {
      cityId: string | null;
      headline: string | null;
      summary: string | null;
      skills: Array<{ skillId: string; level: SkillLevel; skill: { name: string; slug: string } }>;
      experiences: Array<{ startDate: Date; endDate: Date | null; isCurrent: boolean }>;
      educations: Array<{ degree: DegreeLevel | null }>;
      languages: Array<{ language: { code: string }; level: LanguageLevel }>;
      certifications: unknown[];
    },
    job: {
      cityId: string | null;
      workMode: WorkMode;
      experienceYearsMin: number | null;
      experienceLevel: ExperienceLevel | null;
      jobSkills: Array<{
        skillId: string;
        isRequired: boolean;
        weight: number;
        skill: { name: string; slug: string };
      }>;
      jobLanguages?: Array<{
        languageId: string;
        minLevel: LanguageLevel;
        isRequired: boolean;
        language: { code: string; name: string };
      }>;
    },
  ): MatchBreakdown {
    // Skills — 45 points
    let skillsScore = 45;
    const matchedSkills: string[] = [];
    const missingRequiredSkills: string[] = [];
    const profileSkillMap = new Map(
      profile.skills.map((s) => [s.skillId, s]),
    );

    if (job.jobSkills.length === 0) {
      skillsScore = 30;
    } else {
      let weightedHit = 0;
      let weightedTotal = 0;
      for (const js of job.jobSkills) {
        const w = (js.weight || 1) * (js.isRequired ? 1.5 : 1);
        weightedTotal += w;
        const ps = profileSkillMap.get(js.skillId);
        if (ps) {
          weightedHit += w * Math.min(1.15, SKILL_LEVEL_SCORE[ps.level]);
          matchedSkills.push(js.skill.name);
        } else if (js.isRequired) {
          missingRequiredSkills.push(js.skill.name);
        }
      }
      skillsScore = weightedTotal
        ? Math.round((weightedHit / weightedTotal) * 45)
        : 30;
    }

    // Experience — 20 points
    const experienceYears = this.totalExperienceYears(profile.experiences);
    const requiredYears =
      job.experienceYearsMin ??
      (job.experienceLevel ? EXP_LEVEL_YEARS[job.experienceLevel] : null);
    let experienceScore = 12;
    if (requiredYears === null || requiredYears === 0) {
      experienceScore = 16;
    } else if (experienceYears >= requiredYears) {
      experienceScore = 20;
    } else if (experienceYears >= requiredYears * 0.7) {
      experienceScore = 14;
    } else if (experienceYears >= requiredYears * 0.4) {
      experienceScore = 8;
    } else {
      experienceScore = 3;
    }

    // Location — 15 points
    let locationScore = 8;
    if (job.workMode === 'REMOTE') {
      locationScore = 15;
    } else if (job.cityId && profile.cityId && job.cityId === profile.cityId) {
      locationScore = 15;
    } else if (job.workMode === 'HYBRID' && profile.cityId) {
      locationScore = 10;
    } else if (!job.cityId) {
      locationScore = 12;
    } else {
      locationScore = 4;
    }

    // Education — 10 points
    const maxDegree = profile.educations.reduce((max, e) => {
      if (!e.degree) return max;
      return Math.max(max, DEGREE_RANK[e.degree]);
    }, 0);
    let educationScore = 5;
    if (maxDegree >= DEGREE_RANK.MASTER) educationScore = 10;
    else if (maxDegree >= DEGREE_RANK.BACHELOR) educationScore = 8;
    else if (maxDegree >= DEGREE_RANK.VOCATIONAL) educationScore = 6;
    else if (maxDegree >= DEGREE_RANK.HIGH_SCHOOL) educationScore = 4;
    else educationScore = 2;

    // Language — 10 points (requirement-based when job lists languages)
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
      Math.round(skillsScore + experienceScore + locationScore + educationScore + languageScore),
    );

    return {
      skills: skillsScore,
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
        jobSkills: { include: { skill: true } },
        jobLanguages: { include: { language: true } },
        city: true,
        applications: { select: { profileId: true } },
      },
    });
    const appliedIds = new Set(job.applications.map((a) => a.profileId));

    const skillIds = job.jobSkills.map((s) => s.skillId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: {
        visibility: { in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] },
        ...(skillIds.length
          ? { skills: { some: { skillId: { in: skillIds } } } }
          : {}),
      },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true } },
        skills: { include: { skill: true } },
        experiences: true,
        educations: true,
        languages: { include: { language: true } },
        certifications: true,
        city: true,
      },
      take: 200,
    });

    const scored = profiles
      .filter((p) => !appliedIds.has(p.id))
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
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);

    return scored;
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
    const appliedJobIds = new Set(profile.applications.map((a) => a.jobPostId));
    const skillIds = profile.skills.map((s) => s.skillId);

    const jobs = await this.prisma.jobPost.findMany({
      where: {
        status: 'PUBLISHED',
        ...(skillIds.length
          ? { jobSkills: { some: { skillId: { in: skillIds } } } }
          : {}),
      },
      include: {
        company: {
          select: { id: true, name: true, slug: true, logoUrl: true },
        },
        city: true,
        category: true,
        jobSkills: { include: { skill: true } },
        jobLanguages: { include: { language: true } },
      },
      take: 200,
      orderBy: { publishedAt: 'desc' },
    });

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
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }
}
