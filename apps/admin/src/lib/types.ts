/** Row shapes returned by the admin list endpoints. */

export type UserRole = 'EMPLOYEE' | 'RECRUITER' | 'SUPER_ADMIN';
export type PlanCode = 'FREE' | 'STANDARD' | 'PREMIUM' | 'VIP';
export type JobStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'EXPIRED';
export type ReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type ReportEntityType = 'JOB_POST' | 'USER' | 'COMPANY' | 'CHAT_MESSAGE';
export type CatalogKind = 'skill' | 'jobTitle' | 'language' | 'benefit';
export type CatalogStatus = 'PENDING' | 'COMPLETE' | 'IGNORED';

export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  locale: string;
  avatarUrl: string | null;
  isBanned: boolean;
  emailVerified: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

export type AdminCompany = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  size: string | null;
  isVerified: boolean;
  isBanned: boolean;
  createdAt: string;
  city: { name: string; slug: string } | null;
  industry: { name: string; slug: string } | null;
  subscription: { plan: PlanCode; status: string } | null;
  _count: { jobPosts: number; members: number; followers: number };
};

export type AdminJob = {
  id: string;
  title: string;
  status: JobStatus;
  locale: string;
  employmentType: string;
  workMode: string;
  experienceLevel: string | null;
  boostUntil: string | null;
  boostWeight: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string; slug: string };
  city: { name: string } | null;
  _count: { applications: number; views: number };
};

export type AdminReport = {
  id: string;
  entityType: ReportEntityType;
  entityId: string;
  reason: string;
  status: ReportStatus;
  resolution: string | null;
  createdAt: string;
  reporter: { id: string; email: string; fullName: string } | null;
};

export type AdminAuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string; fullName: string } | null;
};

export type AdminCatalogEntry = {
  id: string;
  name: string;
  nameUz: string | null;
  nameRu: string | null;
  nameUzIsMachine: boolean;
  nameRuIsMachine: boolean;
  i18nStatus: CatalogStatus;
  createdAt: string;
};

export type AdminFlag = {
  id: string;
  key: string;
  enabled: boolean;
  payload: unknown;
};

export type AdminMetrics = {
  users: number;
  companies: number;
  publishedJobs: number;
  applications: number;
  revenueUzs: number;
};

export const USER_ROLES: UserRole[] = ['EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN'];
export const PLAN_CODES: PlanCode[] = ['FREE', 'STANDARD', 'PREMIUM', 'VIP'];
export const JOB_STATUSES: JobStatus[] = ['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'EXPIRED'];
export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
];
export const WORK_MODES = ['ONSITE', 'REMOTE', 'HYBRID'];
export const EXPERIENCE_LEVELS = ['INTERN', 'JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXECUTIVE'];
export const COMPANY_SIZES = [
  'SIZE_1_10',
  'SIZE_11_50',
  'SIZE_51_200',
  'SIZE_201_1000',
  'SIZE_1000_PLUS',
];
export const REPORT_STATUSES: ReportStatus[] = ['OPEN', 'RESOLVED', 'DISMISSED'];
export const REPORT_ENTITY_TYPES: ReportEntityType[] = [
  'JOB_POST',
  'USER',
  'COMPANY',
  'CHAT_MESSAGE',
];
export const LOCALES = ['uz', 'ru', 'en'];
export const CATALOG_KINDS: Array<{ value: CatalogKind; label: string }> = [
  { value: 'skill', label: 'Skills' },
  { value: 'jobTitle', label: 'Job titles' },
  { value: 'language', label: 'Languages' },
  { value: 'benefit', label: 'Benefits' },
];
export const CATALOG_STATUSES: CatalogStatus[] = ['PENDING', 'COMPLETE', 'IGNORED'];

/** Enum values are SCREAMING_CASE in the database but read better as words. */
export function humanize(value?: string | null): string {
  if (!value) return '-';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact relative age, for "last seen" style columns. */
export function timeAgo(value?: string | null): string {
  if (!value) return 'never';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function isHot(job: Pick<AdminJob, 'boostUntil'>): boolean {
  return Boolean(job.boostUntil && new Date(job.boostUntil).getTime() > Date.now());
}
