-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "industryGroupId" TEXT;

-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN     "seniorityLevelCode" TEXT,
ADD COLUMN     "seniorityVersion" TEXT,
ADD COLUMN     "seniorityYearsMax" INTEGER,
ADD COLUMN     "seniorityYearsMin" INTEGER;

-- CreateTable
CREATE TABLE "IndustryTaxonomy" (
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryTaxonomy_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "BusinessIndustryGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameUz" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "boundaries" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessIndustryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryGroupMapping" (
    "industryId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndustryGroupMapping_pkey" PRIMARY KEY ("industryId","version")
);

-- CreateTable
CREATE TABLE "SeniorityCatalog" (
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeniorityCatalog_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "SeniorityLevel" (
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameUz" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "yearsMin" INTEGER NOT NULL,
    "yearsMax" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SeniorityLevel_pkey" PRIMARY KEY ("code","version")
);

-- CreateIndex
CREATE INDEX "BusinessIndustryGroup_version_archivedAt_sortOrder_idx" ON "BusinessIndustryGroup"("version", "archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessIndustryGroup_code_version_key" ON "BusinessIndustryGroup"("code", "version");

-- CreateIndex
CREATE INDEX "IndustryGroupMapping_groupId_idx" ON "IndustryGroupMapping"("groupId");

-- CreateIndex
CREATE INDEX "SeniorityLevel_version_archivedAt_sortOrder_idx" ON "SeniorityLevel"("version", "archivedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "Company_industryGroupId_idx" ON "Company"("industryGroupId");

-- AddForeignKey
ALTER TABLE "BusinessIndustryGroup" ADD CONSTRAINT "BusinessIndustryGroup_version_fkey" FOREIGN KEY ("version") REFERENCES "IndustryTaxonomy"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryGroupMapping" ADD CONSTRAINT "IndustryGroupMapping_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryGroupMapping" ADD CONSTRAINT "IndustryGroupMapping_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BusinessIndustryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeniorityLevel" ADD CONSTRAINT "SeniorityLevel_version_fkey" FOREIGN KEY ("version") REFERENCES "SeniorityCatalog"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_industryGroupId_fkey" FOREIGN KEY ("industryGroupId") REFERENCES "BusinessIndustryGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_seniorityLevelCode_seniorityVersion_fkey" FOREIGN KEY ("seniorityLevelCode", "seniorityVersion") REFERENCES "SeniorityLevel"("code", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One active version per catalog; historical versions and references are retained.
CREATE UNIQUE INDEX "IndustryTaxonomy_one_active" ON "IndustryTaxonomy" (active) WHERE active;
CREATE UNIQUE INDEX "SeniorityCatalog_one_active" ON "SeniorityCatalog" (active) WHERE active;
ALTER TABLE "SeniorityLevel" ADD CONSTRAINT "SeniorityLevel_range_check" CHECK ("yearsMin">=0 AND ("yearsMax" IS NULL OR "yearsMax">="yearsMin"));
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_seniority_snapshot_check" CHECK (
 ("seniorityLevelCode" IS NULL AND "seniorityVersion" IS NULL AND "seniorityYearsMin" IS NULL AND "seniorityYearsMax" IS NULL)
 OR ("seniorityLevelCode" IS NOT NULL AND "seniorityVersion" IS NOT NULL AND "seniorityYearsMin" IS NOT NULL AND "seniorityYearsMin">=0
 AND ("seniorityYearsMax" IS NULL OR "seniorityYearsMax">="seniorityYearsMin")));

CREATE FUNCTION business_catalog_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='IndustryGroupMapping' THEN
  IF NOT EXISTS (SELECT 1 FROM "BusinessIndustryGroup" WHERE id=NEW."groupId" AND version=NEW.version) THEN RAISE EXCEPTION 'INDUSTRY_MAPPING_VERSION_CONFLICT'; END IF;
 ELSIF TG_TABLE_NAME='Company' THEN
  IF NEW."industryGroupId" IS NOT NULL AND NEW."industryId" IS NOT NULL AND NOT EXISTS
   (SELECT 1 FROM "IndustryGroupMapping" WHERE "industryId"=NEW."industryId" AND "groupId"=NEW."industryGroupId") THEN RAISE EXCEPTION 'INDUSTRY_GROUP_CONFLICT'; END IF;
 ELSIF TG_TABLE_NAME='JobPost' THEN
  IF NEW."seniorityLevelCode" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SeniorityLevel" WHERE code=NEW."seniorityLevelCode" AND version=NEW."seniorityVersion"
    AND "yearsMin"=NEW."seniorityYearsMin" AND "yearsMax" IS NOT DISTINCT FROM NEW."seniorityYearsMax") THEN RAISE EXCEPTION 'SENIORITY_SNAPSHOT_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "IndustryGroupMapping_consistency" BEFORE INSERT OR UPDATE ON "IndustryGroupMapping" FOR EACH ROW EXECUTE FUNCTION business_catalog_consistency();
CREATE TRIGGER "Company_industry_consistency" BEFORE INSERT OR UPDATE OF "industryId","industryGroupId" ON "Company" FOR EACH ROW EXECUTE FUNCTION business_catalog_consistency();
CREATE TRIGGER "JobPost_seniority_consistency" BEFORE INSERT OR UPDATE OF "seniorityLevelCode","seniorityVersion","seniorityYearsMin","seniorityYearsMax" ON "JobPost" FOR EACH ROW EXECUTE FUNCTION business_catalog_consistency();
CREATE FUNCTION prevent_seniority_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.code IS DISTINCT FROM OLD.code OR NEW.version IS DISTINCT FROM OLD.version OR NEW."yearsMin" IS DISTINCT FROM OLD."yearsMin" OR NEW."yearsMax" IS DISTINCT FROM OLD."yearsMax" THEN
  RAISE EXCEPTION 'SENIORITY_VERSION_IMMUTABLE: Create a new catalog version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "SeniorityLevel_immutable" BEFORE UPDATE ON "SeniorityLevel" FOR EACH ROW EXECUTE FUNCTION prevent_seniority_rewrite();

