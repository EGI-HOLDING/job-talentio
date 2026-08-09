-- Optional CEFR language requirements on job posts
CREATE TABLE "JobPostLanguage" (
    "id" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "minLevel" "LanguageLevel" NOT NULL DEFAULT 'B1',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "JobPostLanguage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPostLanguage_jobPostId_languageId_key" ON "JobPostLanguage"("jobPostId", "languageId");

CREATE INDEX "JobPostLanguage_languageId_idx" ON "JobPostLanguage"("languageId");

ALTER TABLE "JobPostLanguage" ADD CONSTRAINT "JobPostLanguage_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPostLanguage" ADD CONSTRAINT "JobPostLanguage_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;
