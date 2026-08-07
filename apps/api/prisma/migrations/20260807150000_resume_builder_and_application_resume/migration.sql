-- Resume builder fields + Application.resumeId
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "templateKey" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "themeAccent" TEXT;
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "inclusion" JSONB;
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "builderMeta" JSONB;

ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "resumeId" TEXT;

CREATE INDEX IF NOT EXISTS "Application_resumeId_idx" ON "Application"("resumeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Application_resumeId_fkey'
  ) THEN
    ALTER TABLE "Application"
      ADD CONSTRAINT "Application_resumeId_fkey"
      FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill resumeId from snapshot JSON when present
UPDATE "Application" a
SET "resumeId" = (a."resumeSnapshot" -> 'resume' ->> 'id')
WHERE a."resumeId" IS NULL
  AND a."resumeSnapshot" IS NOT NULL
  AND (a."resumeSnapshot" -> 'resume' ->> 'id') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Resume" r WHERE r."id" = (a."resumeSnapshot" -> 'resume' ->> 'id')
  );
