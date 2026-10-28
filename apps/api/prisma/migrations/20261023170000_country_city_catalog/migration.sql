ALTER TABLE "Province" ADD COLUMN "sourceCode" TEXT;
ALTER TABLE "City" ADD COLUMN "sourceCode" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CITY';
CREATE UNIQUE INDEX "Province_sourceCode_key" ON "Province"("sourceCode");
CREATE UNIQUE INDEX "City_sourceCode_key" ON "City"("sourceCode");
CREATE TABLE "CityAlias" (
  "id" TEXT NOT NULL,
  "cityId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "aliasKey" TEXT NOT NULL,
  CONSTRAINT "CityAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CityAlias_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CityAlias_cityId_aliasKey_key" ON "CityAlias"("cityId", "aliasKey");
CREATE INDEX "CityAlias_aliasKey_idx" ON "CityAlias"("aliasKey");
ALTER TABLE "JobPost" ADD COLUMN "countryId" TEXT;
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "JobPost_countryId_idx" ON "JobPost"("countryId");
UPDATE "JobPost" j SET "countryId" = p."countryId"
FROM "City" c JOIN "Province" p ON p.id = c."provinceId"
WHERE j."cityId" = c.id;
