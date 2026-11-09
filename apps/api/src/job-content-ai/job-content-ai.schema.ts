import { z } from 'zod';

export const jobContentTargetSchema = z.enum(['description', 'responsibilities', 'kpis', 'skills']);
export type JobContentTarget = z.infer<typeof jobContentTargetSchema>;

export const generateJobContentSchema = z.object({
  companyId: z.string().min(1).max(100),
  target: jobContentTargetSchema,
  locale: z.enum(['id', 'en', 'ru', 'uz']),
  job: z.object({
    title: z.string().trim().min(2).max(200),
    seniority: z.string().trim().max(120).nullable(),
    experienceMin: z.number().int().min(0).max(50).nullable(),
    experienceMax: z.number().int().min(0).max(50).nullable(),
    description: z.string().max(20_000),
    responsibilities: z.array(z.string().max(1_000)).max(30),
    kpis: z.array(z.string().max(1_000)).max(30),
    specificExpectations: z.string().max(5_000),
    skills: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      isRequired: z.boolean(),
      minLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).nullable(),
    }).strict()).max(30),
  }).strict(),
}).strict();

export type GenerateJobContentInput = z.infer<typeof generateJobContentSchema>;

const descriptionOutput = z.object({
  description: z.string().trim().min(40).max(4_000),
}).strict();
const listOutput = z.object({
  items: z.array(z.string().trim().min(2).max(240)).min(1).max(8),
}).strict();
const kpiOutput = z.object({
  items: z.array(z.string().trim().min(2).max(240)).min(1).max(6),
}).strict();
const skillsOutput = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    isRequired: z.boolean(),
    minLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']).nullable(),
  }).strict()).min(1).max(10),
}).strict();

export type JobContentSuggestion =
  | { description: string }
  | { items: string[] }
  | { items: Array<{ name: string; isRequired: boolean; minLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT' | null }> };

export function validateJobContentSuggestion(target: JobContentTarget, value: unknown): JobContentSuggestion {
  const parsed = (target === 'description' ? descriptionOutput
    : target === 'responsibilities' ? listOutput
      : target === 'kpis' ? kpiOutput : skillsOutput).safeParse(value);
  if (!parsed.success) throw new Error('INVALID_JOB_CONTENT_OUTPUT');
  if (target === 'description') return parsed.data as { description: string };

  const seen = new Set<string>();
  if (target === 'skills') {
    const items = (parsed.data as z.infer<typeof skillsOutput>).items.filter(item => {
      const key = item.name.normalize('NFKC').trim().toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!items.length) throw new Error('INVALID_JOB_CONTENT_OUTPUT');
    return { items };
  }

  const items = (parsed.data as z.infer<typeof listOutput>).items.filter(item => {
    const key = item.normalize('NFKC').trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!items.length) throw new Error('INVALID_JOB_CONTENT_OUTPUT');
  return { items };
}
