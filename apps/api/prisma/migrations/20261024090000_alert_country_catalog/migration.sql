ALTER TABLE "JobAlert" ADD COLUMN "countryId" TEXT;
ALTER TABLE "JobAlert" ADD CONSTRAINT "JobAlert_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "JobAlert_countryId_idx" ON "JobAlert"("countryId");
UPDATE "JobAlert" a SET "countryId" = p."countryId" FROM "City" c JOIN "Province" p ON p.id = c."provinceId" WHERE a."cityId" = c.id;
