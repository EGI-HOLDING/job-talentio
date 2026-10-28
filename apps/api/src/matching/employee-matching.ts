import type { MatchEvidence, MatchInsights, OccupationMatchingMetadata } from '@job-talentio/shared';
import { languageLevelRank } from '@job-talentio/shared';
import { normalizeJobTitleKey } from '../common/title-resolve';
import { normalizeSkillKey } from '../common/skill-resolve';

export const EMPLOYEE_MATCH_VERSION = 'employee-evidence-v2';
export type CatalogRole = {
  id: string; name: string; nameId?: string | null; nameUz?: string | null; nameRu?: string | null;
  normalizedKey: string; aliases: Array<{ alias: string; aliasKey: string }>; matchingMetadata?: unknown;
};
type Skill = { id?: string; name: string; nameId?:string | null; nameUz?:string | null; nameRu?:string | null; normalizedKey?: string | null; slug: string; aliases?: Array<{ aliasKey: string }> };
export type EmployeeMatchProfile = {
  id: string; headline?: string | null; desiredPosition?: string | null; desiredPositions?: string[];
  cityId?: string | null; residenceCountryId?: string | null; noExperience?: boolean;
  preferredCountries?: Array<{ id: string }>;
  city?: { provinceId?: string; province?: { countryId: string } } | null;
  skills: Array<{ id?: string; skillId: string; level: string; levelSource?: string; skill: Skill }>;
  experiences: Array<{ id?: string; title: string; startDate: Date; endDate: Date | null; isCurrent: boolean }>;
  languages: Array<{ id?: string; languageId?: string; level: string; language: { code: string } }>;
};
export type EmployeeMatchJob = {
  id: string; title: string; jobTitleId?: string | null; companyId: string; publishedAt?: Date | null;
  countryId?: string | null; cityId?: string | null; workMode: string; experienceYearsMin?: number | null; experienceLevel?:string | null;
  city?: { provinceId?: string; province?: { countryId: string } } | null;
  jobSkills: Array<{ id?: string; skillId: string; isRequired: boolean; weight: number; minLevel?: string | null; skill: Skill }>;
  jobLanguages: Array<{ id?: string; minLevel: string; isRequired: boolean; provenance?: string; language: { code: string; name: string } }>;
};

/** Ambiguous catalog labels never silently resolve to an arbitrary occupation. */
export class OccupationIndex {
  readonly roles = new Map<string, CatalogRole>();
  private labels = new Map<string, Set<string>>();
  constructor(roles: CatalogRole[]) {
    for (const role of roles) {
      this.roles.set(role.id, role);
      for (const text of [role.name, role.nameId, role.nameUz, role.nameRu, role.normalizedKey,
        ...role.aliases.flatMap(a => [a.alias, a.aliasKey])]) {
        if (!text) continue;
        const key = normalizeJobTitleKey(text);
        if (!key) continue;
        const ids = this.labels.get(key) ?? new Set<string>(); ids.add(role.id); this.labels.set(key, ids);
      }
    }
  }
  resolve(text: string): Set<string> {
    const whole = this.labels.get(normalizeJobTitleKey(text));
    if (whole?.size === 1) return new Set(whole);
    const ids = new Set<string>();
    // Resolve the complete label first: slashes can also belong to a single occupation.
    for (const part of text.split(/\s+(?:—|–|@)\s+/u)[0].split(/\s*[\/|;\n]\s*|\s+[&+]\s+/u)) {
      const found = this.labels.get(normalizeJobTitleKey(part));
      if (found?.size === 1) for (const id of found) ids.add(id);
    }
    return ids;
  }
  related(from: string, to: string): boolean {
    const metadata = this.roles.get(from)?.matchingMetadata as OccupationMatchingMetadata | null;
    return Array.isArray(metadata?.relatedRoles) && metadata.relatedRoles.some(r => r.id === to && r.approved === true && r.kind === 'RELATED' && r.reference);
  }
}

const levelRank = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'];
const skillKeys = (skill: Skill) => new Set([skill.name, skill.slug, skill.normalizedKey,
  ...(skill.aliases ?? []).map(a => a.aliasKey)].filter((v): v is string => Boolean(v)).map(normalizeSkillKey).filter(Boolean));
const overlap = (a: Set<string>, b: Set<string>) => [...a].some(value => b.has(value));

export function experienceNeedsReview(exp: EmployeeMatchProfile['experiences'][number], now: Date): boolean {
  const start = new Date(exp.startDate).getTime();
  const end = exp.isCurrent ? now.getTime() : exp.endDate ? new Date(exp.endDate).getTime() : NaN;
  // Structural CV markers, not occupation-specific words. Keep source records untouched.
  const heading = /^(?:professional experience|work experience|employment history|pengalaman kerja|ish tajribasi|опыт работы|stack\s*:|technologies\s*:)/iu.test(exp.title.trim());
  return heading || !Number.isFinite(start) || !Number.isFinite(end) || end < start || start > now.getTime() || end > now.getTime();
}

