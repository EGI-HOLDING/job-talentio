-- Optional canonical target role on resumes (for matching / analytics)
ALTER TABLE "Resume" ADD COLUMN IF NOT EXISTS "targetJobTitleId" TEXT;

CREATE INDEX IF NOT EXISTS "Resume_targetJobTitleId_idx" ON "Resume"("targetJobTitleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Resume_targetJobTitleId_fkey'
  ) THEN
    ALTER TABLE "Resume"
      ADD CONSTRAINT "Resume_targetJobTitleId_fkey"
      FOREIGN KEY ("targetJobTitleId") REFERENCES "JobTitle"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
