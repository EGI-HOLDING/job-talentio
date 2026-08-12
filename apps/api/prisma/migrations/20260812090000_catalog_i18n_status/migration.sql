-- Review state for catalogs users can extend at runtime, plus provenance flags so
-- machine output never overwrites a human translation.
CREATE TYPE "CatalogI18nStatus" AS ENUM ('PENDING', 'COMPLETE', 'IGNORED');

ALTER TABLE "Skill"
    ADD COLUMN "nameUzIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "nameRuIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "i18nStatus" "CatalogI18nStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "JobTitle"
    ADD COLUMN "nameUzIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "nameRuIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "i18nStatus" "CatalogI18nStatus" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "Language"
    ADD COLUMN "nameUzIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "nameRuIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "i18nStatus" "CatalogI18nStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Benefit"
    ADD COLUMN "nameUzIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "nameRuIsMachine" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "i18nStatus" "CatalogI18nStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rows curated by the seed maps are already done; the backfill script decides
-- between PENDING and IGNORED for the rest.
UPDATE "Skill" SET "i18nStatus" = 'COMPLETE' WHERE "nameUz" IS NOT NULL AND "nameRu" IS NOT NULL;
UPDATE "JobTitle" SET "i18nStatus" = 'COMPLETE' WHERE "nameUz" IS NOT NULL AND "nameRu" IS NOT NULL;
UPDATE "Language" SET "i18nStatus" = 'COMPLETE' WHERE "nameUz" IS NOT NULL AND "nameRu" IS NOT NULL;
UPDATE "Benefit" SET "i18nStatus" = 'COMPLETE' WHERE "nameUz" IS NOT NULL AND "nameRu" IS NOT NULL;

CREATE INDEX "Skill_i18nStatus_createdAt_idx" ON "Skill"("i18nStatus", "createdAt");
CREATE INDEX "JobTitle_i18nStatus_createdAt_idx" ON "JobTitle"("i18nStatus", "createdAt");
CREATE INDEX "Language_i18nStatus_createdAt_idx" ON "Language"("i18nStatus", "createdAt");
CREATE INDEX "Benefit_i18nStatus_createdAt_idx" ON "Benefit"("i18nStatus", "createdAt");

-- Company description gets the same source-language treatment as job postings,
-- so the unused CompanyTranslation table can finally be served.
ALTER TABLE "Company" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'uz';

-- Screening questions travel with the posting they belong to.
CREATE TABLE "JobQuestionTranslation" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "isMachine" BOOLEAN NOT NULL DEFAULT false,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobQuestionTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobQuestionTranslation_questionId_locale_key" ON "JobQuestionTranslation"("questionId", "locale");
CREATE INDEX "JobQuestionTranslation_questionId_idx" ON "JobQuestionTranslation"("questionId");

ALTER TABLE "JobQuestionTranslation" ADD CONSTRAINT "JobQuestionTranslation_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "JobQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Profile narrative is never translated, only labelled with the language it was written in.
ALTER TABLE "EmployeeProfile" ADD COLUMN "contentLocale" TEXT;
