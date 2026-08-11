-- Localized display names for lookup catalogs. `name` stays the canonical
-- English label and the final fallback, so existing rows keep rendering.
ALTER TABLE "Skill" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "Country" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "Province" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "City" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "JobCategory" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "IndustryGroup" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "Industry" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "Language" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "Benefit" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
ALTER TABLE "JobTitle" ADD COLUMN "nameUz" TEXT, ADD COLUMN "nameRu" TEXT;
