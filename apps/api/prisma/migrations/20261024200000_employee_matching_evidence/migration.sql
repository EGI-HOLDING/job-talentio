-- Additive only: preserve all catalog, profile, application and requirement rows.
ALTER TABLE "JobTitle" ADD COLUMN "matchingMetadata" JSONB;
ALTER TABLE "JobPostLanguage" ADD COLUMN "provenance" TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE "JobPostSkill" ADD COLUMN "minLevel" "SkillLevel";
ALTER TABLE "ProfileSkill" ADD COLUMN "levelSource" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';
