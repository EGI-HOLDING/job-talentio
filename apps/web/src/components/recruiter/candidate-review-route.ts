import { CANDIDATE_REVIEW_ROOT, employerJobHref, employerWorkspaceHref } from '@/lib/accountNavigation';

export const candidateStages: Record<string, string> = {
  NEW: 'Perlu ditinjau', IN_REVIEW: 'Sedang ditinjau', INTERVIEW: 'Wawancara',
  OFFER: 'Penawaran', HIRED: 'Diterima bekerja', REJECTED: 'Ditolak', WITHDRAWN: 'Ditarik',
};

export const reviewTabs = ['cv', 'screening', 'schedule', 'messages', 'activity'] as const;
export type ReviewTab = typeof reviewTabs[number];
export type ReviewReport = { kind: 'cv' } | { kind: 'interview'; invitationId: string } | { kind: 'application' };

type ListFilters = { q: string; page: number; limit: number; phase: string; sort: string; stage: string };
const defaults: ListFilters = { q: '', page: 1, limit: 10, phase: 'all', sort: 'score', stage: '' };
const keys = Object.keys(defaults) as Array<keyof ListFilters>;

export function readCandidateListFilters(params: Pick<URLSearchParams, 'get'>): ListFilters {
  const page = Number(params.get('list-page')), limit = Number(params.get('list-limit'));
  const phase = params.get('list-phase') ?? '', sort = params.get('list-sort') ?? '', stage = params.get('list-stage') ?? '';
  return {
    q: (params.get('list-q') ?? '').slice(0, 200),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(100_000, page) : defaults.page,
    limit: [10, 25, 50, 100].includes(limit) ? limit : defaults.limit,
    phase: ['review', 'progress', 'finished'].includes(phase) ? phase : defaults.phase,
    sort: ['newest', 'schedule'].includes(sort) ? sort : defaults.sort,
    stage: Object.hasOwn(candidateStages, stage) ? stage : defaults.stage,
  };
}

function filterParams(filters: ListFilters) {
  return new URLSearchParams(keys.filter(key => defaults[key] !== filters[key]).map(key => [`list-${key}`, String(filters[key])]));
}

export function candidateListHref(companyId: string, jobId?: string | null, filters: ListFilters = defaults) {
  const href = jobId ? employerJobHref(jobId, 'applicants', companyId) : employerWorkspaceHref('jobs', companyId) + '&pool=1';
  const params = filterParams(filters);
  return params.size ? `${href}&${params}` : href;
}

export function candidateReviewHref(id: string, filters: ListFilters, tab: ReviewTab = 'cv', report?: ReviewReport) {
  const params = filterParams(filters);
  if (tab !== 'cv' && !report) params.set('tab', tab);
  const suffix = report?.kind === 'interview' ? '/reports/interviews/' + encodeURIComponent(report.invitationId) : report ? '/reports/' + report.kind : '';
  return `${CANDIDATE_REVIEW_ROOT}/${encodeURIComponent(id)}${suffix}${params.size ? '?' + params : ''}`;
}
