ALTER TABLE "JobPost" ADD COLUMN "assessmentLanguage" VARCHAR(2),
    ADD CONSTRAINT "JobPost_assessmentLanguage_check" CHECK ("assessmentLanguage" IN ('id', 'en'));
ALTER TABLE "JobCreationSession" ADD COLUMN "assessmentLanguage" VARCHAR(2),
    ADD CONSTRAINT "JobCreationSession_assessmentLanguage_check" CHECK ("assessmentLanguage" IN ('id', 'en'));
