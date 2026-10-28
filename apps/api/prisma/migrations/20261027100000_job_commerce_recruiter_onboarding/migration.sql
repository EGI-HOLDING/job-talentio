ALTER TABLE "JobBenefit" ADD COLUMN "selectionConfirmedAt" TIMESTAMP(3);
ALTER TABLE "JobBenefit" ADD COLUMN "boostAllowanceOffset" INTEGER NOT NULL DEFAULT 0;
UPDATE "JobBenefit" SET "selectionConfirmedAt" = "createdAt";

CREATE TABLE "JobPurchaseOrder" (
  "id" TEXT NOT NULL PRIMARY KEY, "companyId" TEXT NOT NULL, "jobId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, "code" "JobPackageCode" NOT NULL, "intent" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "currency" TEXT NOT NULL DEFAULT 'IDR',
  "amount" INTEGER NOT NULL, "catalogVersion" INTEGER NOT NULL, "policyVersion" INTEGER NOT NULL,
  "policySnapshot" JSONB NOT NULL, "expectedBenefitVersion" TEXT,
  "jobTitle" TEXT NOT NULL, "companyName" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3), "fulfilledAt" TIMESTAMP(3), "provider" TEXT, "providerReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPurchaseOrder_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "JobPurchaseOrder_intent_check" CHECK ("intent" IN ('PURCHASE','UPGRADE','RENEW')),
  CONSTRAINT "JobPurchaseOrder_status_check" CHECK ("status" IN ('PENDING','PAID','CANCELLED','EXPIRED','REVIEW'))
);
CREATE UNIQUE INDEX "JobPurchaseOrder_providerReference_key" ON "JobPurchaseOrder"("providerReference");
CREATE INDEX "JobPurchaseOrder_companyId_createdAt_idx" ON "JobPurchaseOrder"("companyId","createdAt");
CREATE INDEX "JobPurchaseOrder_jobId_status_idx" ON "JobPurchaseOrder"("jobId","status");
CREATE INDEX "JobPurchaseOrder_status_expiresAt_idx" ON "JobPurchaseOrder"("status","expiresAt");

CREATE TABLE "JobPaymentEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobPaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "JobPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobPaymentEvent_provider_eventId_key" ON "JobPaymentEvent"("provider","eventId");

CREATE TABLE "RecruiterOnboarding" (
  "userId" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "step" INTEGER NOT NULL DEFAULT 1, "companyId" TEXT, "jobId" TEXT, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruiterOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecruiterOnboarding_step_check" CHECK ("step" BETWEEN 1 AND 3),
  CONSTRAINT "RecruiterOnboarding_status_check" CHECK ("status" IN ('IN_PROGRESS','COMPLETE','NOT_REQUIRED'))
);
-- Preserve access for every existing recruiter; all future recruiters must onboard.
INSERT INTO "RecruiterOnboarding" ("userId","status","updatedAt")
SELECT "id",'NOT_REQUIRED',CURRENT_TIMESTAMP FROM "User" WHERE "role"='RECRUITER';
