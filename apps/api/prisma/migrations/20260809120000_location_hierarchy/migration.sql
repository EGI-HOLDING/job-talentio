-- Country → Province → City hierarchy (non-destructive for existing City ids/slugs)

CREATE TYPE "ProvinceType" AS ENUM ('REGION', 'CITY', 'REPUBLIC');

CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iso2" CHAR(2) NOT NULL,
    "iso3" CHAR(3) NOT NULL,
    "phoneCode" TEXT NOT NULL,
    "currencyCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Country_slug_key" ON "Country"("slug");
CREATE UNIQUE INDEX "Country_iso2_key" ON "Country"("iso2");

CREATE TABLE "Province" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "ProvinceType" NOT NULL DEFAULT 'REGION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Province_countryId_idx" ON "Province"("countryId");
CREATE UNIQUE INDEX "Province_countryId_slug_key" ON "Province"("countryId", "slug");

ALTER TABLE "Province" ADD CONSTRAINT "Province_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Staged: nullable until existing cities are mapped
ALTER TABLE "City" ADD COLUMN "provinceId" TEXT;

-- Seed Uzbekistan + provinces (stable ids via slug lookup later; use fixed cuids for SQL)
INSERT INTO "Country" ("id", "name", "slug", "iso2", "iso3", "phoneCode", "currencyCode", "isActive", "createdAt", "updatedAt")
VALUES ('clgeo_country_uz', 'Uzbekistan', 'uzbekistan', 'UZ', 'UZB', '+998', 'UZS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "Province" ("id", "countryId", "name", "slug", "type", "createdAt", "updatedAt") VALUES
  ('clgeo_prov_tashkent_city', 'clgeo_country_uz', 'Tashkent City', 'tashkent-city', 'CITY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_tashkent_region', 'clgeo_country_uz', 'Tashkent Region', 'tashkent-region', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_karakalpakstan', 'clgeo_country_uz', 'Republic of Karakalpakstan', 'karakalpakstan', 'REPUBLIC', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_andijan', 'clgeo_country_uz', 'Andijan', 'andijan', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_bukhara', 'clgeo_country_uz', 'Bukhara', 'bukhara', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_fergana', 'clgeo_country_uz', 'Fergana', 'fergana', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_jizzakh', 'clgeo_country_uz', 'Jizzakh', 'jizzakh', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_kashkadarya', 'clgeo_country_uz', 'Kashkadarya', 'kashkadarya', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_khorezm', 'clgeo_country_uz', 'Khorezm', 'khorezm', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_namangan', 'clgeo_country_uz', 'Namangan', 'namangan', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_navoi', 'clgeo_country_uz', 'Navoi', 'navoi', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_samarkand', 'clgeo_country_uz', 'Samarkand', 'samarkand', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_sirdarya', 'clgeo_country_uz', 'Sirdarya', 'sirdarya', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_surkhandarya', 'clgeo_country_uz', 'Surkhandarya', 'surkhandarya', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('clgeo_prov_other_uz', 'clgeo_country_uz', 'Other Uzbekistan', 'other-uzbekistan', 'REGION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Map known legacy city slugs
UPDATE "City" SET "provinceId" = 'clgeo_prov_tashkent_city' WHERE "slug" = 'tashkent';
UPDATE "City" SET "provinceId" = 'clgeo_prov_tashkent_region' WHERE "slug" IN ('chirchiq', 'angren');
UPDATE "City" SET "provinceId" = 'clgeo_prov_karakalpakstan' WHERE "slug" = 'nukus';
UPDATE "City" SET "provinceId" = 'clgeo_prov_samarkand' WHERE "slug" = 'samarkand';
UPDATE "City" SET "provinceId" = 'clgeo_prov_bukhara' WHERE "slug" = 'bukhara';
UPDATE "City" SET "provinceId" = 'clgeo_prov_andijan' WHERE "slug" = 'andijan';
UPDATE "City" SET "provinceId" = 'clgeo_prov_namangan' WHERE "slug" = 'namangan';
UPDATE "City" SET "provinceId" = 'clgeo_prov_fergana' WHERE "slug" = 'fergana';
UPDATE "City" SET "provinceId" = 'clgeo_prov_khorezm' WHERE "slug" = 'urgench';
UPDATE "City" SET "provinceId" = 'clgeo_prov_navoi' WHERE "slug" = 'navoi';
UPDATE "City" SET "provinceId" = 'clgeo_prov_kashkadarya' WHERE "slug" = 'karshi';
UPDATE "City" SET "provinceId" = 'clgeo_prov_surkhandarya' WHERE "slug" = 'termez';
UPDATE "City" SET "provinceId" = 'clgeo_prov_jizzakh' WHERE "slug" = 'jizzakh';
UPDATE "City" SET "provinceId" = 'clgeo_prov_sirdarya' WHERE "slug" = 'gulistan';

-- Orphans by legacy region string (case-insensitive)
UPDATE "City" c
SET "provinceId" = p."id"
FROM "Province" p
WHERE c."provinceId" IS NULL
  AND p."countryId" = 'clgeo_country_uz'
  AND lower(trim(c."region")) = CASE p."slug"
    WHEN 'tashkent-city' THEN 'tashkent'
    WHEN 'tashkent-region' THEN 'tashkent region'
    WHEN 'karakalpakstan' THEN 'karakalpakstan'
    WHEN 'samarkand' THEN 'samarkand'
    WHEN 'bukhara' THEN 'bukhara'
    WHEN 'andijan' THEN 'andijan'
    WHEN 'namangan' THEN 'namangan'
    WHEN 'fergana' THEN 'fergana'
    WHEN 'khorezm' THEN 'khorezm'
    WHEN 'navoi' THEN 'navoi'
    WHEN 'kashkadarya' THEN 'kashkadarya'
    WHEN 'surkhandarya' THEN 'surkhandarya'
    WHEN 'jizzakh' THEN 'jizzakh'
    WHEN 'sirdarya' THEN 'sirdarya'
    ELSE NULL
  END;

-- Remaining orphans → holding province
UPDATE "City" SET "provinceId" = 'clgeo_prov_other_uz' WHERE "provinceId" IS NULL;

ALTER TABLE "City" ALTER COLUMN "provinceId" SET NOT NULL;

ALTER TABLE "City" ADD CONSTRAINT "City_provinceId_fkey"
  FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "City_provinceId_idx" ON "City"("provinceId");

ALTER TABLE "City" DROP COLUMN "region";
