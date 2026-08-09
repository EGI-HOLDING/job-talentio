-- Soft-delete support for resume library retention
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Resume_profileId_deletedAt_idx" ON "Resume"("profileId", "deletedAt");