function unionYears(intervals: Array<[number, number]>): number {
  intervals.sort((a,b) => a[0] - b[0]);
  let total = 0; let end = 0;
  for (const [start, finish] of intervals) { total += Math.max(0, finish - Math.max(start,end)); end = Math.max(end,finish); }
  return total / 31557600000;
}

export type EmployeeEvaluation = { score: number; optionalScore: number; positiveCore: boolean; insights: MatchInsights };
export function evaluateEmployee(profile: EmployeeMatchProfile, job: EmployeeMatchJob, index: OccupationIndex, now = new Date()): EmployeeEvaluation {
  const evidence: MatchEvidence[] = [];
  const review = profile.experiences.filter(e => experienceNeedsReview(e, now));
  const validExperiences = profile.experiences.filter(e => !experienceNeedsReview(e, now));
  const roles = new Set<string>();
  for (const text of [profile.headline, profile.desiredPosition, ...(profile.desiredPositions ?? []),
    ...validExperiences.filter(e => e.isCurrent).map(e => e.title)]) {
    if (text) for (const id of index.resolve(text)) roles.add(id);
  }
  const jobRoles = job.jobTitleId ? new Set([job.jobTitleId]) : index.resolve(job.title);
  const historyRoles=new Set(validExperiences.flatMap(e=>[...index.resolve(e.title)]));
  const matchingHistory=overlap(historyRoles,jobRoles);
  const matchingRole = overlap(roles, jobRoles);
  const related = !matchingRole && [...roles].some(from => [...jobRoles].some(to => index.related(from, to)));
  // Free text can match exactly, but cannot invent equivalence or a related occupation.
  const direct = !job.jobTitleId && !matchingRole && !related && [profile.headline, profile.desiredPosition, ...(profile.desiredPositions ?? [])]
    .filter((v): v is string => Boolean(v)).some(text => normalizeJobTitleKey(text) === normalizeJobTitleKey(job.title));
  let score = matchingRole || direct ? 15 : related || matchingHistory ? 8 : 0;
  if (matchingRole || related || direct || matchingHistory) evidence.push({ kind:'ROLE', label:job.title, status:'MET', required:false,
    code:matchingRole || direct ? 'ROLE_MATCH' : matchingHistory ? 'PAST_ROLE' : 'RELATED_ROLE', evidenceRefs:[`profile:${profile.id}:roles`, `job:${job.id}:title`, ...[...roles,...historyRoles].map(id => `jobTitle:${id}`)] });

  const requiredSkills = job.jobSkills.filter(s => s.isRequired);
  const scoredSkills = requiredSkills.length ? requiredSkills : job.jobSkills;
  let matchedWeight = 0; let totalWeight = 0; let optionalScore = 0;
  for (const requirement of job.jobSkills) {
    const weight = Number.isFinite(requirement.weight) && requirement.weight > 0 ? requirement.weight : 1;
    const found = profile.skills.filter(s => s.skillId === requirement.skillId || overlap(skillKeys(s.skill), skillKeys(requirement.skill)))
      .sort((a,b)=>Number(b.levelSource === 'USER_CONFIRMED')-Number(a.levelSource === 'USER_CONFIRMED') || levelRank.indexOf(b.level)-levelRank.indexOf(a.level))[0];
    const knownLevel = found?.levelSource === 'USER_CONFIRMED';
    const status = !found ? 'UNKNOWN' : requirement.minLevel
      ? !knownLevel ? 'UNKNOWN' : levelRank.indexOf(found.level) >= levelRank.indexOf(requirement.minLevel) ? 'MET' : 'UNMET'
      : 'MET';
    const counted = scoredSkills.includes(requirement);
    if (counted) { totalWeight += weight; if (status === 'MET') matchedWeight += weight; }
    else if (status === 'MET') optionalScore += weight;
    evidence.push({ kind:'SKILL', label:requirement.skill.name, status, required:requirement.isRequired,
      ...(requirement.minLevel ? {minimumLevel:requirement.minLevel} : {}),
      labels:{en:requirement.skill.name,id:requirement.skill.nameId,uz:requirement.skill.nameUz,ru:requirement.skill.nameRu},
      code:status === 'MET' ? 'SKILL_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : found && requirement.minLevel ? 'LEVEL_UNCONFIRMED' : 'NOT_LISTED',
      evidenceRefs: found ? [`profileSkill:${found.id ?? found.skillId}`, `jobSkill:${requirement.id ?? requirement.skillId}`] : [`jobSkill:${requirement.id ?? requirement.skillId}`] });
  }
  // Evidence coverage of job requirements; unrelated profile skills never form a denominator.
  if (totalWeight) score += 40 * matchedWeight / totalWeight;
  const positiveCore = matchingRole || direct || related || matchingHistory || matchedWeight > 0;
  const relevantExperience = validExperiences.filter(e => overlap(index.resolve(e.title), jobRoles));
  const years = unionYears(relevantExperience.map(e => [new Date(e.startDate).getTime(), e.isCurrent ? now.getTime() : new Date(e.endDate!).getTime()]));
  const minimum = job.experienceYearsMin;
  if (minimum != null && minimum > 0) {
    const known = relevantExperience.length > 0 || profile.noExperience === true;
    const status = !known ? 'UNKNOWN' : years >= minimum ? 'MET' : 'UNMET';
    if (known) score += 15 * Math.min(1, years / minimum);
    evidence.push({ kind:'EXPERIENCE', label:String(minimum), status, required:true,
      code:status === 'MET' ? 'EXPERIENCE_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : 'NOT_LISTED',
      evidenceRefs:relevantExperience.map(e => `experience:${e.id ?? e.title}`) });
  }
  if (minimum == null && job.experienceLevel) evidence.push({kind:'EXPERIENCE',label:job.experienceLevel,status:'UNKNOWN',required:true,code:'NOT_LISTED',evidenceRefs:[`job:${job.id}:experienceLevel`]});
  const preferred = profile.preferredCountries?.map(c => c.id) ?? [];
  const countryId = job.countryId ?? job.city?.province?.countryId;
  const countryMatch = countryId && (preferred.length ? preferred.includes(countryId) :
    countryId === (profile.residenceCountryId ?? profile.city?.province?.countryId));
  const cityMatch = job.cityId && job.cityId === profile.cityId && (!preferred.length || countryMatch);
  if (cityMatch || countryMatch) {
    score += cityMatch ? 12 : 8;
    evidence.push({ kind:'LOCATION', label:job.cityId === profile.cityId && job.cityId ? 'CITY' : 'COUNTRY', status:'MET', required:false,
      code:'LOCATION_MATCH', evidenceRefs:[`job:${job.id}:location`, `profile:${profile.id}:location`] });
  }
  let languageMet = 0; let verifiedCount = 0;
  for (const requirement of job.jobLanguages) {
    if (requirement.provenance !== 'EMPLOYER_CONFIRMED') {
      evidence.push({ kind:'LANGUAGE', label:requirement.language.name, status:'UNKNOWN', required:false,
        code:'UNVERIFIED_REQUIREMENT', evidenceRefs:[`jobLanguage:${requirement.id ?? requirement.language.code}`] });
      continue;
    }
    const found = profile.languages.find(l => l.language.code === requirement.language.code);
    const status = !found ? 'UNKNOWN' : languageLevelRank(found.level as never) >= languageLevelRank(requirement.minLevel as never) ? 'MET' : 'UNMET';
    verifiedCount++; if (status === 'MET') languageMet++;
    evidence.push({ kind:'LANGUAGE', label:`${requirement.language.name} ${requirement.minLevel}`, status, required:requirement.isRequired,
      code:status === 'MET' ? 'LANGUAGE_MATCH' : status === 'UNMET' ? 'BELOW_REQUIREMENT' : 'NOT_LISTED',
      evidenceRefs:[`jobLanguage:${requirement.id ?? requirement.language.code}`, ...(found ? [`profileLanguage:${found.id ?? found.languageId ?? found.language.code}`] : [])] });
  }
  if (verifiedCount) score += 10 * languageMet / verifiedCount;
  // No degree, certificate or inferred-language bonus without an authored requirement.
  return { score, optionalScore:Math.min(1, optionalScore), positiveCore,
    insights:{ version:EMPLOYEE_MATCH_VERSION, mode:positiveCore ? 'PERSONALIZED' : 'LATEST', evidence,
      reviewExperienceIds:review.map((e,i) => e.id ?? `unidentified:${i}`) } };
}

