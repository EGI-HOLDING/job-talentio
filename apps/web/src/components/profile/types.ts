export type City = { id: string; name: string; slug: string };
export type Skill = { id: string; level: string; skill: { name: string; slug: string } };
export type Experience = { id: string; title: string; companyName: string; description?: string | null; startDate: string; endDate?: string | null; isCurrent: boolean; city?: City | null };
export type Education = { id: string; school: string; degree?: string | null; field?: string | null; startDate?: string | null; endDate?: string | null };
export type Certification = { id: string; name: string; issuer?: string | null; issuedAt?: string | null; expiresAt?: string | null; credentialUrl?: string | null };
export type ProfileLanguage = { id: string; level: string; language: { name: string; code: string } };
export type Resume = { id: string; title: string; isPrimary: boolean; hasFile: boolean; updatedAt?: string; targetJobTitle?: { name: string; slug: string } | null; parseStatus?: string; builderMeta?: { lastExportAt?: string } | null };
export type CareerProfile = {
  id: string;
  headline?: string | null;
  summary?: string | null;
  phone?: string | null;
  desiredPosition?: string | null;
  desiredSalaryMin?: number | null;
  city?: City | null;
  visibility: 'PUBLIC' | 'TO_REGISTERED_RECRUITERS' | 'PRIVATE';
  user: { fullName: string; email?: string | null; avatarUrl?: string | null; emailVerified?: boolean };
  skills: Skill[];
  experiences: Experience[];
  educations: Education[];
  languages: ProfileLanguage[];
  certifications: Certification[];
  resumes: Resume[];
};
export type ProfileEditor = { kind: 'basics' | 'skills' | 'experience' | 'education' | 'languages' | 'certification'; id?: string };
export type ImportedResult = { imported?: { skills?: number; experiences?: number; educations?: number; languages?: number } };
export const PROFILE_HREF = '/dashboard/employee?tab=profile';
export const CVS_HREF = `${PROFILE_HREF}&section=cvs`;
export const CV_ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export function cvFileError(file: File, t: (key: string) => string): string | null {
  if (!/\.(pdf|docx?)$/i.test(file.name)) return t('resumePdfOnly');
  if (file.size > 5 * 1024 * 1024) return t('resumeFileTooLarge');
  if (!file.size) return t('pc.emptyFile');
  return null;
}
export function dateValue(value?: string | null) { return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : ''; }
