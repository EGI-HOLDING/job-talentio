-- CreateEnum
CREATE TYPE "BulkDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED_OPTED_OUT', 'FAILED');

-- AlterTable: GDPR opt-out on candidate profiles
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "bulkCommsOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "bulkCommsOptOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "templateId" TEXT,
    "messageBody" TEXT,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL,
    "deliveryStatus" "BulkDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "statusMoved" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageTemplate_companyId_updatedAt_idx" ON "MessageTemplate"("companyId", "updatedAt");
CREATE INDEX "BulkCampaign_companyId_createdAt_idx" ON "BulkCampaign"("companyId", "createdAt");
CREATE INDEX "BulkCampaign_jobPostId_createdAt_idx" ON "BulkCampaign"("jobPostId", "createdAt");
CREATE INDEX "BulkCampaignRecipient_campaignId_idx" ON "BulkCampaignRecipient"("campaignId");
CREATE INDEX "BulkCampaignRecipient_userId_createdAt_idx" ON "BulkCampaignRecipient"("userId", "createdAt");
CREATE INDEX "BulkCampaignRecipient_applicationId_idx" ON "BulkCampaignRecipient"("applicationId");

ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkCampaign" ADD CONSTRAINT "BulkCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkCampaignRecipient" ADD CONSTRAINT "BulkCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BulkCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
