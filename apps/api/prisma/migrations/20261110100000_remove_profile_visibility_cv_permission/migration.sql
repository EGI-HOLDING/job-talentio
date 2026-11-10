-- Stop collecting profile-visibility and database-CV-sharing preferences.
-- Keep uploaded resumes and historical candidate-access audit rows intact.
UPDATE "EmployeeProfile"
SET "onboardingDraft" = "onboardingDraft" - 'visibility'
WHERE "onboardingDraft" IS NOT NULL
  AND jsonb_typeof("onboardingDraft") = 'object'
  AND "onboardingDraft" ? 'visibility';

ALTER TABLE "EmployeeProfile"
  DROP CONSTRAINT IF EXISTS "EmployeeProfile_databaseResumeId_fkey";

ALTER TABLE "EmployeeProfile"
  DROP COLUMN IF EXISTS "visibility",
  DROP COLUMN IF EXISTS "databaseCvEnabled",
  DROP COLUMN IF EXISTS "databaseResumeId";

DROP TYPE IF EXISTS "ProfileVisibility";
