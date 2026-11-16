ALTER TABLE "PackagePolicy" ADD COLUMN "catalogVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "JobPublicationPeriod"
    ADD COLUMN "featuredStartsAt" TIMESTAMP(3),
    ADD COLUMN "featuredEndsAt" TIMESTAMP(3);
CREATE INDEX "JobPublicationPeriod_featuredEndsAt_companyId_idx"
    ON "JobPublicationPeriod" ("featuredEndsAt", "companyId");

INSERT INTO "PackagePolicy" ("id", "code", "version", "catalogVersion", "settings")
SELECT 'catalog2:' || tier.code, tier.code::"JobPackageCode", COALESCE(previous.version, 0) + 1, 2,
       jsonb_build_object(
         'durationDays', 30, 'boostDays', tier.boost, 'featuredDays', tier.featured,
         'visibility', tier.visibility, 'conversions', tier.code <> 'LITE',
         'reports', tier.code = 'PREMIUM', 'prioritySupport', tier.code = 'PREMIUM',
         'companyPageLinkedIn', tier.code = 'PREMIUM', 'featuredByPeriod', true
       )
FROM (VALUES ('LITE', 1, 3, 1.0), ('STANDARD', 3, 14, 1.15), ('PREMIUM', 7, 30, 1.3))
    AS tier(code, boost, featured, visibility)
LEFT JOIN LATERAL (
  SELECT MAX("version") AS version FROM "PackagePolicy"
  WHERE "code" = tier.code::"JobPackageCode"
) previous ON true;
