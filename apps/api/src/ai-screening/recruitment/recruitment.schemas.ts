import { z } from 'zod';
import { CV_MAX_BYTES } from './cv-scoring.policy';
export const cvStatusIds = z.string().max(6000).transform(value => [...new Set(value.split(','))])
  .pipe(z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).min(1).max(100));
export const cvOperatorRecovery = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RESUME') }).strict(),
  z.object({ action: z.literal('CONFIRM_NOT_ACCEPTED'), reference: z.string().regex(/^[a-zA-Z0-9_-]{5,100}$/) }).strict(),
]);
export const candidateImportSchema = z.object({
  companyId: z.string().min(1), jobId: z.string().min(1).optional(), requestKey: z.string().min(10).max(100),
  files: z.array(z.object({ clientId: z.string().min(1).max(100), filename: z.string().min(1).max(240).regex(/\.(pdf|docx?)$/i), size: z.number().int().min(1).max(CV_MAX_BYTES), contentType: z.enum(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) }).strict()).min(1).max(1000),
}).strict().refine(v => new Set(v.files.map(f => f.clientId)).size === v.files.length, 'Duplicate file IDs');
export const candidateListSchema = z.object({
  companyId: z.string().min(1), jobId: z.string().optional(), q: z.string().max(200).default(''), phase: z.enum(['all','review','progress','finished']).default('all'),
  stage: z.enum(['NEW','IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN']).optional(),
  sort: z.enum(['score','newest','schedule']).default('score'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(10),
}).strict();
export const candidateMoveSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000), stage: z.enum(['IN_REVIEW','INTERVIEW','OFFER','HIRED','REJECTED']) }).strict();
export type CandidateList = z.infer<typeof candidateListSchema>;
export const candidateSelectionSchema = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) }).strict(),
  z.object({ filter: candidateListSchema, expectedCount: z.number().int().min(1), excludedIds: z.array(z.string()).max(1000).default([]) }).strict(),
]);
export const candidateBulkSchema = z.object({ companyId: z.string().min(1), selection: candidateSelectionSchema,
  action: z.discriminatedUnion('kind',[
    z.object({kind:z.literal('move'),stage:z.enum(['IN_REVIEW','INTERVIEW','REJECTED'])}).strict(),
    z.object({kind:z.literal('assign'),userId:z.string().min(1).nullable()}).strict(),
    z.object({kind:z.literal('rescore')}).strict(),
    z.object({kind:z.literal('job'),jobId:z.string().min(1)}).strict(),
  ]),
}).strict();
