-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "JobPost" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_phone_key" ON "EmployeeProfile"("phone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobPost_companyId_fingerprint_idx" ON "JobPost"("companyId", "fingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobPost_companyId_contentHash_idx" ON "JobPost"("companyId", "contentHash");
