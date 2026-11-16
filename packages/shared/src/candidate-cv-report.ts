import type { AssessmentLanguage } from './schemas';

export type CandidateCvResult = {
  assessmentLanguage?: AssessmentLanguage;
  narrative?: { state: 'PENDING' | 'REVIEW_REQUIRED' };
  summary?: string;
  criteria?: Array<{ criterionId: string; level: number; reason: string; evidence: string[] }>;
  limitations?: string[];
  roleAssessment?: { state: string; criteria: Array<{ id: string; name: string; displayName?: string }> };
  sourceReferences?: {
    fileKind?: string;
    blocks: Array<{ id: string; page: number; start: number; end: number }>;
    criteria: Array<{ criterionId: string; blockIds: string[] }>;
  };
  cvText?: string;
};

const legacyCriteria: Record<string, { id: string; en: string }> = {
  skills: { id: 'Keterampilan', en: 'Skills' },
  experience: { id: 'Pengalaman', en: 'Experience' },
  requirements: { id: 'Persyaratan pekerjaan', en: 'Job requirements' },
};

export function candidateCvCriteria(result: CandidateCvResult | null, language: AssessmentLanguage) {
  const sources = result?.sourceReferences;
  const blocks = new Map(sources?.blocks?.map(block => [block.id, block]));
  const references = new Map(sources?.criteria?.map(row => [row.criterionId, row.blockIds]));
  const names = new Map(result?.roleAssessment?.criteria?.map(row => [row.id, row.displayName ?? row.name]));

  return (result?.criteria ?? []).map(row => ({
    id: row.criterionId,
    name: names.get(row.criterionId) || legacyCriteria[row.criterionId]?.[language] || row.criterionId,
    level: row.level,
    reason: row.reason,
    evidence: (row.evidence ?? []).map(quote => {
      // Older results only contain the quote. Keep it and omit the page when its location is unknown.
      const block = (references.get(row.criterionId) ?? []).map(id => blocks.get(id)).find(source =>
        source && source.page > 0 && result?.cvText?.slice(source.start, source.end) === quote);
      return { quote, page: block?.page ?? null };
    }),
  }));
}
