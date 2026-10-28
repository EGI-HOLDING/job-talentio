CREATE TABLE "JobPublicationPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL, "code" "JobPackageCode" NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "JobPublicationPeriod_jobId_cycle_key" ON "JobPublicationPeriod"("jobId","cycle");
CREATE INDEX "JobPublicationPeriod_companyId_code_startsAt_idx" ON "JobPublicationPeriod"("companyId","code","startsAt");
INSERT INTO "JobPublicationPeriod" ("id","jobId","companyId","cycle","code","startsAt","expiresAt","policySnapshot","updatedAt")
SELECT 'period:' || "jobId" || ':1',"jobId","companyId","publicationCycle","highestCode","startsAt","expiresAt","policySnapshot",CURRENT_TIMESTAMP
FROM "JobBenefit" WHERE "startsAt" IS NOT NULL AND "expiresAt" IS NOT NULL;
