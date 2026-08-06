export type Locale = 'uz' | 'ru' | 'en';

export type UserRole = 'EMPLOYEE' | 'RECRUITER' | 'SUPER_ADMIN';

export type CompanyMemberRole = 'OWNER' | 'ADMIN' | 'RECRUITER';

export type PlanCode = 'FREE' | 'STANDARD' | 'PREMIUM';

export type JobStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'CLOSED' | 'EXPIRED';

export type ApplicationStatus =
  | 'NEW'
  | 'IN_REVIEW'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type SubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELLED';

export type ProfileVisibility =
  | 'PUBLIC'
  | 'TO_REGISTERED_RECRUITERS'
  | 'PRIVATE';

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'INTERNSHIP'
  | 'TEMPORARY';

export type WorkMode = 'ONSITE' | 'REMOTE' | 'HYBRID';
