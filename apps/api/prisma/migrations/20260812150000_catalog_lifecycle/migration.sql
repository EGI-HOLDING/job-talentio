-- Lifecycle columns for every admin-managed lookup table.
--
-- archivedAt hides a row from suggestions, lists and facet options while the
-- rows already pointing at it keep rendering. curatedAt marks a row an admin
-- edited by hand, so the backfills that run on every container start stop
-- rewriting it back to the seed catalog.
ALTER TABLE "Skill" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "JobTitle" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "Language" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "Benefit" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "JobCategory" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "Industry" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "IndustryGroup" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "Country" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "Province" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);
ALTER TABLE "City" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "curatedAt" TIMESTAMP(3);

CREATE INDEX "Skill_archivedAt_idx" ON "Skill"("archivedAt");
CREATE INDEX "JobTitle_archivedAt_idx" ON "JobTitle"("archivedAt");
CREATE INDEX "Language_archivedAt_idx" ON "Language"("archivedAt");
CREATE INDEX "Benefit_archivedAt_idx" ON "Benefit"("archivedAt");
CREATE INDEX "JobCategory_archivedAt_idx" ON "JobCategory"("archivedAt");
CREATE INDEX "Industry_archivedAt_idx" ON "Industry"("archivedAt");
CREATE INDEX "IndustryGroup_archivedAt_idx" ON "IndustryGroup"("archivedAt");
CREATE INDEX "Country_archivedAt_idx" ON "Country"("archivedAt");
CREATE INDEX "Province_archivedAt_idx" ON "Province"("archivedAt");
CREATE INDEX "City_archivedAt_idx" ON "City"("archivedAt");
