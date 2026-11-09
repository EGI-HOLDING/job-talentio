import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { JsonSchema } from '../screening.schemas';

export const CV_SCORING_VERSION = 'talentio-cv-luna-v1';
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_RUBRIC = Object.freeze([
  { id: 'skills', name: 'Keterampilan yang relevan', weight: 40 },
  { id: 'experience', name: 'Pengalaman dan cakupan tanggung jawab', weight: 35 },
  { id: 'requirements', name: 'Persyaratan pekerjaan lainnya', weight: 25 },
]);
const criterion = z.object({ criterionId: z.string(), level: z.number().int().min(0).max(4), reason: z.string().min(1).max(1200), evidence: z.array(z.string().min(1).max(1000)).max(5) }).strict();
export const cvResultSchema = z.object({
  readable: z.boolean(), fullName: z.string().min(1).max(200).nullable(), email: z.string().email().max(254).nullable(),
  phone: z.string().max(60).nullable(), headline: z.string().max(300), summary: z.string().max(2000), cvText: z.string().max(200000),
  criteria: z.array(criterion).max(3), limitations: z.array(z.string().max(600)).max(5),
}).strict();
export type CvResult = z.infer<typeof cvResultSchema>;
const str: JsonSchema = { type: 'string' };
const nullable = (value: JsonSchema): JsonSchema => ({ anyOf: [value, { type: 'null' }] });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const CV_RESULT_SCHEMA = obj({
  readable: { type: 'boolean' }, fullName: nullable(str), email: nullable(str), phone: nullable(str), headline: str, summary: str, cvText: str,
  criteria: { type: 'array', items: obj({ criterionId: str, level: { type: 'integer', enum: [0, 1, 2, 3, 4] }, reason: str, evidence: { type: 'array', items: str } }) },
  limitations: { type: 'array', items: str },
});
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export function validateCvResult(value: unknown, scored: boolean) {
  const result = cvResultSchema.parse(value);
  if (!result.readable) {
    if (result.criteria.length) throw Error('UNREADABLE_CV_HAS_SCORES');
    return { result, score: null };
  }
  if (normalize(result.cvText).length < 40) throw Error('CV_TEXT_MISSING');
  if (!scored && result.criteria.length) throw Error('UNASSIGNED_CV_HAS_SCORES');
  if (scored && (result.criteria.length !== CV_RUBRIC.length || new Set(result.criteria.map(c => c.criterionId)).size !== CV_RUBRIC.length || result.criteria.some(c => !CV_RUBRIC.some(r => r.id === c.criterionId)))) throw Error('CV_CRITERIA_MISMATCH');
  for (const row of result.criteria) {
    if (row.level > 0 && !row.evidence.length) throw Error('CV_SCORE_WITHOUT_EVIDENCE');
    if (row.evidence.some(quote => !normalize(result.cvText).includes(normalize(quote)))) throw Error('UNGROUNDED_CV_EVIDENCE');
  }
  const score = scored ? Math.round(CV_RUBRIC.reduce((sum, rubric) => sum + result.criteria.find(c => c.criterionId === rubric.id)!.level / 4 * rubric.weight, 0) * 10) / 10 : null;
  return { result, score };
}
export function fileChecksum(buffer: Buffer) { return createHash('sha256').update(buffer).digest('hex'); }
export function validateCvBytes(buffer: Buffer, filename: string) {
  if (!buffer.length || buffer.length > CV_MAX_BYTES) throw Error('CV_FILE_SIZE');
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf' && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (ext === 'docx' && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc' && buffer.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) return 'application/msword';
  throw Error('CV_FILE_INVALID');
}
