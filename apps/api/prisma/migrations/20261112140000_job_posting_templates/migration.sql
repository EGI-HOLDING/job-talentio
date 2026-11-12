BEGIN;

CREATE TABLE "JobPostingTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceJobId" TEXT,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "draft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobPostingTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JobPostingTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobPostingTemplate_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "JobPost"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "JobPostingTemplate_companyId_sourceJobId_key" ON "JobPostingTemplate"("companyId", "sourceJobId");
CREATE INDEX "JobPostingTemplate_companyId_updatedAt_idx" ON "JobPostingTemplate"("companyId", "updatedAt");

ALTER TABLE "JobCreationSession"
    ADD COLUMN "templateId" TEXT,
    ADD COLUMN "templateIssue" TEXT,
    ADD COLUMN "templateNextAttemptAt" TIMESTAMP(3),
    ADD CONSTRAINT "JobCreationSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "JobPostingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "JobCreationSession_templateId_idx" ON "JobCreationSession"("templateId");
CREATE INDEX "JobCreationSession_template_pending_idx" ON "JobCreationSession"("templateNextAttemptAt", "updatedAt")
    WHERE "templateId" IS NOT NULL AND "jobId" IS NULL AND "templateIssue" IS NULL AND "phase" = 'JOB';

-- The verified Midtrans failure state is already supported by the commerce API.
ALTER TABLE "JobPurchaseOrder" DROP CONSTRAINT "JobPurchaseOrder_status_check";
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_status_check"
  CHECK ("status" IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'REVIEW', 'FAILED'));

COMMIT;
