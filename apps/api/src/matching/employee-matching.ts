/** Shared career DTOs and recruiter catalog helpers only; no candidate scoring engine is defined here. */
import type { OccupationMatchingMetadata } from '@job-talentio/shared';
import { normalizeJobTitleKey } from '../common/title-resolve';
import type { CandidateExperienceInput } from './employee-experience-policy';
export type CatalogRole = {
  id: string; name: string; nameId?: string | null; nameUz?: string | null; nameRu?: string | null;
  normalizedKey: string; aliases: Array<{ alias: string; aliasKey: string }>; matchingMetadata?: unknown;
};
type Skill = { id?: string; name: string; nameId?:string | null; nameUz?:string | null; nameRu?:string | null; normalizedKey?: string | null; slug: string; aliases?: Array<{ aliasKey: string }> };
export type EmployeeMatchProfile = {
  id: string; headline?: string | null; desiredPosition?: string | null; desiredPositions?: string[];
  cvSource?: {versionId:string|null;status:string}; cvRoleTitles?:string[];
  cityId?: string | null; residenceCountryId?: string | null; noExperience?: boolean;
  preferredCountries?: Array<{ id: string }>;
  city?: { provinceId?: string; province?: { countryId: string } } | null;
  skills: Array<{ id?: string; skillId: string; level: string; levelSource?: string; skill: Skill }>;
  experiences: Array<{ id?: string; title: string; startDate: Date; endDate: Date | null; isCurrent: boolean }>;
  languages: Array<{ id?: string; languageId?: string; level: string; language: { code: string } }>;
};
export type EmployeeMatchJob = Partial<Omit<CandidateExperienceInput,'experienceYearsMin'>> & {
  positionEntryMode?:string;
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

export function experienceNeedsReview(exp: EmployeeMatchProfile['experiences'][number], now: Date): boolean {
  const start = new Date(exp.startDate).getTime();
  const end = exp.isCurrent ? now.getTime() : exp.endDate ? new Date(exp.endDate).getTime() : NaN;
  // Structural CV markers, not occupation-specific words. Keep source records untouched.
  const heading = /^(?:professional experience|work experience|employment history|pengalaman kerja|ish tajribasi|опыт работы|stack\s*:|technologies\s*:)/iu.test(exp.title.trim());
  return heading || !Number.isFinite(start) || !Number.isFinite(end) || end < start || start > now.getTime() || end > now.getTime();
}
