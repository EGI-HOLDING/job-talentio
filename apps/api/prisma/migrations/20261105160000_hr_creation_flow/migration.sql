-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "profileDocumentId" TEXT,
ADD COLUMN     "profileSource" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN     "experienceRangeMax" INTEGER,
ADD COLUMN     "experienceRangeMin" INTEGER,
ADD COLUMN     "experienceRangeSource" TEXT,
ADD COLUMN     "kpis" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "positionEntryMode" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "specificExpectations" TEXT;

-- AlterTable
ALTER TABLE "JobPurchaseOrder" ADD COLUMN     "creationSessionId" TEXT,
ADD COLUMN     "paymentRedirectUrl" TEXT,
ADD COLUMN     "providerTransactionId" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RecruiterOnboarding" ADD COLUMN     "creationSessionId" TEXT,
ADD COLUMN     "flowVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "JobCreationSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'PACKAGE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "orderId" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCreationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfileDocument" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "companyId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "fileKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyProfileDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CompanyIndustryGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CompanyIndustryGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobCreationSession_orderId_key" ON "JobCreationSession"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCreationSession_jobId_key" ON "JobCreationSession"("jobId");

-- CreateIndex
CREATE INDEX "JobCreationSession_companyId_updatedAt_idx" ON "JobCreationSession"("companyId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfileDocument_fileKey_key" ON "CompanyProfileDocument"("fileKey");

-- CreateIndex
CREATE INDEX "CompanyProfileDocument_ownerId_createdAt_idx" ON "CompanyProfileDocument"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyProfileDocument_companyId_idx" ON "CompanyProfileDocument"("companyId");

-- CreateIndex
CREATE INDEX "_CompanyIndustryGroups_B_index" ON "_CompanyIndustryGroups"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Company_profileDocumentId_key" ON "Company"("profileDocumentId");

-- AddForeignKey
ALTER TABLE "_CompanyIndustryGroups" ADD CONSTRAINT "_CompanyIndustryGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "BusinessIndustryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CompanyIndustryGroups" ADD CONSTRAINT "_CompanyIndustryGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Certain legacy mappings only. No occupation, CV, application or HR score writes.
INSERT INTO "_CompanyIndustryGroups" ("A","B") SELECT c."industryGroupId",c.id FROM "Company" c WHERE c."industryGroupId" IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO "_CompanyIndustryGroups" ("A","B") SELECT m."groupId",c.id FROM "Company" c JOIN "IndustryGroupMapping" m ON m."industryId"=c."industryId" JOIN "IndustryTaxonomy" t ON t.version=m.version AND t.active WHERE c."industryGroupId" IS NULL ON CONFLICT DO NOTHING;
ALTER TABLE "Company" ADD CONSTRAINT "Company_profile_source_check" CHECK ("profileSource" IN ('MANUAL','DOCUMENT') AND ("profileSource"<>'DOCUMENT' OR "profileDocumentId" IS NOT NULL));
ALTER TABLE "Company" ADD CONSTRAINT "Company_profile_document_fkey" FOREIGN KEY ("profileDocumentId") REFERENCES "CompanyProfileDocument"(id) ON DELETE RESTRICT;
ALTER TABLE "CompanyProfileDocument" ADD CONSTRAINT "CompanyProfileDocument_owner_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE CASCADE;
ALTER TABLE "CompanyProfileDocument" ADD CONSTRAINT "CompanyProfileDocument_company_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "CompanyProfileDocument" ADD CONSTRAINT "CompanyProfileDocument_size_check" CHECK ("sizeBytes">0 AND "sizeBytes"<=5242880);
ALTER TABLE "JobCreationSession" ADD CONSTRAINT "JobCreationSession_company_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "JobCreationSession" ADD CONSTRAINT "JobCreationSession_owner_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "JobCreationSession" ADD CONSTRAINT "JobCreationSession_job_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPost"(id) ON DELETE RESTRICT;
ALTER TABLE "JobCreationSession" ADD CONSTRAINT "JobCreationSession_order_fkey" FOREIGN KEY ("orderId") REFERENCES "JobPurchaseOrder"(id) ON DELETE RESTRICT;
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_creation_fkey" FOREIGN KEY ("creationSessionId") REFERENCES "JobCreationSession"(id) ON DELETE RESTRICT;
ALTER TABLE "JobPurchaseOrder" ADD CONSTRAINT "JobPurchaseOrder_subject_check" CHECK ("jobId" IS NOT NULL OR "creationSessionId" IS NOT NULL);
ALTER TABLE "JobPost" ADD CONSTRAINT "JobPost_effective_experience_check" CHECK (
 ("experienceRangeSource" IS NULL AND "experienceRangeMin" IS NULL AND "experienceRangeMax" IS NULL) OR
 ("experienceRangeSource" IN ('CATALOG_DERIVED','EMPLOYER_ADJUSTED') AND "seniorityLevelCode" IS NOT NULL AND "experienceRangeMin" BETWEEN 0 AND 50 AND "experienceRangeMin" IS NOT NULL AND ("experienceRangeMax" IS NULL OR "experienceRangeMax" BETWEEN "experienceRangeMin" AND 50)));