export function rankEmployeeJobs<T extends { job: EmployeeMatchJob; evaluation: EmployeeEvaluation }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a,b) => Number(b.evaluation.positiveCore) - Number(a.evaluation.positiveCore)
    || (a.evaluation.positiveCore ? b.evaluation.score - a.evaluation.score || b.evaluation.optionalScore - a.evaluation.optionalScore : 0)
    || (b.job.publishedAt?.getTime() ?? 0) - (a.job.publishedAt?.getTime() ?? 0) || a.job.id.localeCompare(b.job.id));
  // Diversity only within equal relevance; never promote an unrelated profession.
  for (let start = 0; start < sorted.length;) {
    if (!sorted[start].evaluation.positiveCore) break;
    let end = start + 1;
    while (end < sorted.length && sorted[end].evaluation.score === sorted[start].evaluation.score
      && sorted[end].evaluation.positiveCore === sorted[start].evaluation.positiveCore
      && sorted[end].evaluation.optionalScore === sorted[start].evaluation.optionalScore) end++;
    const pending = sorted.slice(start,end); const diverse: T[] = []; let last = '';
    while (pending.length) { const ix = Math.max(0,pending.findIndex(row => row.job.companyId !== last)); const [next] = pending.splice(ix,1); diverse.push(next); last = next.job.companyId; }
    sorted.splice(start,end-start,...diverse); start = end;
  }
  return sorted;
}
