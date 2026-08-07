import type { ResumeInclusion } from './schemas';
import { DEFAULT_RESUME_INCLUSION } from './schemas';

export type ResumeChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  tip?: string;
};

export type ResumeDocumentLite = {
  headline?: string | null;
  summary?: string | null;
  email?: string | null;
  phone?: string | null;
  skills: unknown[];
  experiences: Array<{ description?: string | null; startDate?: string | Date | null }>;
  educations: unknown[];
  languages: unknown[];
  certifications: unknown[];
};

export function normalizeResumeInclusion(raw?: ResumeInclusion | null): typeof DEFAULT_RESUME_INCLUSION {
  if (!raw) return { ...DEFAULT_RESUME_INCLUSION, sections: { ...DEFAULT_RESUME_INCLUSION.sections } };
  return {
    sections: {
      ...DEFAULT_RESUME_INCLUSION.sections,
      ...(raw.sections || {}),
    },
    experienceIds: raw.experienceIds ?? null,
    educationIds: raw.educationIds ?? null,
    skillIds: raw.skillIds ?? null,
    languageIds: raw.languageIds ?? null,
    certificationIds: raw.certificationIds ?? null,
  };
}

/** Rule-based completeness / ATS checklist (0–100). */
export function scoreResumeChecklist(doc: ResumeDocumentLite): {
  score: number;
  items: ResumeChecklistItem[];
} {
  const summaryLen = (doc.summary || '').trim().length;
  const items: ResumeChecklistItem[] = [
    {
      id: 'email',
      label: 'Email present',
      ok: Boolean(doc.email?.trim()),
      weight: 10,
      tip: 'Add email on your account / profile',
    },
    {
      id: 'phone',
      label: 'Phone present',
      ok: Boolean(doc.phone?.trim()),
      weight: 8,
      tip: 'Add phone in Profile',
    },
    {
      id: 'headline',
      label: 'Headline present',
      ok: Boolean(doc.headline?.trim()),
      weight: 10,
      tip: 'Add a professional headline',
    },
    {
      id: 'summary',
      label: 'Summary 80–600 characters',
      ok: summaryLen >= 80 && summaryLen <= 600,
      weight: 14,
      tip: summaryLen < 80 ? 'Write a longer professional summary' : 'Shorten your summary under 600 chars',
    },
    {
      id: 'skills',
      label: 'At least 5 skills',
      ok: doc.skills.length >= 5,
      weight: 12,
      tip: 'Add more skills in Profile',
    },
    {
      id: 'experience',
      label: 'At least one experience with description',
      ok: doc.experiences.some((e) => Boolean(e.description?.trim())),
      weight: 16,
      tip: 'Add work experience with bullet details',
    },
    {
      id: 'dates',
      label: 'Experience dates filled',
      ok:
        doc.experiences.length === 0 ||
        doc.experiences.every((e) => Boolean(e.startDate)),
      weight: 10,
      tip: 'Fill start dates on all experiences',
    },
    {
      id: 'education',
      label: 'At least one education',
      ok: doc.educations.length >= 1,
      weight: 10,
      tip: 'Add education in Profile',
    },
    {
      id: 'languages',
      label: 'Languages listed (bonus)',
      ok: doc.languages.length >= 1,
      weight: 5,
      tip: 'Optional: add languages',
    },
    {
      id: 'certs',
      label: 'Certifications listed (bonus)',
      ok: doc.certifications.length >= 1,
      weight: 5,
      tip: 'Optional: add certifications',
    },
  ];

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.filter((i) => i.ok).reduce((s, i) => s + i.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);
  return { score, items };
}
