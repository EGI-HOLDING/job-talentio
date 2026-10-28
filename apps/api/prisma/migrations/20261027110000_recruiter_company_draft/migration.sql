ALTER TABLE "RecruiterOnboarding" ADD COLUMN "companyDraft" JSONB;
ALTER TABLE "JobBenefit" ADD COLUMN "publicationCycle" INTEGER NOT NULL DEFAULT 1;
