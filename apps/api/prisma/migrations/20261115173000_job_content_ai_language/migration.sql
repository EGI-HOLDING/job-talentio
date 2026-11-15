ALTER TABLE "JobPost"
    ADD COLUMN "jobContentAiLanguage" VARCHAR(2),
    ADD CONSTRAINT "JobPost_jobContentAiLanguage_check"
        CHECK ("jobContentAiLanguage" IN ('id', 'en'));
